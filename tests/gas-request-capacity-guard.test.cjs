"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const directory = path.join(__dirname, "../central-api");
const diag = fs.readFileSync(path.join(directory, "15_Property_Capacity_Diagnostics.gs"), "utf8");
const guard = fs.readFileSync(path.join(directory, "19_Request_Property_Byte_Guard.gs"), "utf8");
const requests = fs.readFileSync(path.join(directory, "04_Request_Target.gs"), "utf8");
const entry = fs.readFileSync(path.join(directory, "02_EntryPoint.gs"), "utf8");

function createHarness(properties = {}) {
  const data = {...properties};
  const calls = {writes:0, deletes:0, reads:0};
  const props = {
    getProperties(){calls.reads++;return {...data};},
    getProperty(key){return Object.prototype.hasOwnProperty.call(data,key)?data[key]:null;},
    setProperty(key,value){calls.writes++;data[key]=String(value);},
    deleteProperty(key){calls.deletes++;delete data[key];}
  };
  const sandbox = {
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_",MAX_REQUEST_PROPERTIES:500,CURRENT_STORAGE_LAYOUT:"DATASTORE_V1"},
    Utilities:{newBlob:v=>({getBytes:()=>Buffer.from(String(v),"utf8")})},
    Date,
    PropertiesService:{getScriptProperties:()=>props},
    normalizeString_:v=>v===undefined||v===null?"":String(v).trim(),
    console:{log(){},error(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(diag,sandbox);
  vm.runInContext(guard,sandbox);
  vm.runInContext(requests,sandbox);
  const run=expr=>vm.runInContext(expr,sandbox);
  sandbox.globalProps=props;
  return {run,props,data,calls,setRecord:value=>{sandbox.globalRecord=value;}};
}
function record(id,mode="CREATE"){
  return {
    requestId:id,status:"READY",stage:"READY",operationMode:mode,
    spreadsheetId:"PRIVATE_WORKBOOK_"+id,
    spreadsheetUrl:"https://docs.google.com/spreadsheets/d/PRIVATE_WORKBOOK_"+id+"/edit",
    targetSpreadsheetId:mode==="UPDATE"?"PRIVATE_WORKBOOK_"+id:"",
    updateStrategy:mode==="UPDATE"?"APPEND":"",
    updatePayloadDigest:mode==="UPDATE"?"FAKE_DIGEST_"+id:"",
    viewerUrl:"https://fake.example/report?token=private",
    updateStats:{finalApplications:23},
    createdAt:"2026-09-12T00:00:00.000Z",leaseUntil:"",
    performance:{detail:"TRACE_SECRET".repeat(200),datasetWrites:{job:{elapsedMs:1300}}}
  };
}
function fill(totalBytes){
  const props={};
  let remain=totalBytes;
  for(let i=0;remain>0;i++){
    const key="FILL_"+String(i).padStart(5,"0");
    const amount=Math.min(4000,Math.max(0,remain-key.length));
    if(amount===0)throw Error("invalid filler");
    props[key]="q".repeat(amount);
    remain-=key.length+amount;
  }
  return props;
}

test("new receipt save excludes only optional performance and keeps memory diagnostics intact",()=>{
  const h=createHarness({ACCESS_KEY:"KEEP_ACCESS_KEY",RPTREG_A:"KEEP_REPORT",VIEWER_X:"KEEP_VIEWER"});
  const original=record("A");
  h.setRecord(original);
  h.run("saveRequestRecord_(globalProps, 'A', globalRecord)");
  assert.equal(h.calls.writes,1);
  assert.equal(h.calls.deletes,0);
  assert.ok(original.performance.detail.startsWith("TRACE_SECRET"));
  const saved=JSON.parse(h.data.REQ_A);
  assert.equal("performance" in saved,false);
  assert.equal(saved.requestId,"A");
  assert.equal(saved.spreadsheetId,original.spreadsheetId);
  assert.equal(saved.viewerUrl,original.viewerUrl);
  assert.equal(saved.updateStats.finalApplications,23);
  assert.equal(h.data.ACCESS_KEY,"KEEP_ACCESS_KEY");
  assert.equal(h.data.RPTREG_A,"KEEP_REPORT");
  assert.equal(h.data.VIEWER_X,"KEEP_VIEWER");
});

test("UPDATE replay safety fields and identity digest survive persistence",()=>{
  const h=createHarness();
  const source=record("B","UPDATE");
  h.setRecord(source);
  h.run("saveRequestRecord_(globalProps, 'B', globalRecord)");
  const saved=JSON.parse(h.data.REQ_B);
  assert.equal(saved.targetSpreadsheetId,source.targetSpreadsheetId);
  assert.equal(saved.updateStrategy,"APPEND");
  assert.equal(saved.updatePayloadDigest,source.updatePayloadDigest);
  assert.equal(saved.status,"READY");
  assert.equal(saved.stage,"READY");
  assert.equal(saved.requestId,"B");
  assert.equal(h.calls.deletes,0);
  assert.equal(h.run("getRequestRecord_(globalProps, 'B')").updatePayloadDigest,source.updatePayloadDigest);
  assert.equal(h.run("buildReadyResponse_(globalRecord,'B',false,Date.now())").performance,source.performance);
  assert.equal(Object.keys(h.run("buildReadyResponse_(getRequestRecord_(globalProps,'B'),'B',true,Date.now())").performance).length,0);
});

test("new request admission allows 382382 B baseline with a 24 KiB reserve",()=>{
  const h=createHarness(fill(382382));
  const result=h.run("vaaCheckNewRequestCapacityReadOnly_(globalProps)");
  assert.equal(result.allowed,true);
  assert.equal(result.estimatedCurrentBytes,382382);
  assert.equal(result.reservedBytes,24576);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
});

test("new request admission safely blocks near-budget store without writing or deleting",()=>{
  const h=createHarness(fill(440000));
  const result=h.run("vaaCheckNewRequestCapacityReadOnly_(globalProps)");
  assert.equal(result.allowed,false);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
});

test("new request write refuses a value that would push the store beyond the 90% ceiling",()=>{
  const h=createHarness(fill(460700));
  const rec=record("NEW");
  h.setRecord(rec);
  assert.throws(()=>h.run("saveRequestRecord_(globalProps,'NEW',globalRecord)"),err=>{
    assert.equal(err.code,"PROPERTY_CAPACITY_NEAR_LIMIT");return true;
  });
  assert.equal(h.data.REQ_NEW,undefined);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
});

test("individual Script Property value above 9 KiB is rejected even under total budget",()=>{
  const h=createHarness();
  const rec=record("LONG");
  rec.fileName="x".repeat(10000);
  h.setRecord(rec);
  assert.throws(()=>h.run("saveRequestRecord_(globalProps,'LONG',globalRecord)"),err=>{
    assert.equal(err.code,"PROPERTY_VALUE_TOO_LARGE");return true;
  });
  assert.equal(h.data.REQ_LONG,undefined);
  assert.equal(h.calls.writes,0);
});

test("overwriting an existing key replaces rather than double-counts its prior storage",()=>{
  const rec=record("EXISTING");
  const prev=JSON.stringify({...rec,performance:undefined});
  const h=createHarness({...fill(455000),REQ_EXISTING:prev});
  rec.status="ERROR";
  rec.stage="DATA_WRITTEN";
  h.setRecord(rec);
  h.run("saveRequestRecord_(globalProps,'EXISTING',globalRecord)");
  assert.equal(h.calls.writes,1);
  assert.equal(JSON.parse(h.data.REQ_EXISTING).status,"ERROR");
  assert.equal(h.calls.deletes,0);
});

test("legacy count-only prune cannot delete requestIds even above 500 entries",()=>{
  const values={};
  for(let i=0;i<510;i++)values["REQ_"+i]=JSON.stringify({requestId:String(i),status:"READY"});
  const h=createHarness(values);
  assert.equal(h.run("pruneRequestProperties_(globalProps)"),false);
  assert.equal(h.calls.deletes,0);
  assert.equal(Object.keys(h.data).length,510);
});

test("source checks capacity before CREATE workbook/UPDATE lease and has no automatic prune call",()=>{
  const admission=entry.indexOf("vaaCheckNewRequestCapacityReadOnly_(props)");
  const create=entry.indexOf("SpreadsheetApp.create(");
  const lease=entry.indexOf("vaaClaimTargetUpdateLease_(");
  const firstSave=entry.indexOf("saveRequestRecord_(");
  assert.ok(admission>0);
  assert.ok(create>admission);
  assert.ok(lease>admission);
  assert.ok(firstSave>admission);
  assert.doesNotMatch(entry,/pruneRequestProperties_\(props\);/);
  assert.match(requests,/vaaSerializeRequestReceiptForStorage_\(record\)/);
  assert.match(requests,/vaaCheckRequestReceiptWriteReadOnly_\(/);
  assert.doesNotMatch(guard,/\.deleteProperty\s*\(/);
  assert.doesNotMatch(guard,/\.setProperty\s*\(/);
});

test("UTF-8 estimate handles Japanese character bytes and non-destructive same-key updates",()=>{
  const h=createHarness({REQ_J:"旧"});
  const proj=h.run("vaaRequestPropertyWriteProjection_({REQ_J:'旧'},'REQ_J','新')");
  assert.equal(proj.currentEstimatedBytes,8);
  assert.equal(proj.projectedEstimatedBytes,8);
  assert.equal(proj.propertyExists,true);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
});

function makeDoPostReplayHarness(receipts,driveAccessible=false) {
  const data={...receipts};
  const calls={writes:0,deletes:0,creates:0,driveReads:0,locks:0,unlocks:0};
  const props={
    getProperties:()=>({...data}),
    getProperty:key=>Object.prototype.hasOwnProperty.call(data,key)?data[key]:null,
    setProperty(key,v){calls.writes++;data[key]=String(v);},
    deleteProperty(key){calls.deletes++;delete data[key];}
  };
  const sandbox={
    API_CONFIG:{
      REQUEST_PROPERTY_PREFIX:"REQ_",MAX_BODY_CHARS:25000000,
      CURRENT_STORAGE_LAYOUT:"DATASTORE_V1",
      DEFAULT_SCHEMA_VERSION:"3.0"
    },
    PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({
      waitLock(){calls.locks++;},releaseLock(){calls.unlocks++;}
    })},
    DriveApp:{getFileById(){
      calls.driveReads++;
      if(!driveAccessible)throw Error("simulated transient Drive API failure");
      return {getName:()=>"Existing verified workbook"};
    }},
    SpreadsheetApp:{create(){calls.creates++;throw Error("MUST_NOT_CREATE_WORKBOOK");}},
    Utilities:{newBlob:v=>({getBytes:()=>Buffer.from(String(v),"utf8")})},
    normalizeString_:v=>v===null||v===undefined?"":String(v).trim(),
    Date,console:{error(){},log(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(diag,sandbox);
  vm.runInContext(guard,sandbox);
  vm.runInContext(requests,sandbox);
  vm.runInContext(entry,sandbox);
  // Only request coordination and admission are under test. Keep the
  // independent payload/transport validation out of this targeted harness.
  sandbox.validateEnvelope_=()=>({ok:true});
  sandbox.extractSpreadsheetId_=()=>("");
  sandbox.perfMs_=()=>0;
  sandbox.jsonOutput_=o=>o;
  sandbox.errorOutput_=(code,message)=>({ok:false,code,message});
  const post=()=>sandbox.doPost({postData:{contents:JSON.stringify({
    action:"create",requestId:"SAFE_REPLAY_ID"
  })}});
  return {post,data,calls};
}

test("doPost refuses to erase an existing receipt when Drive API is transiently unavailable",()=>{
  const h=makeDoPostReplayHarness({
    REQ_SAFE_REPLAY_ID:JSON.stringify(record("SAFE_REPLAY_ID"))
  },false);
  const before=JSON.stringify(h.data);
  const response=h.post();
  assert.equal(response.ok,false);
  assert.equal(response.code,"REQUEST_TARGET_UNVERIFIED");
  assert.equal(JSON.stringify(h.data),before);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.creates,0);
  assert.equal(h.calls.driveReads,1);
  assert.equal(h.calls.locks,h.calls.unlocks);
});

test("doPost refuses to create when existing receipt JSON cannot be verified",()=>{
  const h=makeDoPostReplayHarness({REQ_SAFE_REPLAY_ID:"invalid receipt JSON"});
  const response=h.post();
  assert.equal(response.code,"REQUEST_RECEIPT_UNVERIFIED");
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.creates,0);
  assert.equal(h.calls.driveReads,0);
  assert.equal(h.calls.locks,h.calls.unlocks);
});

test("doPost refuses to create when existing receipt omits its workbook ID",()=>{
  const h=makeDoPostReplayHarness({
    REQ_SAFE_REPLAY_ID:JSON.stringify({requestId:"SAFE_REPLAY_ID",status:"ERROR"})
  });
  const response=h.post();
  assert.equal(response.code,"REQUEST_RECEIPT_UNVERIFIED");
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.creates,0);
});

test("doPost returns existing READY record without writes when Drive file verifies",()=>{
  const h=makeDoPostReplayHarness({
    REQ_SAFE_REPLAY_ID:JSON.stringify(record("SAFE_REPLAY_ID"))
  },true);
  const response=h.post();
  assert.equal(response.ok,true);
  assert.equal(response.reused,true);
  assert.equal(response.status,"READY");
  assert.equal(response.spreadsheetId,"PRIVATE_WORKBOOK_SAFE_REPLAY_ID");
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.creates,0);
  assert.equal(h.calls.locks,h.calls.unlocks);
});

test("doPost rejects a new request at 440K before any workbook or request write",()=>{
  const h=makeDoPostReplayHarness(fill(440000));
  const response=h.post();
  assert.equal(response.ok,false);
  assert.equal(response.code,"PROPERTY_CAPACITY_NEAR_LIMIT");
  assert.equal(h.calls.creates,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.locks,h.calls.unlocks);
});
