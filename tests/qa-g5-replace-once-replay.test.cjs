"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");
const load=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const sources=[
  "qa/G4_Isolated_Create_Replay_QA.gs",
  "qa/G5_Isolated_Append_Preflight_QA.gs",
  "qa/G5_Isolated_Append_Once_Replay_QA.gs",
  "qa/G5_Isolated_Replace_Preflight_QA.gs",
  "qa/G5_Isolated_Replace_Once_Replay_QA.gs"
].map(load);
const G4="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const APPEND="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const REPLACE="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const ROOT="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const OUTPUT="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const TARGET="ISOLATED_QA_SPREADSHEET_123456789";
const clone=x=>JSON.parse(JSON.stringify(x));
const dataEquals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function harness(opt={}) {
  const values={
    ACCESS_KEY:"NOT_A_REAL_KEY_TESTS_ONLY_32_CHARACTERS",
    SCHEMA_VERSION:"3.0",
    SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID:"QA_DS_FOLDER"
  };
  const state={writes:0,deletes:0,posts:0,logs:[],
    pointer:"QA_DATASTORE_APPEND_FILE",data:null,jobTitle:""};
  const folder={getName:()=>"_valid_application_analysis_datastore",
    parent:opt.wrongFolder?"OTHER_ROOT":ROOT};
  const file={parent:"QA_DS_FOLDER"};
  const props={
    getProperty:k=>Object.hasOwn(values,k)?values[k]:null,
    setProperty(k,v){values[k]=v;state.writes++;},
    deleteProperty(k){delete values[k];state.deletes++;}
  };
  const globals={
    API_CONFIG:{
      ROOT_FOLDER_ID:ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUTPUT,
      DEFAULT_APP_VERSION:"TEST_QA_ONLY",
      EXPECTED_COMMON_MASTER_VERSION:"QA_COMMON_MASTER",
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"_valid_application_analysis_datastore",
      MAX_DATASET_ROWS:100000
    },
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{openById:id=>({getId:()=>id})},
    DriveApp:{getFolderById:()=>folder,getFileById:()=>file},
    folderIsDirectChildOf_:(obj,id)=>obj.parent===id,
    fileIsInManagedOutputTree_:()=>true,
    validateUpdateTargetDriveFile_:(id,out)=>{
      if(id!==TARGET||out!==OUTPUT)throw Error("NOT_TEST_TARGET");
      return {};
    },
    validateUpdateTargetWorkbook_:()=>({
      ok:true,stateData:{map:{analysisDataStoreFileId:state.pointer}}
    }),
    rptReadStateData_:()=>({
      map:{analysisDataStoreFileId:state.pointer}
    }),
    VAAAppendMergeCore:core,
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!opt.capacityExceeded}),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    validateEnvelope_:payload=>{
      const required=["applicationData","jobAnalysisMaster","processInfo","inputFiles","imageMasterInitial"];
      return required.every(k=>payload.datasets[k]&&
        payload.datasets[k].rows.every(row=>row.length===payload.datasets[k].headers.length))
        ?{ok:true}:{ok:false,code:"INVALID_DATASET"};
    },
    vaaValidateUpdateProtocol_:payload=>({
      ok:["REPLACE","APPEND"].includes(payload.updateStrategy) &&
        payload.updateProtocol==="IDENTITY_V1"
    }),
    vaaDigestUpdateRequest_:payload=>JSON.stringify([
      payload.updateStrategy,payload.updateProtocol,
      payload.targetSpreadsheetId||payload.targetSpreadsheetUrl,payload.datasets
    ]),
    vaaValidateUpdateRequestRecord_:(record,strategy,digest)=>({
      ok:record.updateStrategy===strategy && record.updatePayloadDigest===digest,
      code:"REQUEST_PAYLOAD_MISMATCH"
    }),
    readAnalysisDataStore_:()=>({
      ok:true,status:"HIT",datasets:clone(state.data)
    }),
    console:{log:x=>state.logs.push(x)},
    Date
  };
  const ctx=vm.createContext(globals);
  for(const source of sources)vm.runInContext(source,ctx);
  const init=vm.runInContext("vaaQaG4SyntheticPayload_()",ctx);
  const create=core.merge({mode:"REPLACE",incoming:clone(init.datasets)});
  const appPayload=vm.runInContext("vaaQaG5AppendPayload_('"+TARGET+"')",ctx);
  const appended=core.merge({mode:"APPEND",
    incoming:clone(appPayload.datasets),
    existing:{
      applicationIdentityVersion:core.VERSION,
      applicationData:create.applicationData,
      jobAnalysisMaster:create.jobAnalysisMaster
    }
  });
  state.data={
    applicationData:appended.applicationData,
    jobAnalysisMaster:appended.jobAnalysisMaster
  };
  values["REQ_"+G4]=JSON.stringify({
    requestId:G4,operationMode:"CREATE",status:"READY",
    stage:"READY",spreadsheetId:TARGET
  });
  values["REQ_"+APPEND]=JSON.stringify({
    requestId:APPEND,operationMode:"UPDATE",
    status:"READY",stage:"READY",updateStrategy:"APPEND",
    targetSpreadsheetId:TARGET,spreadsheetId:TARGET,
    updatePayloadDigest:globals.vaaDigestUpdateRequest_(appPayload)
  });
  if(opt.wrongRoot)globals.API_CONFIG.ROOT_FOLDER_ID="NOT_TEST_ROOT";
  if(opt.existingReplaceReceipt)values["REQ_"+REPLACE]="SAVED";
  if(opt.activeLease)values["VAA_TARGET_UPDATE_"+TARGET]="ACTIVE";
  if(opt.missingAppend)delete values["REQ_"+APPEND];
  if(opt.badAppendDigest){
    const r=JSON.parse(values["REQ_"+APPEND]);
    r.updatePayloadDigest="TAMPERED";
    values["REQ_"+APPEND]=JSON.stringify(r);
  }
  if(opt.badBaseline)state.data.applicationData.rows[0][0]="CORRUPTED";
  globals.doPost=e=>{
    state.posts++;
    const payload=JSON.parse(e.postData.contents);
    const key="REQ_"+payload.requestId;
    if(values[key]) {
      const record=JSON.parse(values[key]);
      if(record.updateStrategy!==payload.updateStrategy ||
         record.updatePayloadDigest!==globals.vaaDigestUpdateRequest_(payload)){
        return {getContent:()=>JSON.stringify({
          ok:false,code:"REQUEST_PAYLOAD_MISMATCH"
        })};
      }
      return {getContent:()=>JSON.stringify({
        ok:true,status:"READY",stage:"READY",reused:true,
        requestId:payload.requestId,
        updateStrategy:record.updateStrategy,
        spreadsheetId:record.spreadsheetId,
        updateStats:record.updateStats
      })};
    }
    if(opt.apiFail) {
      return {getContent:()=>JSON.stringify({
        ok:false,code:"SIMULATED_FAILURE"
      })};
    }
    const result=core.merge({
      mode:payload.updateStrategy,
      incoming:clone(payload.datasets),
      maxRows:100000
    });
    state.data={
      applicationData:result.applicationData,
      jobAnalysisMaster:result.jobAnalysisMaster
    };
    state.pointer="QA_DATASTORE_REPLACE_FILE";
    const stats={
      oldApplications:result.stats.oldApplications,
      uploadedApplications:result.stats.uploadedApplications,
      addedApplications:result.stats.addedApplications,
      finalApplications:result.stats.finalApplications,
      finalJobs:result.stats.finalJobs
    };
    const receipt={
      requestId:payload.requestId,operationMode:"UPDATE",
      status:"READY",stage:"READY",updateStrategy:payload.updateStrategy,
      updatePayloadDigest:globals.vaaDigestUpdateRequest_(payload),
      spreadsheetId:TARGET,targetSpreadsheetId:TARGET,updateStats:stats
    };
    props.setProperty(key,JSON.stringify(receipt));
    return {getContent:()=>JSON.stringify({
      ok:true,status:"READY",stage:"READY",reused:false,
      requestId:payload.requestId,updateStrategy:payload.updateStrategy,
      spreadsheetId:TARGET,updateStats:stats
    })};
  };
  return {run:x=>vm.runInContext(x,ctx),values,state,globals};
}

