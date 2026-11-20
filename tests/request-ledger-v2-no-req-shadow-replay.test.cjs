"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const load=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const gateSource=load("central-api/24_Request_Ledger_V2_Production_Gate.gs");
const receiptGateSource=load("central-api/23_Request_Ledger_V2_DoPost_Bridge.gs");
const ID="QA_V2_READY_SHADOW_NO_REQ";
const TARGET="QA_PRIVATE_MANAGED_TARGET";
const LEDGER="QA_PRIVATE_V2_JOURNAL_ID_0123456789";
const ROOT="QA_PRIVATE_ROOT_FOLDER";
const OUTPUT="QA_MANAGED_OUTPUT_FOLDER";
const SECRET="SECRET_REPLAY_RECEIPT_NOT_FOR_LOGGING";

function fixture(options={}){
  const mode=options.mode||"UPDATE";
  const record={
    requestId:ID,status:"READY",stage:"READY",operationMode:mode,
    spreadsheetId:TARGET,secret:SECRET,
    ...(mode==="UPDATE"?{
      targetSpreadsheetId:TARGET,
      updateStrategy:"APPEND",
      updatePayloadDigest:"QA_PAYLOAD_DIGEST"
    }:{})
  };
  const raw=JSON.stringify(record);
  const propertyMap={
    VAA_JOURNAL_DOP_MODE:"PROD_V2_GATED",
    VAA_REQUEST_JOURNAL_MODE:"PROD_RESERVATION_V2",
    VAA_PROD_LEDGER_FENCE:"ACTIVE_V1",
    VAA_PROD_LEDGER_ROOT_ID:ROOT,
    VAA_PROD_LEDGER_OUTPUT_ID:OUTPUT,
    VAA_PROD_READY_RETIRE_MODE:"OFF",
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER,
    ...(options.withReq?{["REQ_"+ID]:options.conflictingReq?raw+" ":""+raw}:{})
  };
  const effects={reserved:0,capacityCalls:0,scriptWrites:0,
    journalWrites:0,targetCreations:0};
  const props={
    getProperty:k=>Object.prototype.hasOwnProperty.call(propertyMap,k)?
      propertyMap[k]:null,
    getProperties:()=>({...propertyMap}),
    setProperty:()=>{effects.scriptWrites++;throw Error("PROHIBITED");},
    deleteProperty:()=>{effects.scriptWrites++;throw Error("PROHIBITED");}
  };
  const parents=root=>({i:0,hasNext(){return this.i++<1},
    next(){return {getId:()=>root}}});
  const ledgerFile={
    getMimeType:()=>"GOOGLE_SHEETS",
    getSharingAccess:()=>"PRIVATE",
    isTrashed:()=>false,
    getParents:()=>parents(ROOT)
  };
  const targetFile={
    getMimeType:()=>options.badMime?"OTHER":"GOOGLE_SHEETS",
    getParents:()=>parents(options.unmanaged?"WRONG_FOLDER":OUTPUT),
    isTrashed:()=>false
  };
  const api={
    API_CONFIG:{ROOT_FOLDER_ID:ROOT,SHEET_OUTPUT_FOLDER_ID:OUTPUT},
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    DriveApp:{Access:{PRIVATE:"PRIVATE"},getFileById:id=>{
      if(options.driveUnavailable)throw Error(SECRET);
      if(id===LEDGER)return ledgerFile;
      if(id===TARGET)return targetFile;
      throw Error("TARGET_NOT_FOUND");
    }},
    VAA_LEDGER_JOURNAL_MODE_PROP_:"VAA_REQUEST_JOURNAL_MODE",
    VAA_LEDGER_READY_PROPERTY_:"VAA_REQUEST_LEDGER_SPREADSHEET_ID",
    vaaLedgerJournalError_:code=>Object.assign(new Error("REDACTED"),{code}),
    vaaLedgerJournalOpenReadOnly_:()=>{
      if(options.journalUnavailable)throw Error(SECRET);
      return {readySheet:{},sheet:{appendRow:()=>{
        effects.journalWrites++;throw Error("PROHIBITED");
      }}};
    },
    vaaLedgerReadyLookupFromSheet_:()=>options.v1Collision?
      {state:"FOUND",record,raw:JSON.stringify({...record,secret:"BAD"})}:
      {state:"NOT_FOUND"},
    vaaLedgerJournalLookupFromSheet_:()=>{
      if(options.journalInvalid)throw Error(SECRET);
      const state=options.journalState||"READY";
      if(state==="READY")return {state:"READY",revision:2,
        latest:{body:{receipt:record}}};
      if(state==="ABSENT")return {state:"ABSENT"};
      return {state,revision:1};
    },
    getRequestPropertyKey_:id=>"REQ_"+id,
    vaaCheckNewRequestCapacityReadOnly_:()=>{
      effects.capacityCalls++;
      return {allowed:true};
    },
    vaaLedgerJournalReserveUnderLock_:()=>{
      // A test must never reserve or append to an external journal.
      effects.reserved++;
      throw Error("PROHIBITED_RESERVATION");
    },
    fileIsInManagedOutputTree_:(file,outputFolder)=>{
      if(outputFolder!==OUTPUT)return false;
      const it=file.getParents();
      return it.hasNext() && it.next().getId()===OUTPUT;
    }
  };
  const ctx=vm.createContext(api);
  vm.runInContext(receiptGateSource,ctx);
  vm.runInContext(gateSource,ctx);
  return {
    decide:(overrides={})=>ctx.vaaLedgerProdDecideUnderLock_(
      props,ID,overrides.mode||mode,
      overrides.target!==undefined?overrides.target:
        (mode==="UPDATE"?TARGET:""),
      overrides.strategy!==undefined?overrides.strategy:
        (mode==="UPDATE"?"APPEND":""),
      overrides.digest!==undefined?overrides.digest:
        (mode==="UPDATE"?"QA_PAYLOAD_DIGEST":""),
      !!props.getProperty("REQ_"+ID)
    ),
    propertyMap,effects,record,raw,props
  };
}
function assertNoEffects(f,before){
  assert.equal(f.effects.reserved,0);
  assert.equal(f.effects.capacityCalls,0);
  assert.equal(f.effects.scriptWrites,0);
  assert.equal(f.effects.journalWrites,0);
  assert.equal(f.effects.targetCreations,0);
  assert.deepEqual(f.propertyMap,before);
}

