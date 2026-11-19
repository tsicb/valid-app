"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");
const source=fs.readFileSync(path.join(
  __dirname,"..","qa/G6_Isolated_Unlinked_Stage_Forensics_QA.gs"
),"utf8");

const CREATE="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const RESERVED="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const STAGE="QA_G6I_STAGE_ONLY_PRECAS_20261119_V1";
const TEST_ID="QA_G6D_TEST_WORKBOOK_123456789";
const FILE_ID="QA_G6J_STAGE_FILE_123456789";
const POINTER="QA_G6D_ORIGINAL_DATASTORE";
const TEST_FOLDER="QA_EXISTING_TEST_FOLDER";
const ROOT="QA_ISOLATED_TEST_ROOT";
const clone=x=>JSON.parse(JSON.stringify(x));
const datasets={
  applicationData:{
    headers:["応募識別キー"],
    rows:[["I1:old"],["I1:new"]]
  },
  jobAnalysisMaster:{
    headers:["求人ID"],
    rows:[["QA_JOB_1"]]
  }
};
const stats={
  oldApplications:1,uploadedApplications:2,
  addedApplications:1,skippedAsExisting:1,
  finalApplications:2,finalJobs:1
};

function setup(o={}) {
  const properties={
    "REQ_HISTORY_G4":"G4_READY_IMMUTABLE",
    "REQ_HISTORY_G5_APPEND":"G5_APPEND_READY_IMMUTABLE",
    "REQ_HISTORY_G5_REPLACE":"G5_REPLACE_READY_IMMUTABLE",
    ["REQ_"+CREATE]:"G6D_CREATE_READY_IMMUTABLE",
    TEST_DATASTORE_FOLDER:TEST_FOLDER,
    SECRET:"QA_FAKE_SECRET_NEVER_LOG"
  };
  if(o.updateUsed)properties["REQ_"+RESERVED]="USED";
  if(o.stageUsed)properties["REQ_"+STAGE]="USED";
  if(o.lease)properties["LEASE_"+TEST_ID]="ACTIVE";
  const effects={
    getProperties:0, writes:0,deletes:0,created:0,trashed:0,
    locked:0,posted:0,reads:0,inspections:0,logs:[]
  };
  const props={
    getProperty:key=>properties[key]??null,
    getProperties:()=>{effects.getProperties++;return {...properties};},
    setProperty(){effects.writes++;throw Error("WRITE_FORBIDDEN");},
    deleteProperty(){effects.deletes++;throw Error("DELETE_FORBIDDEN");}
  };
  const stageBody={
    dataType:"VALID_APPLICATION_ANALYSIS_DATASTORE",
    dataStoreVersion:"QA_VERSION",
    applicationIdentityVersion:core.VERSION,
    updateStrategy:"APPEND",
    requestId:STAGE,
    spreadsheetId:TEST_ID,
    datasets:clone(datasets),
    updateStats:clone(stats)
  };
  const file={
    getName:()=>o.wrongFileName?"OTHER_STAGE.json":
      "analysis_data_"+TEST_ID+"_"+STAGE+".json",
    getId:()=>FILE_ID,
    getBlob:()=>({
      getDataAsString:()=>{
        effects.reads++;
        const body=clone(stageBody);
        if(o.badStats)body.updateStats.finalApplications=999;
        if(o.badIdentity)body.requestId="OTHER_SYNTHETIC_REQUEST";
        if(o.contentChanges&&effects.reads>=2)
          body.datasets.applicationData.rows[1]=["ALTERED"];
        if(o.badJson)return "{INVALID";
        return JSON.stringify(body);
      }
    }),
    setTrashed(){effects.trashed++;throw Error("TRASH_FORBIDDEN");}
  };
  const folder={
    getName:()=>o.badFolderName?"WRONG_FOLDER":"QA_TEST_DATASTORE",
    createFile(){effects.created++;throw Error("CREATE_FORBIDDEN");}
  };
  const scope={
    API_CONFIG:{
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"TEST_DATASTORE_FOLDER",
      ANALYSIS_DATASTORE_FOLDER_NAME:"QA_TEST_DATASTORE"
    },
    VAAAppendMergeCore:core,
    VAA_QA_G6C_CONFIG_:{createRequestId:CREATE},
    VAA_QA_G6E_UPDATE_REQUEST_ID_:RESERVED,
    VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_:STAGE,
    VAA_QA_G4_CONFIG_:{testRootId:ROOT},
    PropertiesService:{getScriptProperties:()=>props},
    vaaQaG4IsolatedConfig_:()=>props,
    vaaQaG6DHistorySnapshot_:p=>[
      p.getProperty("REQ_HISTORY_G4"),
      p.getProperty("REQ_HISTORY_G5_APPEND"),
      p.getProperty("REQ_HISTORY_G5_REPLACE")
    ],
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6JStageDetailsReadOnly_:()=>{
      effects.inspections++;
      const pass=!o.auditFails;
      const stageCount=o.multipleStages?2:1;
      const out={
        pass, actualReadyReceipts:o.readyCountWrong?3:4,
        stageFileCount:stageCount,
        validationCode:o.validationBad?"INVALID_STAGE":"OK",
        stageIsUnlinked:!o.pointerLinked,
        stagePointerNotFlipped:!o.pointerLinked,
        originalPointerUnchanged:!o.pointerLinked,
        faultDomainInspectionPass:pass
      };
      return {
        output:out,
        stageFileId:o.secondStageIdChanged&&effects.inspections===2?
          "OTHER_STAGE_FILE":FILE_ID,
        targetId:TEST_ID,
        originalPointer:o.secondPointerChanged&&effects.inspections===2?
          "ALTERED_POINTER":POINTER,
        plan:{datasets:clone(datasets),stats:clone(stats)}
      };
    },
    validateAnalysisDataStoreObject_:(body,target,req)=>({
      ok:!!body&&body.dataType==="VALID_APPLICATION_ANALYSIS_DATASTORE" &&
        body.spreadsheetId===target&&body.requestId===req &&
        !!body.datasets&&Array.isArray(body.datasets.applicationData.rows) &&
        Array.isArray(body.datasets.jobAnalysisMaster.rows)
    }),
    DriveApp:{
      getFolderById:id=>{
        if(id!==TEST_FOLDER)throw Error("UNSAFE_FOLDER");
        return folder;
      },
      getFileById:id=>{
        if(id!==FILE_ID)throw Error("UNEXPECTED_FILE");
        return file;
      }
    },
    folderIsDirectChildOf_:(value,parent)=>{
      if(value===folder)return parent===ROOT&&!o.badFolderParent;
      if(value===file)return parent===TEST_FOLDER&&!o.badFileParent;
      return false;
    },
    vaaQaG6IStageCandidateFileName_:target=>
      "analysis_data_"+target+"_"+STAGE+".json",
    vaaTargetUpdateLeaseKey_:target=>"LEASE_"+target,
    console:{log:x=>effects.logs.push(x)}
  };
  vm.runInContext(source,vm.createContext(scope));
  return {run:expr=>scope.vaaQaG6KVerifyUnlinkedStageReadOnly(),
    effects,properties};
}