test("G5-E/F/G source is valid and excluded from normal GAS source staging",()=>{
  const source=sources[4];
  new vm.Script(source);
  const stager=load("scripts/stage-append-test-gas.mjs");
  assert.doesNotMatch(stager,/G5_Isolated_Replace_Once_Replay_QA/);
  assert.doesNotMatch(source,/clasp push|clasp deploy/);
});

test("G5-E one REPLACE preserves TEST target; 2 applicants become 1 with new job data",()=>{
  const h=harness();
  const pre=h.run("vaaQaG5ReplacePreflightReadOnly()");
  assert.equal(pre.safeToReplaceOnce,true);
  const out=h.run("vaaQaG5ReplaceOnce()");
  assert.equal(out.phase,"G5_REPLACE_ONCE");
  assert.equal(out.ok,true);
  assert.equal(out.reused,false);
  assert.equal(out.sameTarget,true);
  assert.equal(out.receiptReady,true);
  assert.equal(out.oldApplications,0);
  assert.equal(out.addedApplications,1);
  assert.equal(out.finalApplications,1);
  assert.equal(out.dataStoreMatchesExpected,true);
  assert.equal(out.updateLeaseExists,false);
  assert.equal(out.pass,true);
  assert.equal(h.state.posts,1);
  assert.equal(h.state.data.applicationData.rows.length,1);
  const j=h.state.data.jobAnalysisMaster;
  assert.equal(j.rows[0][j.headers.indexOf("仕事名")],"QA架空求人_REPLACE後");
  assert.equal(j.rows[0][j.headers.indexOf("給与金額MIN")],1600);
  assert.equal(h.state.deletes,0);
  assert.doesNotMatch(h.state.logs.join("\n"),/NOT_A_REAL_KEY|ISOLATED_QA_SPREADSHEET/);
});

