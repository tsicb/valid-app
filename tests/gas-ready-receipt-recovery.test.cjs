"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const dir=path.resolve(__dirname,"../central-api");
const diagnostic=fs.readFileSync(path.join(dir,"15_Property_Capacity_Diagnostics.gs"),"utf8");
const recovery=fs.readFileSync(path.join(dir,"16_Ready_Receipt_Recovery.gs"),"utf8");
const haltAudit=fs.readFileSync(path.join(dir,"17_Ready_Receipt_Halt_Audit.gs"),"utf8");

const secret="SUPER_PRIVATE_BACKUP_SECRET_FAKE_ONLY";
function oldReady(id, {days=45,mode="CREATE",performanceSize=3700,extras={}}={}) {
    return JSON.stringify({
        status:"READY", stage:"READY", requestId:id, operationMode:mode,
        spreadsheetId:"private_fake_sheet_"+id,
        targetSpreadsheetId:mode==="UPDATE"?"existing_target_"+id:"",
        createdAt:new Date(Date.now()-days*86400000).toISOString(),
        updatedAt:new Date(Date.now()-1*86400000).toISOString(),
        leaseUntil:"",
        updateStrategy:mode==="UPDATE"?"APPEND":"",
        updatePayloadDigest:mode==="UPDATE"?"sha256_fake_data_"+id:"",
        viewerUrl:"https://fake.example.com/report/#r=private_token",
        updateStats:{total:34},
        performance:{executionTimeMs:44,privateTrace:secret,details:"x".repeat(performanceSize)},
        ...extras
    });
}
function fixture(count=150) {
    const props={
        ACCESS_KEY:secret,
        VIEWER_SECRET:"viewer-mapping-preserved",
        RPTREG_PRIVATE:"registry-preserved"
    };
    for(let i=0;i<count;i++){
        const id="REQ"+String(i).padStart(3,"0");
        props["REQ_"+id]=oldReady(id,{days:45+i%20,mode:i%3===0?"UPDATE":"CREATE"});
    }
    props.REQ_BUSY=oldReady("BUSY",{days:50,extras:{status:"PROCESSING"}});
    props.REQ_ERROR=oldReady("ERROR",{days:50,extras:{status:"ERROR"}});
    props.REQ_RECENT=oldReady("RECENT",{days:3});
    return props;
}
function setup({properties=fixture(),privateBackup=true,failAt=Infinity}={}){
    const scriptProps={...properties};
    const userProps={};
    const files=new Map();
    const calls={scriptReads:0,scriptWrites:0,scriptDeletes:0,userWrites:0,locks:0,unlocks:0,backupCreates:0};
    const logs=[];
    const script={
        getProperties(){calls.scriptReads++;return {...scriptProps};},
        getProperty(k){return scriptProps[k]??null;},
        setProperty(k,v){
            calls.scriptWrites++;
            if(calls.scriptWrites===failAt)throw Error("mock quota error");
            scriptProps[k]=String(v);
        },
        deleteProperty(){calls.scriptDeletes++;throw Error("MUST NOT DELETE");}
    };
    const user={
        getProperty(k){return userProps[k]??null;},
        setProperty(k,v){calls.userWrites++;userProps[k]=String(v);},
        deleteProperty(k){calls.userWrites++;delete userProps[k];}
    };
    const DriveApp={
        Access:{PRIVATE:"PRIVATE",ANYONE:"ANYONE"},
        Permission:{NONE:"NONE"},
        createFile(name,content,mime){
            calls.backupCreates++;
            const id="PRIVATE_BACKUP_FILE_"+calls.backupCreates;
            const file={
                id,
                name,
                text:String(content),
                mime,
                access:privateBackup?"PRIVATE":"ANYONE",
                getId(){return id;},
                setSharing(){throw Error("must not rewrite backup permissions");},
                setContent(value){
                    if(this.access!=="PRIVATE")throw Error("must never write to a public backup");
                    this.text=String(value);
                    return this;
                },
                getSharingAccess(){return this.access;},
                getName(){return this.name;},
                isTrashed(){return false;},
                getBlob(){return {getDataAsString:()=>this.text};}
            };
            files.set(id,file);
            return file;
        },
        getFileById(id){const f=files.get(id);if(!f)throw Error("missing");return f;}
    };
    const Utilities={
        DigestAlgorithm:{SHA_256:"SHA_256"},
        Charset:{UTF_8:"UTF-8"},
        computeDigest(alg,data){return Array.from(crypto.createHash("sha256").update(String(data),"utf8").digest()).map(x=>x>127?x-256:x);},
        newBlob(text,mime,name){
            return {text:String(text),mime,name,getBytes(){return Buffer.from(String(text),"utf8");}};
        }
    };
    const ctx=vm.createContext({
        Date,console:{log:s=>logs.push(String(s)),error:s=>logs.push(String(s))},
        Utilities,DriveApp,API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_"},
        PropertiesService:{getScriptProperties:()=>script,getUserProperties:()=>user},
        LockService:{getScriptLock:()=>({waitLock(){calls.locks++;},releaseLock(){calls.unlocks++;}})}
    });
    vm.runInContext(diagnostic,ctx);
    vm.runInContext(recovery,ctx);
    vm.runInContext(haltAudit,ctx);
    const run=code=>vm.runInContext(code,ctx);
    return {ctx,run,calls,logs,scriptProps,userProps,files,original:{...properties}};
}

