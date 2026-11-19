"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const core=require("../central-api/append-merge-core.js");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const qa=read("qa/G6_Isolated_Fail_Fast_Prewrite_QA.gs");
const ROOT="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const OUT="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const G4="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const APPEND="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const REPLACE="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const G6D="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const G6E="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const OLD="QA_G4_HISTORIC_TEST_TARGET_12345";
const NEW="QA_G6D_NEW_TEST_TARGET_123456";
const clone=x=>JSON.parse(JSON.stringify(x));

function fixture(options={}) {
  const values={
    ACCESS_KEY:"QA_G6G_FAKE_TEST_ONLY_ACCESS_KEY",
    SCHEMA_VERSION:"3.0"
  };
  for(const id of [G4,APPEND,REPLACE]){
    values["REQ_"+id]=JSON.stringify({
      requestId:id,operationMode:"UPDATE",
      status:"READY",stage:"READY",spreadsheetId:OLD
    });
  }
  values["REQ_"+G6D]=JSON.stringify({
    requestId:G6D,operationMode:"CREATE",
    status:"READY",stage:"READY",
    spreadsheetId:NEW,outputFolderId:OUT
  });
  if(options.existingCandidate)values["REQ_"+G6E]="EXISTING";
  if(options.targetLease)values["VAA_TARGET_UPDATE_"+NEW]="LEASE";
  const state={
    realWrites:0,realDeletes:0,logs:[],
    driveCalls:0,lockCalls:0,stageCalls:0,postCalls:0,
    pointerReads:0,oldPointer:"G4_REPLACE_DATASTORE",
    newPointer:"G6D_CREATE_DATASTORE"
  };
  const props={
    getProperty:k=>values[k]??null,
    getProperties:()=>clone(values),
    setProperty(){state.realWrites++;throw Error("REAL_PROPERTY_WRITE_FORBIDDEN");},
    deleteProperty(){state.realDeletes++;throw Error("REAL_PROPERTY_DELETE_FORBIDDEN");}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:options.wrongRoot?"NOT_TEST":ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUT,
      DEFAULT_APP_VERSION:"QA_TEST_VERSION",
      EXPECTED_COMMON_MASTER_VERSION:"QA_COMMON",
      REQUEST_PROPERTY_PREFIX:"REQ_",
      CURRENT_STORAGE_LAYOUT:"DATASTORE_V1",
      MAX_DATASET_ROWS:100000
    },
    VAAAppendMergeCore:core,
    PropertiesService:{getScriptProperties:()=>props},
    Utilities:{
      newBlob:s=>({getBytes:()=>[...Buffer.from(String(s),"utf8")]}),
      DigestAlgorithm:{SHA_256:"SHA_256"},
      Charset:{UTF_8:"UTF_8"},
      computeDigest:(a,s,b)=>[
        ...crypto.createHash("sha256").update(String(s),"utf8").digest()
      ]
    },
    normalizeString_:v=>String(v??"").trim(),
    invalid_:(code,message)=>({ok:false,code,message}),
    vaaQaG6DHistorySnapshot_:p=>[G4,APPEND,REPLACE].map(
      id=>p.getProperty("REQ_"+id)
    ),
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6FSyntheticFaultReviewReadOnly:()=>({
      pass:!options.badPrior,
      simulatedDecisionsPass:!options.badPrior,
      negativeGatesPass:!options.badPrior,
      actualReadyReceipts:options.badReadyCount?3:4,
      candidateRequestIdUnused:true,
      targetLeaseNotCreated:true
    }),
    vaaQaG5ReplaceReadyGateReadOnly_:()=>({
      targetId:OLD,pointer:state.oldPointer
    }),
    validateUpdateTargetDriveFile_:(id,out)=>{
      if(id!==NEW||out!==OUT||options.badFolder)
        throw Error("TEST_OUTPUT_INVALID");
      return {};
    },
    SpreadsheetApp:{
      openById:id=>{
        if(id!==NEW)throw Error("UNKNOWN_TEST_SHEET");
        return {getId:()=>id};
      }
    },
    rptReadStateData_:()=>{
      state.pointerReads++;
      return {map:{
        analysisDataStoreFileId:
          options.newPointerChanged&&state.pointerReads>1
            ?"UNKNOWN_DATASTORE":state.newPointer,
        analysisDataStoreRequestId:
          options.badPointerOwner?"WRONG_REQUEST":G6D
      }};
    },
    LockService:{
      getScriptLock(){
        state.lockCalls++;
        throw Error("SHOULD_NOT_LOCK");
      }
    },
    DriveApp:{
      getFileById(){
        state.driveCalls++;
        throw Error("SHOULD_NOT_READ_DRIVE");
      }
    },
    getOrCreateAnalysisDataStoreFolder_(){
      state.stageCalls++;
      throw Error("SHOULD_NOT_STAGE");
    },
    buildAnalysisDataStoreObject_(){
      state.stageCalls++;
      throw Error("SHOULD_NOT_BUILD_DATASTORE");
    },
    console:{log:x=>state.logs.push(x)},
    Date
  };
  const context=vm.createContext(scope);
  const files=[
    "central-api/15_Property_Capacity_Diagnostics.gs",
    "central-api/19_Request_Property_Byte_Guard.gs",
    "central-api/04_Request_Target.gs",
    "central-api/13_Append_Update_Guard.gs",
    "central-api/12_Append_DataStore.gs",
    "qa/G4_Isolated_Create_Replay_QA.gs",
    "qa/G6_Isolated_Fault_Domain_Preflight_QA.gs",
    "qa/G6_Isolated_Capacity_Boundary_ReadOnly_QA.gs",
    "qa/G6_Isolated_Update_Fault_Preflight_QA.gs",
    "qa/G6_Isolated_Fail_Fast_Prewrite_QA.gs"
  ];
  // Canonical 13_Append_Update_Guard defines the expected real helpers.
  for(const p of files)vm.runInContext(read(p),context);
  // Replace the canonical Drive validator with a Node-only TEST fixture.
  // The actual GAS QA still uses canonical Drive validation.
  scope.validateUpdateTargetDriveFile_=(id,out)=>{
    if(id!==NEW||out!==OUT||options.badFolder)
      throw Error('TEST_OUTPUT_INVALID');
    return {};
  };
  if(options.corruptStageFence){
    vm.runInContext("vaaStageAppendDataStore_ = function() {};",context);
  }
  return {run:s=>vm.runInContext(s,context),state,values,scope};
}

