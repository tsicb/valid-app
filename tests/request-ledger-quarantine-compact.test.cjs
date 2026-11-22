"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const script=fs.readFileSync(path.join(__dirname,
  "../central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs"),"utf8");
const hash=x=>crypto.createHash("sha256").update(String(x)).digest("hex");
const MARK='{"status":"RETIRED","archiveSchema":"LEGACY_QUARANTINE_V1"}';
const HEADER=["requestHash","rawJson","rawDigest","sourceKind",
  "location","archivedAt","schemaVersion"];
const SECRET="STRICTLY_PRIVATE_TEST_SECRET_NEVER_IN_LOG";
function fixture(opts={}){
  const store={VAA_PROD_LEGACY_MIGRATION_MODE:opts.mode||"OFF"};
  const full={},outside=[],linked={};
  for(let i=0;i<97;i++){
    const id="HISTORIC_"+String(i).padStart(3,"0");
    const target=i<81?"LINKED_"+i:i===81?"UNLINKED":"TRASHED_"+i;
    if(i<81)linked[target]=true;
    const mode=i<39?"UPDATE":"CREATE";
    const rec={
      requestId:id,status:"READY",stage:"READY",operationMode:mode,
      spreadsheetId:target,internalSecret:SECRET,
      ...(mode==="UPDATE"?{targetSpreadsheetId:target,
        updateStrategy:"",updatePayloadDigest:""}:{})
    };
    const raw=JSON.stringify(rec);
    store["REQ_"+id]=raw;
    full[id]=raw;outside.push(id);
  }
  for(let i=0;i<2;i++){
    const id="CURRENT_"+i;
    store["REQ_"+id]=JSON.stringify({requestId:id,operationMode:"CREATE",
      spreadsheetId:"CURRENT_"+i,status:"READY",stage:"READY",secret:SECRET});
  }
  for(let i=0;i<4;i++){
    const id="FAILED_"+i;
    store["REQ_"+id]=JSON.stringify({requestId:id,operationMode:"UPDATE",
      spreadsheetId:"ERROR_TARGET",status:"ERROR",stage:"ERROR",secret:SECRET});
  }
  const modernId=opts.modernWithJournal?
    "MODERN_REAL_V2_READY":"QA_JOURNAL_E2E_CREATE_TEST";
  const modernReceipt={
    requestId:modernId,operationMode:"CREATE",
    spreadsheetId:"CURRENT_0",status:"READY",stage:"READY"
  };
  const modernRaw=JSON.stringify(modernReceipt);
  store["REQ_"+modernId]=modernRaw;
  const effects={setPropertiesCalls:0,propValuesWritten:0,deleted:0,
    archiveCellsWritten:0,archiveAttempts:0,tabCreated:0,
    lockWait:0,lockRelease:0,logs:[],reserve:0};
  let getPropertiesCalls=0;
  const props={
    getProperty:key=>Object.prototype.hasOwnProperty.call(store,key)?
      store[key]:null,
    getProperties:()=>{
      getPropertiesCalls++;
      if(opts.driftBeforeCopy && getPropertiesCalls===2)
        store.UNRELATED_EXTERNAL_PROPERTY="CHANGED_DURING_PREWRITE";
      return {...store};
    },
    setProperties:(changes,deleteAllOthers)=>{
      effects.setPropertiesCalls++;
      assert.equal(deleteAllOthers,false);
      const entries=Object.entries(changes);
      if(opts.failCompactBefore)throw Error(SECRET);
      if(opts.partialCompact){
        for(const [key,value] of entries.slice(0,20)){
          store[key]=value;effects.propValuesWritten++;
        }
        throw Error(SECRET);
      }
      for(const [key,value] of entries){
        store[key]=value;effects.propValuesWritten++;
      }
    },
    deleteProperty:()=>effects.deleted++
  };
  function fakeSheet(name,rows=[],book=null){
    const state={rows:rows.map(x=>x.slice())};
    return {
      name,state,
      getParent:()=>book,
      getLastRow:()=>state.rows.length,
      getRange:(row,col,height,width)=>({
        getValues:()=>{
          if(opts.archiveReadFail&&name==="legacy_quarantine_v1")
            throw Error(SECRET);
          return Array.from({length:height},(_,i)=>
            Array.from({length:width},(_,j)=>
              state.rows[row-1+i]?.[col-1+j] ?? ""));
        },
        setValues:(values)=>{
          effects.archiveAttempts++;
          if(opts.archiveBeforeWriteFail)throw Error(SECRET);
          values.forEach((r,i)=>{
            state.rows[row-1+i]=r.slice();
            effects.archiveCellsWritten+=r.length;
          });
          if(opts.archiveUnknownAfterWrite)throw Error(SECRET);
        }
      })
    };
  }
  const book={
    tabs:{},
    getSheetByName(name){return this.tabs[name]||null;},
    insertSheet(name){
      if(opts.tabCreateFail)throw Error(SECRET);
      assert.equal(this.tabs[name],undefined);
      const s=fakeSheet(name,[],this);
      this.tabs[name]=s;
      effects.tabCreated++;return s;
    }
  };
  const backupReceipts=fakeSheet("receipts",[["ledger"]],book);
  const primary=fakeSheet("receipts",[["ledger"]],null);
  const journal=fakeSheet("journal_v2",opts.modernWithJournal?
    [["ledger"],[hash(modernId)]]:[["ledger"]],null);
  const managedIds={"CURRENT_0":true,"CURRENT_1":true};
  const mock={
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{flush:()=>{if(opts.flushFail)throw Error(SECRET);}},
    LockService:{getScriptLock:()=>({
      waitLock:()=>{effects.lockWait++;if(opts.lockFail)throw Error(SECRET);},
      releaseLock:()=>{effects.lockRelease++;}
    })},
    DriveApp:{getFileById:id=>{
      if(opts.rosterMismatch && id==="LINKED_0")return {isTrashed:()=>false};
      if(id.startsWith("TRASHED_"))return {isTrashed:()=>true};
      throw Error(SECRET);
    }},
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_",SHEET_OUTPUT_FOLDER_ID:"OUTPUT"},
    console:{log:x=>effects.logs.push(String(x))},
    vaaLedgerReadyRequestId_:id=>{if(!id||String(id).length>120)throw Error("INVALID");return id;},
    vaaLedgerReadyHash_:hash,
    vaaLedgerReadyValidateRaw_:(id,raw)=>{
      const r=JSON.parse(raw);
      if(r.requestId!==id||r.status!=="READY"||r.stage!=="READY"||
        (r.operationMode==="UPDATE"&&(!r.updatePayloadDigest||
          !["APPEND","REPLACE"].includes(r.updateStrategy))))throw Error("INVALID");
      return r;
    },
    getRequestPropertyKey_:id=>"REQ_"+id,
    vaaTargetUpdateLeaseKey_:target=>"LEASE_"+target,
    vaaLedgerProdAssertScope_:()=>{
      if(opts.badScope)throw Error(SECRET);
    },
    vaaLedgerProdLegacyBackupSheet_:()=>{
      if(opts.badBackupAcl)throw Error(SECRET);
      return {sheet:backupReceipts};
    },
    vaaLedgerReadyOpenReadOnly_:()=>primary,
    vaaLedgerJournalOpenReadOnly_:()=>({sheet:journal}),
    vaaLedgerJournalLookupFromSheet_:(_sheet,id)=>{
      if(id!==modernId||!opts.modernWithJournal)
        return {state:"ABSENT"};
      return {state:opts.modernNotReady?"RESERVED":"READY",
        revision:opts.modernNotReady?1:2,
        latest:{body:{receipt:opts.modernConflict?
          {...modernReceipt,fileName:SECRET}:modernReceipt}}};
    },
    vaaLedgerResidualFolderSnapshot_:()=>{
      if(opts.badInventory)throw Error(SECRET);
      return {inventoryComplete:true,ids:managedIds,
        folderCount:6,fileCount:29,uniqueSheetCount:29};
    },
    vaaLedgerResidualReferences_:()=>{
      if(opts.badReferences)return {referencesComplete:false,ids:linked};
      return {referencesComplete:true,ids:linked};
    },
    fileIsInManagedOutputTree_:()=>!!opts.rosterMismatch
  };
  const originalMocks={...mock};
  const ctx=vm.createContext(mock);
  vm.runInContext(script,ctx);
  // Restore mocks that names in the production file might overwrite.
  for(const name of ["vaaLedgerProdAssertScope_",
    "vaaLedgerProdLegacyBackupSheet_","vaaLedgerResidualFolderSnapshot_",
    "vaaLedgerResidualReferences_"])ctx[name]=originalMocks[name];
  const run=(fn)=>JSON.parse(JSON.stringify(ctx[fn]()));
  return {ctx,props,store,effects,full,outside,book,backupReceipts,
    primary,journal,moveIntoManaged:id=>{managedIds[id]=true;},
    audit:()=>run("vaaLedgerProdQuarantineAuditReadOnly"),
    copy:()=>run("vaaLedgerProdQuarantineCopyOnce"),
    compact:()=>run("vaaLedgerProdQuarantineCompactOnce")};
}
const checkSanitized=(f)=>{
  for(const line of f.effects.logs){
    assert.ok(line.startsWith("VAA_PROD_QUARANTINE "));
    for(const secret of [SECRET,"HISTORIC_000","LINKED_0",
      "REQ_HISTORIC","CURRENT_0","TRASHED_82"]){
      assert.equal(line.includes(secret),false,
        "source IDs / secrets must never be logged");
    }
  }
};
test("read-only baseline validates 97 candidates and protects current and errors",()=>{
  const f=fixture();
  const a=f.audit();
  assert.equal(a.pass,true);
  assert.equal(a.strictReadOnly,true);
  assert.equal(a.archiveVerified,false);
  assert.equal(a.rawReady,97);
  assert.equal(a.compacted,0);
  assert.equal(a.backedUp,0);
  assert.equal(a.preservedManagedReady,2);
  assert.equal(a.preservedErrors,4);
  assert.equal(a.modernExcluded,1);
  assert.equal(f.effects.archiveAttempts,0);
  assert.equal(f.effects.setPropertiesCalls,0);
  checkSanitized(f);
});
test("COPY once archives 97 exact originals, leaves every REQ value untouched",()=>{
  const f=fixture();
  const before=JSON.stringify(f.store);
  const c=f.copy();
  assert.equal(c.pass,true);
  assert.equal(c.sourceStable,true);
  assert.equal(c.archiveVerified,true);
  assert.equal(c.copied,97);
  assert.equal(c.archiveWrites,97);
  assert.equal(c.rawReady,97);
  assert.equal(c.compacted,0);
  assert.equal(f.effects.tabCreated,1);
  assert.equal(f.effects.archiveAttempts,1);
  assert.equal(f.effects.setPropertiesCalls,0);
  assert.equal(JSON.stringify(f.store),before);
  const rows=f.book.tabs.legacy_quarantine_v1.state.rows;
  assert.equal(rows.length,98);
  assert.deepEqual(Array.from(rows[0]),HEADER);
  for(const r of rows.slice(1)){
    const rec=JSON.parse(r[1]);
    assert.equal(r[0],hash(rec.requestId));
    assert.equal(r[2],hash(r[1]));
    assert.equal(r[1],f.full[rec.requestId]);
  }
  assert.equal(f.audit().pass,true);
  assert.equal(f.copy().pass,true); // verified-existing; no duplicate
  assert.equal(f.effects.archiveAttempts,1);
  checkSanitized(f);
});
test("COMPACT only after COPY replaces exactly 97 values and retains 7 protected sources",()=>{
  const f=fixture();
  assert.equal(f.copy().pass,true);
  const c=f.compact();
  assert.equal(c.pass,true);
  assert.equal(c.compacted,97);
  assert.equal(c.rawReady,0);
  assert.equal(c.sourceStable,true);
  assert.equal(c.propertyWrites,97);
  assert.equal(c.propertyDeletes,0);
  assert.equal(f.effects.setPropertiesCalls,1);
  assert.equal(f.effects.propValuesWritten,97);
  assert.equal(f.effects.deleted,0);
  for(const id of f.outside)assert.equal(f.store["REQ_"+id],MARK);
  for(let i=0;i<2;i++)assert.equal(JSON.parse(f.store["REQ_CURRENT_"+i]).status,"READY");
  for(let i=0;i<4;i++)assert.equal(JSON.parse(f.store["REQ_FAILED_"+i]).status,"ERROR");
  assert.equal(JSON.parse(f.store.REQ_QA_JOURNAL_E2E_CREATE_TEST).status,"READY");
  const a=f.audit();
  assert.equal(a.pass,true);
  assert.equal(a.archiveVerified,true);
  assert.equal(a.backedUp,97);
  assert.equal(a.compacted,97);
  assert.equal(a.rawReady,0);
  assert.equal(f.copy().pass,false); // no blind re-copy after compaction
  assert.equal(f.compact().pass,false); // no blind repeat
  assert.equal(f.effects.setPropertiesCalls,1);
  checkSanitized(f);
});
test("COMPACT without archive refuses all property writes",()=>{
  const f=fixture(),c=f.compact();
  assert.equal(c.pass,false);
  assert.equal(c.errorCode,"QUARANTINE_COMPACT_NOT_READY");
  assert.equal(f.effects.setPropertiesCalls,0);
  assert.equal(f.effects.tabCreated,0);
});
test("failure in inventory, source mode, ACL, or folder safety stops before archive write",()=>{
  for(const opt of [
    {badInventory:true},{badReferences:true},{badScope:true},
    {badBackupAcl:true},{mode:"COPY_DUAL_ARCHIVE_READY_V1"},
    {rosterMismatch:true}
  ]){
    const f=fixture(opt),a=f.audit(),c=f.copy();
    assert.equal(a.pass,false,JSON.stringify(opt));
    assert.equal(c.pass,false,JSON.stringify(opt));
    assert.equal(f.effects.archiveAttempts,0);
    assert.equal(f.effects.setPropertiesCalls,0);
    assert.equal(f.effects.deleted,0);
    checkSanitized(f);
  }
});
test("changed source, missing archive row, and corrupted digest stop COMPACT",()=>{
  for(const corruption of ["source","missing","digest"]){
    const f=fixture();
    assert.equal(f.copy().pass,true);
    if(corruption==="source")f.store.REQ_HISTORIC_000="{}";
    if(corruption==="missing")f.book.tabs.legacy_quarantine_v1.state.rows.pop();
    if(corruption==="digest")f.book.tabs.legacy_quarantine_v1.state.rows[1][2]="BAD";
    const a=f.audit(),c=f.compact();
    assert.equal(a.pass,false,corruption);
    assert.equal(c.pass,false,corruption);
    assert.equal(f.effects.setPropertiesCalls,0);
    assert.equal(f.effects.deleted,0);
  }
});
test("COPY unknown completion must be inspected; exact archive can be recovered read-only",()=>{
  const f=fixture({archiveUnknownAfterWrite:true});
  const c=f.copy();
  assert.equal(c.pass,false);
  assert.equal(c.unknownCompletion,true);
  assert.equal(f.effects.archiveAttempts,1);
  assert.equal(f.effects.setPropertiesCalls,0);
  const a=f.audit();
  assert.equal(a.pass,true);
  assert.equal(a.archiveVerified,true);
  assert.equal(a.rawReady,97);
  assert.equal(a.compacted,0);
  checkSanitized(f);
});
test("partial COMPACT unknown must fail, but read-only audit reports raw/marker split",()=>{
  const f=fixture({partialCompact:true});
  assert.equal(f.copy().pass,true);
  const c=f.compact();
  assert.equal(c.pass,false);
  assert.equal(c.unknownCompletion,true);
  assert.equal(f.effects.setPropertiesCalls,1);
  assert.equal(f.effects.propValuesWritten,20);
  assert.equal(f.effects.deleted,0);
  const a=f.audit();
  assert.equal(a.pass,true);
  assert.equal(a.archiveVerified,true);
  assert.equal(a.rawReady,77);
  assert.equal(a.compacted,20);
  assert.equal(f.compact().pass,false); // no automatic reattempt of partial
  checkSanitized(f);
});
test("read failure on existing archive is not treated as empty archive",()=>{
  const f=fixture({archiveReadFail:true});
  assert.equal(f.copy().pass,false); // write completed; readback fails
  assert.equal(f.effects.archiveAttempts,1);
  assert.equal(f.audit().pass,false);
  assert.equal(f.compact().pass,false);
  assert.equal(f.effects.setPropertiesCalls,0);
});

