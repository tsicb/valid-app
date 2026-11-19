"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = p => fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const source = read("qa/G6_Isolated_Cas_Fault_Attestation_QA.gs");
const G6D = "QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const G6E = "QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const NEW_TARGET = "QA_NEW_PRIVATE_TEST_WORKBOOK";
const OLD_TARGET = "QA_PREVIOUS_TEST_WORKBOOK";
const NEW_POINTER = "QA_G6D_PRIVATE_DATASTORE";
const OLD_POINTER = "QA_G5_PRIVATE_DATASTORE";

function fixture(o = {}) {
  const propsData = {
    "REQ_G4_TEST": "OLD_RECEIPT_ONE",
    "REQ_G5_APPEND": "OLD_RECEIPT_TWO",
    "REQ_G5_REPLACE": "OLD_RECEIPT_THREE",
    ["REQ_" + G6D]: "G6D_CREATE_RECEIPT"
  };
  if (o.candidateExisting) propsData["REQ_" + G6E] = "STARTED";
  if (o.targetLease) propsData["VAA_TARGET_UPDATE_" + NEW_TARGET] = "LEASE";
  const calls = {writes:0,deletes:0,posts:0,logs:[],reads:0};
  const props = {
    getProperty: k => propsData[k] ?? null,
    setProperty() {calls.writes++;throw Error("WRITE_FORBIDDEN");},
    deleteProperty() {calls.deletes++;throw Error("DELETE_FORBIDDEN");}
  };
  const scope = {
    API_CONFIG: {REQUEST_PROPERTY_PREFIX:"REQ_"},
    PropertiesService: {getScriptProperties:()=>props},
    vaaQaG4IsolatedConfig_: ()=>props,
    VAA_QA_G6C_CONFIG_: {createRequestId:G6D},
    VAA_QA_G4_CONFIG_: {testOutputId:"QA_TEST_ONLY_OUTPUT"},
    vaaQaG6DHistorySnapshot_: p=>[
      p.getProperty("REQ_G4_TEST"),
      p.getProperty("REQ_G5_APPEND"),
      p.getProperty("REQ_G5_REPLACE")
    ],
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6GFailFastPrewriteReadOnly: ()=>({
      pass:!o.badPrior,actualReadyReceipts:o.badReadyCount?3:4,
      candidateRequestStillUnused:true,targetLeaseStillAbsent:true
    }),
    getRequestRecord_:()=>({
      requestId:G6D,status:"READY",stage:"READY",operationMode:"CREATE",
      spreadsheetId:NEW_TARGET
    }),
    vaaQaG5ReplaceReadyGateReadOnly_:()=>({
      targetId:OLD_TARGET,pointer:OLD_POINTER
    }),
    SpreadsheetApp: {openById:id=>{
      assert.equal(id,NEW_TARGET);
      return {getId:()=>id};
    }},
    rptReadStateData_:()=>{
      calls.reads++;
      return {map:{
        analysisDataStoreFileId:
          o.pointerChanges && calls.reads>1 ? "QA_CHANGED" : NEW_POINTER,
        analysisDataStoreRequestId:G6D
      }};
    },
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    console:{log:s=>calls.logs.push(s)},
    Date
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(read("central-api/12_Append_DataStore.gs"),ctx);
  vm.runInContext(read("central-api/02_EntryPoint.gs"),ctx);
  vm.runInContext(source,ctx);
  return {run:e=>vm.runInContext(e,ctx),calls,scope,propsData};
}

test("G6-H source is syntax valid and does not execute POST or writes",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,
    /\bdoPost\s*\(|\bvaaStageAppendDataStore_\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(/);
  assert.match(source,/vaaQaG6GFailFastPrewriteReadOnly/);
});

test("G6-H attests exact canonical stage/CAS and real TEST baseline",()=>{
  const h=fixture();
  const checks=h.run("vaaQaG6HSourceAttestationReadOnly_()");
  assert.equal(Object.keys(checks).length,7);
  for(const [k,v] of Object.entries(checks))assert.equal(v,true,k);
  const r=h.run("vaaQaG6HCasFaultAttestationReadOnly()");
  assert.equal(r.phase,"G6_CAS_FAULT_ATTESTATION_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.actualReadyReceipts,4);
  assert.equal(r.sourceAttestationPass,true);
  assert.equal(r.historicalReceiptsUnchanged,true);
  assert.equal(r.createReceiptUnchanged,true);
  assert.equal(r.originalDataStoreUnchanged,true);
  assert.equal(r.candidateDataStorePointerUnchanged,true);
  assert.equal(r.candidateRequestStillUnused,true);
  assert.equal(r.targetLeaseStillAbsent,true);
  assert.equal(r.inMemoryFaultHarnessOnly,true);
  assert.equal(r.actualFaultInjected,false);
  assert.equal(r.actualUpdatePerformed,false);
  assert.equal(r.actualResumeTested,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(r.pass,true);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.posts,0);
  assert.equal(h.calls.logs.length,1);
  assert.doesNotMatch(h.calls.logs.join("\n"),/QA_NEW_PRIVATE_TEST_WORKBOOK|QA_PREVIOUS_TEST_WORKBOOK|QA_G6D_PRIVATE_DATASTORE/);
});

test("G6-H stops if prerequisite G6-G pass or READY4 baseline is missing",()=>{
  for(const o of [{badPrior:true},{badReadyCount:true}]){
    const h=fixture(o);
    assert.throws(()=>h.run("vaaQaG6HCasFaultAttestationReadOnly()"),
      /QA_G6H_BASELINE_NOT_READY/);
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.posts,0);
  }
});

test("G6-H rejects changed CAS helper and never injects faults",()=>{
  const h=fixture();
  h.run("vaaCommitStagedAppendDataStore_ = function () {};");
  const out=h.run("vaaQaG6HCasFaultAttestationReadOnly()");
  assert.equal(out.sourceAttestationPass,false);
  assert.equal(out.pass,false);
  assert.equal(out.actualFaultInjected,false);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
});

test("G6-H no-write gate rejects changed pointers, used ID or residual lease",()=>{
  for(const o of [{pointerChanges:true},{candidateExisting:true},{targetLease:true}]){
    const h=fixture(o);
    const out=h.run("vaaQaG6HCasFaultAttestationReadOnly()");
    assert.equal(out.pass,false);
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.deletes,0);
    assert.equal(h.calls.posts,0);
  }
});
