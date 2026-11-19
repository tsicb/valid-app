"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const qa=read("qa/Ledger_V2_E2E_Update_Append_Once_QA.gs");
const NEW="QA_JOURNAL_E2E_UPDATE_20261119_V1";
const GOOD="QA_JOURNAL_E2E_CREATE_20261119_V2";
const BAD="QA_JOURNAL_E2E_CREATE_20261119_V1";
const ROOT="QA_TEST_ROOT",OUT="QA_TEST_OUTPUT";
const TARGET="QA_VERIFIED_SUCCESSFUL_CREATE_TEST_WORKBOOK";
const V1="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const ids=["ORIGINAL_G4","ORIGINAL_G5A","ORIGINAL_G5R","ORIGINAL_G6D"];
const clone=v=>JSON.parse(JSON.stringify(v));
const hex=s=>crypto.createHash("sha256").update(s,"utf8").digest("hex");
const original=()=>({
  applicationData:{
    headers:["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ",
      "応募識別キー","応募識別方式","応募日時","応募日","応募曜日"],
    rows:[["APP000001","QA0001","QA_JOB_1","QA_REF_1",1,
      "I1:"+"a".repeat(64),"PERSON_NAME","2026/11/18 12:00","2026/11/18","水"]]
  },
  jobAnalysisMaster:{
    headers:["求人参照ID","企業ID","仕事番号","仕事名","Indeed用求人タイトル"],
    rows:[["QA_REF_1","QA0001","QA_JOB_1","QA架空求人","QA架空求人"]]
  },
  processInfo:{headers:["項目","値"],rows:[["ETL実行日時","2026-11-18T12:00:00Z"]]},
  inputFiles:{headers:["種別","ファイル名","読込行数","文字コード"],
    rows:[["応募CSV","QA_SYNTHETIC.csv",1,"UTF-8"]]},
  imageMasterInitial:{headers:["画像ファイル名"],rows:[]}
});
function harness(opt={}){
  const flags={posts:0,modifiedProps:0,deletedProps:0,logs:[]};
  const propsMap={
    VAA_JOURNAL_DOP_MODE:opt.armed?"TEST_ONE_SYNTHETIC_REQUEST_V1":"OFF",
    VAA_REQUEST_JOURNAL_MODE:opt.armed?"TEST_RESERVATION_V1":"OFF",
    VAA_REQUEST_LEDGER_REPLAY_MODE:"OFF",
    VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID:opt.badAllowlist?"OTHER":NEW,
    VAA_JOURNAL_TEST_ROOT_ID:ROOT,
    VAA_JOURNAL_TEST_OUTPUT_ID:OUT
  };
  ids.forEach(id=>propsMap["REQ_"+id]=JSON.stringify({
    requestId:id,status:"READY",stage:"READY",spreadsheetId:"HISTORIC_"+id
  }));
  const failed={requestId:BAD,operationMode:"CREATE",status:"ERROR",
    stage:"CREATED",spreadsheetId:"QA_FAIL_WORKBOOK"};
  const completed={requestId:GOOD,operationMode:"CREATE",status:"READY",
    stage:"READY",spreadsheetId:TARGET};
  propsMap["REQ_"+BAD]=JSON.stringify(failed);
  propsMap["REQ_"+GOOD]=JSON.stringify(completed);
  if(opt.noCompleted)delete propsMap["REQ_"+GOOD];
  if(opt.oldGone)delete propsMap["REQ_"+BAD];
  if(opt.updateUsed)propsMap["REQ_"+NEW]="UPDATE_ALREADY_USED";
  if(opt.activeLease)propsMap["VAA_TARGET_UPDATE_"+TARGET]="BUSY";
  if(opt.historicGone)delete propsMap["REQ_"+ids[0]];
  const state={
    journal:{
      [BAD]:opt.badOldState?{state:"ABSENT"}:
        {state:"RESERVED",revision:1,latest:{digest:"old",body:{}}},
      [GOOD]:opt.badCompletedState?{state:"ABSENT"}:
        {state:"READY",revision:2,
          latest:{digest:"source",body:{receipt:clone(completed)}}},
      [NEW]:{state:"ABSENT"}
    },
    dataset:null
  };
  const props={
    getProperty:k=>propsMap[k]??null,
    getProperties:()=>({...propsMap}),
    setProperty:()=>{flags.modifiedProps++;throw Error("QA_NO_PROPERTY_WRITES");},
    deleteProperty:()=>{flags.deletedProps++;throw Error("QA_NO_PROPERTY_DELETES");}
  };
  const readySheet={getSheetName:()=>"receipts"};
  const journalSheet={getLastRow:()=>
    opt.extraJournalRow?5:state.journal[NEW].state==="ABSENT"?4:6};
  const ctx={
    VAA_QA_G4_CONFIG_:{testRootId:ROOT,testOutputId:OUT},
    VAA_QA_LEDGER_E2E_CREATE_:{requestId:BAD},
    VAA_QA_LEDGER_V2_RETEST_:{requestId:GOOD},
    VAA_QA_LEDGER_READY_SYNTHETIC_ID_:V1,
    VAA_LEDGER_REPLAY_MODE_PROPERTY_:"VAA_REQUEST_LEDGER_REPLAY_MODE",
    VAA_JOURNAL_DOP_MODE_PROP_:"VAA_JOURNAL_DOP_MODE",
    VAA_JOURNAL_DOP_TEST_MODE_:"TEST_ONE_SYNTHETIC_REQUEST_V1",
    VAA_JOURNAL_DOP_ID_PROP_:"VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID",
    VAA_LEDGER_JOURNAL_MODE_PROP_:"VAA_REQUEST_JOURNAL_MODE",
    VAA_LEDGER_JOURNAL_TEST_MODE_:"TEST_RESERVATION_V1",
    VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_:"VAA_JOURNAL_TEST_ROOT_ID",
    VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_:"VAA_JOURNAL_TEST_OUTPUT_ID",
    API_CONFIG:{MAX_DATASET_ROWS:100000},
    vaaQaG4IsolatedConfig_:()=>props,
    vaaQaG4SyntheticPayload_:()=>({
      action:"create",requestId:"ORIGINAL_G4",
      companyDisplayName:"QA_ONLY",outputFolderId:OUT,
      updateProtocol:"IDENTITY_V1",
      datasets:original()
    }),
    vaaQaLedgerE2EHistorySnapshot_:p=>
      ids.map(id=>String(p.getProperty("REQ_"+id)||"")),
    vaaQaLedgerE2EHistoryValid_:rows=>rows.length===4 &&
      rows.every(Boolean),
    vaaQaLedgerE2EHistoryEqual_:(a,b)=>
      JSON.stringify(a)===JSON.stringify(b),
    vaaQaLedgerReadyPropsEqual_:(a,b)=>
      JSON.stringify(a)===JSON.stringify(b),
    getRequestPropertyKey_:id=>"REQ_"+id,
    vaaQaLedgerReadyCheckPrivateTestLedger_:()=>readySheet,
    vaaLedgerJournalOpenReadOnly_:()=>({sheet:journalSheet,readySheet}),
    vaaLedgerJournalLookupFromSheet_:(sheet,id)=>
      clone(state.journal[id]||{state:"ABSENT"}),
    vaaLedgerReadyLookupFromSheet_:(sheet,id)=>
      id===V1&&!opt.v1Gone?{state:"FOUND"}:{state:"NOT_FOUND"},
    vaaCheckNewRequestCapacityReadOnly_:()=>({
      allowed:!opt.capacityDenied
    }),
    validateUpdateTargetDriveFile_:(id,folder)=>{
      if(id!==TARGET||folder!==OUT||opt.badTarget)
        throw Error("QA_TARGET_NOT_VERIFIED");
    },
    SpreadsheetApp:{openById:id=>{
      if(id!==TARGET)throw Error("QA_UNKNOWN_TARGET");
      return {getId:()=>id};
    }},
    vaaQaG5ReadTestDataStore_:()=>clone(state.dataset),
    validateEnvelope_:payload=>({
      ok:!opt.invalidPayload && payload.updateStrategy==="APPEND" &&
        payload.updateProtocol==="IDENTITY_V1"
    }),
    vaaDigestUpdateRequest_:payload=>hex(JSON.stringify([
      payload.updateStrategy,payload.updateProtocol,
      payload.targetSpreadsheetId,payload.datasets
    ])),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    vaaLedgerDopScopeCode_:(p,id,mode)=>
      id===NEW&&mode==="UPDATE" &&
        p.getProperty("VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID")===NEW &&
        !opt.badScope?"":"JOURNAL_DOP_TEST_SCOPE_DENIED",
    console:{log:x=>flags.logs.push(x)}
  };
  const context=vm.createContext(ctx);
  vm.runInContext(read("central-api/11_Append_Merge.gs"),context);
  state.dataset=clone(ctx.VAAAppendMergeCore.merge({
    mode:"REPLACE",incoming:original(),maxRows:100000
  }));
  vm.runInContext(qa,context);
  ctx.vaaQaG4Invoke_=payload=>{
    flags.posts++;
    assert.equal(payload.requestId,NEW);
    assert.equal(payload.targetSpreadsheetId,TARGET);
    if(opt.throwAfterInvoke)throw Error("QA_POST_RESPONSE_UNKNOWN");
    if(opt.failAfterInvoke){
      state.journal[NEW]={
        state:"RESERVED",revision:1,
        latest:{digest:"reserved",body:{phase:"RESERVED"}}
      };
      return {ok:false,code:"INTERNAL_ERROR"};
    }
    state.dataset=clone(ctx.VAAAppendMergeCore.merge({
      mode:"APPEND",existing:state.dataset,
      incoming:payload.datasets,maxRows:100000
    }));
    const digest=ctx.vaaDigestUpdateRequest_(payload);
    const receipt={
      requestId:NEW,operationMode:"UPDATE",status:"READY",
      stage:"READY",updateStrategy:"APPEND",updatePayloadDigest:digest,
      spreadsheetId:TARGET,targetSpreadsheetId:TARGET
    };
    propsMap["REQ_"+NEW]=JSON.stringify(receipt);
    state.journal[NEW]={
      state:"READY",revision:2,
      latest:{digest:"ready",body:{receipt:clone(receipt)}}
    };
    return {ok:true,status:"READY",reused:false};
  };
  return {run:name=>ctx[name](),ctx,flags,propsMap,state};
}

