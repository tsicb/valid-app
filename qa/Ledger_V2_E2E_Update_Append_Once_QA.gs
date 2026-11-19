/**
 * V2 immutable journal: one isolated synthetic UPDATE (APPEND) TEST.
 *
 * Starting evidence:
 *   - original four READY REQ_ receipts + V1 READY archive (unchanged)
 *   - E2E CREATE V1: one failed RESERVED revision 1 (unchanged)
 *   - E2E CREATE V2: verified READY revision 2, target has 1 app and 1 job
 *   - journal_v2 therefore contains exactly 3 data events (4 incl header)
 *
 * Preflight OFF and armed only READ. UPDATE ONCE calls the canonical doPost
 * exactly once against the verified E2E CREATE V2 TEST workbook.
 * Failure/timeout/unknown outcome: inspect only; never retry or delete.
 *
 * Requires preinstalled G4 and V2 CREATE QA modules. TEST script only.
 */
const VAA_QA_LEDGER_V2_UPDATE_ = Object.freeze({
  requestId:'QA_JOURNAL_E2E_UPDATE_20261119_V1',
  company:'QA_JOURNAL_E2E_SYNTHETIC_UPDATE_ONLY',
  updateStrategy:'APPEND'
});

function vaaQaLedgerV2UpdateReceipt_(props) {
  const id=VAA_QA_LEDGER_V2_RETEST_.requestId;
  const raw=String(props.getProperty(getRequestPropertyKey_(id))||'');
  try {
    const receipt=JSON.parse(raw);
    if (receipt.requestId===id &&
        receipt.operationMode==='CREATE' &&
        receipt.stage==='READY' && receipt.status==='READY' &&
        receipt.spreadsheetId) {
      return {raw:raw,record:receipt};
    }
  }catch(_){}
  return {raw:raw,record:null};
}

function vaaQaLedgerV2UpdatePayload_(spreadsheetId) {
  const data=vaaQaG4SyntheticPayload_();
  data.requestId=VAA_QA_LEDGER_V2_UPDATE_.requestId;
  data.companyDisplayName=VAA_QA_LEDGER_V2_UPDATE_.company;
  data.outputFolderId=VAA_QA_G4_CONFIG_.testOutputId;
  data.targetSpreadsheetId=spreadsheetId;
  data.updateStrategy=VAA_QA_LEDGER_V2_UPDATE_.updateStrategy;
  data.updateProtocol='IDENTITY_V1';
  // Independent applicant identity, job number and source job reference.
  // These values are synthetic, never taken from a real applicant.
  const app=data.datasets.applicationData;
  const appRow=app.rows[0];
  appRow[app.headers.indexOf('レコードID')]='APP000002';
  appRow[app.headers.indexOf('仕事番号')]='QA_JOB_2';
  appRow[app.headers.indexOf('求人参照ID')]='QA_REF_2';
  appRow[app.headers.indexOf('応募識別キー')]='I1:'+Array(65).join('b');
  appRow[app.headers.indexOf('応募日時')]='2026/11/19 12:00';
  appRow[app.headers.indexOf('応募日')]='2026/11/19';
  appRow[app.headers.indexOf('応募曜日')]='木';
  const job=data.datasets.jobAnalysisMaster;
  const jobRow=job.rows[0];
  jobRow[job.headers.indexOf('求人参照ID')]='QA_REF_2';
  jobRow[job.headers.indexOf('仕事番号')]='QA_JOB_2';
  jobRow[job.headers.indexOf('仕事名')]='QA架空求人・追加分';
  jobRow[job.headers.indexOf('Indeed用求人タイトル')]='QA架空求人・追加分';
  return data;
}

function vaaQaLedgerV2UpdateExpected_(existing) {
  const baseline=VAAAppendMergeCore.merge({
    mode:'REPLACE',
    incoming:vaaQaG4SyntheticPayload_().datasets,
    maxRows:API_CONFIG.MAX_DATASET_ROWS
  });
  const merged=VAAAppendMergeCore.merge({
    mode:'APPEND',
    existing:{
      applicationIdentityVersion:VAAAppendMergeCore.VERSION,
      applicationData:baseline.applicationData,
      jobAnalysisMaster:baseline.jobAnalysisMaster
    },
    incoming:vaaQaLedgerV2UpdatePayload_(existing).datasets,
    maxRows:API_CONFIG.MAX_DATASET_ROWS
  });
  return {baseline:baseline,merged:merged};
}

