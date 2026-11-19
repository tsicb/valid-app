/**
 * Isolated TEST V2 journal — second, independent synthetic CREATE attempt.
 *
 * Historical E2E V1 failed on a transient Spreadsheet service exception
 * (03_Workbook formatting). Its RESERVED rev1, non-READY REQ_ and partial
 * TEST workbook MUST remain intact. NEVER rerun or repair that V1 request.
 *
 * This file provides:
 *  - vaaQaLedgerV2RetestPreflightReadOnly: flags OFF, no writes
 *  - vaaQaLedgerV2RetestArmedPreflightReadOnly: flags explicitly ON, no writes
 *  - vaaQaLedgerV2RetestCreateOnce: one new TEST doPost, NEVER retry
 *  - vaaQaLedgerV2RetestInspectReadOnly: forensic reads, safe at any time
 *
 * The new requestId ends in _V2; 23_ bridge requires exact 1-ID allowlist.
 * No cleanup/REQ deletion, no staging/CAS repair, no PROD changes.
 */
const VAA_QA_LEDGER_V2_RETEST_ = Object.freeze({
  requestId:'QA_JOURNAL_E2E_CREATE_20261119_V2',
  company:'QA_JOURNAL_E2E_SYNTHETIC_CREATE_V2'
});

function vaaQaLedgerV2RetestPayload_() {
  const payload=vaaQaG4SyntheticPayload_();
  payload.requestId=VAA_QA_LEDGER_V2_RETEST_.requestId;
  payload.companyDisplayName=VAA_QA_LEDGER_V2_RETEST_.company;
  payload.outputFolderId=VAA_QA_G4_CONFIG_.testOutputId;
  return payload;
}

function vaaQaLedgerV2RetestModes_(props) {
  const mop=String(props.getProperty(
    VAA_JOURNAL_DOP_MODE_PROP_)||'').trim();
  const journal=String(props.getProperty(
    VAA_LEDGER_JOURNAL_MODE_PROP_)||'').trim();
  const oldReplay=String(props.getProperty(
    VAA_LEDGER_REPLAY_MODE_PROPERTY_)||'').trim();
  const off=(mop===''||mop==='OFF') &&
    (journal===''||journal==='OFF') &&
    (oldReplay===''||oldReplay==='OFF');
  const armed=mop===VAA_JOURNAL_DOP_TEST_MODE_ &&
    journal===VAA_LEDGER_JOURNAL_TEST_MODE_ &&
    props.getProperty(VAA_JOURNAL_DOP_ID_PROP_)===
      VAA_QA_LEDGER_V2_RETEST_.requestId &&
    props.getProperty(VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_)===
      VAA_QA_G4_CONFIG_.testRootId &&
    props.getProperty(VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_)===
      VAA_QA_G4_CONFIG_.testOutputId &&
    (oldReplay===''||oldReplay==='OFF');
  return {off:off,armed:armed};
}