const noWrites=h=>{
  const x=h.effects;
  assert.equal(x.writes,0);
  assert.equal(x.deletes,0);
  assert.equal(x.created,0);
  assert.equal(x.trashed,0);
  assert.equal(x.locked,0);
  assert.equal(x.posted,0);
};

test("G6-K syntax-valid, no CAS, POST, create, trash or property mutations",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,
    /\bdoPost\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\bvaaStageAppendDataStore_\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\.createFile\s*\(|\.setTrashed\s*\(/);
  assert.match(source,/vaaQaG6JStageDetailsReadOnly_\s*\(/);
  assert.doesNotMatch(source,/vaaQaG6IStagePreflightReadOnly\s*\(/);
});

test("G6-K healthy two-pass Stage audit confirms preserved orphan without writes",()=>{
  const h=setup();
  const r=h.run();
  assert.equal(r.phase,"G6_UNLINKED_STAGE_FORENSIC_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.independentReadPasses,2);
  assert.equal(r.firstStageAuditPass,true);
  assert.equal(r.secondStageAuditPass,true);
  assert.equal(r.stageFileCount,1);
  assert.equal(r.stageNameMatchesExpected,true);
  assert.equal(r.stageInTestFolder,true);
  assert.equal(r.stageIdAndTargetStableAcrossPasses,true);
  assert.equal(r.stageBodyValidFirstRead,true);
  assert.equal(r.stageBodyValidSecondRead,true);
  assert.equal(r.stageContentsStableAcrossReads,true);
  assert.equal(r.stageIsUnlinked,true);
  assert.equal(r.originalPointerUnchanged,true);
  assert.equal(r.actualReadyReceipts,4);
  assert.equal(r.historicalReceiptsUnchanged,true);
  assert.equal(r.createReceiptUnchanged,true);
  assert.equal(r.reservedUpdateRequestUnused,true);
  assert.equal(r.stageRequestUnused,true);
  assert.equal(r.updateLeaseAbsent,true);
  assert.equal(r.stagePreservationDecision,"PRESERVE_FOR_NEXT_REVIEW");
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(r.casAuthorized,false);
  assert.equal(r.updateAuthorized,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(r.actualCleanupPerformed,false);
  assert.equal(r.actualCasPerformed,false);
  assert.equal(r.readyForCleanupDesignReview,true);
  assert.equal(r.pass,true);
  assert.equal(h.effects.inspections,2);
  assert.equal(h.effects.reads,2);
  assert.equal(h.effects.logs.length,1);
  assert.doesNotMatch(h.effects.logs[0],
    /QA_FAKE_SECRET_NEVER_LOG|QA_G6D_TEST_WORKBOOK|QA_G6J_STAGE_FILE|I1:new/);
  noWrites(h);
});

test("G6-K does not mistake corrupt or changing Stage contents for PASS",()=>{
  for(const options of [
    {badStats:true},{badIdentity:true},
    {contentChanges:true},{badJson:true}
  ]){
    const h=setup(options);
    const r=h.run();
    assert.equal(r.pass,false);
    assert.equal(r.readyForCleanupDesignReview,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-K fails closed if two independent pass IDs or pointers disagree",()=>{
  for(const options of [
    {secondStageIdChanged:true},{secondPointerChanged:true}
  ]){
    const h=setup(options);
    const r=h.run();
    assert.equal(r.stageIdAndTargetStableAcrossPasses,false);
    assert.equal(r.pass,false);
    noWrites(h);
  }
});

test("G6-K rejects lost READY history, linked pointer or used requestId/lease",()=>{
  for(const options of [
    {readyCountWrong:true},{pointerLinked:true},
    {updateUsed:true},{stageUsed:true},{lease:true}
  ]){
    const h=setup(options);
    if(options.readyCountWrong||options.pointerLinked){
      assert.throws(()=>h.run(),/QA_G6K_FIRST_STAGE_AUDIT_NOT_READY/);
    }else{
      const r=h.run();assert.equal(r.pass,false);
    }
    noWrites(h);
  }
});

test("G6-K refuses multiple Stage files or an invalid G6-J stage audit",()=>{
  for(const options of [
    {multipleStages:true},{validationBad:true},{auditFails:true}
  ]){
    const h=setup(options);
    assert.throws(()=>h.run(),/QA_G6K_FIRST_STAGE_AUDIT_NOT_READY/);
    noWrites(h);
  }
});

test("G6-K refuses a stage outside TEST parent or renamed file",()=>{
  for(const options of [
    {badFolderName:true},{badFolderParent:true},
    {badFileParent:true},{wrongFileName:true}
  ]){
    const h=setup(options);
    assert.throws(()=>h.run(),
      /QA_G6K_STAGE_FOLDER_NOT_TEST|QA_G6K_STAGE_FILE_NOT_TEST_ISOLATED/);
    noWrites(h);
  }
});

test("G6-K explicitly prohibits cleanup or CAS even after a clean audit",()=>{
  const h=setup();
  const r=h.run();
  assert.equal(r.pass,true);
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(r.casAuthorized,false);
  assert.equal(r.updateAuthorized,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(r.actualCleanupPerformed,false);
  noWrites(h);
});