function vaaQaLedgerV2UpdateFlags_(props) {
  const first=String(props.getProperty(VAA_JOURNAL_DOP_MODE_PROP_)||'').trim();
  const second=String(props.getProperty(VAA_LEDGER_JOURNAL_MODE_PROP_)||'').trim();
  const replay=String(props.getProperty(VAA_LEDGER_REPLAY_MODE_PROPERTY_)||'').trim();
  return {
    off:(first===''||first==='OFF') &&
        (second===''||second==='OFF') &&
        (replay===''||replay==='OFF'),
    armed:first===VAA_JOURNAL_DOP_TEST_MODE_ &&
      second===VAA_LEDGER_JOURNAL_TEST_MODE_ &&
      props.getProperty(VAA_JOURNAL_DOP_ID_PROP_)===
        VAA_QA_LEDGER_V2_UPDATE_.requestId &&
      props.getProperty(VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_)===
        VAA_QA_G4_CONFIG_.testRootId &&
      props.getProperty(VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_)===
        VAA_QA_G4_CONFIG_.testOutputId &&
      (replay===''||replay==='OFF')
  };
}

function vaaQaLedgerV2UpdatePreflight_(requireArmed) {
  const props=vaaQaG4IsolatedConfig_();
  const propsBefore=props.getProperties();
  const historic=vaaQaLedgerE2EHistorySnapshot_(props);
  const source=vaaQaLedgerV2UpdateReceipt_(props);
  const sourceId=VAA_QA_LEDGER_V2_RETEST_.requestId;
  const oldId=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const newId=VAA_QA_LEDGER_V2_UPDATE_.requestId;
  const readySheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const old=vaaLedgerJournalLookupFromSheet_(tabs.sheet,oldId);
  const sourceEvent=vaaLedgerJournalLookupFromSheet_(tabs.sheet,sourceId);
  const targetEvent=vaaLedgerJournalLookupFromSheet_(tabs.sheet,newId);
  const oldRaw=String(props.getProperty(getRequestPropertyKey_(oldId))||'');
  const newRaw=String(props.getProperty(getRequestPropertyKey_(newId))||'');
  const sourceReady=!!source.record &&
    sourceEvent.state==='READY' && sourceEvent.revision===2 &&
    JSON.stringify(sourceEvent.latest.body.receipt)===source.raw;
  let targetInTestOutput=false,baselineExact=false;
  let plan=null,validation={ok:false},digest='',summary=null;
  if(sourceReady){
    try {
      const sheetId=source.record.spreadsheetId;
      validateUpdateTargetDriveFile_(
        sheetId,VAA_QA_G4_CONFIG_.testOutputId
      );
      targetInTestOutput=true;
      const book=SpreadsheetApp.openById(sheetId);
      const actual=vaaQaG5ReadTestDataStore_(book);
      plan=vaaQaLedgerV2UpdateExpected_(sheetId);
      baselineExact=
        JSON.stringify(actual.applicationData)===
          JSON.stringify(plan.baseline.applicationData) &&
        JSON.stringify(actual.jobAnalysisMaster)===
          JSON.stringify(plan.baseline.jobAnalysisMaster) &&
        actual.applicationData.rows.length===1 &&
        actual.jobAnalysisMaster.rows.length===1;
      const payload=vaaQaLedgerV2UpdatePayload_(sheetId);
      validation=validateEnvelope_(payload);
      digest=vaaDigestUpdateRequest_(payload);
      summary=plan.merged.stats;
    }catch(_){}
  }
  const updatePlanExact=!!summary &&
    summary.strategy==='APPEND' &&
    summary.oldApplications===1 &&
    summary.addedApplications===1 &&
    summary.finalApplications===2 &&
    summary.oldJobs===1 &&
    summary.addedJobs===1 &&
    summary.finalJobs===2;
  const modes=vaaQaLedgerV2UpdateFlags_(props);
  const fakeProps={
    getProperty:function(key) {
      if(key===VAA_JOURNAL_DOP_ID_PROP_)return newId;
      if(key===VAA_LEDGER_JOURNAL_MODE_PROP_)
        return VAA_LEDGER_JOURNAL_TEST_MODE_;
      if(key===VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_)
        return VAA_QA_G4_CONFIG_.testRootId;
      if(key===VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_)
        return VAA_QA_G4_CONFIG_.testOutputId;
      return props.getProperty(key);
    }
  };
  const scopeAllowed=vaaLedgerDopScopeCode_(
    fakeProps,newId,'UPDATE'
  )==='';
  const v1Synthetic=vaaLedgerReadyLookupFromSheet_(
    readySheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const noV1New=vaaLedgerReadyLookupFromSheet_(
    readySheet,newId
  ).state==='NOT_FOUND';
  let oldErrorStatus=false;
  try {
    const rec=JSON.parse(oldRaw);
    oldErrorStatus=rec.requestId===oldId &&
      rec.status!=='READY' &&
      !!rec.spreadsheetId;
  }catch(_){}
  const budget=vaaCheckNewRequestCapacityReadOnly_(props);
  const after=props.getProperties();
  const out={
    phase:requireArmed?
      'LEDGER_V2_UPDATE_ARMED_PREFLIGHT_READ_ONLY':
      'LEDGER_V2_UPDATE_OFF_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,
    existingHistoricalReadyFour:
      vaaQaLedgerE2EHistoryValid_(historic),
    failedCreateV1ReservationPreserved:
      old.state==='RESERVED'&&old.revision===1,
    failedCreateV1ReceiptPreserved:oldErrorStatus,
    completedCreateV2ReadyVerified:sourceReady,
    completedCreateV2TargetInTestOutput:targetInTestOutput,
    completedCreateV2DataUnchanged:baselineExact,
    journalHasExactlyPreviousThreeEvents:
      tabs.sheet.getLastRow()===4,
    updateRequestAbsentFromJournal:targetEvent.state==='ABSENT',
    updateRequestAbsentFromProperties:!newRaw,
    updateRequestAbsentFromV1Archive:noV1New,
    originalV1ReadyArchivePreserved:v1Synthetic.state==='FOUND',
    targetUpdateLeaseAbsent:sourceReady &&
      !props.getProperty(
        vaaTargetUpdateLeaseKey_(source.record.spreadsheetId)
      ),
    syntheticUpdatePayloadValid:validation.ok===true,
    syntheticUpdateDigestValid:/^[0-9a-f]{64}$/.test(digest),
    appendPlanAddsOneApplicationAndOneJob:updatePlanExact,
    capacityAllowed:budget.allowed===true,
    testScopeAcceptedInMemory:scopeAllowed,
    modesOff:modes.off,
    correctlyArmed:modes.armed,
    expectedModeSelected:requireArmed?modes.armed:modes.off,
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(propsBefore,after),
    historicalReadyUnchanged:
      vaaQaLedgerE2EHistoryEqual_(
        historic,vaaQaLedgerE2EHistorySnapshot_(props)
      ),
    actualDoPostInvoked:false,
    actualUpdatePerformed:false,
    journalWritten:false,
    cleanupAuthorized:false,
    retryAuthorized:false,
    productionChanged:false
  };
  out.pass=!!(
    out.existingHistoricalReadyFour &&
    out.failedCreateV1ReservationPreserved &&
    out.failedCreateV1ReceiptPreserved &&
    out.completedCreateV2ReadyVerified &&
    out.completedCreateV2TargetInTestOutput &&
    out.completedCreateV2DataUnchanged &&
    out.journalHasExactlyPreviousThreeEvents &&
    out.updateRequestAbsentFromJournal &&
    out.updateRequestAbsentFromProperties &&
    out.updateRequestAbsentFromV1Archive &&
    out.originalV1ReadyArchivePreserved &&
    out.targetUpdateLeaseAbsent &&
    out.syntheticUpdatePayloadValid &&
    out.syntheticUpdateDigestValid &&
    out.appendPlanAddsOneApplicationAndOneJob &&
    out.capacityAllowed &&
    out.testScopeAcceptedInMemory &&
    out.expectedModeSelected &&
    out.scriptPropertiesUnchanged &&
    out.historicalReadyUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_UPDATE_PREFLIGHT '+JSON.stringify(out));
  return out;
}

function vaaQaLedgerV2UpdatePreflightReadOnly() {
  return vaaQaLedgerV2UpdatePreflight_(false);
}

function vaaQaLedgerV2UpdateArmedPreflightReadOnly() {
  return vaaQaLedgerV2UpdatePreflight_(true);
}

/**
 * ONE-SHOT real TEST APPEND, NEVER retry this requestId even on timeout.
 */
function vaaQaLedgerV2UpdateOnce() {
  const pre=vaaQaLedgerV2UpdateArmedPreflightReadOnly();
  if(!pre.pass)throw Error('QA_LEDGER_V2_UPDATE_PREFLIGHT_FAILED');
  const props=vaaQaG4IsolatedConfig_();
  const source=vaaQaLedgerV2UpdateReceipt_(props);
  const previous=source.raw;
  const oldRaw=String(props.getProperty(getRequestPropertyKey_(
    VAA_QA_LEDGER_E2E_CREATE_.requestId
  ))||'');
  const historic=vaaQaLedgerE2EHistorySnapshot_(props);
  const payload=vaaQaLedgerV2UpdatePayload_(
    source.record.spreadsheetId
  );
  const response=vaaQaG4Invoke_(payload);
  const inspect=vaaQaLedgerV2UpdateInspectReadOnly();
  const out={
    phase:'LEDGER_V2_UPDATE_ONCE',
    actualDoPostInvoked:true,
    responseOk:response&&response.ok===true,
    responseReady:response&&response.status==='READY',
    responseReused:response&&response.reused===true,
    responseCode:String(response&&response.code||''),
    journalReady:inspect.newJournalReady,
    journalRevision:inspect.newJournalRevision,
    completedCreateReceiptPreserved:
      previous===vaaQaLedgerV2UpdateReceipt_(props).raw,
    failedCreateReceiptPreserved:
      oldRaw===String(props.getProperty(getRequestPropertyKey_(
        VAA_QA_LEDGER_E2E_CREATE_.requestId
      ))||''),
    historicalReadyUnchanged:
      vaaQaLedgerE2EHistoryEqual_(
        historic,vaaQaLedgerE2EHistorySnapshot_(props)
      ),
    autoRetryAuthorized:false,
    cleanupAuthorized:false,
    productionChanged:false
  };
  out.pass=!!(
    out.responseOk && out.responseReady && !out.responseReused &&
    out.journalReady && out.journalRevision===2 &&
    inspect.pass && out.completedCreateReceiptPreserved &&
    out.failedCreateReceiptPreserved &&
    out.historicalReadyUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_UPDATE '+JSON.stringify(out));
  return out;
}

/** Safe READ-ONLY after success, error or unknown response. */
function vaaQaLedgerV2UpdateInspectReadOnly() {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const historical=vaaQaLedgerE2EHistorySnapshot_(props);
  const oldId=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const createId=VAA_QA_LEDGER_V2_RETEST_.requestId;
  const updateId=VAA_QA_LEDGER_V2_UPDATE_.requestId;
  const source=vaaQaLedgerV2UpdateReceipt_(props);
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const first=vaaLedgerJournalLookupFromSheet_(tabs.sheet,updateId);
  const second=vaaLedgerJournalLookupFromSheet_(tabs.sheet,updateId);
  const old=vaaLedgerJournalLookupFromSheet_(tabs.sheet,oldId);
  const priorCreate=vaaLedgerJournalLookupFromSheet_(tabs.sheet,createId);
  const updateRaw=String(
    props.getProperty(getRequestPropertyKey_(updateId))||''
  );
  let update=null;
  try{update=updateRaw?JSON.parse(updateRaw):null;}catch(_){}
  const stable=first.state===second.state &&
    first.revision===second.revision &&
    (first.state==='ABSENT' ||
      (first.latest.digest===second.latest.digest &&
       JSON.stringify(first.latest.body)===
         JSON.stringify(second.latest.body)));
  const ready=stable && first.state==='READY' &&
    first.revision===2 && !!update &&
    update.requestId===updateId &&
    update.operationMode==='UPDATE' &&
    update.status==='READY' && update.stage==='READY' &&
    update.updateStrategy==='APPEND' &&
    !!source.record &&
    update.targetSpreadsheetId===source.record.spreadsheetId &&
    update.spreadsheetId===source.record.spreadsheetId;
  let hashMatches=false,archiveMatches=false,actualExact=false;
  let updateLeaseAbsent=false;
  if(source.record){
    try {
      const payload=vaaQaLedgerV2UpdatePayload_(
        source.record.spreadsheetId
      );
      hashMatches=!!update &&
        update.updatePayloadDigest===
          vaaDigestUpdateRequest_(payload);
      archiveMatches=ready &&
        JSON.stringify(first.latest.body.receipt)===updateRaw;
      const actual=vaaQaG5ReadTestDataStore_(
        SpreadsheetApp.openById(source.record.spreadsheetId)
      );
      const expected=vaaQaLedgerV2UpdateExpected_(
        source.record.spreadsheetId
      ).merged;
      actualExact=
        JSON.stringify(actual.applicationData)===
          JSON.stringify(expected.applicationData) &&
        JSON.stringify(actual.jobAnalysisMaster)===
          JSON.stringify(expected.jobAnalysisMaster) &&
        actual.applicationData.rows.length===2 &&
        actual.jobAnalysisMaster.rows.length===2;
      updateLeaseAbsent=!props.getProperty(
        vaaTargetUpdateLeaseKey_(source.record.spreadsheetId)
      );
    }catch(_){}
  }
  const v1Archived=vaaLedgerReadyLookupFromSheet_(
    tabs.readySheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const noV1Update=vaaLedgerReadyLookupFromSheet_(
    tabs.readySheet,updateId
  ).state==='NOT_FOUND';
  const out={
    phase:'LEDGER_V2_UPDATE_INSPECT_READ_ONLY',
    strictReadOnly:true,
    independentJournalReads:2,
    newJournalState:first.state,
    newJournalRevision:first.revision||0,
    journalStableAcrossReads:stable,
    newJournalReady:ready,
    updateReceiptExists:!!updateRaw,
    updateReceiptReady:!!update&&update.status==='READY',
    journalMatchesUpdateReceipt:archiveMatches,
    updatePayloadDigestMatches:hashMatches,
    finalDatastoreExactlyTwoApplicantsAndJobs:actualExact,
    updateTargetLeaseAbsent:updateLeaseAbsent,
    failedV1ReservationPreserved:
      old.state==='RESERVED'&&old.revision===1,
    completedV2CreateJournalPreserved:
      priorCreate.state==='READY'&&priorCreate.revision===2 &&
      !!source.record &&
      JSON.stringify(priorCreate.latest.body.receipt)===source.raw,
    originalFourReadyPreserved:
      vaaQaLedgerE2EHistoryValid_(historical),
    originalV1ReadyArchivePreserved:v1Archived.state==='FOUND',
    noUpdateRecordInOldV1Archive:noV1Update,
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,props.getProperties()),
    actualPostInvoked:false,
    actualJournalWrite:false,
    cleanupAuthorized:false,
    retryAuthorized:false,
    productionChanged:false
  };
  out.pass=!!(
    out.newJournalReady && out.journalMatchesUpdateReceipt &&
    out.updatePayloadDigestMatches &&
    out.finalDatastoreExactlyTwoApplicantsAndJobs &&
    out.updateTargetLeaseAbsent &&
    out.failedV1ReservationPreserved &&
    out.completedV2CreateJournalPreserved &&
    out.originalFourReadyPreserved &&
    out.originalV1ReadyArchivePreserved &&
    out.noUpdateRecordInOldV1Archive &&
    out.scriptPropertiesUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_UPDATE_INSPECT '+JSON.stringify(out));
  return out;
}