test("G6-G has no calls to doPost, Drive write, property write or leases",()=>{
  new vm.Script(qa);
  assert.doesNotMatch(qa,
    /\bdoPost\s*\(|\.setTrashed\s*\(|\.moveTo\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\bvaaClaimTargetUpdateLease_\s*\(|\bvaaReleaseTargetUpdateLease_\s*\(/);
  assert.match(qa,/vaaQaG6FSyntheticFaultReviewReadOnly/);
  assert.match(qa,/vaaQaG6GGuardSourceFenceReadOnly_/);
  assert.doesNotMatch(read("scripts/stage-append-test-gas.mjs"),
    /G6_Isolated_Fail_Fast_Prewrite_QA/);
});

test("G6-G rejects 12 invalid prewrite cases via actual canonical functions",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6GFailFastPrewriteReadOnly()");
  assert.equal(r.phase,"G6_FAIL_FAST_PREWRITE_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.priorSyntheticReviewPass,true);
  assert.equal(r.actualReadyReceipts,4);
  assert.equal(r.sourceGuardBeforeWritesVerified,true);
  assert.equal(r.syntheticNewRequestAdmissionRejected,true);
  assert.equal(r.probeCount,12);
  assert.equal(r.probes.length,12);
  assert.equal(r.allPrewriteProbesPass,true);
  for(const probe of r.probes){
    assert.equal(probe.pass,true,probe.probe);
    assert.equal(probe.expectedCode,probe.actualCode);
  }
  assert.equal(r.fakePropertySetAttempts,0);
  assert.equal(r.fakePropertyDeleteAttempts,0);
  assert.equal(r.historicalReceiptsUnchanged,true);
  assert.equal(r.createReceiptUnchanged,true);
  assert.equal(r.originalDataStoreUnchanged,true);
  assert.equal(r.candidateDataStorePointerUnchanged,true);
  assert.equal(r.candidateRequestStillUnused,true);
  assert.equal(r.targetLeaseStillAbsent,true);
  assert.equal(r.actualFaultInjected,false);
  assert.equal(r.actualUpdatePerformed,false);
  assert.equal(r.actualResumeTested,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(r.pass,true);
  assert.equal(h.state.realWrites,0);
  assert.equal(h.state.realDeletes,0);
  assert.equal(h.state.stageCalls,0);
  assert.equal(h.state.driveCalls,0);
  assert.equal(h.state.lockCalls,0);
  assert.equal(h.state.postCalls,0);
  assert.equal(h.state.logs.length,1);
  assert.doesNotMatch(h.state.logs.join("\n"),
    /QA_G6G_FAKE_TEST_ONLY_ACCESS_KEY|QA_G6D_NEW_TEST_TARGET|QA_G4_HISTORIC_TEST_TARGET|REQ_QA_/);
});

test("G6-G verifies fail-fast before the I/O calls in canonical helpers",()=>{
  const h=fixture();
  const fence=h.run("vaaQaG6GGuardSourceFenceReadOnly_()");
  assert.equal(fence.stageGuardBeforeDataBuild,true);
  assert.equal(fence.commitGuardBeforeLock,true);
  assert.equal(h.state.lockCalls,0);
  assert.equal(h.state.stageCalls,0);
});

test("G6-G deliberately refuses changed canonical prewrite guard source",()=>{
  const h=fixture({corruptStageFence:true});
  assert.throws(()=>h.run("vaaQaG6GFailFastPrewriteReadOnly()"),
    /QA_G6G_PREWRITE_SOURCE_FENCE_UNVERIFIED/);
  assert.equal(h.state.stageCalls,0);
  assert.equal(h.state.realWrites,0);
  assert.equal(h.state.lockCalls,0);
});

test("G6-G rejects G6-F prior failure, wrong TEST root and wrong Drive folder",()=>{
  for(const opts of [{badPrior:true},{badReadyCount:true},
    {wrongRoot:true},{badFolder:true}]){
    const h=fixture(opts);
    assert.throws(()=>h.run("vaaQaG6GFailFastPrewriteReadOnly()"),
      /QA_G6G_PRIOR_FAILURE_REVIEW_NOT_READY|QA_ISOLATION_FAILED|TEST_OUTPUT_INVALID/);
    assert.equal(h.state.realWrites,0);
    assert.equal(h.state.realDeletes,0);
    assert.equal(h.state.stageCalls,0);
    assert.equal(h.state.lockCalls,0);
  }
});

test("G6-G stops for started request, preexisting lease or wrong datastore owner",()=>{
  for(const opts of [{existingCandidate:true},
    {targetLease:true},{badPointerOwner:true}]){
    const h=fixture(opts);
    assert.throws(()=>h.run("vaaQaG6GFailFastPrewriteReadOnly()"),
      /QA_G6G_CANDIDATE_ALREADY_STARTED|QA_G6G_DATASTORE_BASELINE_INVALID/);
    assert.equal(h.state.realWrites,0);
    assert.equal(h.state.lockCalls,0);
  }
});

test("G6-G changed pointer during the read-only inspection fails final pass",()=>{
  const h=fixture({newPointerChanged:true});
  const r=h.run("vaaQaG6GFailFastPrewriteReadOnly()");
  assert.equal(r.candidateDataStorePointerUnchanged,false);
  assert.equal(r.pass,false);
  assert.equal(h.state.realWrites,0);
  assert.equal(h.state.stageCalls,0);
});

test("G6-G cannot invoke any real stage or CAS operations even on a healthy test",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6GFailFastPrewriteReadOnly()");
  assert.equal(r.pass,true);
  assert.equal(h.state.driveCalls,0);
  assert.equal(h.state.lockCalls,0);
  assert.equal(h.state.stageCalls,0);
  assert.equal(h.state.realWrites,0);
  assert.equal(h.state.realDeletes,0);
});
