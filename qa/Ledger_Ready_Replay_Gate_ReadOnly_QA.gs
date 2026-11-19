/**
 * TEST ledger READY read-through gate audit — READ ONLY.
 *
 * Uses the G6-D synthetic target and the already saved one-row private
 * TEST ledger. Never changes REAL Script Properties, does not enable
 * VAA_REQUEST_LEDGER_REPLAY_MODE in the real TEST project, never calls
 * doPost or creates/updates worksheets/Drive files.
 *
 * Requires central-api/21_Request_Ready_Ledger_Replay_Gate.gs plus the
 * previous Ledger_Ready_Synthetic_Sheets_Test_QA.gs and G4/G6-D QA.
 */
function vaaQaLedgerReplayGateInspectReadOnly() {
  const real=vaaQaG4IsolatedConfig_();
  const before=real.getProperties();
  const prior=vaaQaLedgerReadySyntheticInspectReadOnly();
  if(!prior.pass ||
     prior.archiveRowCount!==1 ||
     prior.historicReadyReceipts!==4 ||
     !prior.replayResponseFromLedgerVerified) {
    throw new Error('QA_LEDGER_REPLAY_PREVIOUS_ARCHIVE_NOT_READY');
  }
  const testId=VAA_QA_LEDGER_READY_SYNTHETIC_ID_;
  const fake={
    getProperty:function(key) {
      if(key===VAA_LEDGER_REPLAY_MODE_PROPERTY_) {
        return VAA_LEDGER_REPLAY_TEST_MODE_;
      }
      if(key===VAA_LEDGER_REPLAY_TEST_ROOT_PROPERTY_) {
        return VAA_QA_G4_CONFIG_.testRootId;
      }
      if(key===VAA_LEDGER_REPLAY_TEST_OUTPUT_PROPERTY_) {
        return VAA_QA_G4_CONFIG_.testOutputId;
      }
      if(key===VAA_LEDGER_REPLAY_TEST_REQUEST_PROPERTY_) {
        return testId;
      }
      if(key===VAA_LEDGER_READY_PROPERTY_) {
        return real.getProperty(key);
      }
      if(key===getRequestPropertyKey_(testId))return null;
      return null;
    },
    setProperty:function() {
      throw new Error('QA_LEDGER_REPLAY_PROPERTIES_WRITE_FORBIDDEN');
    },
    deleteProperty:function() {
      throw new Error('QA_LEDGER_REPLAY_PROPERTIES_DELETE_FORBIDDEN');
    }
  };
  const replay=vaaLedgerReplayDecisionReadOnly_(
    fake,testId,'CREATE','','',''
  );
  const replayGood=replay.state==='READY' &&
    replay.record.requestId===testId &&
    replay.record.status==='READY' &&
    replay.record.stage==='READY';
  const replayResponse=replayGood ?
    buildReadyResponse_(replay.record,testId,true,Date.now()):null;
  const responseGood=!!replayResponse &&
    replayResponse.ok===true &&
    replayResponse.reused===true &&
    replayResponse.operationMode==='CREATE' &&
    replayResponse.status==='READY';

  const missingId='QA_LEDGER_READY_NOT_IN_ARCHIVE_20261119_V1';
  const missingFake={
    getProperty:function(key) {
      if(key===VAA_LEDGER_REPLAY_TEST_REQUEST_PROPERTY_)return missingId;
      return fake.getProperty(key);
    }
  };
  const missing=vaaLedgerReplayDecisionReadOnly_(
    missingFake,missingId,'CREATE','','',''
  );
  const wrongMode=vaaLedgerReplayDecisionReadOnly_(
    fake,testId,'UPDATE',replayGood?replay.record.spreadsheetId:'',
    'APPEND',''
  );
  const wrongId=vaaLedgerReplayDecisionReadOnly_(
    fake,missingId,'CREATE','','',''
  );
  const offFake={
    getProperty:function(key) {
      if(key===VAA_LEDGER_REPLAY_MODE_PROPERTY_)return '';
      return fake.getProperty(key);
    }
  };
  const defaultOff=vaaLedgerReplayDecisionReadOnly_(
    offFake,testId,'CREATE','','',''
  );
  const modeOffInRealTest=String(
    real.getProperty(VAA_LEDGER_REPLAY_MODE_PROPERTY_)||''
  ).trim()==='';
  const after=real.getProperties();
  const result={
    phase:'LEDGER_READY_REPLAY_GATE_READ_ONLY',
    strictReadOnly:true,
    previousSheetsArchiveInspectPass:prior.pass,
    syntheticArchiveRowCount:prior.archiveRowCount,
    historicalReadyReceipts:prior.historicReadyReceipts,
    testModeOnlyEnabledInMemory:true,
    realTestReplayFlagStillOff:modeOffInRealTest,
    missingRealSyntheticRequestProperty:
      !real.getProperty(getRequestPropertyKey_(testId)),
    archivedReadySelected:replayGood,
    replayResponseFromLedgerReady:responseGood,
    unknownRequestBlocked:
      missing.state==='HALT' &&
      missing.code==='LEDGER_REPLAY_NOT_FOUND_TEST_ONLY',
    changedOperationBlocked:
      wrongMode.state==='HALT' &&
      wrongMode.code==='REQUEST_TARGET_MISMATCH',
    nonAllowlistedRequestBlocked:
      wrongId.state==='HALT' &&
      wrongId.code==='LEDGER_REPLAY_TEST_SCOPE_DENIED',
    defaultOffPreservesLegacy:
      defaultOff.state==='DISABLED',
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,after),
    actualPostInvoked:false,
    actualCreateOrUpdatePerformed:false,
    actualReceiptDeleted:false,
    ledgerRowWritten:false,
    cleanupAuthorized:false
  };
  result.pass=!!(
    result.previousSheetsArchiveInspectPass &&
    result.syntheticArchiveRowCount===1 &&
    result.historicalReadyReceipts===4 &&
    result.realTestReplayFlagStillOff &&
    result.missingRealSyntheticRequestProperty &&
    result.archivedReadySelected &&
    result.replayResponseFromLedgerReady &&
    result.unknownRequestBlocked &&
    result.changedOperationBlocked &&
    result.nonAllowlistedRequestBlocked &&
    result.defaultOffPreservesLegacy &&
    result.scriptPropertiesUnchanged
  );
  console.log('VAA_QA_LEDGER_REPLAY_GATE '+JSON.stringify(result));
  return result;
}
