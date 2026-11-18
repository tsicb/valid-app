"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const canon=[
  "central-api/04_Request_Target.gs",
  "central-api/13_Append_Update_Guard.gs",
  "central-api/15_Property_Capacity_Diagnostics.gs",
  "qa/G4_Isolated_Create_Replay_QA.gs"
].map(read);
const script=read("qa/G6_Isolated_Failure_Gates_ReadOnly_QA.gs");
const ROOT="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const OUTPUT="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const ID="QA_SYNTHETIC_TARGET_FILE_123456789";
const G4="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const APPEND="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const REPLACE="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const clone=o=>JSON.parse(JSON.stringify(o));
const digestFor=strategy=>crypto.createHash("sha256").update(
  JSON.stringify([strategy,"",ID,null]),"utf8").digest("hex");

function setup(opts={}) {
  const propsData={
    ACCESS_KEY:"SECRET_NOT_REAL_G6B_TEST_ONLY_VALUE",
    SCHEMA_VERSION:"3.0",
    RPTREG_TEST:"QA",
    VIEWER_TEST:"QA"
  };
  propsData["REQ_"+G4]=JSON.stringify({
    requestId:G4,operationMode:"CREATE",
    status:"READY",stage:"READY",spreadsheetId:ID
  });
  propsData["REQ_"+APPEND]=JSON.stringify({
    requestId:APPEND,operationMode:"UPDATE",
    updateStrategy:"APPEND",updatePayloadDigest:digestFor("APPEND"),
    status:"READY",stage:"READY",spreadsheetId:ID,targetSpreadsheetId:ID
  });
  propsData["REQ_"+REPLACE]=JSON.stringify({
    requestId:REPLACE,operationMode:"UPDATE",
    updateStrategy:"REPLACE",updatePayloadDigest:digestFor("REPLACE"),
    status:"READY",stage:"READY",spreadsheetId:ID,targetSpreadsheetId:ID
  });
  if(opts.malformedG4)propsData["REQ_"+G4]="{malformed";
  if(opts.badAppendDigest){
    const rec=JSON.parse(propsData["REQ_"+APPEND]);
    rec.updatePayloadDigest="INVALID_DIGEST";
    propsData["REQ_"+APPEND]=JSON.stringify(rec);
  }
  if(opts.badReplaceMode){
    const rec=JSON.parse(propsData["REQ_"+REPLACE]);
    rec.updateStrategy="APPEND";
    propsData["REQ_"+REPLACE]=JSON.stringify(rec);
  }
  if(opts.withLease)propsData["VAA_TARGET_UPDATE_"+ID]="ACTIVE";

  const calls={writes:0,deletes:0,logs:[],getFile:0};
  const props={
    getProperty:k=>propsData[k]??null,
    getProperties:()=>clone(propsData),
    setProperty(){calls.writes++;throw Error("MUTATION_FORBIDDEN");},
    deleteProperty(){calls.deletes++;throw Error("MUTATION_FORBIDDEN");}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:opts.badRoot?"WRONG_ROOT":ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUTPUT,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      CURRENT_STORAGE_LAYOUT:"QA_LAYOUT"
    },
    PropertiesService:{getScriptProperties:()=>props},
    DriveApp:{
      getFileById:id=>{
        calls.getFile++;
        if(opts.fileGone || id!==ID) throw Error("FILE_NOT_FOUND");
        return {getName:()=>"QA_SYNTHETIC_FILE"};
      }
    },
    Utilities:{
      newBlob:s=>({getBytes:()=>[...Buffer.from(String(s),"utf8")]}),
      DigestAlgorithm:{SHA_256:"SHA_256"},
      Charset:{UTF_8:"UTF_8"},
      computeDigest:(algorithm,text,charset)=>
        [...crypto.createHash("sha256").update(String(text),"utf8").digest()]
    },
    normalizeString_:str=>String(str??"").trim(),
    vaaQaG5GetReadyG4Receipt_:()=>({
      props,receipt:{spreadsheetId:ID}
    }),
    vaaQaG5StoredAppendReceipt_:()=>JSON.parse(propsData["REQ_"+APPEND]),
    vaaQaG5ReplaceStoredReceipt_:()=>JSON.parse(propsData["REQ_"+REPLACE]),
    vaaQaG5AppendPayload_:id=>({updateStrategy:"APPEND",targetSpreadsheetId:id}),
    vaaQaG5ReplacePayload_:id=>({updateStrategy:"REPLACE",targetSpreadsheetId:id}),
    vaaQaG5ReplaceReadyGateReadOnly_:()=>{
      if(opts.badDataStore)throw Error("QA_REPLACE_DATASTORE_MISMATCH");
      return {targetId:ID,receipt:{requestId:REPLACE}};
    },
    console:{log:line=>calls.logs.push(line)},
    Date
  };
  const ctx=vm.createContext(scope);
  for(const source of canon)vm.runInContext(source,ctx);
  vm.runInContext(
    "const VAA_QA_G5_APPEND_REQUEST_ID_ = '"+APPEND+"';"+
    "const VAA_QA_G5_REPLACE_REQUEST_ID_ = '"+REPLACE+"';",
    ctx
  );
  vm.runInContext(script,ctx);
  return {
    run:expr=>vm.runInContext(expr,ctx),
    calls,propsData
  };
}

