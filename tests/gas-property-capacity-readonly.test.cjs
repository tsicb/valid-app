"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "../central-api/15_Property_Capacity_Diagnostics.gs"),
    "utf8"
);
const NOW = Date.parse("2026-11-18T03:12:04.000Z");
const day = 86400000;
const dateBefore = n => new Date(NOW - n * day).toISOString();

function contextFor(properties) {
    let reads = 0;
    const logs = [];
    const store = {
        getProperties() { reads++; return {...properties}; },
        setProperty() { throw Error("MUST NOT WRITE"); },
        setProperties() { throw Error("MUST NOT WRITE"); },
        deleteProperty() { throw Error("MUST NOT DELETE"); },
        deleteAllProperties() { throw Error("MUST NOT DELETE"); }
    };
    const ctx = vm.createContext({
        Utilities: {newBlob:value=>({getBytes:()=>Buffer.from(String(value), "utf8")})},
        PropertiesService: {getScriptProperties:()=>store},
        API_CONFIG: {REQUEST_PROPERTY_PREFIX:"REQ_"},
        Date, console: {log:s=>logs.push(String(s))}
    });
    vm.runInContext(source, ctx);
    return {ctx, logs, reads:()=>reads};
}
const secret="REDACT_ME_SUPER_SECRET_ABC123";
const token="VIEWER_FAKE_SECRET_TOKEN_VALUE_XYZ";
const workbook="WORKBOOK_PRIVATE_SHEET_ID";
const properties={
    ACCESS_KEY:secret,
    VAA_APPLICATION_IDENTITY_HMAC_V1:"sensitive_hmac_" + secret,
    SCHEMA_VERSION:"3.0",
    SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID:"sensitive_folder_id",
    ["VIEWER_"+token]:JSON.stringify({spreadsheetId:workbook, lastAccessAt:dateBefore(1),accessCount:4}),
    ["RPTREG_"+workbook]:JSON.stringify({spreadsheetId:workbook,fileName:"PRIVATE_CLIENT_COMPANY"}),
    ["VAA_TARGET_UPDATE_"+workbook]:JSON.stringify({requestId:"secret_request",expiresAt:NOW+30000}),
    REQ_DONE: JSON.stringify({status:"READY",createdAt:dateBefore(42),leaseUntil:"",requestId:"PRIVATE_DONE"}),
    REQ_ERROR: JSON.stringify({status:"ERROR",createdAt:dateBefore(95),leaseUntil:"",lastErrorMessage:secret}),
    REQ_PENDING: JSON.stringify({status:"PROCESSING",createdAt:dateBefore(1),leaseUntil:new Date(NOW+90000).toISOString()}),
    REQ_BAD:"not-valid-json",
    REQ_DATELESS:JSON.stringify({status:"READY",createdAt:""}),
    SOME_UNKNOWN_KEY:secret
};

test("readonly scan reads only and logs no property key, value, token, ID or error text",()=>{
    const a=contextFor(properties);
    const result=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",
        a.ctx
    );
    assert.equal(a.reads(),1);
    assert.equal(result.strictReadOnly,true);
    assert.equal(result.includesPropertyValues,false);
    assert.equal(result.includesPropertyKeys,false);
    assert.equal(result.propertyCount,Object.keys(properties).length);
    const output=JSON.stringify(result);
    for(const forbidden of [secret,token,workbook,"SOME_UNKNOWN_KEY","PRIVATE_CLIENT_COMPANY","PRIVATE_DONE","secret_request","REQ_DONE","VIEWER_"+token]){
        assert.equal(output.includes(forbidden),false,forbidden+" was disclosed");
    }
    assert.equal(a.logs.length,0);
    assert.equal(result.estimatedTotalBytes, Object.entries(properties).reduce((n,[key,val])=>n+Buffer.byteLength(key)+Buffer.byteLength(String(val)),0));
    assert.equal(result.estimatedValueBytes, Object.values(properties).reduce((n,val)=>n+Buffer.byteLength(String(val)),0));
});

