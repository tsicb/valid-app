"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const code=read("qa/Ledger_V2_E2E_Create_Once_QA.gs");
const ID="QA_JOURNAL_E2E_CREATE_20261119_V1";
const oldIds=["G4_ORIGINAL","G5_APPEND","G5_REPLACE","G6D_CREATE"];
const root="QA_TEST_ROOT",output="QA_TEST_OUTPUT",target="QA_NEW_E2E_WORKBOOK";
const oldSynthetic="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const copy=x=>JSON.parse(JSON.stringify(x));
function harness(o={}) {
  const propsMap={
    SCHEMA_VERSION:"3.0",ACCESS_KEY:"QA_SECRET_MUST_NOT_LOG",
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:"QA_LEDGER_PRIVATE",
    VAA_JOURNAL_DOP_MODE:o.off?"OFF":"TEST_ONE_SYNTHETIC_REQUEST_V1",
    VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID:o.invalidAllowlist?"OTHER":ID,
    VAA_REQUEST_JOURNAL_MODE:"TEST_RESERVATION_V1",
    VAA_JOURNAL_TEST_ROOT_ID:root,
    VAA_JOURNAL_TEST_OUTPUT_ID:output
  };
  oldIds.forEach(id=>propsMap["REQ_"+id]=JSON.stringify({
    requestId:id,status:"READY",stage:"READY",
    operationMode:"CREATE",spreadsheetId:"OLD_WORKBOOK_"+id
  }));
  if(o.badHistoricalCount)delete propsMap["REQ_G5_REPLACE"];
  if(o.existingRequest)propsMap["REQ_"+ID]=JSON.stringify({
    requestId:ID,status:"PROCESSING",stage:"CREATED",spreadsheetId:target
  });
  const writes={posts:0,created:0,deleted:0,logs:[],inspects:0};
  const state={value:"ABSENT",revision:0,receipt:null};
  const makeEvent=()=>state.value==="ABSENT"?
    {state:"ABSENT"}:
    {state:state.value,revision:state.revision,
      latest:{
        digest:"FAKE_DIGEST_1",
        body:state.value==="READY"?{
          phase:"READY",receipt:copy(state.receipt)
        }:{phase:"RESERVED",receipt:null}
      }};
  const props={
    getProperty:k=>propsMap[k]??null,
    getProperties:()=>({...propsMap}),
    setProperty(){writes.created++;throw Error("UNEXPECTED_SCRIPT_PROPERTIES_WRITE");},
    deleteProperty(){writes.deleted++;throw Error("UNEXPECTED_SCRIPT_PROPERTIES_DELETE");}
  };
  const sheet={getLastRow:()=>o.journalNotEmpty?3:
    state.value==="ABSENT"?1:state.value==="READY"?3:2};
  const readySheet={getLastRow:()=>o.readyRowMissing?1:2};
  const scope={
    VAA_QA_G4_CONFIG_:{testRootId:root,testOutputId:output,
      requestId:oldIds[0]},
    VAA_QA_G5_APPEND_REQUEST_ID_:oldIds[1],
    VAA_QA_G5_REPLACE_REQUEST_ID_:oldIds[2],
    VAA_QA_G6C_CONFIG_:{createRequestId:oldIds[3]},
    VAA_QA_LEDGER_READY_SYNTHETIC_ID_:oldSynthetic,
    VAA_LEDGER_REPLAY_MODE_PROPERTY_:"VAA_REQUEST_LEDGER_REPLAY_MODE",
    VAA_LEDGER_JOURNAL_TEST_MODE_:"TEST_RESERVATION_V1",
    VAA_LEDGER_REPLAY_TEST_MODE_:"TEST_READY_REPLAY_ONLY_V1",
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_",SHEET_OUTPUT_FOLDER_ID:output},
    PropertiesService:{getScriptProperties:()=>props},
    vaaQaG4IsolatedConfig_:()=>props,
    vaaQaG4SyntheticPayload_:()=>({
      action:"create",requestId:oldIds[0],accessKey:"QA_SECRET_MUST_NOT_LOG",
      outputFolderId:output,companyDisplayName:"QA_G4_OLD",
      datasets:{applicationData:{headers:["X"],rows:[["1"]]}}
    }),
    vaaQaG4Invoke_:payload=>{
      writes.posts++;
      assert.equal(payload.requestId,ID);
      assert.equal(payload.companyDisplayName,
        "QA_JOURNAL_E2E_SYNTHETIC_CREATE_ONLY");
      if(o.postFails)throw Error("POST_RESPONSE_LOST");
      if(o.postErrorResponse)return {
        ok:false,code:"SYNTHETIC_STOP",status:"ERROR"
      };
      const r={
        requestId:ID,operationMode:"CREATE",
        status:"READY",stage:"READY",spreadsheetId:target,
        outputFolderId:output,spreadsheetUrl:"https://example.invalid/qa"
      };
      propsMap["REQ_"+ID]=JSON.stringify(r); // model canonical doPost write
      state.value="READY";state.revision=2;state.receipt=r;
      return {ok:true,status:"READY",spreadsheetId:target,reused:false};
    },
    validateEnvelope_:()=>({ok:!o.invalidPayload,code:"BAD_PAYLOAD"}),
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!o.noCapacity}),
    vaaQaLedgerReadyCheckPrivateTestLedger_:()=>readySheet,
    vaaLedgerJournalOpenReadOnly_:()=>({
      sheet,readySheet
    }),
    vaaLedgerJournalLookupFromSheet_:()=>makeEvent(),
    vaaLedgerReadyLookupFromSheet_:(sh,id)=>{
      if(sh===readySheet) {
        return id===oldSynthetic&&!o.readyRowMissing?
          {state:"FOUND",record:{requestId:oldSynthetic}}:
          {state:"NOT_FOUND"};
      }
      return {state:"NOT_FOUND"};
    },
    vaaLedgerDopMode_:()=>propsMap.VAA_JOURNAL_DOP_MODE==="OFF"?
      "DISABLED":"ENABLED",
    vaaLedgerDopScopeCode_:()=>o.invalidAllowlist?
      "JOURNAL_DOP_TEST_SCOPE_DENIED":"",
    vaaQaLedgerReadyPropsEqual_:(a,b)=>{
      const keysA=Object.keys(a).sort(),keysB=Object.keys(b).sort();
      return keysA.length===keysB.length &&
        keysA.every((k,i)=>k===keysB[i]&&a[k]===b[k]);
    },
    getRequestPropertyKey_:id=>"REQ_"+id,
    validateUpdateTargetDriveFile_:(id,folder)=>{
      if(id!==target||folder!==output||o.invalidTarget)
        throw Error("UNVERIFIED_TARGET");
    },
    console:{log:s=>writes.logs.push(s)},
    Date
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(code,ctx);
  return {run:fn=>scope[fn](),writes,propsMap,state,sheet};
}

