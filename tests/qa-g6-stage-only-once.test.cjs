"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const g6j=read("qa/G6_Isolated_PreCas_Stage_Once_QA.gs");

const root="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const out="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const g4="QA_G4_SYNTHETIC_CREATE_20261118_V1";
const app="QA_G5_SYNTHETIC_APPEND_20261118_V1";
const replace="QA_G5_SYNTHETIC_REPLACE_20261119_V1";
const create="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const update="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const stageId="QA_G6I_STAGE_ONLY_PRECAS_20261119_V1";
const old="QA_OLD_TEST_SHEET_123456789";
const target="QA_G6D_TEST_SHEET_123456789";
const oldPointer="QA_OLD_DATASTORE_POINTER";
const pointer="QA_G6D_DATASTORE_POINTER";
const folderId="QA_FAKE_TEST_DATASTORE_FOLDER";
const clone=x=>JSON.parse(JSON.stringify(x));

function fixture(opts={}) {
  const properties={
    ACCESS_KEY:"TEST_ONLY_FAKE_ACCESS_KEY_NOT_FOR_LOG",
    SCHEMA_VERSION:"3.0",
    ANALYSIS_DATASTORE_FOLDER_ID:folderId,
    ["REQ_"+g4]:"G4_IMMUTABLE",
    ["REQ_"+app]:"G5_APPEND_IMMUTABLE",
    ["REQ_"+replace]:"G5_REPLACE_IMMUTABLE"
  };
  properties["REQ_"+create]=JSON.stringify({
    requestId:create,operationMode:"CREATE",
    status:"READY",stage:"READY",spreadsheetId:target,
    outputFolderId:out
  });
  if(opts.usedStageReceipt)properties["REQ_"+stageId]="USED";
  if(opts.usedUpdateReceipt)properties["REQ_"+update]="USED";
  if(opts.lease)properties["VAA_TARGET_UPDATE_"+target]="LEASE";

  const state={
    postCalls:0,propWrites:0,propDeletes:0,
    created:0,deleted:0,casCalls:0,locks:0,logs:[],
    stageFiles:[],readFiles:0,folderCreateCalls:0
  };
  const props={
    getProperty:k=>properties[k]??null,
    getProperties:()=>clone(properties),
    setProperty(){state.propWrites++;throw Error("PROPS_WRITE_FORBIDDEN");},
    deleteProperty(){state.propDeletes++;throw Error("PROPS_DELETE_FORBIDDEN");}
  };
  let baseline=null;
  let linked=null;
  let expectedStageName=null;
  const folder={
    getName:()=>opts.wrongFolderName?"PROD_FOLDER":"QA_DataStore",
    getId:()=>folderId,
    getFilesByName:name=>{
      if(name!==expectedStageName)throw Error("INVALID_STAGE_FILE_QUERY");
      const found=state.stageFiles.filter(f=>f.getName()===name && !f.trashed);
      let pos=0;
      return {hasNext:()=>pos<found.length,next:()=>found[pos++]};
    },
    createFile:(name,text,mime)=>{
      state.created++;
      if(opts.failBeforeCreate)throw Error("QA_SIMULATED_BEFORE_FILE_WRITE");
      const id="QA_G6J_STAGE_FILE_"+state.created;
      const file={
        trashed:false,
        getId:()=>id,
        getName:()=>name,
        getBlob:()=>({getDataAsString:()=>{
          if(opts.badStageJson)return "{BAD_JSON";
          return text;
        }}),
        setTrashed:on=>{
          state.deleted++;
          file.trashed=on===true;
        }
      };
      state.stageFiles.push(file);
      if(opts.failAfterCreate)throw Error("QA_SIMULATED_LOST_STAGE_RESPONSE");
      return file;
    }
  };
  const context={
    API_CONFIG:{
      ROOT_FOLDER_ID:root,SHEET_OUTPUT_FOLDER_ID:out,
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"QA_DataStore",
      ANALYSIS_DATASTORE_VERSION:"v1",
      DEFAULT_SCHEMA_VERSION:"3.0",
      CURRENT_STORAGE_LAYOUT:"QA_LAYOUT",
      EXPECTED_COMMON_MASTER_VERSION:"QA_COMMON",
      MAX_DATASET_ROWS:100000
    },
    PropertiesService:{getScriptProperties:()=>props},
    VAAAppendMergeCore:core,
    MimeType:{PLAIN_TEXT:"text/plain"},
    normalizeString_:x=>String(x??"").trim(),
    SpreadsheetApp:{openById:id=>{
      if(id!==target)throw Error("NOT_ISOLATED_TEST_WORKBOOK");
      return {getId:()=>target};
    }},
    rptReadStateData_:()=>({map:{
      analysisDataStoreFileId:opts.pointerChanged?"OTHER_POINTER":pointer,
      analysisDataStoreRequestId:create
    }}),
    DriveApp:{
      getFolderById:id=>{
        if(id!==folderId)throw Error("NOT_TEST_FOLDER");
        return folder;
      },
      getFileById:id=>{
        state.readFiles++;
        if(id===pointer)return {getBlob:()=>({
          getDataAsString:()=>JSON.stringify(linked)
        })};
        throw Error("UNKNOWN_FILE");
      }
    },
    getOrCreateAnalysisDataStoreFolder_:()=>{
      state.folderCreateCalls++;
      return folder;
    },
    folderIsDirectChildOf_:(file,folder)=>
      !opts.wrongParent &&
      (folder===root||folder===folderId),
    getRequestRecord_:(p,id)=>{
      try{return JSON.parse(p.getProperty("REQ_"+id));}
      catch(_){return null;}
    },
    vaaQaG6DHistorySnapshot_:p=>[g4,app,replace].map(
      id=>p.getProperty("REQ_"+id)
    ),
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6DInspectFaultDomainReadOnly:()=>({
      pass:!opts.invalidDomain,readyCount:4,
      dataStoreMatchesSynthetic:!opts.invalidDomain
    }),
    vaaQaG5ReplaceReadyGateReadOnly_:()=>({
      targetId:old,pointer:oldPointer
    }),
    validateUpdateTargetDriveFile_:(id,folder)=>{
      if(id!==target||folder!==out)throw Error("WRONG_TARGET");
      return {};
    },
    vaaQaG5ReadTestDataStore_:()=>clone(baseline),
    buildAnalysisDataStoreObject_:(ss,payload,req)=>({
      dataType:"VALID_APPLICATION_ANALYSIS_DATASTORE",
      dataStoreVersion:"v1",
      spreadsheetId:ss.getId(),requestId:req,
      datasets:clone(payload.datasets)
    }),
    validateAnalysisDataStoreObject_:(data,id,req)=>({
      ok:!!data&&data.spreadsheetId===id &&
        data.requestId===req && !!data.datasets
    }),
    vaaQaG6IStagePreflightReadOnly:()=>({
      readyForStageOnlyDesignReview:!opts.preflightDenied,
      stageFileAlreadyPresent:state.stageFiles.length>0,
      candidateStageReceiptExists:!!properties["REQ_"+stageId],
      targetLeaseExists:!!properties["VAA_TARGET_UPDATE_"+target],
      reservedUpdateReceiptExists:!!properties["REQ_"+update],
      actualReadyReceipts:4
    }),
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    LockService:{getScriptLock(){state.locks++;throw Error("LOCK_NOT_ALLOWED");}},
    doPost(){state.postCalls++;throw Error("POST_NOT_ALLOWED");},
    console:{log:value=>state.logs.push(value)},
    Date
  };
  const vmCtx=vm.createContext(context);
  vm.runInContext(read("qa/G4_Isolated_Create_Replay_QA.gs"),vmCtx);
  vm.runInContext(
    "const VAA_QA_G5_APPEND_REQUEST_ID_ = '"+app+"';"+
    "const VAA_QA_G5_REPLACE_REQUEST_ID_ = '"+replace+"';",vmCtx
  );
  vm.runInContext(read("qa/G6_Isolated_Fault_Domain_Preflight_QA.gs"),vmCtx);
  vm.runInContext(read("qa/G6_Isolated_Update_Fault_Preflight_QA.gs"),vmCtx);
  vm.runInContext(read("qa/G6_Isolated_PreCas_Stage_Preflight_QA.gs"),vmCtx);
  const createPayload=vm.runInContext("vaaQaG6CFaultDomainPayload_()",vmCtx);
  const m=core.merge({
    mode:"REPLACE",incoming:clone(createPayload.datasets),maxRows:100000
  });
  baseline={applicationData:m.applicationData,jobAnalysisMaster:m.jobAnalysisMaster};
  linked={
    spreadsheetId:target,requestId:create,
    applicationIdentityVersion:core.VERSION,
    datasets:clone(baseline)
  };
  expectedStageName=vm.runInContext(
    "vaaQaG6IStageCandidateFileName_('"+target+"')",vmCtx
  );
  vm.runInContext(read("central-api/12_Append_DataStore.gs"),vmCtx);
  // Pure fixture gate: G6-I already passed in real TEST, we test G6-J only.
  context.vaaQaG6IStagePreflightReadOnly=()=>({
    readyForStageOnlyDesignReview:!opts.preflightDenied,
    stageFileAlreadyPresent:state.stageFiles.some(f=>!f.trashed),
    candidateStageReceiptExists:!!properties["REQ_"+stageId],
    targetLeaseExists:!!properties["VAA_TARGET_UPDATE_"+target],
    reservedUpdateReceiptExists:!!properties["REQ_"+update],
    actualReadyReceipts:4
  });
  vm.runInContext(g6j,vmCtx);
  return {state,properties,
    run:x=>vm.runInContext(x,vmCtx),
    createdFiles:()=>state.stageFiles};
}
function unchanged(h) {
  assert.equal(h.state.propWrites,0);
  assert.equal(h.state.propDeletes,0);
  assert.equal(h.state.casCalls,0);
  assert.equal(h.state.locks,0);
  assert.equal(h.state.postCalls,0);
  assert.equal(h.state.deleted,0);
}

