"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const load=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const source=load("central-api/24_Request_Ledger_V2_Production_Gate.gs");
const bridge=load("central-api/23_Request_Ledger_V2_DoPost_Bridge.gs");
const core=load("central-api/22_Request_Ledger_V2_Journal.gs");
const entry=load("central-api/02_EntryPoint.gs");
const ID="SAFE_SYNTHETIC_PROD_ID";
const TARGET="SPREADSHEET_PRIVATE_TOKEN_NOT_TO_LOG";
const LEDGER="P".repeat(42);
const ROOT="ROOT_0123456789ABC";
const OUTPUT="OUT_0123456789ABC";
const SECRET="SECRET_DO_NOT_LOG";
const hash=s=>"HASH("+s+")";
const receipt=(kind="CREATE")=>({
  requestId:ID,operationMode:kind,status:"READY",stage:"READY",
  spreadsheetId:TARGET,...(kind==="UPDATE"?{
    targetSpreadsheetId:TARGET,updateStrategy:"APPEND",updatePayloadDigest:"digest1"
  }:{})
});
const identity=(kind="CREATE")=>({
  requestId:ID,operationMode:kind,targetSpreadsheetId:kind==="UPDATE"?TARGET:"",
  updateStrategy:kind==="UPDATE"?"APPEND":"",
  updatePayloadDigest:kind==="UPDATE"?"digest1":""
});
function harness(options={}){
  const record=receipt(options.kind||"CREATE");
  const reqRaw=JSON.stringify(record);
  const data={
    VAA_JOURNAL_DOP_MODE:options.off?"OFF":
      (options.testBridge?"TEST_ONE_SYNTHETIC_REQUEST_V1":"PROD_V2_GATED"),
    VAA_REQUEST_JOURNAL_MODE:options.off?"OFF":"PROD_RESERVATION_V2",
    VAA_PROD_LEDGER_FENCE:options.noFence?"OFF":"ACTIVE_V1",
    VAA_PROD_LEDGER_ROOT_ID:ROOT,
    VAA_PROD_LEDGER_OUTPUT_ID:OUTPUT,
    VAA_PROD_READY_RETIRE_MODE:options.retire?"RETIRE_VERIFIED_NEW_READY_V1":"OFF",
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER
  };
  if(options.legacy)data["REQ_"+ID]=reqRaw;
  if(options.badLegacy)data["REQ_"+ID]="invalid";
  if(options.fenceOff)delete data.VAA_PROD_LEDGER_FENCE;
  if(options.badConfig)data.VAA_PROD_LEDGER_ROOT_ID="WRONG_ROOT";
  if(options.badJournalMode)data.VAA_REQUEST_JOURNAL_MODE="OFF";
  let modernState=options.modern||"ABSENT";
  let oldState=options.old||"NOT_FOUND";
  const effects={reserve:0,finalize:0,deletes:0,locks:0,releases:0,
    checks:0,reads:0};
  const props={
    getProperty:k=>data[k]||null,
    deleteProperty:k=>{effects.deletes++;delete data[k];}
  };
  const ledgerFile={
    getMimeType:()=>"GOOGLE_SHEETS",
    getSharingAccess:()=>options.notPrivate?"DOMAIN":"PRIVATE",
    isTrashed:()=>!!options.trashed,
    getParents:()=>({
      n:0,
      hasNext(){return this.n++< (options.extraParent?2:1)},
      next(){return {getId:()=>options.wrongParent?"OTHER":ROOT}}
    })
  };
  const sheets={
    ready:{name:"receipts"},
    journal:{name:"journal_v2"}
  };
  const mock={
    console:{log:()=>{throw Error("NO_VERBOSE_LOG");}},
    API_CONFIG:{ROOT_FOLDER_ID:ROOT,SHEET_OUTPUT_FOLDER_ID:OUTPUT},
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    DriveApp:{Access:{PRIVATE:"PRIVATE"},
      getFileById:id=>{
        effects.checks++;
        if(options.driveUnavailable)throw Error(SECRET);
        if(id===LEDGER)return ledgerFile;
        return {getMimeType:()=>"GOOGLE_SHEETS",
          getParents:()=>({hasNext:()=>true,next:()=>({getId:()=>OUTPUT})})};
      }
    },
    VAA_JOURNAL_DOP_MODE_PROP_:"VAA_JOURNAL_DOP_MODE",
    VAA_LEDGER_JOURNAL_MODE_PROP_:"VAA_REQUEST_JOURNAL_MODE",
    VAA_LEDGER_READY_PROPERTY_:"VAA_REQUEST_LEDGER_SPREADSHEET_ID",
    vaaLedgerJournalError_:code=>Object.assign(new Error(code),{code}),
    vaaLedgerJournalOpenReadOnly_:()=>{
      effects.reads++;
      if(options.invalidSheet)throw Error(SECRET);
      return {readySheet:sheets.ready,sheet:sheets.journal};
    },
    vaaLedgerReadyLookupFromSheet_:()=> {
      if(options.badV1)throw Error(SECRET);
      return oldState==="FOUND"?
        {state:"FOUND",record,...{raw:reqRaw}}:{state:oldState};
    },
    vaaLedgerJournalLookupFromSheet_:()=> {
      if(options.badV2)throw Error(SECRET);
      return modernState==="READY"?
        {state:"READY",revision:2,latest:{body:{receipt:record}}}:
        {state:modernState,revision:modernState==="RESERVED"?1:0};
    },
    getRequestPropertyKey_:id=>"REQ_"+id,
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!options.overBudget}),
    vaaLedgerJournalReserveUnderLock_:(_,given,scope)=>{
      effects.reserve++;
      assert.equal(scope,"PROD");
      assert.equal(given.requestId,ID);
      if(options.reservationLost)throw Error(SECRET);
      return {state:"RESERVED",revision:1};
    },
    vaaLedgerJournalFinalizeReadyUnderLock_:(_,id,scope)=>{
      effects.finalize++;
      assert.equal(scope,"PROD");
      if(options.finalizeLost)throw Error(SECRET);
      return {state:"READY",revision:2};
    },
    vaaLedgerJournalReadOnly_:()=>{
      if(options.finalizeMismatch)return {state:"RESERVED"};
      return {state:"READY",revision:2,latest:{body:{receipt:record}}};
    },
    vaaLedgerReadyValidateRaw_:(id,s)=>{
      const x=JSON.parse(s);
      assert.equal(x.requestId,id);
      if(x.status!=="READY")throw Error("BAD");
      return x;
    },
    LockService:{getScriptLock:()=>{
      effects.locks++;
      return {waitLock:()=>{if(options.lockFail)throw Error(SECRET)},
        releaseLock:()=>effects.releases++};
    }},
    vaaLedgerDopReceiptMatches_:(rec,id,kind,target,strategy,digest)=>{
      return rec.requestId===id && rec.operationMode===kind &&
        (kind!=="UPDATE"||(
          rec.targetSpreadsheetId===target && rec.updateStrategy===strategy &&
          rec.updatePayloadDigest===digest
        )) && !options.badTarget;
    },
    VAA_LEDGER_JOURNAL_TEST_MODE_:"TEST_RESERVATION_V1",
    VAA_JOURNAL_DOP_TEST_MODE_:"TEST_ONE_SYNTHETIC_REQUEST_V1"
  };
  const ctx=vm.createContext(mock);vm.runInContext(source,ctx);
  return {
    decide:(mode=options.kind||"CREATE",d=mode==="UPDATE"?"digest1":"")=>
      ctx.vaaLedgerProdDecideUnderLock_(props,ID,mode,
        mode==="UPDATE"?TARGET:"",mode==="UPDATE"?"APPEND":"",d,
        !!props.getProperty("REQ_"+ID)),
    finalize:(mode=options.kind||"CREATE")=>
      ctx.vaaLedgerProdFinalizeReady_(props,ID,mode),
    ctx,props,data,effects
  };
}
test("dormant OFF leaves existing pipeline untouched",()=>{
  const h=harness({off:true,noFence:true});
  assert.equal(h.decide().state,"DISABLED");
  assert.equal(h.effects.reads,0);
  assert.equal(h.effects.reserve,0);
});
test("sticky fence blocks fallback to legacy when OFF",()=>{
  const h=harness({off:true});
  const r=h.decide();
  assert.equal(r.state,"HALT");
  assert.equal(r.code,"JOURNAL_PROD_STICKY_FENCE");
  assert.equal(h.effects.reserve,0);
});
test("mode, fence, roots, journal and sharing gates fail closed",()=>{
  for(const opts of [
    {noFence:true},{badConfig:true},{badJournalMode:true},
    {notPrivate:true},{wrongParent:true},{extraParent:true},
    {driveUnavailable:true},{trashed:true},{invalidSheet:true}
  ]){
    const h=harness(opts);const r=h.decide();
    assert.equal(r.state,"HALT",JSON.stringify(opts));
    assert.equal(h.effects.reserve,0,JSON.stringify(opts));
  }
});
test("new CREATE reserves exactly once, only after ledger checks",()=>{
  const h=harness();const r=h.decide();
  assert.equal(r.state,"ADMITTED");
  assert.equal(h.effects.reserve,1);
  assert.equal(h.effects.reads,1);
  assert.ok(h.effects.checks>0);
});
test("new UPDATE reserves exact target, strategy and digest",()=>{
  const h=harness({kind:"UPDATE"});
  assert.equal(h.decide().state,"ADMITTED");
  assert.equal(h.effects.reserve,1);
});
test("new reservation lost reply and low capacity HALT instead of attempting work",()=>{
  const a=harness({reservationLost:true});const r=a.decide();
  assert.equal(r.state,"HALT");
  assert.equal(r.code,"JOURNAL_PROD_UNVERIFIED");
  assert.equal(a.effects.reserve,1);
  const b=harness({overBudget:true});
  assert.equal(b.decide().state,"HALT");
  assert.equal(b.effects.reserve,0);
});
test("pre-cutover legacy REQ is not registered as a new request",()=>{
  const a=harness({legacy:true});
  assert.equal(a.decide().state,"LEGACY");
  assert.equal(a.effects.reserve,0);
  const b=harness({badLegacy:true});
  assert.equal(b.decide().state,"LEGACY");
  assert.equal(b.effects.reserve,0);
  // Legacy doPost's existing invalid receipt check then halts.
});
test("archived V1 READY replays without REQ and never reserves",()=>{
  const h=harness({old:"FOUND"});
  const r=h.decide();
  assert.equal(r.state,"READY");
  assert.equal(r.record.spreadsheetId,TARGET);
  assert.equal(h.effects.reserve,0);
});
test("modern READY replays without REQ, including UPDATE exact digest",()=>{
  const h=harness({modern:"READY",kind:"UPDATE"});
  assert.equal(h.decide().state,"READY");
  assert.equal(h.decide("UPDATE","different").state,"HALT");
  assert.equal(h.effects.reserve,0);
});
test("READY with property conflict, target conflict or inaccessible source fail",()=>{
  for(const opts of [
    {modern:"READY",badLegacy:true},{old:"FOUND",badLegacy:true},
    {modern:"READY",badTarget:true},{badV1:true},{badV2:true}
  ]){
    const h=harness(opts);assert.equal(h.decide().state,"HALT",JSON.stringify(opts));
    assert.equal(h.effects.reserve,0);
  }
});
test("RESERVED / ERROR blocks both new and existing REQ; no resume",()=>{
  for(const modern of ["RESERVED","ERROR"]){
    for(const legacy of [false,true]){
      const h=harness({modern,legacy});
      assert.equal(h.decide().state,"HALT");
      assert.equal(h.effects.reserve,0);
    }
  }
});
test("finalization persists READY, leaves source REQ if retirement disabled",()=>{
  const h=harness({legacy:true});
  const r=h.finalize();
  assert.equal(r.state,"READY");
  assert.equal(r.retired,false);
  assert.equal(h.effects.finalize,1);
  assert.equal(h.effects.deletes,0);
  assert.equal(h.effects.releases,1);
});
test("explicitly enabled retirement only after verified V2 READY and matching raw",()=>{
  const h=harness({legacy:true,retire:true});
  const r=h.finalize();
  assert.equal(r.state,"READY");
  assert.equal(r.retired,true);
  assert.equal(h.effects.deletes,1);
  assert.equal(h.props.getProperty("REQ_"+ID),null);
  assert.equal(h.effects.releases,1);
});
test("failed journal finalize or mismatched archive never removes REQ",()=>{
  for(const opts of [
    {legacy:true,retire:true,finalizeLost:true},
    {legacy:true,retire:true,finalizeMismatch:true},
    {legacy:true,retire:true,lockFail:true}
  ]){
    const h=harness(opts);const r=h.finalize();
    assert.equal(r.state,"HALT",JSON.stringify(opts));
    assert.equal(h.effects.deletes,0,JSON.stringify(opts));
  }
});
test("new scoped journal helpers preserve legacy TEST as default",()=>{
  assert.match(core,/function vaaLedgerJournalAssertWriteScope_\(props,scope\)/);
  assert.match(core,/if\(scope==='PROD'\)return vaaLedgerProdAssertScope_\(props\);/);
  assert.match(core,/if\(scope==null\)return vaaLedgerJournalAssertTestScope_\(props\);/);
  assert.match(core,/function vaaLedgerJournalReserveUnderLock_\(props,input,scope\)/);
  assert.match(core,/function vaaLedgerJournalFinalizeReadyUnderLock_\(props,requestId,scope\)/);
  assert.match(bridge,/vaaLedgerJournalReserveUnderLock_\(props,request\)/);
});
test("doPost routes PROD first while preserving existing TEST bridge",()=>{
  assert.match(entry,/vaaLedgerProdDecideUnderLock_/);
  assert.match(entry,/vaaLedgerDopDecideUnderLock_/);
  assert.match(entry,/journalAdmissionSource === 'PROD'/);
  assert.match(entry,/vaaLedgerProdFinalizeReady_/);
  assert.match(entry,/vaaLedgerDopFinalizeReady_/);
});
test("never log raw receipts or secret values in PROD bridge",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,/console\.(?:log|error|warn)\s*\(/);
  assert.doesNotMatch(source,/\bdoPost\s*\(/);
  assert.doesNotMatch(source,/UrlFetchApp/);
});