function vaaQaLedgerV2RetestPreflight_(requireArmed) {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const id=VAA_QA_LEDGER_V2_RETEST_.requestId;
  const oldId=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const historical=vaaQaLedgerE2EHistorySnapshot_(props);
  const payload=vaaQaLedgerV2RetestPayload_();
  const validation=validateEnvelope_(payload);
  const budget=vaaCheckNewRequestCapacityReadOnly_(props);
  const sheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const old=vaaLedgerJournalLookupFromSheet_(tabs.sheet,oldId);
  const fresh=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  const oldRaw=String(props.getProperty(getRequestPropertyKey_(oldId))||'');
  const freshRaw=String(props.getProperty(getRequestPropertyKey_(id))||'');
  let oldReceipt=null,oldWorkbookVerified=false;
  try {
    oldReceipt=JSON.parse(oldRaw);
    if(oldReceipt && oldReceipt.spreadsheetId &&
       oldReceipt.requestId===oldId &&
       oldReceipt.status!=='READY'){
      validateUpdateTargetDriveFile_(
        oldReceipt.spreadsheetId,VAA_QA_G4_CONFIG_.testOutputId
      );
      oldWorkbookVerified=true;
    }
  }catch(_){}
  const oldArchived=vaaLedgerReadyLookupFromSheet_(sheet,oldId);
  const newArchived=vaaLedgerReadyLookupFromSheet_(sheet,id);
  const previouslySaved=vaaLedgerReadyLookupFromSheet_(
    sheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const realModes=vaaQaLedgerV2RetestModes_(props);
  const scopeFake={getProperty:function(key) {
    if(key===VAA_JOURNAL_DOP_MODE_PROP_)
      return VAA_JOURNAL_DOP_TEST_MODE_;
    if(key===VAA_JOURNAL_DOP_ID_PROP_)return id;
    if(key===VAA_LEDGER_JOURNAL_MODE_PROP_)
      return VAA_LEDGER_JOURNAL_TEST_MODE_;
    if(key===VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_)
      return VAA_QA_G4_CONFIG_.testRootId;
    if(key===VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_)
      return VAA_QA_G4_CONFIG_.testOutputId;
    return props.getProperty(key);
  }};
  const inMemoryScopeAccepted=
    vaaLedgerDopScopeCode_(scopeFake,id,'CREATE')==='';
  const selectedMode=requireArmed?realModes.armed:realModes.off;
  const after=props.getProperties();
  const report={
    phase:requireArmed?
      'LEDGER_V2_RETEST_ARMED_PREFLIGHT_READ_ONLY':
      'LEDGER_V2_RETEST_OFF_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,
    originalFourReadyPresent:vaaQaLedgerE2EHistoryValid_(historical),
    oldFailedReservationPreserved:
      old.state==='RESERVED'&&old.revision===1,
    oldErrorReceiptPreserved:
      !!oldRaw && !!oldReceipt &&
      oldReceipt.status!=='READY' && oldWorkbookVerified,
    originalReadyV1ArchivePreserved:
      previouslySaved.state==='FOUND',
    journalHasOldReservationOnly:
      tabs.sheet.getLastRow()===2,
    newJournalIdAbsent:fresh.state==='ABSENT',
    newReqPropertyAbsent:!freshRaw,
    oldAndNewIdsNotInReadyArchive:
      oldArchived.state==='NOT_FOUND' &&
      newArchived.state==='NOT_FOUND',
    newCanonicalPayloadValid:validation.ok===true,
    capacityAllowed:budget.allowed===true,
    modesOff:realModes.off,
    correctlyArmed:realModes.armed,
    expectedModeSelected:selectedMode,
    inMemoryIsolatedTestScopeAccepted:inMemoryScopeAccepted,
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,after),
    historicalReadyUnchanged:
      vaaQaLedgerE2EHistoryEqual_(
        historical,vaaQaLedgerE2EHistorySnapshot_(props)
      ),
    actualDoPostInvoked:false,
    actualJournalWrite:false,
    actualCreatePerformed:false,
    retryAuthorized:false,
    cleanupAuthorized:false,
    productionChanged:false
  };
  report.pass=!!(
    report.originalFourReadyPresent &&
    report.oldFailedReservationPreserved &&
    report.oldErrorReceiptPreserved &&
    report.originalReadyV1ArchivePreserved &&
    report.journalHasOldReservationOnly &&
    report.newJournalIdAbsent &&
    report.newReqPropertyAbsent &&
    report.oldAndNewIdsNotInReadyArchive &&
    report.newCanonicalPayloadValid &&
    report.capacityAllowed &&
    report.expectedModeSelected &&
    report.inMemoryIsolatedTestScopeAccepted &&
    report.scriptPropertiesUnchanged &&
    report.historicalReadyUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_RETEST_PREFLIGHT '+
    JSON.stringify(report));
  return report;
}

function vaaQaLedgerV2RetestPreflightReadOnly() {
  return vaaQaLedgerV2RetestPreflight_(false);
}

function vaaQaLedgerV2RetestArmedPreflightReadOnly() {
  return vaaQaLedgerV2RetestPreflight_(true);
}

/**
 * ONE-SHOT, writes to TEST Sheets/Script Properties. Never call for the
 * historical V1 ID, never repeat after success/error/timeout/unknown state.
 */
function vaaQaLedgerV2RetestCreateOnce() {
  const pre=vaaQaLedgerV2RetestArmedPreflightReadOnly();
  if(!pre.pass)throw new Error('QA_V2_RETEST_NOT_ARMED_OR_NOT_SAFE');
  const props=vaaQaG4IsolatedConfig_();
  const fourBefore=vaaQaLedgerE2EHistorySnapshot_(props);
  const oldId=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const failedReceiptBefore=String(
    props.getProperty(getRequestPropertyKey_(oldId))||''
  );
  const response=vaaQaG4Invoke_(vaaQaLedgerV2RetestPayload_());
  const inspection=vaaQaLedgerV2RetestInspectReadOnly();
  const good=!!response && response.ok===true &&
    response.status==='READY' && response.reused!==true &&
    inspection.pass &&
    inspection.newReceiptReady &&
    inspection.newJournalReady &&
    inspection.journalRevision===2;
  const out={
    phase:'LEDGER_V2_RETEST_CREATE_ONCE',
    actualDoPostInvoked:true,
    responseOk:!!response&&response.ok===true,
    responseCode:String(response&&response.code||''),
    responseReady:!!response&&response.status==='READY',
    responseReused:!!response&&response.reused===true,
    journalRevision:inspection.journalRevision,
    newJournalReady:inspection.newJournalReady,
    oldFailedReceiptPreserved:
      failedReceiptBefore===String(
        props.getProperty(getRequestPropertyKey_(oldId))||''
      ),
    originalFourReadyUnchanged:
      vaaQaLedgerE2EHistoryEqual_(
        fourBefore,vaaQaLedgerE2EHistorySnapshot_(props)
      ),
    autoRetryAuthorized:false,
    cleanupAuthorized:false,
    productionChanged:false,
    pass:good
  };
  console.log('VAA_QA_LEDGER_V2_RETEST_CREATE '+
    JSON.stringify(out));
  return out;
}

