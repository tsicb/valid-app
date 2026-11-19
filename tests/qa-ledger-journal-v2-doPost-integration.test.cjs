"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const bridge=read("central-api/23_Request_Ledger_V2_DoPost_Bridge.gs");
const entry=read("central-api/02_EntryPoint.gs");
const CREATE="QA_JOURNAL_E2E_CREATE_20261119_V1";
const UPDATE="QA_JOURNAL_E2E_UPDATE_20261119_V1";
const TARGET="QA_TEST_WORKBOOK_ID_12345678";
const ROOT="QA_ISOLATED_TEST_ROOT_123456";
const OUTPUT="QA_ISOLATED_TEST_OUTPUT_12345";
const LEDGER="QA_PRIVATE_TEST_SHEETS_LEDGER_ID";
const digest=x=>crypto.createHash("sha256").update(String(x),"utf8").digest("hex");
const H1=["requestKey","recordJson","recordDigest","revision","updatedAt","schemaVersion","recordStatus"];
const H2=["requestKey","revision","phase","recordJson","recordDigest","prevDigest","updatedAt","schemaVersion"];
function ready(id=CREATE,mode="CREATE"){
  return {requestId:id,operationMode:mode,status:"READY",stage:"READY",
    spreadsheetId:TARGET,spreadsheetUrl:"https://docs.google.com/spreadsheets/d/"+TARGET+"/edit",
    ...(mode==="UPDATE"?{
      targetSpreadsheetId:TARGET,updateStrategy:"APPEND",
      updatePayloadDigest:"qa_digest_001"
    }:{targetSpreadsheetId:""})};
}
function make(opts={}){
  const id=opts.update?UPDATE:CREATE;
  const propsMap={
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER,
    VAA_REQUEST_JOURNAL_MODE:"TEST_RESERVATION_V1",
    VAA_JOURNAL_TEST_ROOT_ID:ROOT,
    VAA_JOURNAL_TEST_OUTPUT_ID:OUTPUT,
    VAA_JOURNAL_DOP_MODE:opts.off?"OFF":
      "TEST_ONE_SYNTHETIC_REQUEST_V1",
    VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID:opts.badAllowlist?"OTHER":id
  };
  if(opts.badV2Flag)propsMap.VAA_REQUEST_JOURNAL_MODE="OFF";
  if(opts.badRoot)propsMap.VAA_JOURNAL_TEST_ROOT_ID="OTHER_ROOT";
  if(opts.unknownMode)propsMap.VAA_JOURNAL_DOP_MODE="UNKNOWN_MODE";
  if(opts.receiptInProps)propsMap["REQ_"+id]=JSON.stringify(ready(id,opts.update?"UPDATE":"CREATE"));
  const old=[H1.slice()];
  const journal=[H2.slice()];
  const counts={
    journalWrites:0,legacyWrites:0,creates:0,updateValidation:0,
    propertyWrites:0,propertyDeletes:0,lock:0,unlock:0,
    readyResponse:0,errorResponse:0,logged:0
  };
  function iterator(items) {let at=0;return {hasNext:()=>at<items.length,next:()=>items[at++]};}
  const targetFile={
    getName:()=>"QA_E2E_TEST_WORKBOOK",
    getMimeType:()=>"application/vnd.google-apps.spreadsheet",
    getParents:()=>iterator([{getId:()=>OUTPUT,getParents:()=>iterator([])}])
  };
  const ledgerFile={
    getName:()=>"QA_LEDGER",
    getMimeType:()=>"application/vnd.google-apps.spreadsheet",
    getSharingAccess:()=>opts.publicLedger?"ANYONE":"PRIVATE",
    getParents:()=>iterator([{getId:()=>opts.ledgerOutside?"OTHER_ROOT":ROOT}])
  };
  const props={
    getProperty:key=>propsMap[key]??null,
    getProperties:()=>({...propsMap}),
    setProperty:(k,v)=>{counts.propertyWrites++;propsMap[k]=String(v);},
    deleteProperty:key=>{counts.propertyDeletes++;delete propsMap[key];}
  };
  function sheet(data,legacy){
    return {
      getParent:()=>book,
      getLastRow:()=>data.length,
      getRange:(start,col,numRows,numCols)=>({
        getValues:()=>data.slice(start-1,start-1+numRows).map(r=>r.slice(col-1,col-1+numCols)),
        createTextFinder:find=>({
          matchEntireCell(){return this;},
          matchCase(){return this;},
          findAll:()=>data.slice(1).flatMap((r,i)=>
            r[0]===find?[{getRow:()=>i+2}]:[])
        })
      }),
      appendRow:r=>{
        if(legacy){counts.legacyWrites++;throw Error("LEGACY_WRITE_FORBIDDEN");}
        counts.journalWrites++;
        if(opts.beforeReservationWrite)throw Error("TEST_WRITE_FAILED_BEFORE");
        data.push(r);
        if(opts.uncertainReservationWrite)throw Error("TEST_WRITE_REPLY_LOST");
      }
    };
  }
  const oldSheet=sheet(old,true);
  const journalSheet=sheet(journal,false);
  const book={getSheetByName:name=>
    name==="receipts"?oldSheet:name==="journal_v2"?journalSheet:null};
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:opts.productionRoot?"PROD_ROOT":ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUTPUT,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      MAX_BODY_CHARS:100000,
      CURRENT_STORAGE_LAYOUT:"DATASTORE_V1",
      DEFAULT_SCHEMA_VERSION:"3.0"
    },
    VAA_QA_G4_CONFIG_:opts.missingQaConfig?null:{testRootId:ROOT,testOutputId:OUTPUT},
    MimeType:{GOOGLE_SHEETS:"application/vnd.google-apps.spreadsheet"},
    PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({
      waitLock(){counts.lock++;},
      releaseLock(){counts.unlock++;}
    })},
    DriveApp:{
      Access:{PRIVATE:"PRIVATE"},
      getFileById:fid=>{
        if(fid===LEDGER){
          if(opts.ledgerUnavailable)throw Error("LEDGER_CANNOT_OPEN");
          return ledgerFile;
        }
        if(fid===TARGET)return targetFile;
        throw Error("UNEXPECTED_DRIVE_ID");
      }
    },
    SpreadsheetApp:{
      openById:fid=>{
        if(fid!==LEDGER||opts.ledgerUnavailable)
          throw Error("CANNOT_OPEN_LEDGER");
        return book;
      },
      create:()=>{
        counts.creates++;
        throw Error("QA_STOP_AFTER_RESERVATION_BEFORE_WORKBOOK_CREATION");
      }
    },
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},Charset:{UTF_8:"UTF_8"},
      computeDigest:(_,text)=>Array.from(crypto.createHash("sha256")
        .update(String(text),"utf8").digest())
    },
    validateEnvelope_:()=>({ok:true}),
    normalizeString_:v=>String(v??"").trim(),
    extractSpreadsheetId_:v=>v===TARGET?TARGET:"",
    perfMs_:()=>0,
    jsonOutput_:v=>{counts.readyResponse++;return v;},
    errorOutput_:(code,msg)=>{counts.errorResponse++;return {ok:false,code,message:msg};},
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!opts.capacityDenied}),
    resolveCreateOutputFolder_:()=>({getId:()=>OUTPUT,getName:()=>"QA_TEST_OUTPUT"}),
    buildOutputFileName_:()=>"QA_TEST_WORKBOOK",
    vaaDigestUpdateRequest_:()=>opts.badDigest?"CHANGED_DIGEST":"qa_digest_001",
    validateUpdateTargetDriveFile_:()=>{
      counts.updateValidation++;
      throw Error("QA_STOP_AFTER_RESERVATION_BEFORE_TARGET_UPDATE");
    },
    auditWorkbookErrorByIdSafe_:()=>{},
    mapErrorCode_:()=>"QA_CONTROLLED_STOP_AFTER_RESERVATION",
    safeErrorMessage_:()=>"QA_CONTROLLED_STOP_AFTER_RESERVATION",
    console:{log(){counts.logged++;},error(){counts.logged++;}},
    Date
  };
  const ctx=vm.createContext(scope);
  for(const file of [
    "central-api/04_Request_Target.gs",
    "central-api/13_Append_Update_Guard.gs",
    "central-api/20_Request_Ready_Ledger_Foundation.gs",
    "central-api/21_Request_Ready_Ledger_Replay_Gate.gs",
    "central-api/22_Request_Ledger_V2_Journal.gs",
    "central-api/23_Request_Ledger_V2_DoPost_Bridge.gs",
    "central-api/02_EntryPoint.gs"
  ])vm.runInContext(read(file),ctx);
  const post=(overrides={})=>{
    const payload={
      action:"create",requestId:id,
      ...(opts.update?{targetSpreadsheetId:TARGET,updateStrategy:"APPEND"}:{}),
      ...overrides
    };
    return scope.doPost({postData:{contents:JSON.stringify(payload)}});
  };
  const saveReady=()=>{
    propsMap["REQ_"+id]=JSON.stringify(ready(id,opts.update?"UPDATE":"CREATE"));
  };
  const lookup=()=>scope.vaaLedgerJournalReadOnly_(props,id);
  const finalize=()=>scope.vaaLedgerDopFinalizeReady_(
    props,id,opts.update?"UPDATE":"CREATE"
  );
  const decide=()=>scope.vaaLedgerDopDecideUnderLock_(
    props,id,opts.update?"UPDATE":"CREATE",
    opts.update?TARGET:"",opts.update?"APPEND":"",
    opts.update?"qa_digest_001":"",!!props.getProperty("REQ_"+id)
  );
  return {post,propsMap,id,counts,journal,old,lookup,saveReady,finalize,decide,scope};
}
function assertBefore(h){
  assert.equal(h.counts.propertyWrites,0);
  assert.equal(h.counts.propertyDeletes,0);
  assert.equal(h.counts.legacyWrites,0);
}