test("group totals and safe lifecycle summary preserve request statuses and active leases",()=>{
    const {ctx}=contextFor(properties);
    const res=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    const groups=Object.fromEntries(Array.from(res.groups,g=>[g.category,g]));
    assert.equal(groups.REQUEST_RECORDS.count,5);
    assert.equal(groups.VIEWER_MAPPINGS.count,1);
    assert.equal(groups.REPORT_REGISTRY.count,1);
    assert.equal(groups.UPDATE_LEASES.count,1);
    assert.equal(groups.PROTECTED_CONFIG.count,3);
    assert.equal(groups.SYSTEM_CONFIG.count,1);
    assert.equal(groups.OTHER_UNCLASSIFIED.count,1);
    assert.equal(res.requestLifecycle.ready,2);
    assert.equal(res.requestLifecycle.error,1);
    assert.equal(res.requestLifecycle.inProgressOrOther,1);
    assert.equal(res.requestLifecycle.malformed,1);
    assert.equal(res.requestLifecycle.olderThan30Days,2);
    assert.equal(res.requestLifecycle.olderThan90Days,1);
    assert.equal(res.requestLifecycle.activeLease,1);
    assert.equal(res.requestLifecycle.completedOrErrorOlderThan30DaysNoActiveLease,2);
    assert.equal(res.requestLifecycle.missingCreatedAt,1);
});

test("large individual property detected without showing its value",()=>{
    const {ctx}=contextFor({"REQ_BIG":"x".repeat(9400)});
    const result=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(result.groups[0].overSingleValueLimit,1);
    assert.equal(result.largestValueBytes,9400);
    assert.ok(!JSON.stringify(result).includes("xxxxxxxxxx"));
});

test("unknown or fresh requests are never counted as old cleanup candidates",()=>{
    const {ctx}=contextFor({
        REQ_YOUNG:JSON.stringify({status:"READY",createdAt:dateBefore(2)}),
        REQ_BUSY:JSON.stringify({status:"ERROR",createdAt:dateBefore(100),leaseUntil:new Date(NOW+60000).toISOString()}),
        REQ_WORKING:JSON.stringify({status:"PROCESSING",createdAt:dateBefore(100)}),
        REQ_NO_DATE:JSON.stringify({status:"READY"}),
        REQ_UNKNOWN:JSON.stringify({status:"WEIRD",createdAt:dateBefore(100)})
    });
    const result=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(result.requestLifecycle.completedOrErrorOlderThan30DaysNoActiveLease,0);
    assert.equal(result.requestLifecycle.activeLease,1);
});

test("editor-run entry point reads exactly once and logs only the safe summary",()=>{
    const {ctx,logs,reads}=contextFor(properties);
    const output=vm.runInContext("vaaAuditScriptPropertyCapacityReadOnly()",ctx);
    assert.equal(output.audit,"SCRIPT_PROPERTY_CAPACITY_READ_ONLY");
    assert.equal(reads(),1);
    assert.equal(logs.length,1);
    assert.match(logs[0],/^VAA_PROPERTY_CAPACITY_READONLY /);
    assert.doesNotMatch(logs[0],/REDACT_ME|PRIVATE_CLIENT|secret_request|VIEWER_FAKE/);
});


function ready(id, ageDays, mode="CREATE", extra={}) {
    return JSON.stringify({
        requestId:id,
        status:"READY",stage:"READY",
        operationMode:mode,
        spreadsheetId:"private_sheet_"+id,
        createdAt:dateBefore(ageDays),
        updatedAt:dateBefore(ageDays),
        leaseUntil:"",
        ...extra
    });
}

test("recovery preview never changes properties and contains no sensitive keys or values",()=>{
    const p={
        ...properties,
        REQ_OLD_1:ready("OLD_1",50,"CREATE",{secretData:secret}),
        REQ_OLD_2:ready("OLD_2",40,"UPDATE",{anotherSecret:token})
    };
    const {ctx,reads,logs}=contextFor(p);
    // Preview alone reads one snapshot and never calls any mutating methods.
    const preview=vm.runInContext("vaaPreviewOldReadyRequestCleanupReadOnly()",ctx);
    assert.equal(reads(),1);
    assert.equal(preview.strictReadOnly,true);
    assert.equal(preview.cleanupExecuted,false);
    assert.equal(preview.eligibleCount,2);
    assert.equal(preview.eligibleByMode.CREATE.count,1);
    assert.equal(preview.eligibleByMode.UPDATE.count,1);
    assert.equal(logs.length,1);
    assert.match(logs[0],/^VAA_REQUEST_CLEANUP_PREFLIGHT_READONLY /);
    for(const secretString of [secret,token,workbook,"OLD_1","OLD_2","private_sheet","SOME_UNKNOWN_KEY"]){
        assert.equal(JSON.stringify(preview).includes(secretString),false);
        assert.equal(logs[0].includes(secretString),false);
    }
});

