"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const mergeCore=require("../central-api/append-merge-core.js");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const g4=read("qa/G4_Isolated_Create_Replay_QA.gs");
const g5=read("qa/G5_Isolated_Append_Preflight_QA.gs");
const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const out="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const target="QA_TEST_WORKBOOK_ONLY_123456789";

function fixture(overrides={}) {
  const map={
    ACCESS_KEY:"G5_FAKE_SECRET_TEST_ONLY_32_CHARACTERS",
    SCHEMA_VERSION:"3.0",
    SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID:"QA_DATASTORE_FOLDER"
  };
  const state={writes:0,deletes:0,readCalls:0,logs:[],postCalls:0};
  const folder={getName:()=>"_valid_application_analysis_datastore",_parentId:root};
  const file={_parentId:"QA_DATASTORE_FOLDER"};
  const props={
    getProperty:key=>Object.prototype.hasOwnProperty.call(map,key)?map[key]:null,
    setProperty:(key,value)=>{state.writes++;map[key]=value;},
    deleteProperty:key=>{state.deletes++;delete map[key];}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:overrides.wrongRoot?"NOT_TEST":root,
      SHEET_OUTPUT_FOLDER_ID:out,
      DEFAULT_APP_VERSION:"TEST_APP",
      EXPECTED_COMMON_MASTER_VERSION:"2026.09.03-common-v1",
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"_valid_application_analysis_datastore",
      MAX_DATASET_ROWS:100000
    },
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{openById:id=>({getId:()=>id})},
    DriveApp:{
      getFolderById:id=>folder,
      getFileById:id=>file
    },
    folderIsDirectChildOf_:(item,id)=>item._parentId===id,
    validateUpdateTargetDriveFile_:(id,folderId)=>{
      if(folderId!==out||id!==target)throw Error("not test target");
      return {};
    },
    validateUpdateTargetWorkbook_:()=>({
      ok:true,stateData:{map:{analysisDataStoreFileId:"QA_FILE_ONLY"}}
    }),
    validateEnvelope_:payload=>{
      const required=["applicationData","jobAnalysisMaster","processInfo","inputFiles","imageMasterInitial"];
      return required.every(n=>payload.datasets[n] &&
        payload.datasets[n].rows.every(row=>
          row.length===payload.datasets[n].headers.length))
        ?{ok:true}:{ok:false,code:"INVALID_DATASET"};
    },
    vaaValidateUpdateProtocol_:payload=>({
      ok:payload.updateStrategy==="APPEND" &&
        payload.updateProtocol==="IDENTITY_V1"
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!overrides.atCapacity}),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    VAAAppendMergeCore:mergeCore,
    console:{log:value=>state.logs.push(value)},
    Date
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(g4,ctx);
  vm.runInContext(g5,ctx);
  const original=vm.runInContext("vaaQaG4SyntheticPayload_()",ctx);
  const existing=mergeCore.merge({
    mode:"REPLACE",incoming:JSON.parse(JSON.stringify(original.datasets))
  });
  if(overrides.badBaseline)existing.applicationData.rows[0][0]="CORRUPTED";
  scope.readAnalysisDataStore_=()=>{
    state.readCalls++;
    return {ok:true,status:"HIT",datasets:{
      applicationData:existing.applicationData,
      jobAnalysisMaster:existing.jobAnalysisMaster
    }};
  };
  if(overrides.wrongFolder)folder._parentId="NOT_TEST_ROOT";
  map["REQ_QA_G4_SYNTHETIC_CREATE_20261118_V1"]=JSON.stringify({
    requestId:"QA_G4_SYNTHETIC_CREATE_20261118_V1",
    operationMode:"CREATE",status:"READY",stage:"READY",
    spreadsheetId:target
  });
  if(overrides.missingG4Receipt)
    delete map["REQ_QA_G4_SYNTHETIC_CREATE_20261118_V1"];
  if(overrides.existingG5Receipt)
    map["REQ_QA_G5_SYNTHETIC_APPEND_20261118_V1"]="{existing}";
  if(overrides.activeLease)
    map["VAA_TARGET_UPDATE_"+target]="{active}";
  return {state,map,run:()=>vm.runInContext("vaaQaG5AppendPreflightReadOnly()",ctx)};
}

test("G5-A QA file is syntax valid and has no direct mutation functions",()=>{
  new vm.Script(g5);
  assert.doesNotMatch(g5,/\.setProperty\(|\.deleteProperty\(|SpreadsheetApp\.create\(|doPost\(/);
  assert.match(g5,/readAnalysisDataStore_\(/);
  assert.match(g5,/vaaCheckNewRequestCapacityReadOnly_/);
});

test("G5-A checks real merge plan with one old and one new synthetic applicant",()=>{
  const h=fixture();
  const result=h.run();
  assert.equal(result.phase,"G5_APPEND_PREFLIGHT_READ_ONLY");
  assert.equal(result.safeToAppendOnce,true);
  assert.equal(result.initialRowsMatch,true);
  assert.equal(result.expectedOldApplications,1);
  assert.equal(result.expectedAddedApplications,1);
  assert.equal(result.expectedFinalApplications,2);
  assert.equal(result.expectedFinalJobs,1);
  assert.equal(h.state.readCalls,1);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
  assert.equal(h.state.postCalls,0);
  assert.doesNotMatch(h.state.logs.join("\n"),/G5_FAKE_SECRET|QA_TEST_WORKBOOK_ONLY/);
});

test("stale initial data store is rejected before any write",()=>{
  const h=fixture({badBaseline:true});
  const r=h.run();
  assert.equal(r.safeToAppendOnce,false);
  assert.equal(r.mergePlanCode,"BASELINE_MISMATCH");
  assert.equal(h.state.writes,0);
});

test("wrong TEST root, missing CREATE receipt or external DataStore folder abort",()=>{
  const wrong=fixture({wrongRoot:true});
  assert.throws(()=>wrong.run(),/QA_ISOLATION_FAILED/);
  const missing=fixture({missingG4Receipt:true});
  assert.throws(()=>missing.run(),/QA_G5_MISSING_G4_RECEIPT/);
  const outside=fixture({wrongFolder:true});
  assert.throws(()=>outside.run(),/QA_G5_DATASTORE_OUTSIDE_TEST_ROOT/);
  for(const h of [wrong,missing,outside]){
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
  }
});

test("new request is blocked for capacity, existing receipt, or active UPDATE lease",()=>{
  for(const options of [
    {atCapacity:true}, {existingG5Receipt:true},{activeLease:true}
  ]) {
    const h=fixture(options);
    const r=h.run();
    assert.equal(r.safeToAppendOnce,false);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
  }
});