test("G6-J QA source is syntax valid and cannot invoke CAS or mutate receipts",()=>{
  new vm.Script(g6j);
  assert.doesNotMatch(g6j,/\bdoPost\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\.setTrashed\s*\(/);
  assert.match(g6j,/vaaStageAppendDataStore_\s*\(/);
  assert.match(g6j,/vaaQaG6JInspectStageReadOnly/);
});

test("G6-J one-shot creates exactly one unlinked synthetic TEST stage and passes",()=>{
  const h=fixture();
  const res=h.run("vaaQaG6JStageOnlyOnce()");
  assert.equal(res.phase,"G6_STAGE_ONLY_ONCE");
  assert.equal(res.pass,true);
  assert.equal(res.stageCreated,true);
  assert.equal(res.stageFileCount,1);
  assert.equal(res.stageValidationCode,"OK");
  assert.equal(res.stageResultMatchesInspection,true);
  assert.equal(res.stageInTestFolder,true);
  assert.equal(res.stageDataStoreMatchesExpected,true);
  assert.equal(res.targetPointerUnchanged,true);
  assert.equal(res.stageUnlinkedFromWorkbook,true);
  assert.equal(res.stageReceiptUnused,true);
  assert.equal(res.reservedUpdateRequestUnused,true);
  assert.equal(res.updateLeaseAbsent,true);
  assert.equal(res.casPerformed,false);
  assert.equal(res.fullDoPostFaultInjected,false);
  assert.equal(res.driveFilesCreatedExpected,1);
  assert.equal(h.state.created,1);
  unchanged(h);
  assert.doesNotMatch(h.state.logs.join("\n"),
    /TEST_ONLY_FAKE_ACCESS_KEY|QA_G6D_TEST_SHEET|QA_G6J_STAGE_FILE/);
});

test("G6-J independent forensic inspector reads stage and performs zero writes",()=>{
  const h=fixture();
  assert.equal(h.run("vaaQaG6JStageOnlyOnce()").pass,true);
  const writes=h.state.created;
  const result=h.run("vaaQaG6JInspectStageReadOnly()");
  assert.equal(result.phase,"G6_STAGE_ONLY_INSPECT_READ_ONLY");
  assert.equal(result.strictReadOnly,true);
  assert.equal(result.actualReadyReceipts,4);
  assert.equal(result.stageFileCount,1);
  assert.equal(result.validationCode,"OK");
  assert.equal(result.stageBodyMatchesExpected,true);
  assert.equal(result.stageCountsMatchExpected,true);
  assert.equal(result.stageDataStoreApplications,2);
  assert.equal(result.stageDataStoreJobs,1);
  assert.equal(result.originalPointerUnchanged,true);
  assert.equal(result.pass,true);
  assert.equal(h.state.created,writes);
  unchanged(h);
});

test("G6-J before-creation inspector is safe and returns a precise absence",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6JInspectStageReadOnly()");
  assert.equal(r.stageFileCount,0);
  assert.equal(r.stageFileExists,false);
  assert.equal(r.validationCode,"STAGE_ABSENT");
  assert.equal(r.pass,false);
  assert.equal(h.state.created,0);
  unchanged(h);
});

test("G6-J second execution is rejected by stage preflight without another file",()=>{
  const h=fixture();
  assert.equal(h.run("vaaQaG6JStageOnlyOnce()").pass,true);
  assert.throws(()=>h.run("vaaQaG6JStageOnlyOnce()"),
    /QA_G6J_STAGE_BLOCKED_BY_PREFLIGHT/);
  assert.equal(h.state.created,1);
  unchanged(h);
});

test("G6-J lost response after stage creation is inspectable, never retried",()=>{
  const h=fixture({failAfterCreate:true});
  assert.throws(()=>h.run("vaaQaG6JStageOnlyOnce()"),
    /QA_SIMULATED_LOST_STAGE_RESPONSE/);
  assert.equal(h.state.created,1);
  const audit=h.run("vaaQaG6JInspectStageReadOnly()");
  assert.equal(audit.pass,true);
  assert.equal(audit.stageFileCount,1);
  assert.throws(()=>h.run("vaaQaG6JStageOnlyOnce()"),
    /QA_G6J_STAGE_BLOCKED_BY_PREFLIGHT/);
  assert.equal(h.state.created,1);
  unchanged(h);
});

test("G6-J failed pre-creation does not attempt cleanup or retry",()=>{
  const h=fixture({failBeforeCreate:true});
  assert.throws(()=>h.run("vaaQaG6JStageOnlyOnce()"),
    /QA_SIMULATED_BEFORE_FILE_WRITE/);
  const audit=h.run("vaaQaG6JInspectStageReadOnly()");
  assert.equal(audit.pass,false);
  assert.equal(audit.stageFileCount,0);
  assert.equal(h.state.created,1);
  unchanged(h);
});

test("G6-J candidate request collision, lease, UPDATE reuse or unsafe preflight fail closed",()=>{
  for(const opts of [
    {usedStageReceipt:true},{usedUpdateReceipt:true},
    {lease:true},{preflightDenied:true}
  ]) {
    const h=fixture(opts);
    assert.throws(()=>h.run("vaaQaG6JStageOnlyOnce()"),
      /QA_G6J_STAGE_BLOCKED_BY_PREFLIGHT/);
    assert.equal(h.state.created,0);
    unchanged(h);
  }
});

test("G6-J halts on out-of-TEST folder before any file write",()=>{
  for(const opts of [{wrongFolderName:true},{wrongParent:true}]) {
    const h=fixture(opts);
    assert.throws(()=>h.run("vaaQaG6JInspectStageReadOnly()"),
      /QA_G6J_DATASTORE_FOLDER_OUTSIDE_TEST/);
    assert.equal(h.state.created,0);
    unchanged(h);
  }
});

test("G6-J excludes malicious or mismatched stage content from PASS",()=>{
  const h=fixture();
  const st=h.run("vaaQaG6JStageOnlyOnce()");
  assert.equal(st.pass,true);
  const file=h.createdFiles()[0];
  const original=file.getBlob;
  file.getBlob=()=>({getDataAsString:()=>"{BROKEN_JSON"});
  const inspect=h.run("vaaQaG6JInspectStageReadOnly()");
  assert.equal(inspect.validationCode,"STAGE_READ_OR_PARSE_FAILED");
  assert.equal(inspect.pass,false);
  unchanged(h);
});