test("V2 READY CREATE and UPDATE replay identically with and without REQ",()=>{
  for(const mode of ["CREATE","UPDATE"]){
    for(const withReq of [true,false]){
      const f=fixture({mode,withReq});
      const before={...f.propertyMap};
      const result=f.decide();
      assert.equal(result.state,"READY",JSON.stringify({mode,withReq,result}));
      assert.equal(result.record.spreadsheetId,TARGET);
      assert.equal(result.record.operationMode,mode);
      assertNoEffects(f,before);
    }
  }
});
test("V2 READY without REQ never re-creates or reserves on repeat",()=>{
  const f=fixture({mode:"CREATE",withReq:false});
  const before={...f.propertyMap};
  for(let i=0;i<3;i++){
    assert.equal(f.decide().state,"READY");
  }
  assertNoEffects(f,before);
});
test("UPDATE replay without REQ rejects changed digest, strategy, target and mode",()=>{
  for(const bad of [
    {digest:"DIFFERENT"},{strategy:"REPLACE"},
    {target:"ANOTHER_TARGET"},{mode:"CREATE"}
  ]){
    const f=fixture({mode:"UPDATE",withReq:false});
    const before={...f.propertyMap};
    assert.equal(f.decide(bad).state,"HALT",JSON.stringify(bad));
    assertNoEffects(f,before);
  }
});
test("CREATE replay without REQ rejects unexpected target or UPDATE mode",()=>{
  for(const bad of [{target:"ANOTHER_TARGET"},{mode:"UPDATE"}]){
    const f=fixture({mode:"CREATE",withReq:false});
    const before={...f.propertyMap};
    assert.equal(f.decide(bad).state,"HALT");
    assertNoEffects(f,before);
  }
});
test("unmanaged or inaccessible target and bad V2 journal cannot be replayed",()=>{
  for(const options of [
    {unmanaged:true},{badMime:true},{driveUnavailable:true},
    {journalUnavailable:true},{journalInvalid:true},{v1Collision:true}
  ]){
    const f=fixture({mode:"UPDATE",withReq:false,...options});
    const before={...f.propertyMap};
    assert.equal(f.decide().state,"HALT",JSON.stringify(options));
    assertNoEffects(f,before);
  }
});
test("RESERVED and ERROR cannot be replayed without REQ",()=>{
  for(const journalState of ["RESERVED","ERROR"]){
    const f=fixture({withReq:false,journalState});
    const before={...f.propertyMap};
    const result=f.decide();
    assert.equal(result.state,"HALT");
    assert.equal(result.code,"JOURNAL_PROD_REQUEST_PENDING_REVIEW");
    assertNoEffects(f,before);
  }
});
test("a malformed extant REQ is not hidden by V2 READY",()=>{
  const f=fixture({withReq:true,conflictingReq:true});
  const before={...f.propertyMap};
  const result=f.decide();
  assert.equal(result.state,"HALT");
  assert.equal(result.code,"JOURNAL_PROD_PROPERTY_CONFLICT");
  assertNoEffects(f,before);
});
test("shadow test uses the exact existing live gate; never changes doPost",()=>{
  new vm.Script(gateSource);
  new vm.Script(receiptGateSource);
  assert.match(gateSource,/function vaaLedgerProdDecideUnderLock_\(/);
  assert.match(gateSource,/if\(modern.state==='READY' \|\| old.state==='FOUND'\)/);
  assert.doesNotMatch(gateSource,/function vaaLedgerProdReplayShadowWrite_/);
});
