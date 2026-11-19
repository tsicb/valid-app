"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const source=read("qa/G6_Isolated_PreCas_Stage_Preflight_QA.gs");
const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const output="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const g4="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const app="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const replace="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const g6d="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const g6e="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const g6i="QA_G6I_STAGE_ONLY_PRECAS_20261119_V1";
const oldTarget="QA_OLDER_TEST_TARGET_123456789";
const newTarget="QA_G6D_TEST_TARGET_123456789";
const oldPointer="QA_G5_OLDER_TEST_DATASTORE";
const newPointer="QA_G6D_NEW_TEST_DATASTORE";
const folderId="QA_TEST_DATASTORE_FOLDER";
const clone=x=>JSON.parse(JSON.stringify(x));

function makeHarness(opts={}){
  const properties={
    ACCESS_KEY:"SYNTHETIC_ACCESS_KEY_DO_NOT_LOG",
    SCHEMA_VERSION:"3.0",
    ANALYSIS_DATASTORE_FOLDER_ID:folderId
  };
  [g4,app,replace].forEach(id=>
    properties["REQ_"+id]=JSON.stringify({requestId:id,status:"READY"})
  );
  properties["REQ_"+g6d]=JSON.stringify({
    requestId:g6d,operationMode:"CREATE",status:"READY",
    stage:"READY",spreadsheetId:opts.sameTarget?oldTarget:newTarget,
    outputFolderId:output
  });
  if(opts.stageReceipt)properties["REQ_"+g6i]="QA_EARLIER_ATTEMPT";
  if(opts.updateReceipt)properties["REQ_"+g6e]="QA_UPDATE_STARTED";
  if(opts.targetLease)properties["VAA_TARGET_UPDATE_"+newTarget]="ACTIVE";

  const state={
    writes:0,deletes:0,posts:0,filesCreated:0,filesTrashed:0,
    locks:0,logs:[],reads:0
  };
  const props={
    getProperty:k=>properties[k]??null,
    getProperties:()=>({...properties}),
    setProperty(){state.writes++;throw Error("REAL_PROPERTY_WRITE_FORBIDDEN");},
    deleteProperty(){state.deletes++;throw Error("REAL_PROPERTY_DELETE_FORBIDDEN");}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:root,
      SHEET_OUTPUT_FOLDER_ID:output,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"QA_Test_DataStore",
      MAX_DATASET_ROWS:100000,
      DEFAULT_APP_VERSION:"TEST",
      EXPECTED_COMMON_MASTER_VERSION:"QA_COMMON"
    },
    PropertiesService:{getScriptProperties:()=>props},
    VAAAppendMergeCore:core,
    normalizeString_:x=>String(x??"").trim(),
    vaaQaG6DHistorySnapshot_:p=>[g4,app,replace].map(id=>p.getProperty("REQ_"+id)),
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6HCasFaultAttestationReadOnly:()=>({
      pass:!opts.badPrior,
      sourceAttestationPass:!opts.badPrior,
      candidateRequestStillUnused:!opts.badPrior,
      targetLeaseStillAbsent:!opts.badPrior,
      actualReadyReceipts:opts.wrongReadyCount?3:4
    }),
    getRequestRecord_:(p,id)=>{
      try{return JSON.parse(p.getProperty("REQ_"+id));}
      catch(_){return null;}
    },
    vaaQaG5ReplaceReadyGateReadOnly_:()=>({
      targetId:oldTarget,pointer:oldPointer
    }),
    vaaQaG5ReadTestDataStore_:()=>{
      const out=clone(baseline);
      if(opts.corruptExisting)out.applicationData.rows.push(
        out.applicationData.rows[0].slice()
      );
      return out;
    },
    vaaReadAppendStoreSource_:()=>({
      fileId:opts.badSourcePointer?"UNKNOWN_FILE":newPointer,
      dataObject:opts.badSourceOwner?{
        ...clone(stored),"requestId":"OTHER_REQUEST"
      }:clone(stored)
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({
      allowed:!opts.noCapacity
    }),
    validateUpdateTargetDriveFile_:(id,out)=>{
      if(id!==newTarget||out!==output||opts.badOutput)
        throw Error("NOT_TEST_OUTPUT");
      return {};
    },
    folderIsDirectChildOf_:(item,parent)=>
      !opts.badParent&&parent===root,
    DriveApp:{
      getFolderById:id=>{
        if(id!==folderId||opts.missingFolder)
          throw Error("NOT_AN_EXISTING_TEST_FOLDER");
        return {
          getName:()=>opts.badFolderName?"PRODUCTION":"QA_Test_DataStore",
          getFilesByName:name=>{
            state.reads++;
            if(!name.includes(g6i))throw Error("INVALID_STAGE_FILE_NAME");
            return {hasNext:()=>!!opts.stageFileExists};
          }
        };
      },
      getFileById(){throw Error("G6I_NO_DRIVE_FILE_IO_EXPECTED");}
    },
    SpreadsheetApp:{openById:id=>{
      if(id!==newTarget)throw Error("NON_TEST_TARGET");
      return {getId:()=>id};
    }},
    rptReadStateData_:()=>{
      state.reads++;
      return {map:{
        analysisDataStoreFileId:
          opts.pointerChanged&&state.reads>1?"NEW_POINTER_CHANGED":newPointer,
        analysisDataStoreRequestId:g6d
      }};
    },
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    console:{log:s=>state.logs.push(s)},
    Date
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(read("qa/G4_Isolated_Create_Replay_QA.gs"),ctx);
  vm.runInContext(
    "const VAA_QA_G5_APPEND_REQUEST_ID_ = '"+app+"';"+
    "const VAA_QA_G5_REPLACE_REQUEST_ID_ = '"+replace+"';",ctx
  );
  vm.runInContext(read("qa/G6_Isolated_Fault_Domain_Preflight_QA.gs"),ctx);
  vm.runInContext(read("qa/G6_Isolated_Update_Fault_Preflight_QA.gs"),ctx);
  const payload=vm.runInContext("vaaQaG6CFaultDomainPayload_()",ctx);
  const merged=core.merge({
    mode:"REPLACE",incoming:clone(payload.datasets),
    maxRows:100000
  });
  const baseline={
    applicationData:merged.applicationData,
    jobAnalysisMaster:merged.jobAnalysisMaster
  };
  const stored={
    requestId:g6d,
    applicationIdentityVersion:core.VERSION,
    datasets:clone(payload.datasets)
  };
  // Use the actual pure canonical merge wrapper, not an independent
  // fake merger. The stage and commit functions are loaded, never invoked.
  vm.runInContext(read("central-api/12_Append_DataStore.gs"),ctx);
  // Node harness only: the canonical read helper uses DriveApp, but this
  // particular test supplies a fully validated synthetic source object.
  // Keep the real vaaBuildAppendStorePlan_ merger untouched.
  scope.vaaReadAppendStoreSource_=()=>({
    fileId:opts.badSourcePointer?"UNKNOWN_FILE":newPointer,
    dataObject:opts.badSourceOwner?{
      ...clone(stored),requestId:"OTHER_REQUEST"
    }:clone(stored)
  });
  // Construct fixture data in the TEST root, then deliberately violate it
  // before invoking G6-I when testing the wrong-root guard.
  if(opts.wrongRoot)scope.API_CONFIG.ROOT_FOLDER_ID="NOT_TEST_ROOT";
  vm.runInContext(source,ctx);
  return {run:x=>vm.runInContext(x,ctx),state,properties};
}

test("G6-I source parses, has no POST/Stage/CAS/file mutators",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,
    /\bdoPost\s*\(|\bvaaStageAppendDataStore_\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\.createFile\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\.setTrashed\s*\(/);
  assert.match(source,/vaaBuildAppendStorePlan_\s*\(/);
  assert.match(source,/getFilesByName\s*\(/);
});

test("G6-I healthy unused PRE-CAS stage-only candidate gets design review gate",()=>{
  const h=makeHarness();
  const r=h.run("vaaQaG6IStagePreflightReadOnly()");
  assert.equal(r.phase,"G6_PRECAS_STAGE_PREFLIGHT_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.priorCasAttestationPass,true);
  assert.equal(r.actualReadyReceipts,4);
  assert.equal(r.independentTestWorkbook,true);
  assert.equal(r.independentDataStorePointer,true);
  assert.equal(r.candidateRequestIndependent,true);
  assert.equal(r.candidateStageReceiptExists,false);
  assert.equal(r.reservedUpdateReceiptExists,false);
  assert.equal(r.targetLeaseExists,false);
  assert.equal(r.newCapacityAllowed,true);
  assert.equal(r.mergePlanCode,"OK");
  assert.equal(r.expectedAddedApplications,1);
  assert.equal(r.expectedSkippedApplications,1);
  assert.equal(r.expectedFinalApplications,2);
  assert.equal(r.expectedFinalJobs,1);
  assert.equal(r.stageFileAlreadyPresent,false);
  assert.equal(r.existingStageFolderInTestRoot,true);
  assert.equal(r.historicalReceiptsUnchanged,true);
  assert.equal(r.createReceiptUnchanged,true);
  assert.equal(r.originalDataStoreUnchanged,true);
  assert.equal(r.pointerUnchangedDuringPreflight,true);
  assert.equal(r.candidateRequestStillUnused,true);
  assert.equal(r.reservedUpdateRequestStillUnused,true);
  assert.equal(r.targetLeaseStillAbsent,true);
  assert.equal(r.readyForStageOnlyDesignReview,true);
  assert.equal(r.stageOnlyExecutionAuthorized,false);
  assert.equal(r.actualStageFileCreated,false);
  assert.equal(r.actualFaultInjected,false);
  assert.equal(r.actualUpdatePerformed,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
  assert.equal(h.state.posts,0);
  assert.equal(h.state.filesCreated,0);
  assert.equal(h.state.filesTrashed,0);
  assert.equal(h.state.locks,0);
  assert.equal(h.state.logs.length,1);
  assert.doesNotMatch(h.state.logs.join("\n"),
    /QA_G6D_TEST_TARGET|SYNTHETIC_ACCESS_KEY|QA_G6I_STAGE_ONLY_PRECAS/);
});

test("G6-I excludes all previously used requestIds including reserved APPEND",()=>{
  const h=makeHarness();
  const p=h.run("vaaQaG6IStageCandidateFileName_('"+newTarget+"')");
  assert.match(p,/^analysis_data_QA_G6D_TEST_TARGET_/);
  assert.match(p,/QA_G6I_STAGE_ONLY_PRECAS_20261119_V1\.json$/);
  const r=h.run("vaaQaG6IStagePreflightReadOnly()");
  assert.equal(r.candidateRequestIndependent,true);
  assert.equal(r.reservedUpdateRequestStillUnused,true);
});

test("G6-I blocks any prior stage artifact, prior receipt, lease or reserved UPDATE",()=>{
  for(const o of [
    {stageFileExists:true},{stageReceipt:true},
    {updateReceipt:true},{targetLease:true}
  ]){
    const h=makeHarness(o);
    const r=h.run("vaaQaG6IStagePreflightReadOnly()");
    assert.equal(r.readyForStageOnlyDesignReview,false);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.filesCreated,0);
  }
});

test("G6-I blocks low capacity and pointer/merge/source uncertainty",()=>{
  // A safe but unfavorable budget/pointer check returns a review denial.
  for(const o of [{noCapacity:true},{pointerChanged:true}]){
    const h=makeHarness(o);
    const r=h.run("vaaQaG6IStagePreflightReadOnly()");
    assert.equal(r.readyForStageOnlyDesignReview,false);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.filesCreated,0);
  }
  // Invalid source / baseline is a stronger gate and must throw closed.
  for(const o of [
    {badSourcePointer:true},{badSourceOwner:true},{corruptExisting:true}
  ]){
    const h=makeHarness(o);
    assert.throws(()=>h.run("vaaQaG6IStagePreflightReadOnly()"));
    assert.equal(h.state.writes,0);
    assert.equal(h.state.filesCreated,0);
  }
});

test("G6-I stops if old QA attestation, folder, root or target isolation fails",()=>{
  for(const o of [
    {badPrior:true},{wrongReadyCount:true},{wrongRoot:true},
    {sameTarget:true},{badOutput:true},
    {missingFolder:true},{badFolderName:true},{badParent:true}
  ]){
    const h=makeHarness(o);
    const fn=()=>h.run("vaaQaG6IStagePreflightReadOnly()");
    assert.throws(fn);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
    assert.equal(h.state.filesCreated,0);
    assert.equal(h.state.posts,0);
  }
});

test("G6-I fault contract leaves stage-only execution and CAS prohibited",()=>{
  const h=makeHarness();
  const plan=h.run("vaaQaG6IFaultPlanReadOnly_()");
  assert.equal(plan.injectionBoundary,"AFTER_VERIFIED_STAGE_BEFORE_CAS");
  assert.equal(plan.stageFileAllowedInFutureTest,true);
  assert.equal(plan.casAllowed,false);
  assert.equal(plan.updatePostAllowed,false);
  assert.equal(plan.receiptWriteAllowed,false);
  assert.equal(plan.targetLeaseAllowed,false);
  assert.equal(plan.cleanupRequiresReadOnlyForensics,true);
  assert.equal(plan.retryAllowed,false);
});