test("doPost journal reservation gate precedes all workbook/lease/REQ writes",()=>{
  new vm.Script(entry);new vm.Script(bridge);
  const gate=entry.indexOf("vaaLedgerDopDecideUnderLock_(");
  const budget=entry.indexOf("const budgetAdmission");
  const create=entry.indexOf("SpreadsheetApp.create(");
  const lease=entry.indexOf("vaaClaimTargetUpdateLease_(");
  const save=entry.indexOf("saveRequestRecord_(");
  const readySave=entry.indexOf("const readyStateSaveStartedAt");
  const finalize=entry.indexOf("vaaLedgerDopFinalizeReady_(");
  assert.ok(gate>0&&gate<budget&&gate<create&&gate<lease&&gate<save);
  assert.ok(finalize>readySave);
  assert.match(entry,/journalAdmissionRequired = true/);
  assert.doesNotMatch(bridge,/\.deleteProperty\s*\(|\.setProperty\s*\(|\.setTrashed\s*\(/);
});

test("real doPost synthetic CREATE saves RESERVED before attempting spreadsheet",()=>{
  const h=make();
  const r=h.post();
  assert.equal(r.ok,false);
  assert.equal(h.counts.journalWrites,1);
  assert.equal(h.counts.creates,1);
  assert.equal(h.lookup().state,"RESERVED");
  assert.equal(h.journal[1][1],1);
  assert.equal(h.journal[1][2],"RESERVED");
  assertBefore(h);
  const again=h.post();
  assert.equal(again.ok,false);
  assert.equal(again.code,"JOURNAL_DOP_REQUEST_RESERVED");
  assert.equal(h.counts.creates,1);
  assert.equal(h.counts.journalWrites,1);
  assertBefore(h);
});

test("real doPost synthetic UPDATE reserves before target validation side effects",()=>{
  const h=make({update:true});
  const r=h.post();
  assert.equal(r.ok,false);
  assert.equal(h.counts.journalWrites,1);
  assert.equal(h.counts.updateValidation,1);
  assert.equal(h.lookup().state,"RESERVED");
  assert.equal(h.journal[1][2],"RESERVED");
  assertBefore(h);
  assert.equal(h.post().code,"JOURNAL_DOP_REQUEST_RESERVED");
  assert.equal(h.counts.updateValidation,1);
});

test("write uncertainty before or after reservation must stop before any side effect",()=>{
  for(const opts of [
    {beforeReservationWrite:true},{uncertainReservationWrite:true}
  ]){
    const h=make(opts);
    const r=h.post();
    assert.equal(r.code,"JOURNAL_DOP_UNVERIFIED");
    assert.equal(h.counts.creates,0);
    assert.equal(h.counts.journalWrites,1);
    assertBefore(h);
    if(opts.uncertainReservationWrite) {
      assert.equal(h.lookup().state,"RESERVED");
      assert.equal(h.post().code,"JOURNAL_DOP_REQUEST_RESERVED");
      assert.equal(h.counts.creates,0);
    }else{
      assert.equal(h.lookup().state,"ABSENT");
    }
  }
});

test("READY rev2 persists after synthetic canonical READY property; no deletion",()=>{
  const h=make();
  const admitted=h.decide();
  assert.equal(admitted.state,"ADMITTED");
  h.saveReady();
  const final=h.finalize();
  assert.equal(final.state,"READY");
  assert.equal(h.lookup().state,"READY");
  assert.equal(h.lookup().revision,2);
  assert.equal(h.journal[2][5],h.journal[1][4]);
  assert.equal(h.counts.journalWrites,2);
  assert.equal(h.counts.propertyDeletes,0);
  const replay=h.post();
  assert.equal(replay.ok,true);
  assert.equal(replay.reused,true);
  assert.equal(replay.status,"READY");
  assert.equal(replay.spreadsheetId,TARGET);
  assert.equal(h.counts.creates,0);
});

test("READY can replay without REQ property after archival but no deletion action",()=>{
  const h=make();
  assert.equal(h.decide().state,"ADMITTED");
  h.saveReady();
  assert.equal(h.finalize().state,"READY");
  delete h.propsMap["REQ_"+h.id]; // Simulate archival, NOT a tool mutation.
  const replay=h.post();
  assert.equal(replay.ok,true);
  assert.equal(replay.reused,true);
  assert.equal(replay.status,"READY");
  assert.equal(h.counts.creates,0);
  assert.equal(h.counts.journalWrites,2);
});

test("READY in REQ when journal remains RESERVED must HALT (no auto-finish)",()=>{
  const h=make();
  assert.equal(h.decide().state,"ADMITTED");
  h.saveReady();
  const result=h.post();
  assert.equal(result.code,"JOURNAL_DOP_REQUEST_RESERVED");
  assert.equal(h.counts.creates,0);
  assert.equal(h.counts.journalWrites,1);
  assert.equal(h.lookup().state,"RESERVED");
});

test("READY + finalized UPDATE rejects changed strategy/digest/target",()=>{
  const h=make({update:true});
  assert.equal(h.decide().state,"ADMITTED");
  h.saveReady();
  assert.equal(h.finalize().state,"READY");
  assert.equal(h.post().reused,true);
  for(const changed of [
    {updateStrategy:"REPLACE"},
    {targetSpreadsheetId:"ANOTHER_TARGET"}
  ]){
    const r=h.post(changed);
    assert.equal(r.ok,false);
    assert.equal(h.counts.updateValidation,0);
  }
  h.propsMap["REQ_"+h.id]=JSON.stringify({...ready(h.id,"UPDATE"),
    updatePayloadDigest:"CHANGED"});
  assert.equal(h.post().code,"JOURNAL_DOP_PROPERTY_CONFLICT");
});

test("enabled journal cannot admit unknown/nonallowlisted or unscoped input",()=>{
  for(const opts of [
    {badRoot:true},{productionRoot:true},
    {missingQaConfig:true},{badAllowlist:true},
    {badV2Flag:true},{unknownMode:true},
    {publicLedger:true},{ledgerOutside:true},
    {ledgerUnavailable:true}
  ]){
    const h=make(opts);const r=h.post();
    assert.equal(r.ok,false);
    assert.equal(h.counts.creates,0);
    assert.equal(h.counts.journalWrites,0);
    assertBefore(h);
  }
  const h=make();
  const r=h.post({requestId:"OTHER_REQUEST_ID"});
  assert.equal(r.code,"JOURNAL_DOP_TEST_SCOPE_DENIED");
  assert.equal(h.counts.journalWrites,0);
});

test("default-OFF path never touches the journal or errors from absent journal",()=>{
  const h=make({off:true,ledgerUnavailable:true});
  const r=h.post();
  assert.equal(r.ok,false);
  assert.equal(h.counts.journalWrites,0);
  // Default-OFF retains legacy admission until the controlled side-effect.
  assert.equal(h.counts.creates,1);
  assertBefore(h);
});

test("low Script Properties quota blocks reservation before any new work",()=>{
  const h=make({capacityDenied:true});
  assert.equal(h.post().code,"PROPERTY_CAPACITY_NEAR_LIMIT");
  assert.equal(h.counts.journalWrites,0);
  assert.equal(h.counts.creates,0);
  assertBefore(h);
});

test("finalize after mode flip HALTs and never fabricates READY in journal",()=>{
  const h=make();
  assert.equal(h.decide().state,"ADMITTED");
  h.saveReady();
  h.propsMap.VAA_JOURNAL_DOP_MODE="OFF";
  assert.equal(h.finalize().state,"DISABLED");
  assert.equal(h.lookup().state,"RESERVED");
  assert.equal(h.counts.journalWrites,1);
});

test("ledger READY replay rejects invalid target folder, not only missing file",()=>{
  const h=make();
  assert.equal(h.decide().state,"ADMITTED");
  h.saveReady();assert.equal(h.finalize().state,"READY");
  const original=h.scope.fileIsInManagedOutputTree_;
  h.scope.fileIsInManagedOutputTree_=()=>false;
  assert.equal(h.post().code,"JOURNAL_DOP_READY_UNVERIFIED");
  h.scope.fileIsInManagedOutputTree_=original;
  assert.equal(h.counts.creates,0);
});