test("G5-E second invocation refuses to send any more POST",()=>{
  const h=harness();
  assert.equal(h.run("vaaQaG5ReplaceOnce()").pass,true);
  assert.throws(()=>h.run("vaaQaG5ReplaceOnce()"),/BLOCKED_BY_PREFLIGHT/);
  assert.equal(h.state.posts,1);
});

test("G5-F replay returns reused true with unchanged DataStore pointer",()=>{
  const h=harness();
  assert.equal(h.run("vaaQaG5ReplaceOnce()").pass,true);
  const out=h.run("vaaQaG5ReplaceReplayReady()");
  assert.equal(out.phase,"G5_REPLACE_REPLAY");
  assert.equal(out.reused,true);
  assert.equal(out.dataStorePointerUnchanged,true);
  assert.equal(out.pass,true);
  assert.equal(h.state.posts,2);
  assert.equal(h.state.data.applicationData.rows.length,1);
});

test("G5-G mismatched payload is rejected by API with no storage or receipt changes",()=>{
  const h=harness();
  assert.equal(h.run("vaaQaG5ReplaceOnce()").pass,true);
  const before=h.values["REQ_"+REPLACE];
  const out=h.run("vaaQaG5ReplaceRejectPayloadMismatch()");
  assert.equal(out.phase,"G5_REPLACE_PAYLOAD_MISMATCH_REJECTION");
  assert.equal(out.rejectedByApi,true);
  assert.equal(out.rejectionCode,"REQUEST_PAYLOAD_MISMATCH");
  assert.equal(out.receiptUnchanged,true);
  assert.equal(out.dataStorePointerUnchanged,true);
  assert.equal(out.dataStoreMatchesExpected,true);
  assert.equal(out.pass,true);
  assert.equal(h.values["REQ_"+REPLACE],before);
  assert.equal(h.state.data.applicationData.rows.length,1);
  assert.equal(h.state.posts,2);
  assert.equal(h.state.deletes,0);
});

test("preflight fails closed for wrong root, low capacity, prior errors, lease or existing requestId",()=>{
  for(const opt of [
    {wrongRoot:true},{capacityExceeded:true},{existingReplaceReceipt:true},
    {activeLease:true},{missingAppend:true},{badAppendDigest:true},
    {badBaseline:true},{wrongFolder:true}
  ]){
    const h=harness(opt);
    assert.throws(
      ()=>{const r=h.run("vaaQaG5ReplaceOnce()");
        if(r.pass)throw Error("SHOULD_BE_BLOCKED");},
      /QA_G5_REPLACE_|QA_ISOLATION_FAILED|QA_G5_DATASTORE_/
    );
    assert.equal(h.state.posts,0);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
  }
});

test("READY replay and mismatch challenge never POST before successful REPLACE",()=>{
  const h=harness();
  assert.throws(()=>h.run("vaaQaG5ReplaceReplayReady()"),/BLOCKED_NOT_READY/);
  assert.throws(()=>h.run("vaaQaG5ReplaceRejectPayloadMismatch()"),/BLOCKED_NOT_READY/);
  assert.equal(h.state.posts,0);
});

test("tampered REPLACE digest, lease, or datastore blocks all further POST",()=>{
  for(const problem of ["digest","lease","datastore"]){
    const h=harness();
    assert.equal(h.run("vaaQaG5ReplaceOnce()").pass,true);
    const receipt=JSON.parse(h.values["REQ_"+REPLACE]);
    if(problem==="digest"){
      receipt.updatePayloadDigest="TAMPERED";
      h.values["REQ_"+REPLACE]=JSON.stringify(receipt);
    }
    if(problem==="lease")h.values["VAA_TARGET_UPDATE_"+TARGET]="ACTIVE";
    if(problem==="datastore")h.state.data.applicationData.rows[0][0]="MUTATED";
    assert.throws(()=>h.run("vaaQaG5ReplaceReplayReady()"),/BLOCKED_/);
    assert.throws(()=>h.run("vaaQaG5ReplaceRejectPayloadMismatch()"),/BLOCKED_/);
    assert.equal(h.state.posts,1);
  }
});

test("server-side error on first REPLACE is surfaced without automatic retry",()=>{
  const h=harness({apiFail:true});
  const out=h.run("vaaQaG5ReplaceOnce()");
  assert.equal(out.ok,false);
  assert.equal(out.pass,false);
  assert.equal(h.state.posts,1);
  assert.throws(()=>h.run("vaaQaG5ReplaceReplayReady()"),/BLOCKED_NOT_READY/);
  assert.equal(h.state.posts,1);
});