test("V2 CREATE QA module is syntax-valid, calls canonical G4 doPost entrypoint only once",()=>{
  new vm.Script(code);
  assert.match(code,/vaaQaG4Invoke_\s*\(/);
  assert.match(code,/vaaLedgerJournalLookupFromSheet_\s*\(/);
  assert.doesNotMatch(code,/\.deleteProperty\s*\(|\.setTrashed\s*\(|\.createFile\s*\(|vaaLedgerJournalReserveUnderLock_\s*\(/);
  assert.match(code,/automaticRetryAuthorized:false/);
});

test("Preflight on private empty ledger and four original READY is read-only",()=>{
  const h=harness();
  const r=h.run("vaaQaLedgerE2ECreatePreflightReadOnly");
  assert.equal(r.pass,true);
  assert.equal(r.v2JournalHeaderOnly,true);
  assert.equal(r.existingHistoricReadyCount,4);
  assert.equal(r.canonicalPayloadValid,true);
  assert.equal(r.testModeEnabled,true);
  assert.equal(r.exactSingleRequestScopeApproved,true);
  assert.equal(r.scriptPropertiesUnchanged,true);
  assert.equal(h.writes.posts,0);
  assert.equal(h.writes.created,0);
  assert.equal(h.writes.deleted,0);
});

test("Create Once writes a synthetic READY and returns V2 rev2 verified result",()=>{
  const h=harness();
  const originals=oldIds.map(id=>h.propsMap["REQ_"+id]);
  const r=h.run("vaaQaLedgerE2ECreateOnce");
  assert.equal(r.pass,true);
  assert.equal(r.responseOk,true);
  assert.equal(r.responseMatchesVerifiedTestReceipt,true);
  assert.equal(r.journalRevision,2);
  assert.equal(r.journalReadyAfterPost,true);
  assert.equal(h.writes.posts,1);
  assert.deepEqual(oldIds.map(id=>h.propsMap["REQ_"+id]),originals);
  assert.equal(h.writes.deleted,0);
  assert.equal(h.run("vaaQaLedgerE2ECreateInspectReadOnly").pass,true);
  const publicLogs=h.writes.logs.join("\n");
  assert.doesNotMatch(publicLogs,/QA_NEW_E2E_WORKBOOK|QA_SECRET_MUST_NOT_LOG|https:\/\//);
});

test("Second Create Once cannot post if journal and REQ already populated",()=>{
  const h=harness();
  h.run("vaaQaLedgerE2ECreateOnce");
  assert.throws(()=>h.run("vaaQaLedgerE2ECreateOnce"),
    /QA_LEDGER_E2E_CREATE_PREFLIGHT_FAILED/);
  assert.equal(h.writes.posts,1);
});

test("Lost doPost response stops without auto-resubmitting",()=>{
  const h=harness({postFails:true});
  assert.throws(()=>h.run("vaaQaLedgerE2ECreateOnce"),/POST_RESPONSE_LOST/);
  assert.equal(h.writes.posts,1);
  assert.equal(h.run("vaaQaLedgerE2ECreateInspectReadOnly").pass,false);
  assert.equal(h.writes.deleted,0);
});

test("Post failure response is reported as non-PASS",()=>{
  const h=harness({postErrorResponse:true});
  const r=h.run("vaaQaLedgerE2ECreateOnce");
  assert.equal(r.pass,false);
  assert.equal(r.responseOk,false);
  assert.equal(h.writes.posts,1);
});

test("Preflight rejects nonempty/used journal, existing REQ, mode off, incomplete history",()=>{
  for(const opt of [
    {journalNotEmpty:true},{existingRequest:true},{off:true},
    {badHistoricalCount:true},{invalidAllowlist:true},
    {noCapacity:true},{invalidPayload:true},{readyRowMissing:true}
  ]){
    const h=harness(opt);
    assert.equal(h.run("vaaQaLedgerE2ECreatePreflightReadOnly").pass,false);
    assert.throws(()=>h.run("vaaQaLedgerE2ECreateOnce"),
      /QA_LEDGER_E2E_CREATE_PREFLIGHT_FAILED/);
    assert.equal(h.writes.posts,0);
  }
});

test("Corrupt workbook location blocks successful inspector PASS",()=>{
  const h=harness({invalidTarget:true});
  const r=h.run("vaaQaLedgerE2ECreateOnce");
  assert.equal(r.pass,false);
  assert.equal(r.responseMatchesVerifiedTestReceipt,false);
  assert.equal(h.writes.posts,1);
});

test("READ ONLY Inspector before run accurately reports absence, not READY",()=>{
  const h=harness();
  const r=h.run("vaaQaLedgerE2ECreateInspectReadOnly");
  assert.equal(r.pass,false);
  assert.equal(r.journalState,"ABSENT");
  assert.equal(r.actualPostInvoked,false);
  assert.equal(r.actualJournalWritten,false);
  assert.equal(h.writes.posts,0);
});