test("recovery preview excludes active, recent, nonready, mismatched, malformed and unknown records",()=>{
    const p={
        REQ_OLD_READY:ready("OLD_READY",40),
        REQ_RECENT:ready("RECENT",20),
        REQ_BROKEN:ready("other_request_id",50),
        REQ_ERROR:JSON.stringify({status:"ERROR",stage:"READY",createdAt:dateBefore(50)}),
        REQ_BUSY:ready("BUSY",40,"UPDATE",{leaseUntil:new Date(NOW+100000).toISOString()}),
        REQ_MALFORMED:"not-json",
        REQ_INCOMPLETE:ready("INCOMPLETE",50,"CREATE",{stage:"REPORT_DONE"}),
        REQ_BADTIME:ready("BADTIME",50,"CREATE",{createdAt:"invalid-date"}),
        REQ_NO_TARGET:ready("NO_TARGET",60,"CREATE",{spreadsheetId:""}),
        REQ_INVALIDMODE:ready("INVALIDMODE",50,"UNK")
    };
    const {ctx}=contextFor(p);
    const out=vm.runInContext(
        "vaaOldReadyRequestCleanupPreview_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",
        ctx
    );
    assert.equal(out.eligibleCount,1);
    assert.equal(out.exclusionCounts.tooRecent,1);
    assert.equal(out.exclusionCounts.notReady,1);
    assert.equal(out.exclusionCounts.activeOrUnverifiableLease,1);
    assert.equal(out.exclusionCounts.malformed,1);
    assert.equal(out.exclusionCounts.statusOrStageMismatch,1);
    assert.equal(out.exclusionCounts.unknownDate,1);
    assert.equal(out.exclusionCounts.missingTarget,1);
    assert.equal(out.exclusionCounts.missingOrMismatchedRequestId,1);
    assert.equal(out.exclusionCounts.unknownOperationMode,1);
    assert.equal(out.proposedCount,0,"below 75% quota should propose no changes");
});