test("G6-B script parses, never calls POST or mutates any Script Properties",()=>{
  new vm.Script(script);
  assert.doesNotMatch(
    script,/\.setProperty\(|\.deleteProperty\(|doPost\(|\.createFile\(|\.setTrashed\(|SpreadsheetApp\.create\(/
  );
  assert.match(script,/vaaQaG5ReplaceReadyGateReadOnly_/);
  assert.match(script,/vaaValidateUpdateRequestRecord_/);
  assert.match(script,/getRequestRecord_/);
  assert.match(script,/isLeaseActive_/);
});

test("G6-B real canonical guards reject synthetic malformed receipt, digest mismatch and live lease",()=>{
  const h=setup();
  const failure=h.run("vaaQaG6BSyntheticFailureGates_()");
  for(const [name,passed] of Object.entries(failure))
    assert.equal(passed,true,"G6-B failed synthetic gate "+name);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
});

test("G6-B healthy TEST-only receipts and DataStore return pass without writes",()=>{
  const h=setup();
  const r=h.run("vaaQaG6BFailureGatesReadOnly()");
  assert.equal(r.phase,"G6_FAILURE_GATES_READ_ONLY");
  assert.equal(r.pass,true);
  assert.equal(r.actualReadyReceipts,3);
  assert.equal(r.actualStatePass,true);
  assert.equal(r.g4CreateReceiptReady,true);
  assert.equal(r.g5AppendReceiptReady,true);
  assert.equal(r.g5ReplaceReceiptReady,true);
  assert.equal(r.g5AppendDigestMatches,true);
  assert.equal(r.g5ReplaceDigestMatches,true);
  assert.equal(r.finalTestDataStoreMatches,true);
  assert.equal(r.syntheticFailureGatesPass,true);
  assert.equal(r.actualFailureInjected,false);
  assert.equal(r.propertiesModified,0);
  assert.equal(r.propertiesDeleted,0);
  assert.equal(r.workbookModified,false);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.logs.length,1);
  assert.doesNotMatch(h.calls.logs.join("\n"),/SECRET_NOT_REAL|QA_SYNTHETIC_TARGET_FILE|REQ_QA_/);
});

test("G6-B malformed CREATE receipt or missing Drive target fail closed before further work",()=>{
  for(const opts of [{malformedG4:true},{fileGone:true},{badRoot:true}]){
    const h=setup(opts);
    assert.throws(()=>h.run("vaaQaG6BFailureGatesReadOnly()"),
      /QA_G6B_|QA_ISOLATION_FAILED/);
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.deletes,0);
    assert.equal(h.calls.logs.length,0);
  }
});

test("G6-B corrupted UPDATE strategy or digest causes the audit to fail",()=>{
  for(const opts of [{badAppendDigest:true},{badReplaceMode:true},{withLease:true}]){
    const h=setup(opts);
    const r=h.run("vaaQaG6BFailureGatesReadOnly()");
    assert.equal(r.pass,false);
    assert.equal(h.calls.writes,0);
    assert.equal(h.calls.deletes,0);
  }
});

test("G6-B invalid active REPLACE DataStore blocks audit, never calls POST",()=>{
  const h=setup({badDataStore:true});
  assert.throws(()=>h.run("vaaQaG6BFailureGatesReadOnly()"),/QA_REPLACE_DATASTORE_MISMATCH/);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.logs.length,0);
});
