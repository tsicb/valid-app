"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const code=read("qa/G6_Isolated_Synthetic_Fault_Recovery_Review_QA.gs");
const ROOT="1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU";
const OUTPUT="1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7";
const CREATE="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const UPDATE="QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const OLD="QA_HISTORIC_TEST_WORKBOOK_12345678";
const NEW="QA_G6D_TEST_WORKBOOK_123456789";

function fixture(opt={}) {
  const properties={
    ACCESS_KEY:"FAKE_TEST_ACCESS_KEY_NEVER_PRINT",
    SCHEMA_VERSION:"3.0"
  };
  const historyIds=[
    "QA_G4_SYNTHETIC_CREATE_20261118_V1",
    "QA_G5_SYNTHETIC_APPEND_20261118_V1",
    "QA_G5_SYNTHETIC_REPLACE_20261119_V1"
  ];
  historyIds.forEach(id=>properties["REQ_"+id]=JSON.stringify({
    requestId:id,operationMode:"UPDATE",status:"READY"
  }));
  properties["REQ_"+CREATE]=JSON.stringify({
    requestId:CREATE,operationMode:"CREATE",
    status:"READY",stage:"READY",spreadsheetId:NEW,
    outputFolderId:OUTPUT
  });
  if(opt.preexistingUpdate)properties["REQ_"+UPDATE]="ALREADY_USED";
  if(opt.targetLease)properties["VAA_TARGET_UPDATE_"+NEW]="ACTIVE";
  const state={writes:0,deletes:0,posts:0,logs:[],pointerReads:0};
  const props={
    getProperty:key=>properties[key]??null,
    getProperties:()=>({...properties}),
    setProperty(){state.writes++;throw Error("MUTATION_FORBIDDEN");},
    deleteProperty(){state.deletes++;throw Error("MUTATION_FORBIDDEN");}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:opt.wrongRoot?"NOT_TEST":ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUTPUT,
      DEFAULT_APP_VERSION:"TEST_QA_VERSION",
      EXPECTED_COMMON_MASTER_VERSION:"TEST_QA_COMMON",
      REQUEST_PROPERTY_PREFIX:"REQ_",
      CURRENT_STORAGE_LAYOUT:"DATASTORE_V1"
    },
    PropertiesService:{getScriptProperties:()=>props},
    normalizeString_:v=>String(v??"").trim(),
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},
      Charset:{UTF_8:"UTF_8"},
      computeDigest:(algorithm,str,charset)=>[
        ...crypto.createHash("sha256").update(String(str),"utf8").digest()
      ]
    },
    vaaQaG6DHistorySnapshot_:p=>historyIds.map(id=>p.getProperty("REQ_"+id)),
    vaaQaG6DHistoryEqual_:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    vaaQaG6EUpdateFaultPreflightReadOnly:()=>({
      readyForFaultInjectionDesignReview:!opt.badPreflight,
      priorReadyReceipts:opt.badReadyCount?3:4,
      pointerUnchangedDuringPreflight:!opt.badPreflight,
      candidateTargetsIndependentTestWorkbook:true
    }),
    SpreadsheetApp:{
      openById:id=>{
        if(id!==NEW)throw Error("WRONG_TEST_TARGET");
        return {getId:()=>id};
      }
    },
    rptReadStateData_:()=>{
      state.pointerReads++;
      return {map:{
        analysisDataStoreFileId:
          opt.changedPointerAfterRead && state.pointerReads>1
            ?"CHANGED_G6D_POINTER":"G6D_PRIVATE_DATASTORE_POINTER",
        analysisDataStoreRequestId:opt.badOwner?"DIFFERENT_REQUEST":CREATE
      }};
    },
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    console:{log:s=>state.logs.push(s)},
    Date
  };
  const ctx=vm.createContext(scope);
  vm.runInContext(read("qa/G4_Isolated_Create_Replay_QA.gs"),ctx);
  vm.runInContext(
    "const VAA_QA_G5_APPEND_REQUEST_ID_ = '"+historyIds[1]+"';"+
    "const VAA_QA_G5_REPLACE_REQUEST_ID_ = '"+historyIds[2]+"';",ctx
  );
  vm.runInContext(read("qa/G6_Isolated_Fault_Domain_Preflight_QA.gs"),ctx);
  vm.runInContext(
    "const VAA_QA_G6E_UPDATE_REQUEST_ID_ = '"+UPDATE+"';",ctx
  );
  vm.runInContext(
    "function vaaQaG6EUpdatePayload_(targetId) {"+
    "const p=vaaQaG6CFaultDomainPayload_();"+
    "p.requestId=VAA_QA_G6E_UPDATE_REQUEST_ID_;"+
    "p.action='update';p.operationMode='update';"+
    "p.targetSpreadsheetId=targetId;"+
    "p.updateStrategy='APPEND';p.updateProtocol='IDENTITY_V1';return p;"+
    "}",ctx
  );
  vm.runInContext(read("central-api/04_Request_Target.gs"),ctx);
  vm.runInContext(read("central-api/13_Append_Update_Guard.gs"),ctx);
  // The canonical 13_Append_Update_Guard defines a mutating lease-key
  // generator, but we only CALL the read-only key-name function.
  vm.runInContext(code,ctx);
  return {run:x=>vm.runInContext(x,ctx),state,properties};
}

