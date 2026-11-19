"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const src=fs.readFileSync(
  path.join(__dirname,"..","qa/G6_Isolated_Stage_Cleanup_Impact_QA.gs"),
  "utf8"
);
const ROOT="QA_TEST_ROOT_ONLY";
const FOLDER_ID="QA_TEST_DATASTORE_FOLDER";
const STAGE_ID="QA_G6J_UNLINKED_SYNTHETIC_FILE_ID";
const STAGE_REQUEST="QA_G6I_STAGE_ONLY_PRECAS_20261119_V1";
const RESERVED="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const CREATE="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const OLD="QA_G4_G5_OLD_WORKBOOK";
const NEW="QA_G6D_NEW_WORKBOOK";
const OLD_PTR="QA_G5_LAST_DATASTORE_POINTER";
const NEW_PTR="QA_G6D_CREATE_DATASTORE_POINTER";
const NAME="analysis_data_"+NEW+"_"+STAGE_REQUEST+".json";
const clone=o=>JSON.parse(JSON.stringify(o));

function fixture(opts={}){
  const values={
    REQ_G4:"READY_IMMUTABLE_G4",
    REQ_G5_APPEND:"READY_IMMUTABLE_G5_APPEND",
    REQ_G5_REPLACE:"READY_IMMUTABLE_G5_REPLACE",
    ["REQ_"+CREATE]:"READY_IMMUTABLE_G6D_CREATE",
    ANALYSIS_DATASTORE_FOLDER_ID:FOLDER_ID,
    QA_SECRET:"FAKE_ACCESS_KEY_MUST_NOT_LOG"
  };
  if(opts.propertyReferencesStage)values.AUX_STAGE_ID=STAGE_ID;
  if(opts.stageReceipt)values["REQ_"+STAGE_REQUEST]="ALREADY_USED";
  if(opts.reservedUpdate)values["REQ_"+RESERVED]="ALREADY_USED";
  if(opts.lease)values["LEASE_"+NEW]="LEASE_PRESENT";
  const calls={
    writes:0,deletes:0,created:0,trashed:0,posts:0,
    locks:0,log:[],pReads:0,scriptSnapshots:0
  };
  const props={
    getProperty:key=>values[key]??null,
    getProperties:()=>{
      calls.scriptSnapshots++;
      if(opts.propertiesChangedAfterAudit &&
         calls.scriptSnapshots===2)values.QA_RACE="CHANGED";
      return clone(values);
    },
    setProperty(){calls.writes++;throw Error("WRITE_FORBIDDEN");},
    deleteProperty(){calls.deletes++;throw Error("DELETE_FORBIDDEN");}
  };
  const parentOne={getId:()=>FOLDER_ID};
  const parentOther={getId:()=>"NOT_TEST_FOLDER"};
  const file={
    getId:()=>STAGE_ID,
    getName:()=>opts.badFileName?"WRONG_NAME.json":NAME,
    getSize:()=>opts.zeroSize?0:2048,
    getParents:()=>{
      const candidates=opts.twoParents?[parentOne,parentOther]:
        opts.badParent?[parentOther]:[parentOne];
      let index=0;
      return {
        hasNext:()=>index<candidates.length,
        next:()=>candidates[index++]
      };
    },
    setTrashed(){calls.trashed++;throw Error("TRASH_FORBIDDEN");}
  };
  const folder={
    getName:()=>opts.badFolderName?"UNEXPECTED_FOLDER":"QA_Test_DataStore",
    getFilesByName:name=>{
      assert.equal(name,NAME);
      const candidates=opts.zeroStage?[]:
        opts.duplicateStage?[file,file]:[file];
      let index=0;
      return {
        hasNext:()=>index<candidates.length,
        next:()=>candidates[index++]
      };
    },
    createFile(){calls.created++;throw Error("CREATE_FORBIDDEN");}
  };
  const knownStates={
    [OLD]:{
      analysisDataStoreFileId:opts.oldActiveStage?STAGE_ID:OLD_PTR,
      analysisDataStoreBackupFileId:
        opts.oldBackupStage?STAGE_ID:"QA_OLD_PREVIOUS_BACKUP",
      analysisDataStoreRequestId:"QA_G5_REPLACE"
    },
    [NEW]:{
      analysisDataStoreFileId:
        opts.newActiveStage?STAGE_ID:NEW_PTR,
      analysisDataStoreBackupFileId:
        opts.newBackupStage?STAGE_ID:"QA_G6D_PREVIOUS_BACKUP",
      analysisDataStoreRequestId:
        opts.wrongOwner?"DIFFERENT_OWNER":CREATE
    }
  };
  const scope={
    API_CONFIG:{
      REQUEST_PROPERTY_PREFIX:"REQ_",
      ANALYSIS_DATASTORE_FOLDER_PROPERTY:"ANALYSIS_DATASTORE_FOLDER_ID",
      ANALYSIS_DATASTORE_FOLDER_NAME:"QA_Test_DataStore"
    },
    VAA_QA_G4_CONFIG_:{
      testRootId:ROOT,testOutputId:"QA_TEST_OUTPUT"
    },
    VAA_QA_G6C_CONFIG_:{createRequestId:CREATE},
    VAA_QA_G6E_UPDATE_REQUEST_ID_:RESERVED,
    VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_:STAGE_REQUEST,
    PropertiesService:{getScriptProperties:()=>props},
    vaaQaG4IsolatedConfig_:()=>{
      if(opts.badTestIsolation)throw Error("QA_ISOLATION_FAILED");
      return props;
    },
    vaaQaG6KVerifyUnlinkedStageReadOnly:()=>({
      pass:!opts.badG6K,
      readyForCleanupDesignReview:!opts.badG6K,
      stageFileCount:opts.badG6K?0:1,
      actualReadyReceipts:opts.badReadyCount?3:4,
      stagePreservationDecision:"PRESERVE_FOR_NEXT_REVIEW",
      stageIsUnlinked:true
    }),
    getRequestRecord_:(p,id)=>id===CREATE?{
      requestId:CREATE,operationMode:"CREATE",status:"READY",
      outputFolderId:"QA_TEST_OUTPUT",
      spreadsheetId:opts.oldTarget?OLD:NEW
    }:null,
    vaaQaG5ReplaceReadyGateReadOnly_:()=>({
      targetId:OLD,pointer:OLD_PTR
    }),
    validateUpdateTargetDriveFile_:(id,folderId)=>{
      if(id!==NEW||folderId!=="QA_TEST_OUTPUT"||opts.invalidDriveTarget)
        throw Error("TEST_TARGET_INVALID");
    },
    DriveApp:{
      getFolderById:id=>{
        assert.equal(id,FOLDER_ID);
        return folder;
      },
      getFileById(){throw Error("G6L_DID_NOT_REQUIRE_DIRECT_FILE_LOOKUP");}
    },
    folderIsDirectChildOf_:(obj,parent)=>{
      if(obj===folder)return parent===ROOT&&!opts.badFolderParent;
      if(obj===file)return parent===FOLDER_ID&&!opts.badDirectMembership;
      return false;
    },
    vaaQaG6IStageCandidateFileName_:(target)=>{
      assert.equal(target,NEW);
      return NAME;
    },
    SpreadsheetApp:{
      openById:id=>{
        if(id!==NEW&&id!==OLD)throw Error("NON_TEST_WORKBOOK");
        return {getId:()=>id};
      }
    },
    rptReadStateData_:ss=>{
      calls.pReads++;
      const v=clone(knownStates[ss.getId()]);
      if(opts.concurrentPointerChange&&calls.pReads>=4){
        v.analysisDataStoreBackupFileId="QA_CHANGED_BACKUP";
      }
      return {map:v};
    },
    vaaTargetUpdateLeaseKey_:id=>"LEASE_"+id,
    console:{log:x=>calls.log.push(x)}
  };
  const context=vm.createContext(scope);
  vm.runInContext(src,context);
  return {run:()=>scope.vaaQaG6LStageRetentionImpactReadOnly(),
    calls,values,scope};
}

