"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const mergeCore=require("../central-api/append-merge-core.js");

const rootPath=path.join(__dirname,"..");
const read=p=>fs.readFileSync(path.join(rootPath,p),"utf8");
const g4=read("qa/G4_Isolated_Create_Replay_QA.gs");
const g5pre=read("qa/G5_Isolated_Append_Preflight_QA.gs");
const g5=read("qa/G5_Isolated_Append_Once_Replay_QA.gs");
const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const output="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const targetId="QA_ISOLATED_WORKBOOK_1234567890";
const G4_ID="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const G5_ID="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const deepCopy=x=>JSON.parse(JSON.stringify(x));

function makeHarness(options={}) {
  const properties={
    ACCESS_KEY:"QA_FAKE_ACCESS_KEY_32PLUS_CHARACTERS_ONLY",
    SCHEMA_VERSION:"3.0",
    SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID:"QA_DATASTORE_FOLDER"
  };
  const state={
    posts:0,writes:0,deletes:0,
    logs:[],pointer:"QA_DATASTORE_CREATE",
    data:null
  };
  const folder={
    getName:()=>"_valid_application_analysis_datastore",
    _parentId:options.invalidFolder?"OTHER_ROOT":root
  };
  const storeFile={_parentId:"QA_DATASTORE_FOLDER"};
  const props={
    getProperty:key=>Object.prototype.hasOwnProperty.call(properties,key)?properties[key]:null,
    setProperty:(key,value)=>{state.writes++;properties[key]=value;},
    deleteProperty:key=>{state.deletes++;delete properties[key];}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:root,
      SHEET_OUTPUT_FOLDER_ID:output,
      DEFAULT_APP_VERSION:"TEST_APP",
      EXPECTED_COMMON_MASTER_VERSION:"2026.09.03-common-v1",
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"_valid_application_analysis_datastore",
      MAX_DATASET_ROWS:100000
    },
    VAAAppendMergeCore:mergeCore,
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{openById:id=>({getId:()=>id})},
    DriveApp:{
      getFolderById:id=>folder,
      getFileById:id=>storeFile
    },
    folderIsDirectChildOf_:(item,id)=>item._parentId===id,
    validateUpdateTargetDriveFile_:(id,folderId)=>{
      if(id!==targetId||folderId!==output)throw Error("NOT_TEST_TARGET");
      return {};
    },
    validateUpdateTargetWorkbook_:()=>({
      ok:true,
      stateData:{map:{analysisDataStoreFileId:state.pointer}}
    }),
    rptReadStateData_:()=>({
      map:{analysisDataStoreFileId:state.pointer}
    }),
    vaaValidateUpdateProtocol_:payload=>({
      ok:payload.updateStrategy==="APPEND"&&
        payload.updateProtocol==="IDENTITY_V1"
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({
      allowed:!options.capacityExceeded
    }),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    validateEnvelope_:payload=>{
      const required=["applicationData","jobAnalysisMaster","processInfo","inputFiles","imageMasterInitial"];
      return required.every(key=>payload.datasets[key] &&
        payload.datasets[key].rows.every(row=>
          row.length===payload.datasets[key].headers.length))
        ?{ok:true}:{ok:false,code:"INVALID_DATASET"};
    },
    vaaDigestUpdateRequest_:payload=>JSON.stringify([
      payload.updateStrategy,payload.updateProtocol,
      payload.targetSpreadsheetId||payload.targetSpreadsheetUrl,
      payload.datasets
    ]),
    vaaValidateUpdateRequestRecord_:(receipt,strategy,digest)=>({
      ok:receipt.updateStrategy===strategy &&
        receipt.updatePayloadDigest===digest
    }),
    console:{log:line=>state.logs.push(line)},
    Date
  };
  const ctx=vm.createContext(scope);
  for(const source of [g4,g5pre,g5])vm.runInContext(source,ctx);
  const baselinePayload=vm.runInContext("vaaQaG4SyntheticPayload_()",ctx);
  const initial=mergeCore.merge({
    mode:"REPLACE",incoming:deepCopy(baselinePayload.datasets)
  });
  state.data={
    applicationData:initial.applicationData,
    jobAnalysisMaster:initial.jobAnalysisMaster
  };
  properties["REQ_"+G4_ID]=JSON.stringify({
    requestId:G4_ID,operationMode:"CREATE",
    status:"READY",stage:"READY",spreadsheetId:targetId
  });
  scope.readAnalysisDataStore_=()=>({
    ok:true,status:"HIT",
    datasets:state.data
  });
  scope.doPost=event=>{
    state.posts++;
    const payload=JSON.parse(event.postData.contents);
    const key="REQ_"+payload.requestId;
    const cached=properties[key];
    if(cached) {
      const receipt=JSON.parse(cached);
      return {getContent:()=>JSON.stringify({
        ok:true,reused:true,status:"READY",stage:"READY",
        requestId:payload.requestId,
        spreadsheetId:receipt.spreadsheetId,
        updateStrategy:receipt.updateStrategy,
        updateStats:receipt.updateStats
      })};
    }
    if(options.simulatePostError) {
      return {getContent:()=>JSON.stringify({
        ok:false,code:"QA_SIMULATED_FAILURE"
      })};
    }
    const result=mergeCore.merge({
      mode:payload.updateStrategy,
      incoming:deepCopy(payload.datasets),
      existing:{
        applicationIdentityVersion:mergeCore.VERSION,
        applicationData:state.data.applicationData,
        jobAnalysisMaster:state.data.jobAnalysisMaster
      }
    });
    state.data={
      applicationData:result.applicationData,
      jobAnalysisMaster:result.jobAnalysisMaster
    };
    state.pointer="QA_DATASTORE_APPEND";
    const saved={
      requestId:payload.requestId,
      operationMode:"UPDATE",status:"READY",stage:"READY",
      updateStrategy:payload.updateStrategy,
      updatePayloadDigest:scope.vaaDigestUpdateRequest_(payload),
      spreadsheetId:targetId,
      targetSpreadsheetId:targetId,
      updateStats:{
        oldApplications:result.stats.oldApplications,
        addedApplications:result.stats.addedApplications,
        finalApplications:result.stats.finalApplications,
        finalJobs:result.stats.finalJobs
      }
    };
    props.setProperty(key,JSON.stringify(saved));
    return {getContent:()=>JSON.stringify({
      ok:true,reused:false,status:"READY",stage:"READY",
      requestId:payload.requestId,spreadsheetId:targetId,
      updateStrategy:payload.updateStrategy,updateStats:saved.updateStats
    })};
  };
  if(options.existingReceipt)
    properties["REQ_"+G5_ID]=JSON.stringify({requestId:G5_ID,status:"READY"});
  if(options.activeLease)
    properties["VAA_TARGET_UPDATE_"+targetId]="ACTIVE";
  if(options.wrongRoot)
    scope.API_CONFIG.ROOT_FOLDER_ID="DIFFERENT_ROOT";
  return {state,properties,scope,ctx,
    run:expression=>vm.runInContext(expression,ctx)};
}

test("G5-B/C QA source is syntax-valid and not part of canonical GAS staging",()=>{
  new vm.Script(g5);
  const stager=read("scripts/stage-append-test-gas.mjs");
  assert.doesNotMatch(stager,/G5_Isolated_Append_Once_Replay_QA/);
  assert.ok(!g5.includes("clasp push"));
  assert.ok(!g5.includes("clasp deploy"));
  assert.match(g5,/vaaQaG5AppendPreflightReadOnly\(/);
  assert.match(g5,/vaaQaG5ReplayReady\(/);
});

test("G5-B APPEND exactly once updates one synthetic existing workbook and READY receipt",()=>{
  const h=makeHarness();
  const r=h.run("vaaQaG5AppendOnce()");
  assert.equal(r.phase,"G5_APPEND_ONCE");
  assert.equal(r.ok,true);
  assert.equal(r.reused,false);
  assert.equal(r.sameTarget,true);
  assert.equal(r.requestIdMatched,true);
  assert.equal(r.receiptReady,true);
  assert.equal(r.receiptStrategyMatches,true);
  assert.equal(r.addedApplications,1);
  assert.equal(r.finalApplications,2);
  assert.equal(r.finalJobs,1);
  assert.equal(r.dataStoreMatchesExpected,true);
  assert.equal(r.pass,true);
  assert.equal(h.state.posts,1);
  assert.equal(h.state.data.applicationData.rows.length,2);
  assert.equal(h.state.deletes,0);
  assert.doesNotMatch(h.state.logs.join("\n"),/QA_FAKE_ACCESS_KEY|QA_ISOLATED_WORKBOOK/);
});

test("G5-B cannot be rerun after READY, even though same id would be replay-safe",()=>{
  const h=makeHarness();
  assert.equal(h.run("vaaQaG5AppendOnce()").pass,true);
  assert.throws(()=>h.run("vaaQaG5AppendOnce()"),/BLOCKED_BY_PREFLIGHT/);
  assert.equal(h.state.posts,1);
  assert.equal(h.state.data.applicationData.rows.length,2);
});

test("G5-C blocks when no prior READY UPDATE and never posts",()=>{
  const h=makeHarness();
  assert.throws(()=>h.run("vaaQaG5ReplayReady()"),/BLOCKED_NOT_READY/);
  assert.equal(h.state.posts,0);
  assert.equal(h.state.writes,0);
});

test("G5-C replays exact same id with stable DataStore pointer and no added rows",()=>{
  const h=makeHarness();
  assert.equal(h.run("vaaQaG5AppendOnce()").pass,true);
  const r=h.run("vaaQaG5ReplayReady()");
  assert.equal(r.phase,"G5_APPEND_REPLAY");
  assert.equal(r.reused,true);
  assert.equal(r.dataStorePointerUnchanged,true);
  assert.equal(r.dataStoreMatchesExpected,true);
  assert.equal(r.pass,true);
  assert.equal(h.state.posts,2);
  assert.equal(h.state.data.applicationData.rows.length,2);
  assert.equal(h.state.pointer,"QA_DATASTORE_APPEND");
  assert.equal(h.state.deletes,0);
});

test("G5-C blocks digest mismatch, active lease and unexpectedly changed DataStore",()=>{
  for(const kind of ["digest","lease","data"]) {
    const h=makeHarness();
    assert.equal(h.run("vaaQaG5AppendOnce()").pass,true);
    const receiptKey="REQ_"+G5_ID;
    if(kind==="digest") {
      const saved=JSON.parse(h.properties[receiptKey]);
      saved.updatePayloadDigest="TAMPERED";
      h.properties[receiptKey]=JSON.stringify(saved);
    }
    if(kind==="lease")
      h.properties["VAA_TARGET_UPDATE_"+targetId]="ACTIVE";
    if(kind==="data")
      h.state.data.applicationData.rows[0][0]="MUTATED";
    assert.throws(()=>h.run("vaaQaG5ReplayReady()"),/QA_G5_REPLAY_BLOCKED_/);
    assert.equal(h.state.posts,1);
  }
});

test("capacity, duplicate id, target lease, or wrong root block APPEND before POST",()=>{
  for(const options of [
    {capacityExceeded:true},{existingReceipt:true},
    {activeLease:true},{wrongRoot:true}
  ]) {
    const h=makeHarness(options);
    assert.throws(()=>h.run("vaaQaG5AppendOnce()"),
      /BLOCKED_BY_PREFLIGHT|ISOLATION_FAILED/);
    assert.equal(h.state.posts,0);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.data.applicationData.rows.length,1);
  }
});

test("server error does not auto-retry or permit READY replay",()=>{
  const h=makeHarness({simulatePostError:true});
  const r=h.run("vaaQaG5AppendOnce()");
  assert.equal(r.ok,false);
  assert.equal(r.pass,false);
  assert.equal(h.state.posts,1);
  assert.throws(()=>h.run("vaaQaG5ReplayReady()"),/BLOCKED_NOT_READY/);
  assert.equal(h.state.posts,1);
  assert.equal(h.state.writes,0);
});