test("backup preparation is private and non-mutating; it never logs sensitive metadata",()=>{
    const h=setup();
    const result=h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    assert.equal(result.phase,"PREPARED_PRIVATE_BACKUP");
    assert.equal(result.scriptPropertiesModified,0);
    assert.equal(result.scriptPropertiesDeleted,0);
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.calls.scriptDeletes,0);
    assert.equal(h.calls.backupCreates,1);
    assert.equal(h.calls.locks,1);
    assert.equal(h.calls.unlocks,1);
    assert.deepEqual(h.scriptProps,h.original);
    assert.ok(result.proposedCount>0);
    assert.ok(result.estimatedAfterBytes<=384000);
    assert.equal(h.files.size,1);
    const backup=[...h.files.values()][0];
    assert.equal(backup.getSharingAccess(),"PRIVATE");
    assert.match(backup.text,/SUPER_PRIVATE_BACKUP_SECRET/,"private backup stores original exact values");
    const safe=JSON.stringify(result)+h.logs.join("");
    assert.doesNotMatch(safe,/SUPER_PRIVATE_BACKUP_SECRET|REQ001|PRIVATE_BACKUP_FILE|private_fake_sheet/);
    assert.ok(Object.keys(h.userProps).some(k=>k.includes("PLAN")));
    assert.throws(()=>h.run("vaaPrepareReadyPerformanceCompactionBackup()"),/PLAN_ALREADY_PREPARED/);
});

test("non-private blank Drive files never receive original receipt contents",()=>{
    const h=setup({privateBackup:false});
    assert.throws(()=>h.run("vaaPrepareReadyPerformanceCompactionBackup()"),/BACKUP_PREPARATION_FAILED/);
    assert.equal(h.calls.backupCreates,1);
    const orphan=[...h.files.values()][0];
    assert.equal(orphan.text,"");
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.calls.scriptDeletes,0);
    assert.equal(Object.keys(h.userProps).length,0);
});

test("commit without same-user manual approval is rejected and leaves receipts untouched",()=>{
    const h=setup();
    assert.throws(()=>h.run("vaaCommitReadyPerformanceCompaction()"),/BACKUP_REQUIRED/);
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    assert.throws(()=>h.run("vaaCommitReadyPerformanceCompaction()"),/EXPLICIT_APPROVAL_REQUIRED/);
    assert.equal(h.calls.scriptWrites,0);
});

test("prepared backups which are not private must not be authorized",()=>{
    const h=setup({privateBackup:true});
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    const file=[...h.files.values()][0];
    file.access="ANYONE";
    assert.throws(()=>h.run("vaaAuthorizeReadyPerformanceCompaction()"),/BACKUP_NOT_PRIVATE/);
    assert.equal(h.calls.scriptWrites,0);
});

