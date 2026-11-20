"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,
  "../central-api/24_Request_Ledger_V2_Production_Gate.gs"),"utf8");
const C_CREATE="VAA_READY_RETIRE_CANARY_CREATE_20261121_Q5A6M8N2";
const C_UPDATE="VAA_READY_RETIRE_CANARY_UPDATE_20261121_Q5A6M8N2";
const OTHER="8a30f192-d573-4687-95fc-942d3f4bd6bf";
const TARGET="SYNTHETIC_MANAGED_SPREADSHEET";
const LEDGER="P".repeat(42);
const ROOT="TEST_ROOT_FOLDER_001";
const OUTPUT="TEST_OUTPUT_FOLDER_01";
const SECRET="PRIVATE_RECEIPT_DATA_NEVER_TO_LOG";

function fixture(options={}){
  const op=options.operationMode||"CREATE";
  const id=options.id||C_CREATE;
  const configuredId=options.configuredId===undefined ?
    C_CREATE:options.configuredId;
  const mode=options.retireMode||"OFF";
  const record={
    requestId:id,operationMode:op,status:"READY",stage:"READY",
    spreadsheetId:TARGET,secret:SECRET,
    ...(op==="UPDATE"?{
      targetSpreadsheetId:TARGET,updateStrategy:"APPEND",
      updatePayloadDigest:"DETERMINISTIC_DIGEST_123"
    }:{})
  };
  const raw=JSON.stringify(record);
  const data={
    VAA_JOURNAL_DOP_MODE:options.v2Off?"OFF":"PROD_V2_GATED",
    VAA_REQUEST_JOURNAL_MODE:"PROD_RESERVATION_V2",
    VAA_PROD_LEDGER_FENCE:"ACTIVE_V1",
    VAA_PROD_LEDGER_ROOT_ID:ROOT,
    VAA_PROD_LEDGER_OUTPUT_ID:OUTPUT,
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER,
    VAA_PROD_READY_RETIRE_MODE:mode,
    VAA_PROD_READY_RETIRE_CANARY_REQUEST_ID:configuredId,
    VAA_PROD_READY_RETIRE_CANARY_OPERATION_MODE:
      options.configuredOperation||"CREATE",
    VAA_PROD_LEGACY_MIGRATION_MODE:
      options.legacyMode||"OFF",
    ["REQ_"+id]:options.sourceMismatch?raw+" ":raw
  };
  const effects={deleteCalls:0,deleteCommitted:0,reserves:0,
    finalized:0,journalReads:0,scopeReads:0,locks:0,releases:0,
    logs:[]};
  const props={
    getProperty:k=>data[k]||null,
    getProperties:()=>({...data}),
    deleteProperty:k=>{
      effects.deleteCalls++;
      if(k!=="REQ_"+id)throw Error("WRONG_DELETE_KEY");
      delete data[k];effects.deleteCommitted++;
      if(options.lostDeleteReply)throw Error(SECRET);
    }
  };
  const file={
    getMimeType:()=>"GOOGLE_SHEETS",
    getSharingAccess:()=>"PRIVATE",
    isTrashed:()=>false,
    getParents:()=>({n:0,
      hasNext(){return this.n++<1},
      next(){return {getId:()=>ROOT}}
    })
  };
  const mock={
    API_CONFIG:{ROOT_FOLDER_ID:ROOT,SHEET_OUTPUT_FOLDER_ID:OUTPUT},
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    DriveApp:{Access:{PRIVATE:"PRIVATE"},getFileById:()=>{effects.scopeReads++;return file}},
    VAA_JOURNAL_DOP_MODE_PROP_:"VAA_JOURNAL_DOP_MODE",
    VAA_LEDGER_JOURNAL_MODE_PROP_:"VAA_REQUEST_JOURNAL_MODE",
    VAA_LEDGER_READY_PROPERTY_:"VAA_REQUEST_LEDGER_SPREADSHEET_ID",
    vaaLedgerJournalError_:code=>Object.assign(new Error("REDACTED"),{code}),
    vaaLedgerJournalOpenReadOnly_:()=>{
      effects.journalReads++;
      return {readySheet:{},sheet:{}};
    },
    vaaLedgerReadyLookupFromSheet_:()=>({state:"NOT_FOUND"}),
    vaaLedgerJournalLookupFromSheet_:()=>{
      const state=options.journalState||"ABSENT";
      return state==="READY"?
        {state:"READY",revision:2,latest:{body:{receipt:record}}}:
        {state};
    },
    vaaLedgerJournalReserveUnderLock_:()=>{
      effects.reserves++;
      return {state:"RESERVED",revision:1};
    },
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:true}),
    getRequestPropertyKey_:k=>"REQ_"+k,
    vaaLedgerJournalFinalizeReadyUnderLock_:()=>{
      effects.finalized++;
      if(options.finalizeError)throw Error(SECRET);
      return {state:"READY",revision:2};
    },
    vaaLedgerJournalReadOnly_:()=>{
      if(options.badReadback)return {state:"RESERVED",revision:1};
      return {state:"READY",revision:2,
        latest:{body:{receipt:options.archiveMismatch?
          {...record,secret:"WRONG"}:record}}};
    },
    vaaLedgerReadyValidateRaw_:(requestedId,value)=>{
      const parsed=JSON.parse(value);
      assert.equal(parsed.requestId,requestedId);
      assert.equal(parsed.status,"READY");
      return parsed;
    },
    vaaLedgerDopReceiptMatches_:()=>!options.badTarget,
    LockService:{getScriptLock:()=>({
      waitLock:()=>{effects.locks++},
      releaseLock:()=>{effects.releases++}
    })},
    console:{log:x=>effects.logs.push(String(x))}
  };
  const ctx=vm.createContext(mock);vm.runInContext(source,ctx);
  return {
    finalize:(kind=op)=>ctx.vaaLedgerProdFinalizeReady_(props,id,kind),
    decide:(kind=op)=>ctx.vaaLedgerProdDecideUnderLock_(
      props,id,kind,kind==="UPDATE"?TARGET:"",
      kind==="UPDATE"?"APPEND":"",
      kind==="UPDATE"?"DETERMINISTIC_DIGEST_123":"",
      !!props.getProperty("REQ_"+id)
    ),
    status:()=>ctx.vaaLedgerProdModeStatus_(props),
    effects,props,data,record,raw
  };
}
test("both CANARY and normal retire start OFF; default never deletes",()=>{
  const h=fixture();
  assert.equal(h.status().state,"ENABLED");
  assert.equal(h.finalize().state,"READY");
  assert.equal(h.effects.deleteCalls,0);
  assert.equal(h.props.getProperty("REQ_"+C_CREATE),h.raw);
});
test("armed one-request CREATE canary removes only its own verified READY",()=>{
  const h=fixture({retireMode:"CANARY_ONE_NEW_READY_V1"});
  assert.equal(h.status().state,"ENABLED");
  const r=h.finalize();
  assert.equal(r.state,"READY");assert.equal(r.retired,true);
  assert.equal(h.effects.deleteCalls,1);
  assert.equal(h.props.getProperty("REQ_"+C_CREATE),null);
  assert.equal(h.effects.releases,1);
});
test("armed one-request UPDATE canary removes only same ID and operation",()=>{
  const h=fixture({id:C_UPDATE,configuredId:C_UPDATE,
    operationMode:"UPDATE",configuredOperation:"UPDATE",
    retireMode:"CANARY_ONE_NEW_READY_V1"});
  const r=h.finalize();
  assert.equal(r.state,"READY");assert.equal(r.retired,true);
  assert.equal(h.effects.deleteCalls,1);
});
test("unrelated normal requests retain REQ while one canary is armed",()=>{
  for(const id of [OTHER,C_UPDATE]){
    const h=fixture({id,retireMode:"CANARY_ONE_NEW_READY_V1"});
    const r=h.finalize();
    assert.equal(r.state,"READY");assert.equal(r.retired,false);
    assert.equal(h.effects.deleteCalls,0);
    assert.equal(h.props.getProperty("REQ_"+id),h.raw);
  }
});
test("canary cannot be armed with a broad or wrong-mode ID",()=>{
  for(const cfg of [
    {configuredId:OTHER},{configuredId:""},
    {configuredId:"VAA_READY_RETIRE_CANARY_CREATE_20261121_SHORT"},
    {configuredId:C_CREATE,configuredOperation:"UPDATE"},
    {legacyMode:"COPY_DUAL_ARCHIVE_READY_V1"},
    {retireMode:"INVALID"},
    {v2Off:true}
  ]){
    const h=fixture({retireMode:"CANARY_ONE_NEW_READY_V1",...cfg});
    assert.equal(h.status().state,"HALT",JSON.stringify(cfg));
    const r=h.finalize();
    assert.equal(r.state,"HALT",JSON.stringify(cfg));
    assert.equal(h.effects.deleteCalls,0);
    assert.equal(h.effects.finalized,0);
  }
});
test("wrong operation on configured canary ID HALTs before reservation",()=>{
  const h=fixture({retireMode:"CANARY_ONE_NEW_READY_V1",
    journalState:"ABSENT"});
  delete h.data["REQ_"+C_CREATE];
  const r=h.decide("UPDATE");
  assert.equal(r.state,"HALT");
  assert.equal(r.code,"JOURNAL_PROD_CANARY_MODE_MISMATCH");
  assert.equal(h.effects.reserves,0);
});
test("normal non-canary ID reserves and later retains REQ in canary mode",()=>{
  const h=fixture({id:OTHER,retireMode:"CANARY_ONE_NEW_READY_V1",
    journalState:"ABSENT"});
  // A new request has no REQ until after its RESERVED journal write.
  delete h.data["REQ_"+OTHER];
  assert.equal(h.decide().state,"ADMITTED");
  assert.equal(h.effects.reserves,1);
  // Simulate the existing production request pipeline writing READY.
  h.data["REQ_"+OTHER]=h.raw;
  assert.equal(h.finalize().retired,false);
  assert.equal(h.effects.deleteCalls,0);
  assert.equal(h.props.getProperty("REQ_"+OTHER),h.raw);
});
test("canary archive mismatch or journal fault never deletes",()=>{
  for(const opt of [
    {archiveMismatch:true},{sourceMismatch:true},
    {badReadback:true},{finalizeError:true}
  ]){
    const h=fixture({retireMode:"CANARY_ONE_NEW_READY_V1",...opt});
    const r=h.finalize();
    assert.equal(r.state,"HALT",JSON.stringify(opt));
    assert.equal(h.effects.deleteCalls,0);
  }
});
test("uncertain delete response HALTs but the only REQ is the one attempted",()=>{
  const h=fixture({retireMode:"CANARY_ONE_NEW_READY_V1",
    lostDeleteReply:true});
  const r=h.finalize();
  assert.equal(r.state,"HALT");
  assert.equal(h.effects.deleteCalls,1);
  assert.equal(h.effects.deleteCommitted,1);
  assert.equal(h.props.getProperty("REQ_"+C_CREATE),null);
  assert.equal(h.effects.releases,1);
  // No retry is performed: the operator must inspect the V2 READY journal.
});
test("global mode remains separately supported (never implied by canary)",()=>{
  const h=fixture({retireMode:"RETIRE_VERIFIED_NEW_READY_V1",
    id:OTHER,configuredId:C_CREATE});
  assert.equal(h.finalize().retired,true);
  assert.equal(h.effects.deleteCalls,1);
});
test("canary source adds no logging, doPost changes or extra delete path",()=>{
  new vm.Script(source);
  const hotPath=source.slice(0,
    source.indexOf("function vaaLedgerProdReadyRetirePreflightReadOnly"));
  assert.doesNotMatch(hotPath,/console\.(?:log|error|warn)\s*\(/);
  assert.doesNotMatch(hotPath,/UrlFetchApp|\bdoPost\s*\(/);
  assert.equal((hotPath.match(/props\.deleteProperty\(/g)||[]).length,1);
});
