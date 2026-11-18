"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const VAAAppendMergeCore=require("../central-api/append-merge-core.js");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const g4=read("qa/G4_Isolated_Create_Replay_QA.gs");
const replace=read("qa/G5_Isolated_Replace_Preflight_QA.gs");
const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const output="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const target="QA_TEST_TARGET_SHEET_123456789";
const rid="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const appendRid="QA_G5_SYNTHETIC_APPEND_20261118_V1";

function harness(options={}) {
  const values={
    ACCESS_KEY:"TEST_G5_REPLACE_KEY_32_CHARACTERS_ONLY",
    SCHEMA_VERSION:"3.0"
  };
  if(options.existingRequest)values["REQ_"+rid]="EXISTING_RECEIPT";
  if(options.lease)values["VAA_TARGET_UPDATE_"+target]="EXISTING_LEASE";

  const effects={writes:0,deletes:0,posts:0,logs:[],checks:0};
  const props={
    getProperty:key=>values[key]||null,
    setProperty:(key,value)=>{effects.writes++;values[key]=value;},
    deleteProperty:key=>{effects.deletes++;delete values[key];}
  };
  const ready={
    requestId:appendRid,
    operationMode:"UPDATE",
    status:"READY",stage:"READY",
    updateStrategy:"APPEND",
    targetSpreadsheetId:target,spreadsheetId:target,
    updatePayloadDigest:options.digestMismatch?"WRONG":"EXACT_MATCH"
  };
  if(options.missingPrior)ready.status="ERROR";

  const scoped={
    API_CONFIG:{
      ROOT_FOLDER_ID:options.wrongRoot?"OTHER_ROOT":root,
      SHEET_OUTPUT_FOLDER_ID:output,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      DEFAULT_APP_VERSION:"TEST_ONLY",
      EXPECTED_COMMON_MASTER_VERSION:"2026.09-test",
      MAX_DATASET_ROWS:100000
    },
    PropertiesService:{getScriptProperties:()=>props},
    VAAAppendMergeCore,
    VAA_QA_G5_APPEND_REQUEST_ID_:appendRid,
    vaaQaG5GetReadyG4Receipt_:()=>({
      props,receipt:{spreadsheetId:target}
    }),
    vaaQaG5StoredAppendReceipt_:()=>ready,
    vaaQaG5AppendPayload_:tid=>({
      targetSpreadsheetId:tid,
      updateStrategy:"APPEND",updateProtocol:"IDENTITY_V1",
      datasets:{}
    }),
    vaaDigestUpdateRequest_:()=> "EXACT_MATCH",
    vaaValidateUpdateRequestRecord_:(receipt,strategy,digest)=>({
      ok:receipt.updateStrategy===strategy &&
         receipt.updatePayloadDigest===digest
    }),
    vaaQaG5VerifyFinalReadOnly_:id=>{
      effects.checks++;
      if(id!==target)throw Error("NOT_TEST_TARGET");
      return {
        dataStoreMatchesExpected:!options.corruptBaseline,
        finalApplications:options.wrongCount?3:2,
        finalJobs:1
      };
    },
    validateEnvelope_:payload=>{
      const needed=["applicationData","jobAnalysisMaster","processInfo","inputFiles","imageMasterInitial"];
      return needed.every(k=>payload.datasets[k] &&
        payload.datasets[k].rows.every(row=>
          row.length===payload.datasets[k].headers.length))
        ?{ok:true}:{ok:false,code:"INVALID_DATASET"};
    },
    vaaValidateUpdateProtocol_:payload=>({
      ok:payload.updateStrategy==="REPLACE" &&
         payload.updateProtocol==="IDENTITY_V1",
      code:payload.updateStrategy==="REPLACE"?"":"PROTOCOL_ERROR"
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!options.capacityExceeded}),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    console:{log:s=>effects.logs.push(s)},
    Date
  };
  const ctx=vm.createContext(scoped);
  vm.runInContext(g4,ctx);
  vm.runInContext(replace,ctx);
  return {effects,values,run:code=>vm.runInContext(code,ctx)};
}