test("authorization is distinct from commit; the latter keeps IDs, digests and Viewer data",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    const approved=h.run("vaaAuthorizeReadyPerformanceCompaction()");
    assert.equal(approved.phase,"APPROVED_NOT_COMMITTED");
    assert.equal(h.calls.scriptWrites,0);
    const beforeTotal=h.run("vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(),Date.now()).estimatedTotalBytes");
    const result=h.run("vaaCommitReadyPerformanceCompaction()");
    assert.equal(result.phase,"COMMITTED_VERIFIED");
    assert.equal(result.scriptPropertiesDeleted,0);
    assert.ok(result.scriptPropertiesModified>0);
    assert.equal(h.calls.scriptDeletes,0);
    assert.equal(h.files.size,1);
    assert.equal(result.estimatedAfterBytes, h.run("vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(),Date.now()).estimatedTotalBytes"));
    assert.ok(result.estimatedAfterBytes<beforeTotal);
    assert.ok(result.estimatedAfterBytes<=384000);
    assert.equal(h.calls.locks,h.calls.unlocks);
    const modified=Object.keys(h.original).filter(k=>h.original[k]!==h.scriptProps[k]);
    assert.equal(modified.length,result.scriptPropertiesModified);
    for(const key of Object.keys(h.original)){
        if(!modified.includes(key))assert.equal(h.scriptProps[key],h.original[key]);
        if(!key.startsWith("REQ_")||!modified.includes(key))continue;
        const before=JSON.parse(h.original[key]);
        const after=JSON.parse(h.scriptProps[key]);
        delete before.performance;
        assert.deepEqual(after,before,"only performance changed: "+key);
    }
    assert.equal(h.scriptProps.ACCESS_KEY,secret);
    assert.equal(h.scriptProps.VIEWER_SECRET,"viewer-mapping-preserved");
    assert.equal(h.scriptProps.RPTREG_PRIVATE,"registry-preserved");
    assert.ok(!Object.keys(h.userProps).some(k=>k.includes("COMPACTION_PLAN")));
    assert.equal(h.logs.filter(l=>l.startsWith("VAA_COMPACTION_COMMITTED")).length,1);
    const safe=h.logs.join("");
    assert.doesNotMatch(safe,/SUPER_PRIVATE_BACKUP_SECRET|private_fake_sheet|PRIVATE_BACKUP_FILE/);
});

test("a change to ANY property since backup causes a fail-closed abort",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    h.run("vaaAuthorizeReadyPerformanceCompaction()");
    h.scriptProps.RPTREG_PRIVATE="concurrent registry edit";
    assert.throws(()=>h.run("vaaCommitReadyPerformanceCompaction()"),/STOPPED_AFTER_0_UPDATES/);
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.scriptProps.RPTREG_PRIVATE,"concurrent registry edit");
    assert.equal(h.files.size,1);
});

test("tampered backup content is rejected before any Script Property mutation",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    const file=[...h.files.values()][0];
    file.text+=" ";
    assert.throws(()=>h.run("vaaAuthorizeReadyPerformanceCompaction()"),/BACKUP_DIGEST_MISMATCH/);
    assert.equal(h.calls.scriptWrites,0);
});

test("a failed write stops immediately, keeps backup, and never deletes receipts",()=>{
    const h=setup({failAt:3});
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    h.run("vaaAuthorizeReadyPerformanceCompaction()");
    assert.throws(()=>h.run("vaaCommitReadyPerformanceCompaction()"),/STOPPED_AFTER_2_UPDATES/);
    assert.equal(h.calls.scriptWrites,3);
    assert.equal(h.calls.scriptDeletes,0);
    assert.equal(h.files.size,1);
    assert.ok(h.logs.some(l=>l.includes('"appliedCount":2')));
    const diff=Object.keys(h.original).filter(k=>h.original[k]!==h.scriptProps[k]);
    assert.equal(diff.length,2);
    assert.throws(()=>h.run("vaaCommitReadyPerformanceCompaction()"),/STOPPED_AFTER_0_UPDATES/,
        "snapshot mismatch prevents rerunning after a partial commit");
});