test("COPY checks source stability before inserting the backup tab",()=>{
  const f=fixture({driftBeforeCopy:true});
  const result=f.copy();
  assert.equal(result.pass,false);
  assert.equal(result.errorCode,"QUARANTINE_SOURCE_CHANGED");
  assert.equal(f.effects.tabCreated,0);
  assert.equal(f.effects.archiveAttempts,0);
  assert.equal(f.effects.setPropertiesCalls,0);
});
test("moving a historical target into managed folder blocks subsequent COMPACT",()=>{
  const f=fixture();
  assert.equal(f.copy().pass,true);
  f.moveIntoManaged("LINKED_0");
  const result=f.compact();
  assert.equal(result.pass,false);
  assert.equal(f.effects.setPropertiesCalls,0);
  assert.equal(JSON.parse(f.store.REQ_HISTORIC_000).status,"READY");
});
test("V1 / V2 collision blocks COMPACT even when private archive matches",()=>{
  for(const which of ["primary","journal"]){
    const f=fixture();
    assert.equal(f.copy().pass,true);
    f[which].state.rows.push([hash("HISTORIC_000")]);
    assert.equal(f.audit().pass,false);
    assert.equal(f.compact().pass,false);
    assert.equal(f.effects.setPropertiesCalls,0);
  }
});
test("archived row duplication or mismatched captured location fails closed",()=>{
  for(const which of ["duplicate","location"]){
    const f=fixture();
    assert.equal(f.copy().pass,true);
    const rows=f.book.tabs.legacy_quarantine_v1.state.rows;
    if(which==="duplicate")rows[2]=rows[1].slice();
    else rows[1][4]="TRASHED";
    assert.equal(f.audit().pass,false);
    assert.equal(f.compact().pass,false);
    assert.equal(f.effects.setPropertiesCalls,0);
  }
});

test("actual production-style V2 READY (not QA name) is excluded and stays intact",()=>{
  const f=fixture({modernWithJournal:true});
  const original=f.store.REQ_MODERN_REAL_V2_READY;
  const a=f.audit();
  assert.equal(a.pass,true);
  assert.equal(a.modernExcluded,1);
  assert.equal(a.rawReady,97);
  assert.equal(f.copy().pass,true);
  assert.equal(f.compact().pass,true);
  assert.equal(f.store.REQ_MODERN_REAL_V2_READY,original);
  assert.equal(f.audit().modernExcluded,1);
});
test("V2 pending or receipt-mismatched historical-looking ID blocks before archive",()=>{
  for(const opts of [
    {modernWithJournal:true,modernNotReady:true},
    {modernWithJournal:true,modernConflict:true}
  ]){
    const f=fixture(opts);
    assert.equal(f.audit().pass,false);
    assert.equal(f.copy().pass,false);
    assert.equal(f.effects.archiveAttempts,0);
    assert.equal(f.effects.setPropertiesCalls,0);
  }
});
