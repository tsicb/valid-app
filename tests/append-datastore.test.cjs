"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const core = require("../central-api/append-merge-core.js");
const script = fs.readFileSync(
  path.join(__dirname,"../central-api/12_Append_DataStore.gs"),"utf8"
);
const sig = s => crypto.createHmac("sha256","test-secret").update(s).digest("hex");
const person = (v,date="2026/10/01") =>
  core.personIdentityKey(sig(core.personMaterial("PERSON_NAME","C01",date,v)));
const A=["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ","応募識別キー","応募識別方式","対応状況"];
const J=["求人参照ID","企業ID","仕事番号","仕事名"];
const ds=(headers,rows)=>({headers:headers.slice(),rows:rows.map(x=>x.slice())});
const app=(name,job="J001",ref="JOB000001",status="初回")=>
  ["APP000001","C01",job,ref,1,person(name),"PERSON_NAME",status];
const job=(no="J001",title="初回求人",ref="JOB000001")=>[ref,"C01",no,title];
const payload=(apps,jobs)=>({
  datasets:{
    applicationData:ds(A,apps),
    jobAnalysisMaster:ds(J,jobs),
    processInfo:ds(["項目","値"],[]),
    inputFiles:ds(["ファイル"],[]),
    imageMasterInitial:ds(["画像"],[])
  },
  commonMasterVersion:"version"
});

function makeHarness(){
  const state={analysisDataStoreFileId:"",analysisDataStoreRequestId:"",analysisDataStoreBackupFileId:""};
  const files=new Map();
  let next=0, locked=false, flushed=0, badReadback=false, failWrite=false;
  function makeFile(content) {
    const id="FILE"+(++next);
    const file={
      id,content,trashed:false,
      getId(){return id;},
      getBlob(){return {getDataAsString(){return badReadback?"{}":file.content;}};},
      setTrashed(value){file.trashed=!!value;}
    };
    files.set(id,file);
    return file;
  }
  const sandbox={
    VAAAppendMergeCore:core,
    API_CONFIG:{MAX_DATASET_ROWS:100000,ANALYSIS_DATASTORE_VERSION:"1.0"},
    normalizeString_:v=>v===undefined||v===null?"":String(v).trim(),
    MimeType:{PLAIN_TEXT:"text/plain"},
    DriveApp:{
      getFileById(id){
        if(!files.has(id))throw new Error("Missing file "+id);
        return files.get(id);
      }
    },
    getOrCreateAnalysisDataStoreFolder_:()=>({createFile:(name,content)=>makeFile(content)}),
    buildAnalysisDataStoreObject_:(ss,source,requestId)=>({
      dataType:"VALID_APPLICATION_ANALYSIS_DATASTORE",
      spreadsheetId:ss.getId(),
      requestId,
      datasets:{
        applicationData:source.datasets.applicationData,
        jobAnalysisMaster:source.datasets.jobAnalysisMaster
      }
    }),
    validateAnalysisDataStoreObject_:(data,id,rid)=>({
      ok: !!(data && data.dataType==="VALID_APPLICATION_ANALYSIS_DATASTORE"
        && data.spreadsheetId===id && data.requestId===rid
        && data.datasets && data.datasets.applicationData
        && data.datasets.jobAnalysisMaster),
      reason:"BAD"
    }),
    rptReadStateData_:()=>({map:{...state}}),
    rptSetStateValues_:(ss,updates)=>{
      if(failWrite)throw new Error("WRITE_BLOCKED");
      Object.assign(state,updates);
      return {map:{...state}};
    },
    SpreadsheetApp:{flush(){flushed++;}},
    LockService:{getScriptLock:()=>({
      waitLock(){if(locked)throw new Error("LOCK_BUSY");locked=true;},
      releaseLock(){locked=false;}
    })},
    Date,
    JSON,
    Set,
    Map
  };
  vm.createContext(sandbox);
  vm.runInContext(script,sandbox,{filename:"12_Append_DataStore.gs"});
  const ss={getId:()=>"SHEET001"};
  const u=(name)=>sandbox[name];
  return {
    state,files,ss,u,makeFile,
    get flushed(){return flushed;},
    get locked(){return locked;},
    get current(){return state.analysisDataStoreFileId;},
    failNextReadback(on){badReadback=on;},
    failNextStateWrite(on){failWrite=on;},
    initialLegacy(){
      const data=sandbox.buildAnalysisDataStoreObject_(
        ss,payload([app("山田")],[job()]),"old");
      const file=makeFile(JSON.stringify(data));
      state.analysisDataStoreFileId=file.id;
      state.analysisDataStoreRequestId="old";
      return file;
    }
  };
}
function stats(r){return JSON.parse(JSON.stringify(r));}