test("source contains no Script Property delete call or web-call entry point",()=>{
    assert.doesNotMatch(recovery,/getScriptProperties\(\)\.deleteProperty\(/);
    assert.doesNotMatch(recovery,/props\.deleteProperty\(/);
    assert.doesNotMatch(recovery,/function\s+(?:doPost|doGet)\s*\(/);
    assert.match(recovery,/lock\.waitLock\(30000\)/);
    assert.match(recovery,/vaaRecoverySnapshotDigest_\(/);
    assert.match(recovery,/file\.getSharingAccess\(\) !== DriveApp\.Access\.PRIVATE/);
});

test("halt audit is read-only; matching snapshot narrows failure to first write/readback",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    h.run("vaaAuthorizeReadyPerformanceCompaction()");
    const before={...h.scriptProps};
    const uBefore={...h.userProps};
    const result=h.run("vaaAuditStoppedReadyPerformanceCompactionReadOnly()");
    assert.equal(result.phase,"HALTED_COMPACTION_AUDIT_READONLY");
    assert.equal(result.strictReadOnly,true);
    assert.equal(result.snapshotUnchanged,true);
    assert.equal(result.backupVerifiedPrivateAndIntact,true);
    assert.equal(result.prewritePlanRevalidationPassed,true);
    assert.equal(result.selectedStillOriginal,result.plannedCount);
    assert.equal(result.selectedAlreadyCompacted,0);
    assert.equal(result.diagnostic,"PREWRITE_CHECKS_PASS_FIRST_WRITE_OR_READBACK_FAILURE_SUSPECTED");
    assert.equal(result.commitRetryAuthorized,false);
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.calls.scriptDeletes,0);
    assert.deepEqual(h.scriptProps,before);
    assert.deepEqual(h.userProps,uBefore);
    assert.equal(h.calls.locks,h.calls.unlocks);
    assert.doesNotMatch(h.logs.join(""),/SUPER_PRIVATE_BACKUP_SECRET|PRIVATE_BACKUP_FILE|private_fake_sheet|REQ001/);
});
test("halt audit identifies unrelated Script Property changes without writing",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    h.run("vaaAuthorizeReadyPerformanceCompaction()");
    h.scriptProps.RPTREG_PRIVATE="changed concurrently";
    const result=h.run("vaaAuditStoppedReadyPerformanceCompactionReadOnly()");
    assert.equal(result.snapshotUnchanged,false);
    assert.equal(result.selectedStillOriginal,result.plannedCount);
    assert.equal(result.selectedAlreadyCompacted,0);
    assert.equal(result.diagnostic,"SNAPSHOT_CHANGED_SINCE_PREPARE_DO_NOT_RETRY");
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.calls.scriptDeletes,0);
});
test("halt audit spots accepted first write even when prior appliedCount remained zero",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    h.run("vaaAuthorizeReadyPerformanceCompaction()");
    const file=[...h.files.values()][0];
    const one=JSON.parse(file.text).selected[0];
    h.scriptProps[one.key]=one.compacted;
    const result=h.run("vaaAuditStoppedReadyPerformanceCompactionReadOnly()");
    assert.equal(result.selectedAlreadyCompacted,1);
    assert.equal(result.selectedStillOriginal,result.plannedCount-1);
    assert.equal(result.diagnostic,"TARGET_WRITE_DETECTED_DO_NOT_RETRY");
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.calls.scriptDeletes,0);
    assert.doesNotMatch(h.logs.join(""),/SUPER_PRIVATE_BACKUP_SECRET|PRIVATE_BACKUP_FILE|private_fake_sheet/);
});
test("halt audit refuses compromised private backup without touching properties",()=>{
    const h=setup();
    h.run("vaaPrepareReadyPerformanceCompactionBackup()");
    const file=[...h.files.values()][0];
    file.text+="altered";
    const result=h.run("vaaAuditStoppedReadyPerformanceCompactionReadOnly()");
    assert.equal(result.diagnostic,"BACKUP_DIGEST_MISMATCH");
    assert.equal(h.calls.scriptWrites,0);
    assert.equal(h.calls.scriptDeletes,0);
});