test("QA G5 REPLACE preflight source is syntax-valid and does not mutate state",()=>{
  new vm.Script(replace);
  assert.doesNotMatch(replace,/\.setProperty\(|\.deleteProperty\(|doPost\(|SpreadsheetApp\.create\(/);
  assert.match(replace,/vaaQaG5VerifyFinalReadOnly_/);
  assert.match(replace,/vaaValidateUpdateRequestRecord_/);
  assert.match(replace,/vaaQaG5ReplacePlan_/);
});

test("G5-D has valid REPLACE preview: 2 historic applications become 1, job title and pay replaced",()=>{
  const h=harness();
  const payload=h.run("vaaQaG5ReplacePayload_('"+target+"')");
  assert.equal(payload.updateStrategy,"REPLACE");
  assert.equal(payload.updateProtocol,"IDENTITY_V1");
  const plan=h.run("vaaQaG5ReplacePlan_(vaaQaG5ReplacePayload_('"+target+"'))");
  assert.equal(plan.applicationData.rows.length,1);
  assert.equal(plan.jobAnalysisMaster.rows.length,1);
  assert.equal(plan.jobAnalysisMaster.rows[0][plan.jobAnalysisMaster.headers.indexOf("仕事名")],"QA架空求人_REPLACE後");
  assert.equal(plan.jobAnalysisMaster.rows[0][plan.jobAnalysisMaster.headers.indexOf("給与金額MIN")],1600);
  assert.equal(plan.applicationData.rows[0][plan.applicationData.headers.indexOf("応募識別キー")],"I1:"+"c".repeat(64));
  assert.equal(h.effects.posts,0);
});

test("G5-D reports safeToReplaceOnce with READ_ONLY flags, no receipt or workbook mutation",()=>{
  const h=harness();
  const r=h.run("vaaQaG5ReplacePreflightReadOnly()");
  assert.equal(r.phase,"G5_REPLACE_PREFLIGHT_READ_ONLY");
  assert.equal(r.safeToReplaceOnce,true);
  assert.equal(r.baselineMatches,true);
  assert.equal(r.payloadValidationCode,"OK");
  assert.equal(r.updateProtocolCode,"OK");
  assert.equal(r.priorAppendReady,true);
  assert.equal(r.priorAppendDigestMatches,true);
  assert.equal(r.previousApplications,2);
  assert.equal(r.expectedFinalApplications,1);
  assert.equal(r.expectedFinalJobs,1);
  assert.equal(r.jobTitleReplacementPlanned,true);
  assert.equal(r.salaryReplacementPlanned,true);
  assert.equal(r.identityReplacementPlanned,true);
  assert.equal(r.workbookModified,false);
  assert.equal(h.effects.writes,0);
  assert.equal(h.effects.deletes,0);
  assert.equal(h.effects.posts,0);
  assert.doesNotMatch(h.effects.logs.join("\n"),/TEST_G5_REPLACE_KEY|QA_TEST_TARGET/);
});

test("G5-D refuses REPLACE if the appended baseline changed or request capacity is low",()=>{
  for(const opt of [
    {corruptBaseline:true},{wrongCount:true},
    {existingRequest:true},{lease:true},{capacityExceeded:true}
  ]){
    const h=harness(opt);
    const r=h.run("vaaQaG5ReplacePreflightReadOnly()");
    assert.equal(r.safeToReplaceOnce,false);
    assert.equal(h.effects.writes,0);
    assert.equal(h.effects.deletes,0);
    assert.equal(h.effects.posts,0);
  }
});

test("G5-D aborts on missing prior READY, altered digest, or incorrect TEST root",()=>{
  for(const opt of [
    {missingPrior:true},{digestMismatch:true},{wrongRoot:true}
  ]){
    const h=harness(opt);
    assert.throws(()=>h.run("vaaQaG5ReplacePreflightReadOnly()"),
      /QA_G5_REPLACE_|QA_ISOLATION_FAILED/);
    assert.equal(h.effects.writes,0);
    assert.equal(h.effects.deletes,0);
    assert.equal(h.effects.posts,0);
  }
});
