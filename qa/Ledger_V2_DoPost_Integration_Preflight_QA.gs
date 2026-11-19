/**
 * V2 doPost integration: READ-ONLY TEST environment inspection.
 *
 * This never calls doPost or any append/RESERVE/READY mutation function.
 * Requires TEST API_CONFIG folders, the existing V1 synthetic READY row,
 * an empty journal_v2 tab and no real TEST cutover flags enabled.
 *
 * Run before proposing the controlled, one-request end-to-end TEST.
 */
const VAA_QA_JOURNAL_E2E_CREATE_ID_=
  'QA_JOURNAL_E2E_CREATE_20261119_V1';

function vaaQaJournalV2DoPostPreflightReadOnly() {
  const real=vaaQaG4IsolatedConfig_();
  const before=real.getProperties();
  const archive=vaaQaLedgerReadySyntheticInspectReadOnly();
  if(!archive.pass || archive.archiveRowCount!==1 ||
     archive.historicReadyReceipts!==4) {
    throw new Error('QA_JOURNAL_V2_READY_ARCHIVE_UNVERIFIED');
  }
  const privateSheet=vaaQaLedgerReadyCheckPrivateTestLedger_(real);
  const tabs=vaaLedgerJournalOpenReadOnly_(real);
  if(tabs.readySheet!==privateSheet &&
     tabs.readySheet.getSheetName()!==privateSheet.getSheetName()) {
    throw new Error('QA_JOURNAL_V2_READY_TAB_CHANGED');
  }
  const candidate=VAA_QA_JOURNAL_E2E_CREATE_ID_;
  const existing=vaaLedgerJournalLookupFromSheet_(
    tabs.sheet,candidate
  );
  const headerOnly=Number(tabs.sheet.getLastRow())===1;
  const noCandidateReq=!real.getProperty(getRequestPropertyKey_(
    candidate
  ));
  const realModeOff=!String(real.getProperty(
    VAA_JOURNAL_DOP_MODE_PROP_
  )||'').trim() ||
    String(real.getProperty(VAA_JOURNAL_DOP_MODE_PROP_)||'')==='OFF';
  const realV2ModeOff=!String(real.getProperty(
    VAA_LEDGER_JOURNAL_MODE_PROP_
  )||'').trim() ||
    String(real.getProperty(VAA_LEDGER_JOURNAL_MODE_PROP_)||'')==='OFF';
  // Set the needed flags IN MEMORY ONLY to inspect strict TEST scope.
  const simulated={
    getProperty:function(key) {
      if(key===VAA_JOURNAL_DOP_MODE_PROP_)
        return VAA_JOURNAL_DOP_TEST_MODE_;
      if(key===VAA_JOURNAL_DOP_ID_PROP_)return candidate;
      if(key===VAA_LEDGER_JOURNAL_MODE_PROP_)
        return VAA_LEDGER_JOURNAL_TEST_MODE_;
      if(key===VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_)
        return VAA_QA_G4_CONFIG_.testRootId;
      if(key===VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_)
        return VAA_QA_G4_CONFIG_.testOutputId;
      return real.getProperty(key);
    },
    setProperty:function(){
      throw new Error('QA_V2_READ_ONLY_PROPERTIES_WRITE');
    },
    deleteProperty:function(){
      throw new Error('QA_V2_READ_ONLY_PROPERTIES_DELETE');
    }
  };
  const scopePass=vaaLedgerDopScopeCode_(
    simulated,candidate,'CREATE'
  )==='';
  const foreignIdDenied=vaaLedgerDopScopeCode_(
    simulated,'OTHER_ID','CREATE'
  )==='JOURNAL_DOP_TEST_SCOPE_DENIED';
  const modeOffSyntheticFence=(()=>{
    const disabled={
      getProperty:function(key) {
        return key===VAA_JOURNAL_DOP_MODE_PROP_ ?
          'OFF':simulated.getProperty(key);
      }
    };
    return vaaLedgerDopDecideUnderLock_(
      disabled,candidate,'CREATE','','','',false
    ).code==='JOURNAL_DOP_SYNTHETIC_FENCE';
  })();
  const after=real.getProperties();
  const out={
    phase:'LEDGER_V2_DOP_INTEGRATION_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,
    historicalReadyReceipts:archive.historicReadyReceipts,
    existingV1ReadyArchiveVerified:archive.pass,
    v1ReadyArchiveRowCount:archive.archiveRowCount,
    v2JournalHasHeaderOnly:headerOnly,
    v2CandidateAbsent:existing.state==='ABSENT',
    syntheticIdNotInRealProperties:noCandidateReq,
    realDoPostV2ModeOff:realModeOff,
    realV2JournalModeOff:realV2ModeOff,
    inMemoryTestScopePass:scopePass,
    unrelatedRequestIdDenied:foreignIdDenied,
    syntheticIdFencedWhenModeOff:modeOffSyntheticFence,
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,after),
    actualDoPostInvoked:false,
    actualReservationWritten:false,
    actualReadyWritten:false,
    actualCreateOrUpdatePerformed:false,
    cleanupAuthorized:false,
    testModeActivationAuthorized:false,
    productionChanged:false
  };
  out.pass=!!(
    out.historicalReadyReceipts===4 &&
    out.existingV1ReadyArchiveVerified &&
    out.v1ReadyArchiveRowCount===1 &&
    out.v2JournalHasHeaderOnly &&
    out.v2CandidateAbsent &&
    out.syntheticIdNotInRealProperties &&
    out.realDoPostV2ModeOff &&
    out.realV2JournalModeOff &&
    out.inMemoryTestScopePass &&
    out.unrelatedRequestIdDenied &&
    out.syntheticIdFencedWhenModeOff &&
    out.scriptPropertiesUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_DOP_PREFLIGHT '+JSON.stringify(out));
  return out;
}
