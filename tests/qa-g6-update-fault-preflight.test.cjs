"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const g4=read("qa/G4_Isolated_Create_Replay_QA.gs");
const g6c=read("qa/G6_Isolated_Fault_Domain_Preflight_QA.gs");
const g6e=read("qa/G6_Isolated_Update_Fault_Preflight_QA.gs");
const ROOT="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const OUT="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const G4ID="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const APPID="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const REPID="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const CREATEID="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const UPDATEID="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const OLD="QA_G4_OLD_TARGET_SHEET_123456789";
const NEW="QA_G6D_NEW_TARGET_SHEET_123456789";
const clone=x=>JSON.parse(JSON.stringify(x));

function fixture(options={}) {
  const properties={
    ACCESS_KEY:"FAKE_TEST_ACCESS_KEY_ONLY_NEVER_LOG",
    SCHEMA_VERSION:"3.0"
  };
  for(const id of [G4ID,APPID,REPID]){
    properties["REQ_"+id]=JSON.stringify({requestId:id,status:"READY"});
  }
  properties["REQ_"+CREATEID]=JSON.stringify({
    requestId:CREATEID,operationMode:"CREATE",
    status:"READY",stage:"READY",
    spreadsheetId:options.badNewId?OLD:NEW,
    outputFolderId:OUT
  });
  if(options.existingUpdate)properties["REQ_"+UPDATEID]="EXISTS";
  if(options.lease)properties["VAA_TARGET_UPDATE_"+NEW]="LEASE";
  const calls={writes:0,deletes:0,posts:0,logs:[],readState:0,reads:0};
  const props={
    getProperty:k=>properties[k]??null,
    getProperties:()=>({...properties}),
    setProperty(){calls.writes++;throw Error("WRITE_FORBIDDEN");},
    deleteProperty(){calls.deletes++;throw Error("DELETE_FORBIDDEN");}
  };
  let baseline=null;
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:options.wrongRoot?"NOT_TEST":ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUT,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      DEFAULT_APP_VERSION:"TEST_QA",
      EXPECTED_COMMON_MASTER_VERSION:"TEST_QA_COMMON",
      MAX_DATASET_ROWS:100000
    },
    PropertiesService:{getScriptProperties:()=>props},
    VAAAppendMergeCore:core,
    vaaQaG6DHistorySnapshot_:p=>[G4ID,APPID,REPID].map(id=>p.getProperty("REQ_"+id)),
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6DInspectFaultDomainReadOnly:()=>({
      pass:!options.inspectorFails,
      candidateReceiptReady:true,
      receiptCount:options.wrongReceiptCount?3:4,
      readyCount:options.wrongReceiptCount?3:4,
      dataStoreMatchesSynthetic:!options.inspectorFails
    }),
    getRequestRecord_:(p,id)=>{
      const raw=p.getProperty("REQ_"+id);
      try{return raw?JSON.parse(raw):null;}catch(_){return null;}
    },
    vaaQaG5GetReadyG4Receipt_:()=>({
      receipt:{spreadsheetId:OLD}
    }),
    vaaQaG5ReplaceReadyGateReadOnly_:()=>({
      targetId:OLD,pointer:"OLD_DATASTORE_POINTER"
    }),
    validateUpdateTargetDriveFile_:(id,folder)=>{
      if(id!==NEW||folder!==OUT||options.badFolder)
        throw Error("NOT_IN_TEST_OUTPUT");
      return {};
    },
    SpreadsheetApp:{openById:id=>{
      if(id!==NEW)throw Error("NOT_G6D_TARGET");
      return {getId:()=>id};
    }},
    rptReadStateData_:()=>{
      calls.readState++;
      return {map:{
        analysisDataStoreFileId:
          options.pointerChanged&&calls.readState>1?"POINTER_FLIPPED":
            (options.samePointer?"OLD_DATASTORE_POINTER":"NEW_DATASTORE_POINTER"),
        analysisDataStoreRequestId:
          options.wrongDataStoreRequest?"OTHER_REQUEST":CREATEID
      }};
    },
    vaaQaG5ReadTestDataStore_:()=>{
      calls.reads++;
      const result=clone(baseline);
      if(options.corruptStore)result.applicationData.rows[0][0]="CORRUPTED";
      if(options.wrongCount)result.applicationData.rows.push(
        result.applicationData.rows[0].slice()
      );
      return result;
    },
    validateEnvelope_:p=>({
      ok:!!p.datasets && !!p.datasets.applicationData &&
        p.datasets.applicationData.rows.length===2 &&
        p.datasets.jobAnalysisMaster.rows.length===1
    }),
    vaaValidateUpdateProtocol_:p=>({
      ok:p.updateStrategy==="APPEND" &&
        p.updateProtocol==="IDENTITY_V1"
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({
      allowed:!options.noCapacity
    }),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    console:{log:x=>calls.logs.push(x)},
    Date
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(g4,ctx);
  vm.runInContext(
    "const VAA_QA_G5_APPEND_REQUEST_ID_ = '"+APPID+"';" +
    "const VAA_QA_G5_REPLACE_REQUEST_ID_ = '"+REPID+"';",ctx
  );
  vm.runInContext(g6c,ctx);
  const p=vm.runInContext("vaaQaG6CFaultDomainPayload_()",ctx);
  const coreResult=core.merge({
    mode:"REPLACE",incoming:clone(p.datasets),maxRows:100000
  });
  baseline={
    applicationData:coreResult.applicationData,
    jobAnalysisMaster:coreResult.jobAnalysisMaster
  };
  vm.runInContext(g6e,ctx);
  return {
    run:expr=>vm.runInContext(expr,ctx),
    calls,properties
  };
}

test("G6-E source is syntax-valid and has no mutations or POST calls",()=>{
  new vm.Script(g6e);
  assert.doesNotMatch(g6e,/\.setProperty\s*\(|\.deleteProperty\s*\(|doPost\s*\(|\.createFile\s*\(|\.setTrashed\s*\(|SpreadsheetApp\.create\s*\(/);
  assert.match(g6e,/vaaQaG6DInspectFaultDomainReadOnly/);
  assert.match(g6e,/VAAAppendMergeCore\.merge/);
});

test("G6-E succeeds and plans independent APPEND 1->2 without writes",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6EUpdateFaultPreflightReadOnly()");
  assert.equal(r.phase,"G6_UPDATE_FAULT_PREFLIGHT_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.faultDomainInspectionPass,true);
  assert.equal(r.priorReadyReceipts,4);
  assert.equal(r.candidateRequestIdAlreadyExists,false);
  assert.equal(r.candidateIndependentOfHistoricalIds,true);
  assert.equal(r.candidateTargetsIndependentTestWorkbook,true);
  assert.equal(r.candidateDataStoreIndependent,true);
  assert.equal(r.currentDataStoreCreatedByG6D,true);
  assert.equal(r.existingApplications,1);
  assert.equal(r.existingJobs,1);
  assert.equal(r.syntheticBaselineMatches,true);
  assert.equal(r.payloadValidationCode,"OK");
  assert.equal(r.updateProtocolCode,"OK");
  assert.equal(r.budgetAllowed,true);
  assert.equal(r.targetUpdateLeaseExists,false);
  assert.equal(r.mergePlanCode,"OK");
  assert.equal(r.expectedFinalApplications,2);
  assert.equal(r.expectedFinalJobs,1);
  assert.equal(r.expectedAddedApplications,1);
  assert.equal(r.expectedSkippedApplications,1);
  assert.equal(r.pointerUnchangedDuringPreflight,true);
  assert.equal(r.historicalReceiptsUnchanged,true);
  assert.equal(r.createReceiptStillPresent,true);
  assert.equal(r.newRequestStillUnused,true);
  assert.equal(r.plannedFaultPointCount,6);
  assert.equal(r.planOnly,true);
  assert.equal(r.actualFaultInjected,false);
  assert.equal(r.actualResumeTested,false);
  assert.equal(r.faultInjectionAuthorized,false);
  assert.equal(r.readyForFaultInjectionDesignReview,true);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.posts,0);
  assert.doesNotMatch(h.calls.logs.join("\n"),
    /FAKE_TEST_ACCESS_KEY_ONLY|QA_G6D_NEW_TARGET_SHEET|REQ_QA_G6E/);
});

test("G6-E uses separate G6-D target and a new synthetic requestId",()=>{
  const h=fixture();
  const p=h.run("vaaQaG6EUpdatePayload_('"+NEW+"')");
  assert.equal(p.requestId,UPDATEID);
  assert.equal(p.action,"update");
  assert.equal(p.operationMode,"update");
  assert.equal(p.updateStrategy,"APPEND");
  assert.equal(p.updateProtocol,"IDENTITY_V1");
  assert.equal(p.targetSpreadsheetId,NEW);
  assert.equal(p.companyDisplayName,"QA_SYNTHETIC_ONLY_G6C_FAULT");
  assert.equal(p.datasets.applicationData.rows.length,2);
  assert.equal(p.datasets.jobAnalysisMaster.rows.length,1);
});

test("G6-E same candidate ID or lease prevents design gate",()=>{
  for(const opt of [{existingUpdate:true},{lease:true}]){
    const h=fixture(opt);
    const r=h.run("vaaQaG6EUpdateFaultPreflightReadOnly()");
    assert.equal(r.readyForFaultInjectionDesignReview,false);
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.posts,0);
  }
});

test("G6-E low quota, changed pointer or unexpected active datastore source fails closed",()=>{
  for(const opt of [
    {noCapacity:true},{pointerChanged:true},
    {samePointer:true},{wrongDataStoreRequest:true},
    {corruptStore:true},{wrongCount:true}
  ]){
    const h=fixture(opt);
    const r=h.run("vaaQaG6EUpdateFaultPreflightReadOnly()");
    assert.equal(r.readyForFaultInjectionDesignReview,false);
    assert.equal(h.calls.posts,0);
    assert.equal(h.calls.writes,0);
  }
});

test("G6-E refuses missing G6-D readiness or bad TEST root before planning",()=>{
  for(const opt of [
    {inspectorFails:true},{wrongReceiptCount:true},{wrongRoot:true}
  ]){
    const h=fixture(opt);
    assert.throws(
      ()=>h.run("vaaQaG6EUpdateFaultPreflightReadOnly()"),
      /QA_G6E_INDEPENDENT_FAULT_DOMAIN_NOT_READY|QA_ISOLATION_FAILED/
    );
    assert.equal(h.calls.posts,0);
    assert.equal(h.calls.writes,0);
  }
});

test("G6-E fails closed if candidate CREATE receipt points to historical target",()=>{
  const h=fixture({badNewId:true});
  assert.throws(
    ()=>h.run("vaaQaG6EUpdateFaultPreflightReadOnly()"),
    /QA_G6E_NOT_AN_INDEPENDENT_TARGET/
  );
  assert.equal(h.calls.posts,0);
  assert.equal(h.calls.writes,0);
});

test("G6-E fails closed for a new target outside TEST output folder",()=>{
  const h=fixture({badFolder:true});
  assert.throws(
    ()=>h.run("vaaQaG6EUpdateFaultPreflightReadOnly()"),
    /NOT_IN_TEST_OUTPUT/
  );
  assert.equal(h.calls.posts,0);
  assert.equal(h.calls.writes,0);
});

test("G6-E fault scenario plan has no authorized real fault injection",()=>{
  const h=fixture();
  const plan=h.run("vaaQaG6EFaultPlanReadOnly_()");
  assert.equal(plan.length,6);
  assert.equal(plan.filter(s=>s.restartDecision==="NO_AUTOMATIC_RETRY").length,3);
  assert.equal(plan[4].expectedPointer,"NEW_OR_UNCERTAIN");
  assert.equal(h.calls.posts,0);
  assert.equal(h.calls.writes,0);
});
