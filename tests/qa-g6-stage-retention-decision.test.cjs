"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../central-api/append-merge-core.js");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const source=read("qa/G6_Isolated_Stage_Retention_Decision_QA.gs");

const CREATE="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const STAGE="QA_G6I_STAGE_ONLY_PRECAS_20261119_V1";
const UPDATE="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const TARGET="QA_G6D_ISOLATED_TEST_WORKBOOK";
const FILE="QA_G6J_SINGLE_STAGE_FILE";
const POINTER="QA_G6D_ORIGINAL_POINTER";
const FOLDER="QA_TEST_DATASTORE_FOLDER";
const ROOT="QA_TEST_ROOT";
const NAME="analysis_data_"+TARGET+"_"+STAGE+".json";
const clone=x=>JSON.parse(JSON.stringify(x));
const planDatasets={
  applicationData:{headers:["応募識別キー"],rows:[["I1:old"],["I1:new"]]},
  jobAnalysisMaster:{headers:["求人ID"],rows:[["QA_JOB_1"]]}
};
const planStats={
  oldApplications:1,uploadedApplications:2,
  addedApplications:1,skippedAsExisting:1,
  finalApplications:2,finalJobs:1
};
function fixture(options={}){
  const values={
    "REQ_READY_G4":"G4_IMMUTABLE",
    "REQ_READY_G5_APPEND":"G5_APPEND_IMMUTABLE",
    "REQ_READY_G5_REPLACE":"G5_REPLACE_IMMUTABLE",
    ["REQ_"+CREATE]:"G6D_IMMUTABLE",
    ANALYSIS_DATASTORE_FOLDER_ID:FOLDER,
    SECRET:"FAKE_SECRET_DO_NOT_LOG"
  };
  if(options.stageReceipt)values["REQ_"+STAGE]="USED";
  if(options.updateReceipt)values["REQ_"+UPDATE]="USED";
  if(options.lease)values["LEASE_"+TARGET]="ACTIVE";
  const events={writes:0,deletes:0,creates:0,trashes:0,
    cas:0,posts:0,reads:0,snapshots:0,logs:[]};
  const props={
    getProperty:k=>values[k]??null,
    getProperties:()=>{
      events.snapshots++;
      if(options.changeProperties&&events.snapshots>1)
        values.QA_NEW_PROPERTY="RACE_VALUE";
      return clone(values);
    },
    setProperty(){events.writes++;throw Error("UNEXPECTED_WRITE");},
    deleteProperty(){events.deletes++;throw Error("UNEXPECTED_DELETE");}
  };
  const body={
    requestId:STAGE,spreadsheetId:TARGET,
    applicationIdentityVersion:core.VERSION,
    updateStrategy:"APPEND",
    datasets:clone(planDatasets),
    updateStats:clone(planStats)
  };
  const parent={getId:()=>options.wrongParent?"OTHER":FOLDER};
  const file={
    getId:()=>FILE,
    getName:()=>options.badName?"WRONG_STAGE.json":NAME,
    getParents:()=>{
      const arr=options.twoParents?[parent,{getId:()=>FOLDER}]:
        options.noParent?[]:[parent];
      let i=0;
      return {hasNext:()=>i<arr.length,next:()=>arr[i++]};
    },
    getBlob:()=>({
      getDataAsString:()=>{
        events.reads++;
        const value=clone(body);
        if(options.badBody)value.updateStats.finalApplications=12;
        if(options.changeBody&&events.reads===2)
          value.datasets.applicationData.rows[1]=["I1:changed"];
        return options.badJson?"{BAD_JSON":JSON.stringify(value);
      }
    }),
    setTrashed(){events.trashes++;throw Error("TRASH_FORBIDDEN");}
  };
  const folder={getName:()=>options.badFolder?"BAD":"QA_Test_DataStore",
    createFile(){events.creates++;throw Error("CREATE_FORBIDDEN");}};
  const scope={
    VAAAppendMergeCore:core,
    VAA_QA_G6C_CONFIG_:{createRequestId:CREATE},
    VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_:STAGE,
    VAA_QA_G6E_UPDATE_REQUEST_ID_:UPDATE,
    VAA_QA_G4_CONFIG_:{testRootId:ROOT},
    API_CONFIG:{
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"QA_Test_DataStore"
    },
    PropertiesService:{getScriptProperties:()=>props},
    vaaQaG4IsolatedConfig_:()=>{
      if(options.wrongRoot)throw Error("QA_ISOLATION_FAILED");
      return props;
    },
    vaaQaG6LStageRetentionImpactReadOnly:()=>({
      pass:!options.badImpact,
      readyForSingleFileCleanupDesignReview:!options.badImpact,
      actualReadyReceipts:options.badReadyCount?3:4,
      exactSingleTestParent:!options.badImpact,
      stageReferencedByKnownWorkbookPointers:!!options.hasPointerRef,
      propertyStageReferenceCount:options.hasPropertyRef?1:0,
      knownWorkbookPointersStable:!options.badImpact,
      scriptPropertiesStable:!options.badImpact,
      cleanupAuthorized:false,
      externalReferenceScopeFullyAudited:false
    }),
    vaaQaG6JStageDetailsReadOnly_:()=>({
      output:{
        pass:!options.badStageInspector,
        stageFileCount:options.stageCountTwo?2:1,
        validationCode:options.badStageInspector?"BAD":"OK",
        originalPointerUnchanged:!options.pointerFlipped,
        stagePointerNotFlipped:!options.pointerFlipped
      },
      stageFileId:FILE,
      targetId:TARGET,
      originalPointer:options.pointerFlipped?FILE:POINTER,
      plan:{datasets:clone(planDatasets),stats:clone(planStats)}
    }),
    validateAnalysisDataStoreObject_:(b,target,request)=>({
      ok:!!b && b.requestId===request && b.spreadsheetId===target &&
        !!b.datasets
    }),
    DriveApp:{
      getFolderById:id=>{
        assert.equal(id,FOLDER);return folder;
      },
      getFileById:id=>{
        assert.equal(id,FILE);return file;
      }
    },
    vaaQaG6IStageCandidateFileName_:t=>{
      assert.equal(t,TARGET);return NAME;
    },
    folderIsDirectChildOf_:(obj,parentId)=>{
      if(obj===folder)return parentId===ROOT&&!options.badFolderRoot;
      if(obj===file)return parentId===FOLDER&&!options.badFileMembership;
      return false;
    },
    vaaTargetUpdateLeaseKey_:t=>"LEASE_"+t,
    vaaQaG6LSamePropertySnapshot_:(a,b)=>{
      const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
      return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&a[k]===b[k]);
    },
    console:{log:x=>events.logs.push(x)}
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(read("qa/G6_Isolated_Unlinked_Stage_Forensics_QA.gs"),ctx);
  vm.runInContext(source,ctx);
  return {run:()=>scope.vaaQaG6MStageRetentionDecisionReadOnly(),events,values};
}
function noWrites(h){
  for(const k of ["writes","deletes","creates","trashes","cas","posts"])
    assert.equal(h.events[k],0,k);
}

