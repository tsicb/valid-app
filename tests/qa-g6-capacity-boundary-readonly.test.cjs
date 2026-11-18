"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const files=[
  "central-api/15_Property_Capacity_Diagnostics.gs",
  "central-api/19_Request_Property_Byte_Guard.gs",
  "qa/G4_Isolated_Create_Replay_QA.gs",
  "qa/G6_Isolated_Capacity_Boundary_ReadOnly_QA.gs"
];
const sources=files.map(read);
const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const out="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
function harness(opts={}) {
  const propsData={
    ACCESS_KEY:"NOT_REAL_SECRET_CAPACITY_TEST_ONLY_32CHARS",
    SCHEMA_VERSION:"3.0",
    SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID:"QA_FAKE_FOLDER",
    RPTREG_QA_TEST:"QA_REPORT",
    VIEWER_QA_TEST:"QA_VIEWER_MAPPING"
  };
  for(let i=0;i<3;i++){
    propsData["REQ_QA_READY_"+i]=JSON.stringify({
      status:"READY",stage:"READY",requestId:"QA_READY_"+i,
      spreadsheetId:"QA_TEST_SHEET",createdAt:"2026-11-18T12:00:00Z"
    });
  }
  if(opts.fewerReady)delete propsData.REQ_QA_READY_2;
  if(opts.malformedReceipt)propsData.REQ_QA_READY_2="{broken_json";
  const state={writes:0,deletes:0,log:[]};
  const props={
    getProperty:key=>propsData[key]??null,
    getProperties:()=>({...propsData}),
    setProperty(){state.writes++;throw Error("QA_SHOULD_NOT_WRITE")},
    deleteProperty(){state.deletes++;throw Error("QA_SHOULD_NOT_DELETE")}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:opts.wrongRoot?"NOT_TEST_ROOT":root,
      SHEET_OUTPUT_FOLDER_ID:out,
      REQUEST_PROPERTY_PREFIX:"REQ_"
    },
    PropertiesService:{getScriptProperties:()=>props},
    Utilities:{newBlob:s=>({getBytes:()=>[...Buffer.from(String(s),"utf8")]})},
    console:{log:value=>state.log.push(value)},
    Date
  };
  const ctx=vm.createContext(scope);
  sources.forEach(s=>vm.runInContext(s,ctx));
  return {run:e=>vm.runInContext(e,ctx),state,propsData};
}

test("G6-A QA is syntax valid, pure synthetic boundary checks and no writes",()=>{
  const code=sources[3];
  new vm.Script(code);
  assert.doesNotMatch(code,/\.setProperty\(|\.deleteProperty\(|doPost\(|SpreadsheetApp\.create\(|\.createFile\(|\.setTrashed\(/);
  assert.match(code,/vaaCheckNewRequestCapacityReadOnly_/);
  assert.match(code,/vaaCheckRequestReceiptWriteReadOnly_/);
  assert.match(code,/vaaSerializeRequestReceiptForStorage_/);
});

test("G6-A checks synthetic exact admission, new/existing-write and per-value boundaries",()=>{
  const h=harness();
  const result=h.run("vaaQaG6CapacityBoundaryReadOnly()");
  assert.equal(result.phase,"G6_CAPACITY_BOUNDARY_READ_ONLY");
  assert.equal(result.strictReadOnly,true);
  assert.equal(result.actualStatePass,true);
  assert.equal(result.actualReadyReceipts,3);
  assert.equal(result.actualActiveLeases,0);
  assert.equal(result.newRequestAdmissionLimitBytes,436224);
  assert.equal(result.newRequestWriteCeilingBytes,460800);
  assert.equal(result.quotaBytes,512000);
  assert.equal(result.perValueLimitBytes,9216);
  assert.equal(result.syntheticAdmissionAtBoundaryAllowed,true);
  assert.equal(result.syntheticAdmissionAboveBoundaryRejected,true);
  assert.equal(result.syntheticNewReceiptAtCeilingAllowed,true);
  assert.equal(result.syntheticNewReceiptAboveCeilingRejected,true);
  assert.equal(result.syntheticExistingReceiptAtQuotaAllowed,true);
  assert.equal(result.syntheticExistingReceiptAboveQuotaRejected,true);
  assert.equal(result.syntheticSingleValueAtLimitAllowed,true);
  assert.equal(result.syntheticSingleValueAboveLimitRejected,true);
  assert.equal(result.receiptPerformanceRemoved,true);
  assert.equal(result.receiptEssentialFieldsRetained,true);
  assert.equal(result.propertiesModified,0);
  assert.equal(result.propertiesDeleted,0);
  assert.equal(result.workbookModified,false);
  assert.equal(result.driveModified,false);
  assert.equal(result.pass,true);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
  assert.equal(h.state.log.length,1);
  assert.doesNotMatch(h.state.log.join("\n"),
    /NOT_REAL_SECRET|QA_TEST_SHEET|QA_FAKE_FOLDER|REQ_QA_READY_/);
});

test("G6-A synthetic snapshot byte generator has exactly requested byte size",()=>{
  const h=harness();
  for(const n of [0,1,100,8000,8001,436224,460800,511999,512000]){
    const result=h.run("vaaRequestPropertyTotalEstimatedBytes_(vaaQaG6SyntheticSnapshotAtBytes_("+n+"))");
    assert.equal(result,n);
  }
  assert.equal(h.state.writes,0);
});

test("G6-A returns fail when TEST historical READY receipts are missing",()=>{
  for(const options of [{fewerReady:true},{malformedReceipt:true}]){
    const h=harness(options);
    const r=h.run("vaaQaG6CapacityBoundaryReadOnly()");
    assert.equal(r.pass,false);
    assert.equal(r.actualStatePass,false);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
  }
});

test("G6-A rejects wrong root before reading sensitive property snapshot",()=>{
  const h=harness({wrongRoot:true});
  assert.throws(()=>h.run("vaaQaG6CapacityBoundaryReadOnly()"),/QA_ISOLATION_FAILED/);
  assert.equal(h.state.log.length,0);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
});
