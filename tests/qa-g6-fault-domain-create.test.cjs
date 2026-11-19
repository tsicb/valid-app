"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const output="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const g4Id="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const appId="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const replaceId="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const newId="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const oldSheet="QA_OLD_TEST_SHEET_123456789";
const newSheet="QA_NEW_TEST_SHEET_123456789";
const code=read("qa/G6_Isolated_Fault_Domain_Create_Once_QA.gs");
const clone=x=>JSON.parse(JSON.stringify(x));

function fixture(options={}) {
  const properties={
    SCHEMA_VERSION:"3.0",
    ACCESS_KEY:"TEST_ONLY_FAKE_ACCESS_KEY_32_CHARACTER",
    RPTREG_TEST:"QA_REGISTRY",
    VIEWER_TEST:"QA_VIEWER"
  };
  for(const [id,mode] of [[g4Id,"CREATE"],[appId,"UPDATE"],[replaceId,"UPDATE"]]) {
    properties["REQ_"+id]=JSON.stringify({
      requestId:id,operationMode:mode,status:"READY",stage:"READY",
      spreadsheetId:oldSheet
    });
  }
  if(options.alreadyExists)properties["REQ_"+newId]="ALREADY_USED";
  const effects={posts:0,writes:0,deletes:0,logs:[],newPointer:"",newData:null};
  const props={
    getProperty:k=>properties[k]??null,
    getProperties:()=>({...properties}),
    setProperty(k,v){effects.writes++;properties[k]=v;},
    deleteProperty(k){effects.deletes++;delete properties[k];}
  };
  const env={
    API_CONFIG:{
      ROOT_FOLDER_ID:options.badRoot?"NOT_TEST_ROOT":root,
      SHEET_OUTPUT_FOLDER_ID:output,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      DEFAULT_APP_VERSION:"TEST_APP",
      EXPECTED_COMMON_MASTER_VERSION:"QA_COMMON",
      MAX_DATASET_ROWS:100000
    },
    PropertiesService:{getScriptProperties:()=>props},
    Utilities:{newBlob:s=>({getBytes:()=>[...Buffer.from(String(s),"utf8")]})},
    VAAAppendMergeCore:core,
    SpreadsheetApp:{openById:id=>{
      if(id!==newSheet)throw Error("WRONG_TEST_SHEET");
      return {getId:()=>id};
    }},
    rptReadStateData_:()=>({map:{analysisDataStoreFileId:effects.newPointer}}),
    validateUpdateTargetDriveFile_:(id,folder)=>{
      if(id!==newSheet||folder!==output||options.wrongFolder)
        throw Error("NOT_IN_TEST_OUTPUT");
      return {};
    },
    vaaQaG5ReadTestDataStore_:()=>clone(effects.newData),
    vaaQaG5ReplaceReadyGateReadOnly_:()=>{
      if(options.badOriginal)throw Error("ORIGINAL_INVALID");
      return {targetId:oldSheet,pointer:"QA_OLD_DATASTORE_POINTER"};
    },
    vaaQaG6BFailureGatesReadOnly:()=>({
      pass:!options.badBaseline,actualReadyReceipts:3,
      finalTestDataStoreMatches:!options.badBaseline
    }),
    validateEnvelope_:p=>({
      ok:p.datasets.applicationData.rows.length===1 &&
        p.datasets.jobAnalysisMaster.rows.length===1
    }),
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!options.noCapacity}),
    stageRank_:s=>({
      TARGET_VALIDATED:15,OPENED:20,DATA_WRITTEN:30,
      REPORT_DONE:40,READY:50
    }[s]||0),
    vaaStageAppendDataStore_:()=>{},
    vaaCommitStagedAppendDataStore_:()=>{},
    vaaExecuteAppendDataStoreUpdate_:()=>{},
    vaaClaimTargetUpdateLease_:()=>{},
    vaaReleaseTargetUpdateLease_:()=>{},
    saveRequestRecord_:()=>{},
    getRequestRecord_:()=>{},
    console:{log:x=>effects.logs.push(x)},
    Date
  };
  const ctx=vm.createContext(env);
  vm.runInContext(read("qa/G4_Isolated_Create_Replay_QA.gs"),ctx);
  vm.runInContext(
    "const VAA_QA_G5_APPEND_REQUEST_ID_ = '"+appId+"';"+
    "const VAA_QA_G5_REPLACE_REQUEST_ID_ = '"+replaceId+"';",ctx
  );
  vm.runInContext(read("qa/G6_Isolated_Fault_Domain_Preflight_QA.gs"),ctx);
  vm.runInContext(read("central-api/15_Property_Capacity_Diagnostics.gs"),ctx);
  vm.runInContext(code,ctx);
  env.doPost=e=>{
    effects.posts++;
    if(options.beforeCommitError)throw Error("SIMULATED_BEFORE_COMMIT");
    const payload=JSON.parse(e.postData.contents);
    if(payload.requestId!==newId||payload.targetSpreadsheetId||
       payload.updateStrategy||payload.outputFolderId!==output)
      throw Error("UNSAFE_CREATE_PAYLOAD");
    if(properties["REQ_"+newId])throw Error("DUPLICATE_CREATE");
    const result=core.merge({
      mode:"REPLACE",incoming:clone(payload.datasets),maxRows:100000
    });
    effects.newPointer="QA_NEW_DATASTORE_POINTER";
    effects.newData={
      applicationData:result.applicationData,
      jobAnalysisMaster:result.jobAnalysisMaster
    };
    props.setProperty("REQ_"+newId,JSON.stringify({
      requestId:newId,operationMode:"CREATE",status:"READY",stage:"READY",
      spreadsheetId:newSheet,outputFolderId:output
    }));
    if(options.afterCommitError)throw Error("SIMULATED_LOST_RESPONSE");
    if(options.errorResponse)return {getContent:()=>JSON.stringify({
      ok:false,status:"ERROR",code:"SIMULATED_API_ERROR"
    })};
    return {getContent:()=>JSON.stringify({
      ok:true,status:"READY",stage:"READY",reused:false,
      spreadsheetId:newSheet,requestId:newId
    })};
  };
  return {run:s=>vm.runInContext(s,ctx),effects,properties};
}

