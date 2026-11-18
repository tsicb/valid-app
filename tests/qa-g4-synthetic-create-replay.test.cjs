"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const qa=fs.readFileSync(
  path.join(__dirname,"../qa/G4_Isolated_Create_Replay_QA.gs"),"utf8"
);
const stager=fs.readFileSync(
  path.join(__dirname,"../scripts/stage-append-test-gas.mjs"),"utf8"
);

function harness(config={}) {
  const cfg={
    testRootId:"1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU",
    testOutputId:"1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7"
  };
  const propsMap={
    ACCESS_KEY:"TEST_KEY_ONLY_WITH_SEPARATE_CREDENTIALS",
    SCHEMA_VERSION:"3.0"
  };
  const logs=[],state={posts:0,writes:0,deletes:0,driveReads:0};
  let capacityAllowed=true,validationOk=true,folderAllowed=true;
  const props={
    getProperty:key=>propsMap[key]||null,
    setProperty(key,value){state.writes++;propsMap[key]=value;},
    deleteProperty(key){state.deletes++;delete propsMap[key];}
  };
  const sandbox={
    API_CONFIG:{
      ROOT_FOLDER_ID:config.badRoot?"PRODUCTION_OR_OTHER_ROOT":cfg.testRootId,
      SHEET_OUTPUT_FOLDER_ID:cfg.testOutputId,
      DEFAULT_APP_VERSION:"TEST_APP_V1",
      EXPECTED_COMMON_MASTER_VERSION:"2026.09.03-common-v1",
      REQUEST_PROPERTY_PREFIX:"REQ_"
    },
    PropertiesService:{getScriptProperties:()=>props},
    validateEnvelope_:payload=>{
      const required=["applicationData","jobAnalysisMaster","processInfo","inputFiles","imageMasterInitial"];
      for(const n of required){
        if(!payload.datasets[n]||
           payload.datasets[n].rows.some(row=>row.length!==payload.datasets[n].headers.length)){
          return {ok:false,code:"INVALID_DATASET"};
        }
      }
      return validationOk?{ok:true}:{ok:false,code:"INVALID"};
    },
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:capacityAllowed}),
    DriveApp:{getFileById:()=>{state.driveReads++;return {};}},
    fileIsInManagedOutputTree_:()=>folderAllowed,
    doPost:event=>{
      state.posts++;
      const p=JSON.parse(event.postData.contents);
      const key="REQ_"+p.requestId;
      const existing=propsMap[key];
      if(existing) {
        const receipt=JSON.parse(existing);
        return {getContent:()=>JSON.stringify({
          ok:true,status:"READY",stage:"READY",reused:true,
          requestId:p.requestId,spreadsheetId:receipt.spreadsheetId
        })};
      }
      const receipt={
        requestId:p.requestId,
        status:"READY",
        stage:"READY",
        spreadsheetId:"TEST_ONLY_WORKBOOK_001"
      };
      props.setProperty(key,JSON.stringify(receipt));
      return {getContent:()=>JSON.stringify({
        ok:true,status:"READY",stage:"READY",reused:false,
        requestId:p.requestId,spreadsheetId:receipt.spreadsheetId
      })};
    },
    console:{log:x=>logs.push(x)},
    Date
  };
  const ctx=vm.createContext(sandbox);
  vm.runInContext(qa,ctx,{filename:"G4_Isolated_Create_Replay_QA.gs"});
  return {
    run:expression=>vm.runInContext(expression,ctx),
    propsMap,logs,state,
    capacityAllowed:x=>capacityAllowed=x,
    validationOk:x=>validationOk=x,
    folderAllowed:x=>folderAllowed=x
  };
}

test("QA-only source is syntactically valid and intentionally outside production GAS staging",()=>{
  new vm.Script(qa);
  assert.match(stager,/join\(root,"central-api"\)/);
  assert.doesNotMatch(stager,/qa\/G4_Isolated_Create_Replay_QA/);
  assert.ok(!qa.includes("clasp push"));
  assert.ok(!qa.includes("clasp deploy"));
});

test("read-only preflight validates complete synthetic dataset and leaves all properties unchanged",()=>{
  const h=harness();
  const result=h.run("vaaQaG4PreflightReadOnly()");
  assert.equal(result.phase,"G4_PREFLIGHT_READ_ONLY");
  assert.equal(result.safeToCreateOnce,true);
  assert.equal(result.syntheticApplications,1);
  assert.equal(result.syntheticJobs,1);
  assert.equal(result.payloadValidationCode,"OK");
  assert.equal(h.state.posts,0);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
  assert.equal(h.logs.length,1);
  assert.doesNotMatch(h.logs[0],/TEST_KEY_ONLY|TEST_ONLY_WORKBOOK/);
});

test("wrong root ID, missing TEST key or near-full budget prevent CREATE before any writes",()=>{
  const wrong=harness({badRoot:true});
  assert.throws(()=>wrong.run("vaaQaG4PreflightReadOnly()"),/ISOLATION_FAILED/);
  assert.equal(wrong.state.posts,0);
  const noKey=harness();delete noKey.propsMap.ACCESS_KEY;
  assert.throws(()=>noKey.run("vaaQaG4PreflightReadOnly()"),/SETUP_REQUIRED/);
  const full=harness();full.capacityAllowed(false);
  assert.equal(full.run("vaaQaG4PreflightReadOnly()").safeToCreateOnce,false);
  assert.throws(()=>full.run("vaaQaG4CreateOnce()"),/NOT_PERMITTED/);
  assert.equal(full.state.posts,0);
});

test("CREATE once then same requestId READY replay; no duplicate workbook dispatch",()=>{
  const h=harness();
  const created=h.run("vaaQaG4CreateOnce()");
  assert.equal(created.ok,true);
  assert.equal(created.reused,false);
  assert.equal(created.requestIdMatched,true);
  assert.equal(h.state.posts,1);
  assert.equal(h.run("vaaQaG4PreflightReadOnly()").safeToCreateOnce,false);
  assert.throws(()=>h.run("vaaQaG4CreateOnce()"),/NOT_PERMITTED/);
  const replay=h.run("vaaQaG4ReplayReady()");
  assert.equal(replay.ok,true);
  assert.equal(replay.reused,true);
  assert.equal(replay.sameSpreadsheet,true);
  assert.equal(replay.pass,true);
  assert.equal(h.state.posts,2);
  assert.equal(h.state.deletes,0);
  assert.doesNotMatch(h.logs.join("\n"),/TEST_KEY_ONLY|TEST_ONLY_WORKBOOK/);
});

test("unverified output workbook or incomplete existing receipt blocks replay safely",()=>{
  const h=harness();
  assert.throws(()=>h.run("vaaQaG4ReplayReady()"),/no saved request receipt/);
  h.run("vaaQaG4CreateOnce()");
  h.folderAllowed(false);
  assert.throws(()=>h.run("vaaQaG4ReplayReady()"),/outside TEST output/);
  assert.equal(h.state.posts,1);
  const key="REQ_QA_G4_SYNTHETIC_CREATE_20261118_V1";
  h.propsMap[key]=JSON.stringify({requestId:"wrong",status:"ERROR"});
  assert.throws(()=>h.run("vaaQaG4ReplayReady()"),/not READY/);
  assert.equal(h.state.posts,1);
});