test("REPLACE stages without replacing pointer and verifies before commit",()=>{
  const h=makeHarness();
  const source=payload([app("山田")],[job()]);
  const plan=h.u("vaaBuildAppendStorePlan_")(source,null,"REPLACE");
  const stage=h.u("vaaStageAppendDataStore_")(h.ss,plan,"req1","");
  assert.equal(h.current,"");
  assert.equal(plan.stats.finalApplications,1);
  assert.equal(h.files.size,1);
  const committed=h.u("vaaCommitStagedAppendDataStore_")(h.ss,stage);
  assert.equal(committed.ok,true);
  assert.equal(h.current,stage.fileId);
  assert.equal(h.state.applicationIdentityVersion,"1");
  assert.equal(h.state.analysisDataStoreApplicationRows,1);
  assert.equal(h.flushed,1);
  assert.equal(h.locked,false);
  assert.equal(JSON.parse(h.files.get(h.current).content).applicationIdentityVersion,"1");
});

test("APPEND merges saved rows and retains old file as backup",()=>{
  const h=makeHarness();
  const base=h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,payload([app("山田")],[job()]),"one","REPLACE");
  const sourceId=base.stage.fileId;
  const change=h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,
    payload([app("山田","J001","JOB000001","new status"),app("佐藤","J002","JOB009999")],
      [job("J001","rewritten","JOB000001"),job("J002","added","JOB009999")]),
    "two","APPEND");
  assert.deepEqual([change.plan.stats.skippedAsExisting,change.plan.stats.addedApplications,change.plan.stats.addedJobs],[1,1,1]);
  assert.equal(h.state.analysisDataStoreBackupFileId,sourceId);
  assert.equal(h.files.get(sourceId).trashed,false);
  const current=JSON.parse(h.files.get(h.current).content);
  assert.equal(current.datasets.applicationData.rows.length,2);
  assert.equal(current.datasets.applicationData.rows[0].at(-1),"初回");
  assert.equal(current.datasets.jobAnalysisMaster.rows[0].at(-1),"初回求人");
  assert.equal(current.datasets.jobAnalysisMaster.rows[1].at(-1),"added");
  const refColumn=current.datasets.applicationData.headers.indexOf("求人参照ID");
  assert.equal(current.datasets.applicationData.rows[1][refColumn],"JOB000002");
});

test("retains exactly one previous backup after a third successful commit",()=>{
  const h=makeHarness();
  const one=h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,payload([app("山田")],[job()]),"one","REPLACE");
  const two=h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,payload([app("佐藤")],[job()]),"two","APPEND");
  h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,payload([app("鈴木")],[job()]),"three","APPEND");
  assert.equal(h.state.analysisDataStoreBackupFileId,two.stage.fileId);
  assert.equal(h.files.get(one.stage.fileId).trashed,true);
  assert.equal(h.files.get(two.stage.fileId).trashed,false);
});

test("staged file is not visible until committed; stale pointer refuses destructive overwrite",()=>{
  const h=makeHarness();
  const base=h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,payload([app("山田")],[job()]),"one","REPLACE");
  const prepare=h.u("vaaBuildAppendStorePlan_");
  const stage=h.u("vaaStageAppendDataStore_");
  const commit=h.u("vaaCommitStagedAppendDataStore_");
  const s1=stage(h.ss,prepare(payload([app("佐藤")],[job()]),
    h.u("vaaReadAppendStoreSource_")(h.ss).dataObject,"APPEND"),"two",base.stage.fileId);
  const s2=stage(h.ss,prepare(payload([app("鈴木")],[job()]),
    h.u("vaaReadAppendStoreSource_")(h.ss).dataObject,"APPEND"),"three",base.stage.fileId);
  commit(h.ss,s1);
  assert.throws(()=>commit(h.ss,s2),{code:"DATASTORE_CONFLICT"});
  assert.equal(h.current,s1.fileId);
  assert.equal(h.locked,false);
});