test("G6-D source syntax valid and excluded from production staging",()=>{
  new vm.Script(code);
  assert.doesNotMatch(read("scripts/stage-append-test-gas.mjs"),
    /G6_Isolated_Fault_Domain_Create_Once_QA/);
  assert.doesNotMatch(code,/clasp push|clasp deploy/);
});

test("G6-D one-time CREATE is independent and verifies datastore",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6DCreateFaultDomainOnce()");
  assert.equal(r.phase,"G6_FAULT_DOMAIN_CREATE_ONCE");
  assert.equal(r.ok,true);
  assert.equal(r.reused,false);
  assert.equal(r.pass,true);
  assert.equal(r.receiptReady,true);
  assert.equal(r.sameTestOutput,true);
  assert.equal(r.differentWorkbookFromG4G5,true);
  assert.equal(r.differentDataStorePointer,true);
  assert.equal(r.dataStoreInTestRoot,true);
  assert.equal(r.dataStoreMatchesSynthetic,true);
  assert.equal(r.actualApplications,1);
  assert.equal(r.actualJobs,1);
  assert.equal(r.historicalReceiptsUnchanged,true);
  assert.equal(r.originalDataStoreStable,true);
  assert.equal(h.effects.posts,1);
  assert.equal(h.effects.deletes,0);
  assert.doesNotMatch(h.effects.logs.join("\n"),
    /TEST_ONLY_FAKE_ACCESS_KEY|QA_NEW_TEST_SHEET|QA_OLD_TEST_SHEET/);
});

test("G6-D read-only inspection sees four READY receipts after CREATE",()=>{
  const h=fixture();
  assert.equal(h.run("vaaQaG6DCreateFaultDomainOnce()").pass,true);
  const x=h.run("vaaQaG6DInspectFaultDomainReadOnly()");
  assert.equal(x.pass,true);
  assert.equal(x.strictReadOnly,true);
  assert.equal(x.receiptCount,4);
  assert.equal(x.readyCount,4);
  assert.equal(x.dataStoreMatchesSynthetic,true);
  assert.equal(h.effects.posts,1);
});

test("G6-D blocks second CREATE by same requestId",()=>{
  const h=fixture();
  assert.equal(h.run("vaaQaG6DCreateFaultDomainOnce()").pass,true);
  assert.throws(()=>h.run("vaaQaG6DCreateFaultDomainOnce()"),
    /QA_G6D_CREATE_BLOCKED_BY_PREFLIGHT/);
  assert.equal(h.effects.posts,1);
});

test("G6-D refuses non-TEST root, reused candidate, no capacity or bad G6-B baseline",()=>{
  for(const opt of [
    {badRoot:true},{alreadyExists:true},{noCapacity:true},{badBaseline:true}
  ]){
    const h=fixture(opt);
    assert.throws(()=>h.run("vaaQaG6DCreateFaultDomainOnce()"),
      /QA_ISOLATION_FAILED|QA_G6C_BASELINE_NOT_READY|QA_G6D_CREATE_BLOCKED_BY_PREFLIGHT/);
    assert.equal(h.effects.posts,0);
    assert.equal(h.effects.writes,0);
  }
});

test("G6-D lost response after commit is inspectable with no automatic retry",()=>{
  const h=fixture({afterCommitError:true});
  assert.throws(()=>h.run("vaaQaG6DCreateFaultDomainOnce()"),
    /SIMULATED_LOST_RESPONSE/);
  assert.equal(h.effects.posts,1);
  const x=h.run("vaaQaG6DInspectFaultDomainReadOnly()");
  assert.equal(x.pass,true);
  assert.throws(()=>h.run("vaaQaG6DCreateFaultDomainOnce()"),
    /BLOCKED_BY_PREFLIGHT/);
  assert.equal(h.effects.posts,1);
});

test("G6-D failure before commit leaves no receipt; inspector never retries",()=>{
  const h=fixture({beforeCommitError:true});
  assert.throws(()=>h.run("vaaQaG6DCreateFaultDomainOnce()"),
    /SIMULATED_BEFORE_COMMIT/);
  const x=h.run("vaaQaG6DInspectFaultDomainReadOnly()");
  assert.equal(x.candidateReceiptExists,false);
  assert.equal(x.pass,false);
  assert.equal(h.effects.posts,1);
});

test("G6-D wrong folder or non-READY API response cannot count as PASS",()=>{
  for(const opt of [{wrongFolder:true},{errorResponse:true}]){
    const h=fixture(opt);
    const result=h.run("vaaQaG6DCreateFaultDomainOnce()");
    assert.equal(result.pass,false);
    assert.equal(h.effects.posts,1);
    assert.equal(h.effects.deletes,0);
  }
});

test("G6-D inspector before CREATE is read-only",()=>{
  const h=fixture();
  const x=h.run("vaaQaG6DInspectFaultDomainReadOnly()");
  assert.equal(x.pass,false);
  assert.equal(x.candidateReceiptExists,false);
  assert.equal(h.effects.posts,0);
  assert.equal(h.effects.writes,0);
});