test("G6-F source parses and contains no actual POST/write/stage/lease mutation",()=>{
  new vm.Script(code);
  assert.doesNotMatch(code,
    /\bdoPost\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(|\bvaaStageAppendDataStore_\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\bvaaClaimTargetUpdateLease_\s*\(|\bvaaReleaseTargetUpdateLease_\s*\(|SpreadsheetApp\.create\s*\(/);
  assert.match(code,/vaaValidateUpdateRequestRecord_\s*\(/);
  assert.match(code,/getRequestRecord_\s*\(/);
  assert.match(code,/isLeaseActive_\s*\(/);
  assert.match(code,/buildReadyResponse_\s*\(/);
});

test("G6-F all six fault-state classifications and 12 negative gates pass",()=>{
  const h=fixture();
  const result=h.run("vaaQaG6FSyntheticFaultReviewReadOnly()");
  assert.equal(result.phase,"G6_SYNTHETIC_FAULT_RECOVERY_REVIEW_READ_ONLY");
  assert.equal(result.strictReadOnly,true);
  assert.equal(result.actualReadyReceipts,4);
  assert.equal(result.scenarioCount,6);
  assert.equal(result.simulatedDecisionsPass,true);
  assert.equal(result.negativeGatesPass,true);
  assert.equal(Object.keys(result.negativeGates).length,12);
  for(const row of result.scenarios)assert.equal(row.pass,true);
  assert.equal(result.historicalReceiptsUnchanged,true);
  assert.equal(result.createReceiptUnchanged,true);
  assert.equal(result.dataStorePointerUnchanged,true);
  assert.equal(result.candidateRequestIdUnused,true);
  assert.equal(result.targetLeaseNotCreated,true);
  assert.equal(result.simulationOnly,true);
  assert.equal(result.actualFaultInjected,false);
  assert.equal(result.actualUpdatePerformed,false);
  assert.equal(result.actualResumeTested,false);
  assert.equal(result.automaticRetryAuthorized,false);
  assert.equal(result.pass,true);
  assert.equal(h.state.posts,0);
  assert.equal(h.state.writes,0);
  assert.equal(h.state.deletes,0);
  assert.equal(h.state.logs.length,1);
  assert.doesNotMatch(h.state.logs.join("\n"),
    /FAKE_TEST_ACCESS_KEY|QA_G6D_TEST_WORKBOOK|QA_HISTORIC_TEST_WORKBOOK|REQ_QA_/);
});

test("G6-F recovery classifier never returns automatic-retry permission",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6FSyntheticFaultReviewReadOnly()");
  const expected=[
    "REVIEW_FRESH_REQUEST_AFTER_AUDIT",
    "HALT_LEASE_WITHOUT_RECEIPT",
    "HALT_PROCESSING_BEFORE_COMMIT",
    "HALT_STAGED_DATA_NOT_COMMITTED",
    "HALT_CAS_COMMITTED_MIRRORS_UNCERTAIN",
    "REVIEW_READY_REPLAY_AFTER_AUDIT"
  ];
  assert.deepEqual(r.scenarios.map(x=>x.actualDecision),expected);
  assert.equal(r.automaticRetryAuthorized,false);
});

test("G6-F missing G6-E readiness fails before any simulation",()=>{
  for(const opt of [{badPreflight:true},{badReadyCount:true}]){
    const h=fixture(opt);
    assert.throws(()=>h.run("vaaQaG6FSyntheticFaultReviewReadOnly()"),
      /QA_G6F_INDEPENDENT_UPDATE_NOT_READY/);
    assert.equal(h.state.posts,0);
    assert.equal(h.state.writes,0);
  }
});

test("G6-F checks TEST root and G6-D DataStore owner",()=>{
  for(const opt of [{wrongRoot:true},{badOwner:true}]){
    const h=fixture(opt);
    assert.throws(()=>h.run("vaaQaG6FSyntheticFaultReviewReadOnly()"),
      /QA_ISOLATION_FAILED|QA_G6F_TEST_DATASTORE_POINTER_UNVERIFIED/);
    assert.equal(h.state.posts,0);
    assert.equal(h.state.writes,0);
  }
});

test("G6-F rejects post-read pointer changes and unexpected candidate request/lease",()=>{
  for(const opt of [
    {changedPointerAfterRead:true},
    {preexistingUpdate:true},{targetLease:true}
  ]){
    const h=fixture(opt);
    const r=h.run("vaaQaG6FSyntheticFaultReviewReadOnly()");
    assert.equal(r.pass,false);
    assert.equal(h.state.posts,0);
    assert.equal(h.state.writes,0);
    assert.equal(h.state.deletes,0);
  }
});

test("G6-F synthetic classifier blocks ERROR, mismatched target and missing lease",()=>{
  const h=fixture();
  const rid="QA_F6_FAKE_ONLY",tid="QA_TEST_TARGET",digest="DIGEST_ONLY";
  const record={
    requestId:rid,operationMode:"UPDATE",updateStrategy:"APPEND",
    updatePayloadDigest:digest,spreadsheetId:tid,
    targetSpreadsheetId:tid,status:"ERROR",stage:"OPENED",leaseUntil:""
  };
  const stringify=JSON.stringify;
  const classify=(rec,pointer="ORIGINAL")=>
    h.run("vaaQaG6FClassifySynthetic_("+JSON.stringify({
      rawReceipt:stringify(rec),rawTargetLease:"",
      pointerState:pointer,pointerOwnedByCandidate:pointer==="NEW",
      stageBlobPresent:false,dataStoreMatchesPlanned:false
    })+","+JSON.stringify(rid)+","+JSON.stringify(tid)+","+JSON.stringify(digest)+")");
  assert.equal(classify(record),"HALT_ERROR_REQUIRES_FORENSICS");
  assert.equal(classify({...record,status:"READY",stage:"OPENED"}),"HALT_READY_STATE_INCONSISTENT");
  assert.equal(classify({...record,targetSpreadsheetId:"WRONG"}),"HALT_RECEIPT_TARGET_MISMATCH");
  assert.equal(classify({...record,status:"PROCESSING"}),"HALT_EXPIRED_OR_MISSING_REQUEST_LEASE");
  assert.equal(h.state.posts,0);
  assert.equal(h.state.writes,0);
});

test("G6-F healthy baseline never claims actual failure injection was performed",()=>{
  const h=fixture();
  const r=h.run("vaaQaG6FSyntheticFaultReviewReadOnly()");
  assert.equal(r.actualFaultInjected,false);
  assert.equal(r.actualResumeTested,false);
  assert.equal(r.actualUpdatePerformed,false);
});