function noWrites(h){
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.deletes,0);
  assert.equal(h.calls.created,0);
  assert.equal(h.calls.trashed,0);
  assert.equal(h.calls.posts,0);
  assert.equal(h.calls.locks,0);
}

test("G6-L source is syntax valid and cannot execute Stage, CAS, POST, delete",()=>{
  new vm.Script(src);
  assert.doesNotMatch(src,
    /\bdoPost\s*\(|\bvaaStageAppendDataStore_\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\.setTrashed\s*\(|\.createFile\s*\(/);
  assert.match(src,/vaaQaG6KVerifyUnlinkedStageReadOnly\s*\(/);
});

test("G6-L healthy single Stage yields design review with NO cleanup authority",()=>{
  const h=fixture();
  const r=h.run();
  assert.equal(r.phase,"G6_STAGE_CLEANUP_IMPACT_READ_ONLY");
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.priorStageForensicsPass,true);
  assert.equal(r.actualReadyReceipts,4);
  assert.equal(r.exactlyOneStageFile,true);
  assert.equal(r.stageNameMatched,true);
  assert.equal(r.exactSingleTestParent,true);
  assert.equal(r.stageFileNonempty,true);
  assert.equal(r.stageUnlinkedInPriorAudit,true);
  assert.equal(r.stageReferencedByKnownWorkbookPointers,false);
  assert.equal(r.propertyStageReferenceCount,0);
  assert.equal(r.knownWorkbookActivePointersExpected,true);
  assert.equal(r.knownWorkbookPointersStable,true);
  assert.equal(r.scriptPropertiesStable,true);
  assert.equal(r.stageRequestReceiptExists,false);
  assert.equal(r.reservedUpdateReceiptExists,false);
  assert.equal(r.targetUpdateLeaseExists,false);
  assert.equal(r.externalReferenceScopeFullyAudited,false);
  assert.equal(r.retentionDecision,"PRESERVE_PENDING_FINAL_CLEANUP_REVIEW");
  assert.equal(r.readyForSingleFileCleanupDesignReview,true);
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(r.casAuthorized,false);
  assert.equal(r.updateAuthorized,false);
  assert.equal(r.automaticRetryAuthorized,false);
  assert.equal(r.actualCleanupPerformed,false);
  assert.equal(r.pass,true);
  assert.equal(h.calls.pReads,4);
  assert.equal(h.calls.scriptSnapshots,2);
  assert.equal(h.calls.log.length,1);
  assert.doesNotMatch(h.calls.log[0],
    /FAKE_ACCESS_KEY|QA_G6J_UNLINKED_SYNTHETIC_FILE_ID|QA_G6D_NEW_WORKBOOK|READY_IMMUTABLE/);
  noWrites(h);
});

test("G6-L forbids cleanup review for linked Stage as active or backup pointer",()=>{
  for(const o of [
    {oldActiveStage:true},{oldBackupStage:true},
    {newActiveStage:true},{newBackupStage:true}
  ]){
    const h=fixture(o);
    const r=h.run();
    assert.equal(r.stageReferencedByKnownWorkbookPointers,true);
    assert.equal(r.readyForSingleFileCleanupDesignReview,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-L blocks references from ANY Script Property and receipt/lease collision",()=>{
  for(const o of [
    {propertyReferencesStage:true},{stageReceipt:true},
    {reservedUpdate:true},{lease:true}
  ]){
    const h=fixture(o);
    const r=h.run();
    assert.equal(r.pass,false);
    assert.equal(r.cleanupAuthorized,false);
    noWrites(h);
  }
});

test("G6-L refuses Stage duplicates or missing Stage file",()=>{
  for(const o of [{duplicateStage:true},{zeroStage:true}]){
    const h=fixture(o);
    assert.throws(()=>h.run(),/QA_G6L_STAGE_NOT_UNIQUE/);
    noWrites(h);
  }
});

test("G6-L exact parent policy rejects another, missing, or invalid parent",()=>{
  for(const o of [
    {badParent:true},{twoParents:true},{badDirectMembership:true}
  ]){
    const h=fixture(o);
    const r=h.run();
    assert.equal(r.exactSingleTestParent,false);
    assert.equal(r.pass,false);
    noWrites(h);
  }
});

test("G6-L blocks source workbook pointer drift or script property mutation",()=>{
  for(const o of [
    {concurrentPointerChange:true},
    {propertiesChangedAfterAudit:true},
    {wrongOwner:true},
    {zeroSize:true},{badFileName:true}
  ]){
    const h=fixture(o);
    const r=h.run();
    assert.equal(r.pass,false);
    noWrites(h);
  }
});

test("G6-L fails closed for missing G6-K PASS or TEST isolation",()=>{
  for(const o of [
    {badG6K:true},{badReadyCount:true},{badTestIsolation:true},
    {oldTarget:true},{invalidDriveTarget:true},
    {badFolderName:true},{badFolderParent:true}
  ]){
    const h=fixture(o);
    assert.throws(()=>h.run());
    noWrites(h);
  }
});

test("G6-L review can never authorize cleanup, CAS, UPDATE or retry",()=>{
  const h=fixture();
  const r=h.run();
  assert.equal(r.pass,true);
  assert.equal(r.externalReferenceScopeFullyAudited,false);
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(r.casAuthorized,false);
  assert.equal(r.updateAuthorized,false);
  assert.equal(r.automaticRetryAuthorized,false);
  noWrites(h);
});