test("QA UPDATE script is syntax valid, has no direct Sheets/property mutations",()=>{
  new vm.Script(qa);
  assert.doesNotMatch(qa,/\.setProperty\s*\(|\.deleteProperty\s*\(|\.appendRow\s*\(|\.setValues\s*\(/);
  assert.match(qa,/vaaQaG4Invoke_\s*\(/);
  assert.match(qa,/retryAuthorized:false/);
});

test("OFF preflight independently verifies original failure and completed CREATE, 1+1 baseline",()=>{
  const h=harness();
  const r=h.run("vaaQaLedgerV2UpdatePreflightReadOnly");
  assert.equal(r.pass,true);
  assert.equal(r.modesOff,true);
  assert.equal(r.failedCreateV1ReservationPreserved,true);
  assert.equal(r.completedCreateV2ReadyVerified,true);
  assert.equal(r.completedCreateV2DataUnchanged,true);
  assert.equal(r.appendPlanAddsOneApplicationAndOneJob,true);
  assert.equal(r.syntheticUpdateDigestValid,true);
  assert.equal(r.journalHasExactlyPreviousThreeEvents,true);
  assert.equal(r.targetUpdateLeaseAbsent,true);
  assert.equal(h.flags.posts,0);
  assert.equal(h.flags.modifiedProps,0);
});

test("OFF and armed preflights are disjoint; armed requires exact allowlist",()=>{
  const h=harness({armed:true});
  assert.equal(h.run("vaaQaLedgerV2UpdatePreflightReadOnly").pass,false);
  assert.equal(h.run("vaaQaLedgerV2UpdateArmedPreflightReadOnly").pass,true);
  const bad=harness({armed:true,badAllowlist:true});
  assert.equal(bad.run("vaaQaLedgerV2UpdateArmedPreflightReadOnly").pass,false);
});

test("Preflight fails closed on missing original history, target, prior READY or unexpected V2 rows",()=>{
  for(const v of [
    {oldGone:true},{noCompleted:true},{badOldState:true},
    {badCompletedState:true},{updateUsed:true},{activeLease:true},
    {historicGone:true},{extraJournalRow:true},{capacityDenied:true},
    {badTarget:true},{v1Gone:true},{invalidPayload:true},{badScope:true}
  ]){
    const h=harness(v);
    const r=h.run("vaaQaLedgerV2UpdatePreflightReadOnly");
    assert.equal(r.pass,false,JSON.stringify(v));
    assert.equal(h.flags.posts,0);
  }
});

test("one-shot APPEND updates exactly 1+1 into 2+2, journal READY2, all historical receipts stay",()=>{
  const h=harness({armed:true});
  const originals=Object.fromEntries([BAD,GOOD,...ids].map(
    id=>[id,h.propsMap["REQ_"+id]]
  ));
  const r=h.run("vaaQaLedgerV2UpdateOnce");
  assert.equal(r.pass,true);
  assert.equal(r.journalRevision,2);
  assert.equal(r.journalReady,true);
  assert.equal(h.flags.posts,1);
  assert.equal(h.state.dataset.applicationData.rows.length,2);
  assert.equal(h.state.dataset.jobAnalysisMaster.rows.length,2);
  for(const id of [BAD,GOOD,...ids])
    assert.equal(h.propsMap["REQ_"+id],originals[id]);
  const inspect=h.run("vaaQaLedgerV2UpdateInspectReadOnly");
  assert.equal(inspect.pass,true);
  assert.equal(inspect.journalMatchesUpdateReceipt,true);
  assert.equal(inspect.updatePayloadDigestMatches,true);
  assert.equal(inspect.finalDatastoreExactlyTwoApplicantsAndJobs,true);
  assert.equal(inspect.originalFourReadyPreserved,true);
  assert.equal(h.flags.modifiedProps,0);
  assert.equal(h.flags.deletedProps,0);
});

test("second one-shot rejects before calling doPost",()=>{
  const h=harness({armed:true});
  h.run("vaaQaLedgerV2UpdateOnce");
  assert.throws(()=>h.run("vaaQaLedgerV2UpdateOnce"),
    /QA_LEDGER_V2_UPDATE_PREFLIGHT_FAILED/);
  assert.equal(h.flags.posts,1);
});

test("UNKNOWN / failed update is not auto-retried or marked READY",()=>{
  const a=harness({armed:true,throwAfterInvoke:true});
  assert.throws(()=>a.run("vaaQaLedgerV2UpdateOnce"),
    /QA_POST_RESPONSE_UNKNOWN/);
  assert.equal(a.flags.posts,1);
  assert.equal(a.run("vaaQaLedgerV2UpdateInspectReadOnly").pass,false);
  const b=harness({armed:true,failAfterInvoke:true});
  assert.equal(b.run("vaaQaLedgerV2UpdateOnce").pass,false);
  assert.equal(b.flags.posts,1);
  assert.equal(b.run("vaaQaLedgerV2UpdateInspectReadOnly").pass,false);
});

test("READ-ONLY inspector before UPDATE reports ABSENT, not success",()=>{
  const h=harness();
  const r=h.run("vaaQaLedgerV2UpdateInspectReadOnly");
  assert.equal(r.pass,false);
  assert.equal(r.newJournalState,"ABSENT");
  assert.equal(r.updateReceiptExists,false);
  assert.equal(r.failedV1ReservationPreserved,true);
  assert.equal(h.flags.posts,0);
});