/** Forensic read-only audit. Safe after any one-shot outcome. */
function vaaQaLedgerV2RetestInspectReadOnly() {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const historical=vaaQaLedgerE2EHistorySnapshot_(props);
  const id=VAA_QA_LEDGER_V2_RETEST_.requestId;
  const oldId=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const first=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  const second=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  const old=vaaLedgerJournalLookupFromSheet_(tabs.sheet,oldId);
  const oldRaw=String(
    props.getProperty(getRequestPropertyKey_(oldId))||''
  );
  const raw=String(props.getProperty(getRequestPropertyKey_(id))||'');
  let rec=null;
  try{rec=raw?JSON.parse(raw):null;}catch(_){}
  const stable=first.state===second.state &&
    first.revision===second.revision &&
    (first.state==='ABSENT'||(
      first.latest.digest===second.latest.digest &&
      JSON.stringify(first.latest.body)===
        JSON.stringify(second.latest.body)
    ));
  const journalReady=stable&&first.state==='READY'&&
    first.revision===2;
  let targetVerified=false;
  if(rec&&rec.spreadsheetId){
    try {
      validateUpdateTargetDriveFile_(
        rec.spreadsheetId,VAA_QA_G4_CONFIG_.testOutputId
      );
      targetVerified=true;
    }catch(_){}
  }
  const receiptReady=!!rec && rec.requestId===id &&
    rec.operationMode==='CREATE' && rec.status==='READY' &&
    rec.stage==='READY' && targetVerified;
  const journalMatches=receiptReady&&journalReady&&
    JSON.stringify(first.latest.body.receipt)===raw;
  let datastoreExact=false;
  if(journalMatches){
    try{
      const book=SpreadsheetApp.openById(rec.spreadsheetId);
      const actual=vaaQaG5ReadTestDataStore_(book);
      const expected=VAAAppendMergeCore.merge({
        mode:'REPLACE',
        incoming:vaaQaLedgerV2RetestPayload_().datasets,
        maxRows:API_CONFIG.MAX_DATASET_ROWS
      });
      datastoreExact=
        JSON.stringify(actual.applicationData)===
          JSON.stringify(expected.applicationData) &&
        JSON.stringify(actual.jobAnalysisMaster)===
          JSON.stringify(expected.jobAnalysisMaster) &&
        actual.applicationData.rows.length===1 &&
        actual.jobAnalysisMaster.rows.length===1;
    }catch(_){}
  }
  const v1=vaaLedgerReadyLookupFromSheet_(
    tabs.readySheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const newV1=vaaLedgerReadyLookupFromSheet_(tabs.readySheet,id);
  const historicalAfter=vaaQaLedgerE2EHistorySnapshot_(props);
  const out={
    phase:'LEDGER_V2_RETEST_INSPECT_READ_ONLY',
    strictReadOnly:true,
    independentJournalReads:2,
    newJournalState:first.state,
    journalRevision:first.revision||0,
    journalStableAcrossReads:stable,
    newJournalReady:journalReady,
    newReceiptExists:!!raw,
    newReceiptReady:receiptReady,
    journalMatchesNewReceipt:journalMatches,
    newWorkbookDataVerified:datastoreExact,
    oldReservationPreserved:
      old.state==='RESERVED'&&old.revision===1,
    oldErrorReceiptPreserved:!!oldRaw,
    originalFourReadyPreserved:
      vaaQaLedgerE2EHistoryValid_(historical),
    historicalReadyUnchangedDuringInspection:
      vaaQaLedgerE2EHistoryEqual_(historical,historicalAfter),
    v1OriginalReadyPreserved:v1.state==='FOUND',
    noNewV1Row:newV1.state==='NOT_FOUND',
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,props.getProperties()),
    actualDoPostInvoked:false,
    actualJournalWrite:false,
    cleanupAuthorized:false,
    retryAuthorized:false
  };
  out.pass=!!(
    out.newJournalReady && out.journalRevision===2 &&
    out.journalStableAcrossReads &&
    out.newReceiptReady && out.journalMatchesNewReceipt &&
    out.newWorkbookDataVerified &&
    out.oldReservationPreserved &&
    out.oldErrorReceiptPreserved &&
    out.originalFourReadyPreserved &&
    out.historicalReadyUnchangedDuringInspection &&
    out.v1OriginalReadyPreserved &&
    out.noNewV1Row &&
    out.scriptPropertiesUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_RETEST_INSPECT '+
    JSON.stringify(out));
  return out;
}
