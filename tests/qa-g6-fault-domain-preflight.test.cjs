"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const g4=read("qa/G4_Isolated_Create_Replay_QA.gs");
const g6c=read("qa/G6_Isolated_Fault_Domain_Preflight_QA.gs");
const ROOT="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const OUTPUT="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const CANDIDATE="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";

function fixture(opts={}) {
  const values={
    ACCESS_KEY:"DUMMY_ONLY_TEST_ACCESS_KEY_32_CHARS",
    SCHEMA_VERSION:"3.0"
  };
  if(opts.existingCandidate) values["REQ_"+CANDIDATE]="EXISTS";
  const state={writes:0,deletes:0,posts:0,logs:[],baselineCalls:0};
  const props={
    getProperty:key=>values[key]||null,
    setProperty(){state.writes++;throw Error("UNEXPECTED_WRITE");},
    deleteProperty(){state.deletes++;throw Error("UNEXPECTED_DELETE");}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:opts.wrongRoot?"NOT_TEST":ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUTPUT,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      DEFAULT_APP_VERSION:"TEST_ONLY_QA",
      EXPECTED_COMMON_MASTER_VERSION:"QA_SYNTHETIC_COMMON"
    },
    PropertiesService:{getScriptProperties:()=>props},
    console:{log:line=>state.logs.push(line)},
    vaaQaG6BFailureGatesReadOnly:()=>{
      state.baselineCalls++;
      return {
        pass:!opts.badBaseline,
        actualReadyReceipts:opts.badBaseline?2:3,
        finalTestDataStoreMatches:!opts.badBaseline
      };
    },
    validateEnvelope_:payload=>({
      ok:payload.datasets.applicationData.rows.length===1 &&
        payload.datasets.jobAnalysisMaster.rows.length===1 &&
        !!payload.accessKey && payload.schemaVersion==="3.0"
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({
      allowed:!opts.capacityFull
    }),
    stageRank_:s=>{
      const m={
        TARGET_VALIDATED:15,OPENED:20,
        DATA_WRITTEN:opts.badStageOrder?10:30,
        REPORT_DONE:40,READY:50
      };
      return m[s]||0;
    },
    vaaStageAppendDataStore_:()=>{},
    vaaCommitStagedAppendDataStore_:()=>{},
    vaaExecuteAppendDataStoreUpdate_:()=>{},
    vaaClaimTargetUpdateLease_:()=>{},
    vaaReleaseTargetUpdateLease_:()=>{},
    saveRequestRecord_:()=>{},
    getRequestRecord_:()=>{},
    Date
  };
  if(!opts.missingHelper)scope.vaaCheckNewRequestCapacityReadOnly_=()=>({
    allowed:!opts.capacityFull
  });
  if(opts.missingHelper)delete scope.vaaStageAppendDataStore_;
  const ctx=vm.createContext(scope);
  vm.runInContext(g4,ctx);
  vm.runInContext(g6c,ctx);
  return {state,values,run:expr=>vm.runInContext(expr,ctx)};
}

test("G6-C source syntax valid, is read only, never provisions test workbook",()=>{
  new vm.Script(g6c);
  assert.doesNotMatch(g6c,/\bdoPost\s*\(|SpreadsheetApp\.create\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\.createFile\s*\(|\.moveTo\s*\(/);
  assert.match(g6c,/vaaQaG6BFailureGatesReadOnly\s*\(/);
  assert.match(g6c,/vaaQaG6CFaultDomainPayload_/);
});

test("G6-C succeeds with separate create-only request candidate and six planning points",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6CFaultDomainPreflightReadOnly()");
  assert.equal(r.phase,"G6_FAULT_DOMAIN_PREFLIGHT_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.actualReadyReceipts,3);
  assert.equal(r.baselinePass,true);
  assert.equal(r.finalTestDataStoreMatches,true);
  assert.equal(r.candidateRequestIdAlreadyExists,false);
  assert.equal(r.candidateIndependentOfHistoricalIds,true);
  assert.equal(r.candidateDoesNotTargetExistingWorkbook,true);
  assert.equal(r.candidateOutputIsTestOnly,true);
  assert.equal(r.candidateSyntheticCompany,true);
  assert.equal(r.candidatePayloadValidationCode,"OK");
  assert.equal(r.budgetAllowed,true);
  assert.equal(r.candidateSyntheticApplications,1);
  assert.equal(r.candidateSyntheticJobs,1);
  assert.equal(r.canonicalStageOrderValid,true);
  assert.equal(r.updateHelpersPresent,true);
  assert.equal(r.plannedFaultPointCount,6);
  assert.equal(r.planOnly,true);
  assert.equal(r.faultDomainProvisioned,false);
  assert.equal(r.faultInjectionAuthorized,false);
  assert.equal(r.actualFailureInjected,false);
  assert.equal(r.actualResumeTested,false);
  assert.equal(r.readyForSeparateProvisioningPlan,true);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
  assert.equal(h.state.posts,0);
  assert.equal(h.state.baselineCalls,1);
  assert.doesNotMatch(h.state.logs.join("\n"),/DUMMY_ONLY_TEST_ACCESS_KEY|QA_G6C_FAULT_DOMAIN_CREATE_/);
});

test("G6-C rejects a pre-existing synthetic requestId without any mutation",()=>{
  const h=fixture({existingCandidate:true});
  const r=h.run("vaaQaG6CFaultDomainPreflightReadOnly()");
  assert.equal(r.candidateRequestIdAlreadyExists,true);
  assert.equal(r.readyForSeparateProvisioningPlan,false);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.posts,0);
});

test("G6-C refuses capacity full, missing guard component or broken stage order",()=>{
  for(const options of [
    {capacityFull:true},{missingHelper:true},{badStageOrder:true}
  ]) {
    const h=fixture(options);
    const r=h.run("vaaQaG6CFaultDomainPreflightReadOnly()");
    assert.equal(r.readyForSeparateProvisioningPlan,false);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
    assert.equal(h.state.posts,0);
  }
});

test("G6-C stops for baseline failure or wrong TEST root before creating candidate",()=>{
  for(const opts of [{badBaseline:true},{wrongRoot:true}]) {
    const h=fixture(opts);
    assert.throws(()=>h.run("vaaQaG6CFaultDomainPreflightReadOnly()"),
      /QA_G6C_BASELINE_NOT_READY|QA_ISOLATION_FAILED/);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
    assert.equal(h.state.posts,0);
  }
});
