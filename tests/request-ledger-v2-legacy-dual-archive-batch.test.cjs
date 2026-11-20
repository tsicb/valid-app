"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const script=fs.readFileSync(path.join(__dirname,
  "../central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs"),"utf8");
const ID="HISTORIC_READY_CREATE";
const TARGET="SENSITIVE_ISOLATED_TARGET";
const ROOT="PRODUCTION_ROOT_TEST_STRING";
const OUT="PRODUCTION_OUTPUT_TEST_STRING";
const MAIN="MAIN_PRIVATE_LEDGER_0123456789";
const BACK="BACKUP_PRIVATE_LEDGER_0123456789";
const SECRET="NEVER_LOG_THIS_RAW_VALUE";
const original={
  requestId:ID,operationMode:"CREATE",status:"READY",stage:"READY",
  spreadsheetId:TARGET,createdAt:"2026-10-01T00:00:00Z",
  secret:SECRET
};
const raw=JSON.stringify(original);

function fixture(opt={}){
  const properties={
    REQ_HISTORIC_READY_CREATE:raw,
    VAA_PROD_LEGACY_MIGRATION_MODE:opt.mode||"OFF",
    VAA_PROD_LEGACY_BACKUP_SPREADSHEET_ID:BACK,
    VAA_PROD_LEDGER_ROOT_ID:ROOT,
    VAA_PROD_LEDGER_OUTPUT_ID:OUT,
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:MAIN
  };
  if(opt.invalidReceipt)properties["REQ_"+ID]="BAD_JSON";
  if(opt.nonready)properties["REQ_"+ID]=JSON.stringify({...original,status:"ERROR"});
  const LEGACY_ID="LEGACY_UPDATE_WITHOUT_DIGEST_OR_STRATEGY";
  if(opt.legacyUpdateWithoutMetadata || opt.legacyUpdateBadTarget){
    properties["REQ_"+LEGACY_ID]=JSON.stringify({
      requestId:LEGACY_ID,operationMode:"UPDATE",
      status:"READY",stage:"READY",spreadsheetId:TARGET,
      targetSpreadsheetId:opt.legacyUpdateBadTarget?"OTHER_TARGET":TARGET,
      updateStrategy:"",updatePayloadDigest:""
    });
  }
  const a={archive:new Map(opt.alreadyPrimary?[[ID,raw]]:[])};
  const b={archive:new Map(opt.alreadyBackup?[[ID,raw]]:[])};
  if(opt.conflictBackup)b.archive.set(ID,"DIFFERENT"+SECRET);
  const calls={backupWrites:0,primaryWrites:0,deletes:0,locks:0,
    releases:0,logs:[],reads:0};
  const props={
    getProperty:k=>properties[k]||null,
    getProperties:()=>({...properties}),
    deleteProperty:k=>{calls.deletes++;delete properties[k];}
  };
  const getBook=id=>id===MAIN?a:id===BACK?b:null;
  const file={
    getMimeType:()=>"GOOGLE_SHEETS",
    getSharingAccess:()=>opt.notPrivate?"DOMAIN":"PRIVATE",
    isTrashed:()=>false,
    getParents:()=>({n:0,hasNext(){return this.n++<1;},
      next(){return {getId:()=>ROOT};}})
  };
  const mock={
    console:{log:s=>calls.logs.push(String(s))},
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_",SHEET_OUTPUT_FOLDER_ID:OUT},
    VAA_LEDGER_READY_PROPERTY_:"VAA_REQUEST_LEDGER_SPREADSHEET_ID",
    VAA_LEDGER_PROD_ROOT_PROP_:"VAA_PROD_LEDGER_ROOT_ID",
    VAA_LEDGER_PROD_OUTPUT_PROP_:"VAA_PROD_LEDGER_OUTPUT_ID",
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    DriveApp:{Access:{PRIVATE:"PRIVATE"},getFileById:id=>{
      if(opt.badBackupAcl && id===BACK)throw Error(SECRET);
      return file;
    }},
    PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>{calls.locks++;
      return {waitLock:()=>{if(opt.lockFail)throw Error(SECRET);},
        releaseLock:()=>calls.releases++};
    }},
    vaaLedgerProdAssertScope_:()=>{
      if(opt.badMain)throw Error(SECRET);
    },
    vaaLedgerReadyOpenReadOnly_:adapter=>{
      const id=adapter.getProperty("VAA_REQUEST_LEDGER_SPREADSHEET_ID");
      const book=getBook(id);
      if(!book)throw Error("UNKNOWN_BOOK");
      return book;
    },
    vaaLedgerJournalOpenReadOnly_:()=>({sheet:{journal:"V2"}}),
    vaaLedgerJournalLookupFromSheet_:()=>{
      if(opt.journalCollision)return {state:"RESERVED"};
      return {state:"ABSENT"};
    },
    vaaLedgerReadyLookupFromSheet_:(sheet,id)=>{
      calls.reads++;
      const content=sheet.archive.get(id);
      return content===undefined?{state:"NOT_FOUND"}:
        {state:"FOUND",raw:content};
    },
    vaaLedgerReadyValidateRaw_:(id,text)=>{
      const x=JSON.parse(text);
      if(x.requestId!==id||x.stage!=="READY"||x.status!=="READY"||
        !x.spreadsheetId || (x.operationMode!=="CREATE"&&x.operationMode!=="UPDATE") ||
        (x.operationMode==="UPDATE" && (
          !x.updatePayloadDigest || !["APPEND","REPLACE"].includes(x.updateStrategy) ||
          !x.targetSpreadsheetId || x.targetSpreadsheetId!==x.spreadsheetId
        )))throw Error(SECRET);
      return x;
    },
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    validateUpdateTargetDriveFile_:(id,output)=>{
      if(id!==TARGET||output!==OUT||opt.targetInvalid)throw Error(SECRET);
      return {isTrashed:()=>false};
    },
    vaaLedgerReadyCopyOneUnderLock_:(adapter,id)=>{
      const book=getBook(adapter.getProperty("VAA_REQUEST_LEDGER_SPREADSHEET_ID"));
      if(!book)throw Error("BAD_BOOK");
      const prev=book.archive.get(id);
      if(prev!==undefined){
        if(prev!==raw)throw Error(SECRET);
        return {state:"VERIFIED_EXISTING"};
      }
      if(book===a)calls.primaryWrites++;else calls.backupWrites++;
      book.archive.set(id,raw);
      if(opt.uncertainBackup && book===b)throw Error(SECRET);
      if(opt.uncertainPrimary && book===a)throw Error(SECRET);
      return {state:"COPIED_AND_VERIFIED"};
    },
    vaaLedgerProdDecideUnderLock_:(_,id,mode,target,strategy,digest,exists)=>{
      if(id!==ID||exists||a.archive.get(id)!==raw) return {state:"HALT"};
      return {state:"READY",record:original};
    },
    vaaLedgerReadyError_:code=>Object.assign(new Error(code),{code}),
    vaaLedgerReadyRequestId_:id=>{
      if(!id||id.length>120)throw Error("BAD_ID");
      return id;
    },
    getRequestPropertyKey_:id=>"REQ_"+id
  };
  const ctx=vm.createContext(mock);
  vm.runInContext(script,ctx);
  return {
    audit:()=>ctx.vaaLedgerProdLegacyAuditReadOnly(),
    copy:()=>ctx.vaaLedgerProdLegacyCopyBatchOnce(),
    retire:()=>ctx.vaaLedgerProdLegacyRetireBatchOnce(),
    setMode:x=>properties.VAA_PROD_LEGACY_MIGRATION_MODE=x,
    calls,properties,a,b
  };
}
test("default OFF: preview reads, both mutators prohibited",()=>{
  const f=fixture();
  const inspection=f.audit();
  assert.equal(inspection.pass,true,JSON.stringify(inspection));
  assert.equal(inspection.needPrimaryCopy,1);
  assert.equal(inspection.needBackupCopy,1);
  assert.equal(f.copy().pass,false);
  assert.equal(f.retire().pass,false);
  assert.equal(f.calls.primaryWrites,0);
  assert.equal(f.calls.backupWrites,0);
  assert.equal(f.calls.deletes,0);
});
test("COPY mode stores exact READY in both private sheets; source unchanged",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1"});
  const before=JSON.stringify(f.properties);
  const res=f.copy();
  assert.equal(res.pass,true,JSON.stringify(res));
  assert.equal(res.copied,1);
  assert.equal(res.sourceStableAfter,true);
  assert.equal(f.a.archive.get(ID),raw);
  assert.equal(f.b.archive.get(ID),raw);
  assert.equal(JSON.stringify(f.properties),before);
  assert.equal(f.calls.primaryWrites,1);
  assert.equal(f.calls.backupWrites,1);
  assert.equal(f.calls.deletes,0);
  assert.equal(f.audit().verifiedBoth,1);
});
test("COPY resume with already exact backup only writes missing primary",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1",alreadyBackup:true});
  const res=f.copy();
  assert.equal(res.pass,true,JSON.stringify(res));
  assert.equal(f.calls.backupWrites,0);
  assert.equal(f.calls.primaryWrites,1);
});
test("existing identical dual copies are skipped without writing",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1",alreadyBackup:true,alreadyPrimary:true});
  assert.equal(f.copy().pass,true);
  assert.equal(f.calls.backupWrites+f.calls.primaryWrites,0);
});
test("COPY lost response after backup or primary append stops and does not delete",()=>{
  for(const options of [{uncertainBackup:true},{uncertainPrimary:true}]){
    const f=fixture({...options,mode:"COPY_DUAL_ARCHIVE_READY_V1"});
    const r=f.copy();
    assert.equal(r.pass,false,JSON.stringify(options));
    assert.equal(r.unknownCompletion,true);
    assert.equal(r.automaticRetryAuthorized,false);
    assert.equal(f.calls.deletes,0);
    // No replay: independent inspection determines which rows exist.
    assert.equal(f.audit().pass,true);
  }
});
test("RETIRE prohibited if any legacy READY lacks one of the two exact copies",()=>{
  for(const options of [{},{alreadyBackup:true},{alreadyPrimary:true}]){
    const f=fixture({...options,mode:"RETIRE_DUAL_VERIFIED_READY_V1"});
    const r=f.retire();
    assert.equal(r.pass,false,JSON.stringify(options));
    assert.equal(f.calls.deletes,0);
  }
});
test("RETIRE deletes only verified legacy READY after dual backup and replay check",()=>{
  const f=fixture({mode:"RETIRE_DUAL_VERIFIED_READY_V1",alreadyBackup:true,alreadyPrimary:true});
  const r=f.retire();
  assert.equal(r.pass,true,JSON.stringify(r));
  assert.equal(r.retired,1);
  assert.equal(r.sourceStableAfter,true);
  assert.equal(f.calls.deletes,1);
  assert.equal(f.properties["REQ_"+ID],undefined);
  assert.equal(f.a.archive.get(ID),raw);
  assert.equal(f.b.archive.get(ID),raw);
  assert.equal(f.calls.releases,1);
});
test("invalid source, journal collision, source/backup conflict block all writes",()=>{
  for(const options of [
    {invalidReceipt:true},{conflictBackup:true},{journalCollision:true},
    {badMain:true},{badBackupAcl:true},{targetInvalid:true},
    {lockFail:true}
  ]){
    const f=fixture({...options,mode:"COPY_DUAL_ARCHIVE_READY_V1"});
    const r=f.copy();
    assert.equal(r.pass,false,JSON.stringify(options));
    assert.equal(f.calls.backupWrites,0,JSON.stringify(options));
    assert.equal(f.calls.primaryWrites,0,JSON.stringify(options));
    assert.equal(f.calls.deletes,0,JSON.stringify(options));
  }
});
test("known legacy UPDATE missing replay proof is quarantined without failing safe copy",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1",legacyUpdateWithoutMetadata:true});
  const before=JSON.stringify(f.properties);
  const audit=f.audit();
  assert.equal(audit.pass,true,JSON.stringify(audit));
  assert.equal(audit.quarantinedLegacyReady,1);
  assert.equal(audit.ready,1);
  assert.equal(audit.needPrimaryCopy,1);
  assert.equal(audit.needBackupCopy,1);
  assert.equal(audit.propertyWrites,0);
  assert.equal(audit.archiveWrites,0);
  const done=f.copy();
  assert.equal(done.pass,true,JSON.stringify(done));
  assert.equal(done.copied,1);
  assert.equal(done.quarantinedLegacyReady,1);
  assert.equal(f.a.archive.size,1);
  assert.equal(f.b.archive.size,1);
  assert.equal(JSON.stringify(f.properties),before);
  assert.equal(f.calls.deletes,0);
  assert.equal(f.calls.backupWrites,1);
  assert.equal(f.calls.primaryWrites,1);
  f.setMode("RETIRE_DUAL_VERIFIED_READY_V1");
  const denied=f.retire();
  assert.equal(denied.pass,false,JSON.stringify(denied));
  assert.equal(denied.errorStage,"INVENTORY");
  assert.equal(f.calls.deletes,0);
});
test("quarantine does not suppress unrelated invalid READY or journal collision",()=>{
  for(const options of [
    {legacyUpdateBadTarget:true},{legacyUpdateWithoutMetadata:true,journalCollision:true}
  ]){
    const f=fixture({...options,mode:"COPY_DUAL_ARCHIVE_READY_V1"});
    assert.equal(f.audit().pass,false,JSON.stringify(options));
    assert.equal(f.copy().pass,false,JSON.stringify(options));
    assert.equal(f.calls.primaryWrites,0);
    assert.equal(f.calls.backupWrites,0);
    assert.equal(f.calls.deletes,0);
  }
});
test("quarantine diagnostic totals do not log source request IDs or records",()=>{
  const f=fixture({legacyUpdateWithoutMetadata:true});
  const a=f.audit();
  assert.equal(a.quarantinedLegacyReady,1);
  const logs=f.calls.logs.join("\n");
  assert.equal(logs.includes("LEGACY_UPDATE_WITHOUT_DIGEST_OR_STRATEGY"),false);
  assert.equal(logs.includes(TARGET),false);
  assert.equal(logs.includes(SECRET),false);
});
test("non-READY historical error is excluded from copy and retirement",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1",nonready:true});
  assert.equal(f.copy().pass,true);
  assert.equal(f.audit().nonReady,1);
  assert.equal(f.calls.primaryWrites,0);
  assert.equal(f.calls.backupWrites,0);
  f.setMode("RETIRE_DUAL_VERIFIED_READY_V1");
  assert.equal(f.retire().pass,true);
  assert.equal(f.calls.deletes,0);
});
test("retire never allowed in COPY mode, and copy never allowed in RETIRE mode",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1",alreadyPrimary:true,alreadyBackup:true});
  assert.equal(f.retire().pass,false);
  f.setMode("RETIRE_DUAL_VERIFIED_READY_V1");
  assert.equal(f.copy().pass,false);
  assert.equal(f.calls.deletes,0);
});
test("returned/logged statuses redact private IDs and original receipts",()=>{
  const f=fixture({mode:"COPY_DUAL_ARCHIVE_READY_V1",uncertainPrimary:true});
  f.copy();f.audit();
  const txt=f.calls.logs.join("\n");
  for(const token of [ID,TARGET,SECRET,ROOT,OUT,MAIN,BACK,raw]){
    assert.equal(txt.includes(token),false,token);
  }
  assert.equal(txt.includes("VAA_PROD_LEGACY_BATCH"),true);
});
test("manual-only batch never appears in normal API route or automation",()=>{
  new vm.Script(script);
  assert.doesNotMatch(script,/\bdoPost\s*\(|ScriptApp\.|newTrigger\s*\(/);
  assert.match(script,/VAA_PROD_LEGACY_BATCH_LIMIT_=10/);
  assert.doesNotMatch(script,/console\.log\([^\n]*item\.id/);
});