test("recovery preview targets 75 percent by oldest first and accurately accounts bytes",()=>{
    const p={
        ACCESS_KEY:"PRIVATE_MASTER_SECRET",
        ["VIEWER_ABC"]:"PRIVATE_VIEWER_MAPPING"
    };
    for(let i=0;i<180;i++){
        const id="RECEIPT_"+String(i).padStart(3,"0");
        p["REQ_"+id]=ready(id,60+i%20,i%2?"CREATE":"UPDATE",{performance:"x".repeat(3350)});
    }
    const {ctx}=contextFor(p);
    const plan=vm.runInContext(
        "vaaOldReadyRequestCleanupPreview_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(plan.eligibleCount,180);
    assert.ok(plan.currentEstimatedBytes>512000);
    assert.ok(plan.proposedCount>0);
    assert.ok(plan.proposedCount<plan.eligibleCount);
    assert.equal(plan.eligibleByMode.CREATE.count,90);
    assert.equal(plan.eligibleByMode.UPDATE.count,90);
    assert.equal(plan.proposedByMode.CREATE.count+plan.proposedByMode.UPDATE.count,plan.proposedCount);
    assert.equal(plan.currentEstimatedBytes-plan.proposedEstimatedFreedBytes,plan.projectedEstimatedBytes);
    assert.ok(plan.projectedEstimatedBytes<=plan.targetBytes);
    assert.ok(plan.canReachTargetWithOldReadyOnly);
});

test("recovery preview reports insufficiency rather than including young or active requests",()=>{
    const p={ACCESS_KEY:"X".repeat(530000)};
    p.REQ_FRESH=ready("FRESH",4);
    p.REQ_OLD=ready("OLD",45,"CREATE",{notes:"x".repeat(1000)});
    const {ctx}=contextFor(p);
    const plan=vm.runInContext(
        "vaaOldReadyRequestCleanupPreview_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(plan.eligibleCount,1);
    assert.equal(plan.proposedCount,1);
    assert.equal(plan.canReachTargetWithOldReadyOnly,false);
    assert.ok(plan.projectedUsagePercent>75);
    assert.equal(plan.exclusionCounts.tooRecent,1);
});

test("read-only source has no mutation, network, Drive or spreadsheet calls",()=>{
    assert.doesNotMatch(source, /\.setProperty\s*\(/);
    assert.doesNotMatch(source, /\.deleteProperty\s*\(/);
    assert.doesNotMatch(source, /\.setProperties\s*\(/);
    assert.doesNotMatch(source, /DriveApp|SpreadsheetApp|UrlFetchApp|ScriptApp|LockService/);
});


test("performance-only preview keeps all request receipts and does not expose sensitive fields",()=>{
    const p={
        ACCESS_KEY:secret,
        ["VIEWER_"+token]:JSON.stringify({spreadsheetId:workbook}),
        REQ_OLD_CREATE:ready("OLD_CREATE",65,"CREATE",{
            updateStats:{finalApplications:40},
            performance:{datasetWrites:{applicationData:{elapsedMs:123}},privateValue:secret}
        }),
        REQ_OLD_UPDATE:ready("OLD_UPDATE",45,"UPDATE",{
            updateStrategy:"APPEND",updatePayloadDigest:secret,
            targetSpreadsheetId:workbook,
            performance:{updateReadMs:4000,trace:token}
        }),
        REQ_RECENT:ready("RECENT",2,"CREATE",{performance:{trace:"x".repeat(200)}}),
        REQ_FAILED:JSON.stringify({requestId:"FAILED",status:"ERROR",stage:"CREATED",performance:{trace:"x".repeat(200)}})
    };
    const before=JSON.stringify(p);
    const {ctx,reads,logs}=contextFor(p);
    const output=vm.runInContext("vaaPreviewReadyRequestPerformanceCompactionReadOnly()",ctx);
    assert.equal(reads(),1);
    assert.equal(before,JSON.stringify(p));
    assert.equal(output.strictReadOnly,true);
    assert.equal(output.propertiesModified,0);
    assert.equal(output.propertiesDeleted,0);
    assert.equal(output.eligibleCount,2);
    assert.equal(output.eligibleByMode.CREATE.count,1);
    assert.equal(output.eligibleByMode.UPDATE.count,1);
    assert.equal(output.exclusionCounts.recent,1);
    assert.equal(output.exclusionCounts.nonReady,1);
    assert.ok(output.eligibleSavingsBytes>0);
    assert.equal(logs.length,1);
    assert.match(logs[0],/^VAA_PERFORMANCE_COMPACTION_PREFLIGHT_READONLY /);
    for (const item of [secret,token,workbook,"REQ_OLD_CREATE","OLD_UPDATE","APPEND","privateValue"]){
        assert.equal(JSON.stringify(output).includes(item),false);
        assert.equal(logs[0].includes(item),false);
    }
});

test("performance-only preview excludes invalid and risky request receipts",()=>{
    const p={
        REQ_A:ready("A",35,"CREATE",{performance:{processingMs:900}}),
        REQ_B:ready("B",35,"UPDATE",{performance:{processingMs:200},stage:"PROCESSING"}),
        REQ_C:ready("C",35,"UPDATE",{performance:{processingMs:200},leaseUntil:new Date(NOW+1000).toISOString()}),
        REQ_D:ready("D",40,"CREATE",{performance:{processingMs:200},requestId:"OTHER"}),
        REQ_E:ready("E",40,"CREATE",{performance:{processingMs:200},createdAt:"wrong-date"}),
        REQ_F:ready("F",40,"CREATE",{performance:{processingMs:200},spreadsheetId:""}),
        REQ_G:ready("G",40,"UNKNOWN",{performance:{processingMs:200}}),
        REQ_H:ready("H",40,"CREATE",{performance:null}),
        REQ_I:"invalid JSON",
        REQ_J:ready("J",10,"CREATE",{performance:{processingMs:300}})
    };
    const {ctx}=contextFor(p);
    const output=vm.runInContext(
        "vaaReadyRequestPerformancePreview_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(output.eligibleCount,1);
    assert.equal(output.exclusionCounts.nonReady,1);
    assert.equal(output.exclusionCounts.activeOrInvalidLease,1);
    assert.equal(output.exclusionCounts.invalidRequestId,1);
    assert.equal(output.exclusionCounts.missingOrFutureDate,1);
    assert.equal(output.exclusionCounts.noSpreadsheetId,1);
    assert.equal(output.exclusionCounts.unknownMode,1);
    assert.equal(output.exclusionCounts.missingOrEmptyPerformance,1);
    assert.equal(output.exclusionCounts.invalidJson,1);
    assert.equal(output.exclusionCounts.recent,1);
    assert.equal(output.proposedCount,0,"already below target usage");
});

test("large performance blocks can reach 75% usage without deleting request IDs",()=>{
    const p={ACCESS_KEY:"KEEP_THIS",VIEWER_PRIVATE:"DO_NOT_TOUCH"};
    for(let i=0;i<180;i++){
        const id="PERF_"+String(i).padStart(3,"0");
        p["REQ_"+id]=ready(id,35+i%30,i%2===0?"CREATE":"UPDATE",{
            updatePayloadDigest:"digest_"+id,
            updateStrategy:i%2===0?"":"APPEND",
            performance:{datasetWrites:{"applicationData":{details:"x".repeat(2800)}},traceMs:123}
        });
    }
    const {ctx}=contextFor(p);
    const output=vm.runInContext(
        "vaaReadyRequestPerformancePreview_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(output.eligibleCount,180);
    assert.ok(output.beforeEstimatedBytes>512000);
    assert.ok(output.proposedCount>0);
    assert.ok(output.proposedCount<180);
    assert.ok(output.canReachTargetWithPerformanceOnly);
    assert.equal(output.beforeEstimatedBytes-output.proposedSavingsBytes,output.projectedEstimatedBytes);
    assert.ok(output.projectedEstimatedBytes<=384000);
    assert.equal(output.proposedByMode.CREATE.count+output.proposedByMode.UPDATE.count,output.proposedCount);
    assert.equal(output.propertiesDeleted,0);
});

test("performance savings are reported insufficient when other properties dominate",()=>{
    const p={
        ACCESS_KEY:"x".repeat(527000),
        REQ_OLD:ready("OLD",40,"CREATE",{performance:{trace:"x".repeat(100)}})
    };
    const {ctx}=contextFor(p);
    const output=vm.runInContext(
        "vaaReadyRequestPerformancePreview_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(output.eligibleCount,1);
    assert.equal(output.proposedCount,1);
    assert.equal(output.canReachTargetWithPerformanceOnly,false);
    assert.ok(output.projectedUsagePercent>75);
});

test("removing only performance preserves all stored replay and response fields",()=>{
    const original=JSON.parse(ready("UPDATE_123",40,"UPDATE",{
        updateStrategy:"APPEND",
        updatePayloadDigest:"digest_do_not_change",
        targetSpreadsheetId:"sheet_does_not_change",
        viewerUrl:"report_url_kept",
        manageUrl:"manage_url_kept",
        updateStats:{finalApplications:34,finalJobs:7},
        performance:{largeInternals:"x".repeat(1234)}
    }));
    const compacted={...original};
    delete compacted.performance;
    assert.deepEqual(Object.keys(original).filter(k=>k!=="performance").sort(),
                     Object.keys(compacted).sort());
    assert.equal(compacted.requestId,"UPDATE_123");
    assert.equal(compacted.status,"READY");
    assert.equal(compacted.stage,"READY");
    assert.equal(compacted.operationMode,"UPDATE");
    assert.equal(compacted.updatePayloadDigest,"digest_do_not_change");
    assert.equal(compacted.targetSpreadsheetId,"sheet_does_not_change");
    assert.equal(compacted.viewerUrl,"report_url_kept");
    assert.equal(compacted.manageUrl,"manage_url_kept");
    assert.deepEqual(compacted.updateStats,{finalApplications:34,finalJobs:7});
    assert.ok(Buffer.byteLength(JSON.stringify(original))>Buffer.byteLength(JSON.stringify(compacted)));
});