test("retrying same committed stage is idempotent",()=>{
  const h=makeHarness();
  const p=h.u("vaaBuildAppendStorePlan_")(payload([app("山田")],[job()]),null,"REPLACE");
  const stage=h.u("vaaStageAppendDataStore_")(h.ss,p,"one","");
  h.u("vaaCommitStagedAppendDataStore_")(h.ss,stage);
  const again=h.u("vaaCommitStagedAppendDataStore_")(h.ss,stage);
  assert.equal(again.reused,true);
  assert.equal(h.current,stage.fileId);
  assert.equal(h.locked,false);
});

test("failed staged readback removes only new temp file, leaving old data linked",()=>{
  const h=makeHarness();
  const old=h.initialLegacy();
  const plan=h.u("vaaBuildAppendStorePlan_")(payload([app("佐藤")],[job()]),null,"REPLACE");
  h.failNextReadback(true);
  assert.throws(()=>h.u("vaaStageAppendDataStore_")(h.ss,plan,"repl",old.id),/検証/);
  assert.equal(h.current,old.id);
  assert.equal(h.files.get(old.id).trashed,false);
  const newest=Array.from(h.files.values()).at(-1);
  assert.equal(newest.trashed,true);
});

test("failed 99-sheet write leaves previous pointer and data intact",()=>{
  const h=makeHarness();
  const old=h.initialLegacy();
  const plan=h.u("vaaBuildAppendStorePlan_")(payload([app("佐藤")],[job()]),null,"REPLACE");
  const stage=h.u("vaaStageAppendDataStore_")(h.ss,plan,"repl",old.id);
  h.failNextStateWrite(true);
  assert.throws(()=>h.u("vaaCommitStagedAppendDataStore_")(h.ss,stage),/WRITE_BLOCKED/);
  assert.equal(h.current,old.id);
  assert.equal(h.files.get(old.id).trashed,false);
  assert.equal(h.locked,false);
});

test("APPEND refuses older DataStore without identity version",()=>{
  const h=makeHarness();
  h.initialLegacy();
  const current=h.u("vaaReadAppendStoreSource_")(h.ss);
  assert.equal(current.dataObject.applicationIdentityVersion,undefined);
  assert.throws(()=>h.u("vaaBuildAppendStorePlan_")(
    payload([app("佐藤")],[job()]),current.dataObject,"APPEND"
  ),{code:"MIGRATION_REQUIRED"});
});

test("REPLACE over older datastore keeps it as backup for migration safety",()=>{
  const h=makeHarness();
  const old=h.initialLegacy();
  const x=h.u("vaaExecuteAppendDataStoreUpdate_")(h.ss,
    payload([app("佐藤")],[job("J001","modern")]),"repl","REPLACE");
  assert.equal(x.plan.stats.finalApplications,1);
  assert.equal(h.state.analysisDataStoreBackupFileId,old.id);
  assert.equal(h.files.get(old.id).trashed,false);
});

test("invalid update mode is rejected before staging or pointers change",()=>{
  const h=makeHarness();
  assert.throws(()=>h.u("vaaBuildAppendStorePlan_")(
    payload([app("山田")],[job()]),null,"unknown"
  ),{code:"INVALID_UPDATE_STRATEGY"});
  assert.equal(h.files.size,0);
});

test("same requestId reuses committed blob and stored stats instead of rewriting",()=>{
  const h=makeHarness();
  const run=h.u("vaaExecuteAppendDataStoreUpdate_");
  const first=run(h.ss,payload([app("山田")],[job()]),"same-req","REPLACE");
  const count=h.files.size;
  const again=run(h.ss,payload([app("山田")],[job()]),"same-req","REPLACE");
  assert.equal(again.commit.reused,true);
  assert.equal(again.stage.fileId,first.stage.fileId);
  assert.equal(h.files.size,count);
  assert.equal(again.plan.stats.finalApplications,1);
  assert.equal(h.current,first.stage.fileId);
  assert.throws(()=>run(h.ss,payload([app("山田")],[job()]),"same-req","APPEND"),{code:"REQUEST_STRATEGY_MISMATCH"});
});
