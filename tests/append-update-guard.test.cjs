"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const dir = path.join(__dirname,"../central-api");
function harness() {
  const properties = new Map();
  let locked = false;
  const props = {
    getProperty:key=>properties.get(key)||null,
    setProperty:(key,value)=>properties.set(key,value),
    deleteProperty:key=>properties.delete(key)
  };
  const api = {
    VAAAppendMergeCore:{VERSION:"1"},
    API_CONFIG:{PROCESS_LEASE_MS:390000,CURRENT_STORAGE_LAYOUT:"DATASTORE_V1"},
    normalizeString_:v=>v===undefined||v===null?"":String(v).trim(),
    invalid_:(code,message)=>({ok:false,code,message}),
    LockService:{getScriptLock:()=>({
      waitLock(){if(locked) throw Error("LOCKED");locked=true;},
      releaseLock(){locked=false;}
    })},
    Utilities:{
      Charset:{UTF_8:"UTF-8"},
      DigestAlgorithm:{SHA_256:"sha256"},
      computeDigest:(algorithm,material)=>Array.from(crypto.createHash(algorithm).update(material).digest()).map(x=>x>127?x-256:x)
    },
    Number,Date,JSON,Set,Map
  };
  vm.createContext(api);
  const code=fs.readFileSync(path.join(dir,"13_Append_Update_Guard.gs"),"utf8");
  vm.runInContext(code,api,{filename:"13_Append_Update_Guard.gs"});
  return {f:name=>api[name],props,properties,get locked(){return locked;}};
}
const incoming=(strategy="APPEND")=>({
  targetSpreadsheetId:"SHEET001", updateStrategy:strategy,updateProtocol:"IDENTITY_V1",
  datasets:{
    applicationData:{
      headers:["企業ID","応募識別キー","応募識別方式"],
      rows:[["C01","I1:"+("f".repeat(64)),"PERSON_NAME"]]
    },
    jobAnalysisMaster:{headers:["企業ID"],rows:[["C01"]]}
  }
});
test("update strategy is explicit and must carry identity headers",()=>{
  const h=harness();
  assert.equal(h.f("vaaValidateUpdateProtocol_")(incoming()).ok,true);
  const missing=incoming();delete missing.updateProtocol;
  assert.equal(h.f("vaaValidateUpdateProtocol_")(missing).code,"UPDATE_PROTOCOL_REQUIRED");
  const bad=incoming();delete bad.updateStrategy;
  assert.equal(h.f("vaaValidateUpdateProtocol_")(bad).code,"UPDATE_PROTOCOL_REQUIRED");
  const wrong=incoming("SILENT_OVERWRITE");
  assert.equal(h.f("vaaValidateUpdateProtocol_")(wrong).code,"UPDATE_PROTOCOL_REQUIRED");
  const noKey=incoming();
  noKey.datasets.applicationData.headers=["応募日時"];
  assert.equal(h.f("vaaValidateUpdateProtocol_")(noKey).code,"APPLICATION_IDENTITY_REQUIRED");
});
test("capability returns explicit supported protocol",()=>{
  const cap=JSON.parse(JSON.stringify(harness().f("vaaUpdateCapabilities_")()));
  assert.deepEqual(cap,{updateProtocol:"IDENTITY_V1",updateStrategies:["APPEND","REPLACE"],applicationIdentityVersion:"1"});
});
test("a requestId is bound to update strategy and payload content",()=>{
  const h=harness(), p=incoming(), d=h.f("vaaDigestUpdateRequest_")(p);
  assert.match(d,/^[0-9a-f]{64}$/);
  const record={updateStrategy:"APPEND",updatePayloadDigest:d};
  assert.equal(h.f("vaaValidateUpdateRequestRecord_")(record,"APPEND",d).ok,true);
  assert.equal(h.f("vaaValidateUpdateRequestRecord_")(record,"REPLACE",d).code,"REQUEST_PAYLOAD_MISMATCH");
  const other=incoming();
  other.datasets.applicationData.rows[0][0]="C02";
  assert.notEqual(d,h.f("vaaDigestUpdateRequest_")(other));
  assert.equal(h.f("vaaValidateUpdateRequestRecord_")(record,"APPEND",h.f("vaaDigestUpdateRequest_")(other)).code,"REQUEST_PAYLOAD_MISMATCH");
});
test("claiming the same target with another requestId fails; other target works",()=>{
  const h=harness(), claim=h.f("vaaClaimTargetUpdateLease_");
  assert.equal(claim(h.props,"SHEET001","req1").ok,true);
  assert.equal(claim(h.props,"SHEET001","req2").code,"TARGET_UPDATE_BUSY");
  assert.equal(claim(h.props,"SHEET002","req2").ok,true);
  assert.equal(claim(h.props,"SHEET001","req1").ok,true);
});
test("only the owner can release an active target lease",()=>{
  const h=harness();
  h.f("vaaClaimTargetUpdateLease_")(h.props,"SHEET001","req1");
  h.f("vaaReleaseTargetUpdateLease_")(h.props,"SHEET001","req2");
  assert.equal(h.f("vaaClaimTargetUpdateLease_")(h.props,"SHEET001","req2").code,"TARGET_UPDATE_BUSY");
  h.f("vaaReleaseTargetUpdateLease_")(h.props,"SHEET001","req1");
  assert.equal(h.f("vaaClaimTargetUpdateLease_")(h.props,"SHEET001","req2").ok,true);
  assert.equal(h.locked,false);
});
test("after expiry, a new request takes ownership and old owner cannot release it",()=>{
  const h=harness(), claim=h.f("vaaClaimTargetUpdateLease_");
  claim(h.props,"SHEET001","req1");
  const key=h.f("vaaTargetUpdateLeaseKey_")("SHEET001");
  h.props.setProperty(key,JSON.stringify({requestId:"req1",expiresAt:1}));
  assert.equal(claim(h.props,"SHEET001","req2").ok,true);
  h.f("vaaReleaseTargetUpdateLease_")(h.props,"SHEET001","req1");
  assert.equal(claim(h.props,"SHEET001","req3").code,"TARGET_UPDATE_BUSY");
});
test("stats are compact enough to fit in ScriptProperties and include end totals",()=>{
  const h=harness();
  const input={
    strategy:"APPEND",oldApplications:1000,uploadedApplications:1000,
    skippedAsExisting:800,addedApplications:200,finalApplications:1200,
    addedJobs:3,finalJobs:48,
    aggregateDecreases:Array.from({length:3000},(_,i)=>({name:"group"+i}))
  };
  const summary=h.f("vaaSummarizeUpdateStats_")(input);
  assert.equal(summary.aggregateDecreaseGroups,3000);
  assert.equal(summary.finalApplications,1200);
  assert.ok(JSON.stringify(summary).length<1500);
  assert.equal(h.f("vaaFinalDatasetCounts_")({datasets:{applicationData:{rows:[1]},jobAnalysisMaster:{rows:[2]}}},{updateStats:summary}).applications,1200);
  assert.equal(h.f("vaaFinalDatasetCounts_")({datasets:{applicationData:{rows:[1]},jobAnalysisMaster:{rows:[2]}}},{updateStats:summary}).jobs,48);
});
test("update endpoint is guarded before it opens the workbook; writes use saved merged data",()=>{
  const source=fs.readFileSync(path.join(dir,"02_EntryPoint.gs"),"utf8");
  assert.ok(source.includes("vaaValidateUpdateProtocol_(payload)"));
  assert.ok(source.includes("vaaDigestUpdateRequest_(payload)"));
  assert.ok(source.includes("vaaClaimTargetUpdateLease_"));
  assert.ok(source.includes("vaaExecuteAppendDataStoreUpdate_"));
  assert.ok(source.includes("requestStateContext.stateData = null;"));
  const commit=source.indexOf("vaaExecuteAppendDataStoreUpdate_(");
  const mirror=source.indexOf("writeSummary[\n                datasetKey");
  assert.ok(commit>0 && mirror>commit,"DataStore must commit before job mirror writes");
  assert.ok(source.includes("operationMode === 'UPDATE'\n    ? {"));
  assert.ok(source.includes("savedCounts.applications"));
  assert.ok(source.includes("savedCounts.jobs"));
  assert.ok(source.includes("vaaReleaseTargetUpdateLease_"));
});
test("READY replay exposes strategy and totals, and auth check exposes capability",()=>{
  const requestFile=fs.readFileSync(path.join(dir,"04_Request_Target.gs"),"utf8");
  const authFile=fs.readFileSync(path.join(dir,"07_ViewerManagement.gs"),"utf8");
  assert.ok(requestFile.includes("record.updateStats || null"));
  assert.ok(requestFile.includes("normalizeString_(record.updateStrategy) || ''"));
  assert.ok(authFile.includes("incrementalUpdate: vaaUpdateCapabilities_()"));
});