test("G6-M source parses; no mutation or real cleanup operation exists",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,
    /\bdoPost\s*\(|\bvaaStageAppendDataStore_\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\.setTrashed\s*\(|\.createFile\s*\(/);
  assert.match(source,/vaaQaG6LStageRetentionImpactReadOnly\s*\(/);
  assert.match(source,/vaaQaG6KValidateBodyReadOnly_\s*\(/);
});

test("G6-M green review retains exact Stage without granting deletion",()=>{
  const h=fixture();
  const r=h.run();
  assert.equal(r.phase,"G6_STAGE_RETENTION_DECISION_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.priorCleanupImpactPass,true);
  assert.equal(r.actualReadyReceipts,4);
  assert.equal(r.singleStageIdentified,true);
  assert.equal(r.stageFileNameMatches,true);
  assert.equal(r.stageExactSingleTestParent,true);
  assert.equal(r.stageByteContentStableAcrossReads,true);
  assert.equal(r.stageBodyStillMatchesSyntheticPlan,true);
  assert.equal(r.originalPointerStillUnchanged,true);
  assert.equal(r.noKnownWorkbookOrPropertyStageReference,true);
  assert.equal(r.scriptPropertiesStillStable,true);
  assert.equal(r.stageRequestReceiptUnused,true);
  assert.equal(r.reservedUpdateReceiptUnused,true);
  assert.equal(r.targetUpdateLeaseAbsent,true);
  assert.equal(r.externalReferencesFullyAudited,false);
  assert.equal(r.evidenceRetentionPolicy,"PRESERVE_UNTIL_G6_RECOVERY_QA_COMPLETE");
  assert.equal(r.noFolderWideCleanup,true);
  assert.equal(r.exactFileIdOnlyForFutureReview,true);
  assert.equal(r.requireFreshAuditBeforeFutureCleanup,true);
  assert.equal(r.requireExplicitHumanApproval,true);
  assert.equal(r.retentionPeriodConfirmed,false);
  assert.equal(r.evidenceArchiveVerified,false);
  assert.equal(r.operatorCleanupApprovalRecorded,false);
  assert.equal(r.readyForRetentionAndCleanupPolicyReview,true);
  assert.equal(r.stagePreservationDecision,"KEEP_STAGE_FOR_EVIDENCE");
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(r.casAuthorized,false);
  assert.equal(r.updateAuthorized,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(r.pass,true);
  assert.equal(h.events.reads,2);
  assert.equal(h.events.snapshots,2);
  assert.equal(h.events.logs.length,1);
  assert.doesNotMatch(h.events.logs[0],/FAKE_SECRET|QA_G6J_SINGLE_STAGE_FILE|QA_G6D_ISOLATED_TEST_WORKBOOK|I1:new/);
  noWrites(h);
});

test("G6-M rejects mutation, corruption or content drift of staged JSON",()=>{
  for(const o of [{changeBody:true},{badBody:true},{badJson:true}]){
    const h=fixture(o);const r=h.run();
    assert.equal(r.pass,false);
    assert.equal(r.readyForRetentionAndCleanupPolicyReview,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-M rejects nonunique parents, wrong name, or wrong folder membership",()=>{
  for(const o of [
    {wrongParent:true},{twoParents:true},{noParent:true},
    {badName:true},{badFileMembership:true}
  ]){
    const h=fixture(o);const r=h.run();
    assert.equal(r.pass,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-M fails closed when known references or request/lease records exist",()=>{
  for(const o of [
    {hasPointerRef:true},{hasPropertyRef:true},
    {stageReceipt:true},{updateReceipt:true},{lease:true}
  ]){
    const h=fixture(o);const r=h.run();
    assert.equal(r.pass,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-M refuses unready impact, invalid TEST root and nonunique Stage audit",()=>{
  for(const o of [
    {badImpact:true},{badReadyCount:true},{wrongRoot:true},
    {badStageInspector:true},{stageCountTwo:true},{badFolder:true},
    {badFolderRoot:true}
  ]){
    const h=fixture(o);
    assert.throws(()=>h.run());
    noWrites(h);
  }
});

test("G6-M preserves and refuses approval when pointers change or Properties race",()=>{
  for(const o of [{pointerFlipped:true},{changeProperties:true}]){
    const h=fixture(o);const r=h.run();
    assert.equal(r.pass,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-M no retention period or human approval is fabricated",()=>{
  const h=fixture();const r=h.run();
  assert.equal(r.pass,true);
  assert.equal(r.retentionPeriodConfirmed,false);
  assert.equal(r.operatorCleanupApprovalRecorded,false);
  assert.equal(r.evidenceArchiveVerified,false);
  assert.equal(r.externalReferencesFullyAudited,false);
  assert.equal(r.actualCleanupPerformed,false);
  assert.equal(r.actualCasPerformed,false);
  assert.equal(r.actualUpdatePerformed,false);
  noWrites(h);
});
