/**
 * V2 REAL-GOOGLE-TEST synthetic CREATE, one shot only.
 *
 * Designed for the existing isolated TEST Apps Script (never PROD).
 *  - PRECHECK: read-only; requires explicit TEST flags configured and the
 *    journal_v2 tab still empty (NOT suitable after first write).
 *  - CREATE ONCE: calls canonical doPost via existing G4 synthetic payload,
 *    but uses a completely new E2E requestId/company. This writes a TEST
 *    workbook, one NEW REQ_ receipt and 2 journal_v2 events if successful.
 *  - INSPECT: READ-ONLY; safe after PASS, FAIL, timeout, lost response.
 *
 * Never repeat CREATE ONCE, including after exceptions/timeouts. No
 * deletion, cleanup, CAS repair, automatic update/retry or production access.
 */
const VAA_QA_LEDGER_E2E_CREATE_ = Object.freeze({
  requestId:'QA_JOURNAL_E2E_CREATE_20261119_V1',
  company:'QA_JOURNAL_E2E_SYNTHETIC_CREATE_ONLY'
});

function vaaQaLedgerE2EHistoricIds_() {
  return [
    VAA_QA_G4_CONFIG_.requestId,
    VAA_QA_G5_APPEND_REQUEST_ID_,
    VAA_QA_G5_REPLACE_REQUEST_ID_,
    VAA_QA_G6C_CONFIG_.createRequestId
  ];
}

function vaaQaLedgerE2EHistorySnapshot_(props) {
  return vaaQaLedgerE2EHistoricIds_().map(function(id) {
    return String(props.getProperty(getRequestPropertyKey_(id))||'');
  });
}

function vaaQaLedgerE2EHistoryValid_(snapshot) {
  const ids=vaaQaLedgerE2EHistoricIds_();
  return snapshot.length===4 && snapshot.every(function(raw,i) {
    if(!raw)return false;
    try {
      const r=JSON.parse(raw);
      return r.requestId===ids[i] && r.status==='READY' &&
        r.stage==='READY' && !!r.spreadsheetId;
    }catch(_){return false;}
  });
}

function vaaQaLedgerE2EHistoryEqual_(a,b) {
  return a.length===b.length &&
    a.every(function(x,i){return !!x && x===b[i];});
}

function vaaQaLedgerE2ECreatePayload_() {
  // G4 payload contains one synthetic applicant and one synthetic job.
  const payload=vaaQaG4SyntheticPayload_();
  payload.requestId=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  payload.companyDisplayName=VAA_QA_LEDGER_E2E_CREATE_.company;
  payload.outputFolderId=VAA_QA_G4_CONFIG_.testOutputId;
  return payload;
}

function vaaQaLedgerE2ECreatePreflightReadOnly() {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const hist=vaaQaLedgerE2EHistorySnapshot_(props);
  const payload=vaaQaLedgerE2ECreatePayload_();
  const valid=validateEnvelope_(payload);
  const budget=vaaCheckNewRequestCapacityReadOnly_(props);
  const readySheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const id=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const lookup=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  const archive=vaaLedgerReadyLookupFromSheet_(readySheet,id);
  const previousSynthetic=vaaLedgerReadyLookupFromSheet_(
    readySheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const onMode=vaaLedgerDopMode_(props)==='ENABLED';
  const scope=vaaLedgerDopScopeCode_(props,id,'CREATE');
  const oldV1ModeOff=!String(props.getProperty(
    VAA_LEDGER_REPLAY_MODE_PROPERTY_
  )||'').trim() || String(props.getProperty(
    VAA_LEDGER_REPLAY_MODE_PROPERTY_
  )||'')==='OFF';
  const after=props.getProperties();
  const out={
    phase:'LEDGER_V2_E2E_CREATE_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,
    isolatedTestFoldersConfirmed:true,
    canonicalPayloadValid:valid.ok===true,
    existingHistoricReadyCount:vaaQaLedgerE2EHistoryValid_(hist)?4:0,
    existingHistoricReadyUnchanged:
      vaaQaLedgerE2EHistoryEqual_(
        hist,vaaQaLedgerE2EHistorySnapshot_(props)
      ),
    v1OriginalSyntheticRowVerified:previousSynthetic.state==='FOUND',
    v1NewRequestAbsent:archive.state==='NOT_FOUND',
    v2JournalHeaderOnly:tabs.sheet.getLastRow()===1,
    v2NewRequestAbsent:lookup.state==='ABSENT',
    newRequestPropertyAbsent:!props.getProperty(
      getRequestPropertyKey_(id)
    ),
    testModeEnabled:onMode,
    exactSingleRequestScopeApproved:scope==='',
    oldReadyOnlyReplayModeOff:oldV1ModeOff,
    capacityAllowed:budget.allowed===true,
    scriptPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,after),
    actualPostInvoked:false,
    actualCreatePerformed:false,
    actualRequestReceiptWritten:false,
    actualJournalWritten:false,
    cleanupAuthorized:false,
    automaticRetryAuthorized:false,
    productionChanged:false
  };
  out.pass=!!(
    out.canonicalPayloadValid &&
    out.existingHistoricReadyCount===4 &&
    out.existingHistoricReadyUnchanged &&
    out.v1OriginalSyntheticRowVerified &&
    out.v1NewRequestAbsent &&
    out.v2JournalHeaderOnly &&
    out.v2NewRequestAbsent &&
    out.newRequestPropertyAbsent &&
    out.testModeEnabled &&
    out.exactSingleRequestScopeApproved &&
    out.oldReadyOnlyReplayModeOff &&
    out.capacityAllowed &&
    out.scriptPropertiesUnchanged
  );
  console.log('VAA_QA_LEDGER_V2_E2E_CREATE_PREFLIGHT '+
    JSON.stringify(out));
  return out;
}

/**
 * ONE-SHOT real doPost: the only workbook-creating public entrypoint.
 * Requires pass:true immediately before use. NEVER rerun regardless of
 * result; inspect the journal and REQ_ instead.
 */
function vaaQaLedgerE2ECreateOnce() {
  const pre=vaaQaLedgerE2ECreatePreflightReadOnly();
  if(!pre.pass)throw new Error('QA_LEDGER_E2E_CREATE_PREFLIGHT_FAILED');
  const props=vaaQaG4IsolatedConfig_();
  const before=vaaQaLedgerE2EHistorySnapshot_(props);
  const payload=vaaQaLedgerE2ECreatePayload_();
  const response=vaaQaG4Invoke_(payload);
  const inspection=vaaQaLedgerE2ECreateInspectReadOnly();
  const out={
    phase:'LEDGER_V2_E2E_CREATE_ONCE',
    actualPostInvoked:true,
    responseOk:response.ok===true,
    responseCode:String(response.code||''),
    responseReady:response.status==='READY',
    responseReused:response.reused===true,
    responseMatchesVerifiedTestReceipt:
      inspection.newReceiptReady &&
      response.spreadsheetId===inspection.verifiedTargetId,
    journalReadyAfterPost:inspection.journalReady,
    journalRevision:inspection.journalRevision,
    historicReadyUnchanged:
      vaaQaLedgerE2EHistoryEqual_(
        before,vaaQaLedgerE2EHistorySnapshot_(props)
      ),
    noCleanupPerformed:true,
    automaticRetryAuthorized:false,
    actualUpdatePerformed:false,
    productionChanged:false
  };
  out.pass=!!(out.responseOk && out.responseReady &&
    !out.responseReused &&
    out.responseMatchesVerifiedTestReceipt &&
    out.journalReadyAfterPost &&
    out.journalRevision===2 &&
    out.historicReadyUnchanged &&
    inspection.pass);
  // No requestId, spreadsheet ID, URLs, token, applicant rows or file names.
  console.log('VAA_QA_LEDGER_V2_E2E_CREATE '+
    JSON.stringify(out, function(k,v) {
      return k==='verifiedTargetId'?undefined:v;
    }));
  return out;
}

/**
 * Safe after uncertain or completed one-shot. V2 RESERVED alone is NOT
 * considered success or permission for a retry.
 */
function vaaQaLedgerE2ECreateInspectReadOnly() {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const hist1=vaaQaLedgerE2EHistorySnapshot_(props);
  const readySheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const id=VAA_QA_LEDGER_E2E_CREATE_.requestId;
  const first=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  const second=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  const raw=props.getProperty(getRequestPropertyKey_(id));
  let receipt=null;
  try{receipt=raw?JSON.parse(raw):null;}catch(_){}
  const journalStable=first.state===second.state &&
    first.revision===second.revision &&
    (
      first.state==='ABSENT' ||
      (first.latest.digest===second.latest.digest &&
       JSON.stringify(first.latest.body)===
       JSON.stringify(second.latest.body))
    );
  const journalReady=journalStable && first.state==='READY' &&
    first.revision===2;
  let targetValid=false;
  if(receipt && receipt.spreadsheetId) {
    try {
      validateUpdateTargetDriveFile_(
        receipt.spreadsheetId,VAA_QA_G4_CONFIG_.testOutputId
      );
      targetValid=true;
    }catch(_){}
  }
  const receiptReady=!!receipt &&
    receipt.requestId===id && receipt.status==='READY' &&
    receipt.stage==='READY' &&
    receipt.operationMode==='CREATE' &&
    targetValid;
  const matchesJournal=receiptReady && journalReady &&
    JSON.stringify(first.latest.body.receipt)===raw;
  const archive=vaaLedgerReadyLookupFromSheet_(readySheet,id);
  const oldSynthetic=vaaLedgerReadyLookupFromSheet_(
    readySheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const hist2=vaaQaLedgerE2EHistorySnapshot_(props);
  const after=props.getProperties();
  const out={
    phase:'LEDGER_V2_E2E_CREATE_INSPECT_READ_ONLY',
    strictReadOnly:true,
    independentJournalReadPasses:2,
    journalStableAcrossReads:journalStable,
    journalState:first.state,
    journalRevision:first.revision||0,
    journalReady:journalReady,
    newReceiptExists:!!raw,
    newReceiptReady:receiptReady,
    verifiedTargetInIsolatedTestOutput:targetValid,
    readyJournalMatchesReceipt:matchesJournal,
    v1PreviousSyntheticRowPreserved:oldSynthetic.state==='FOUND',
    newRequestNotDuplicatedInV1:archive.state==='NOT_FOUND',
    historicReadyCount:vaaQaLedgerE2EHistoryValid_(hist1)?4:0,
    historicReadyUnchangedAcrossInspection:
      vaaQaLedgerE2EHistoryEqual_(hist1,hist2),
    scriptPropertiesUnchangedDuringInspection:
      vaaQaLedgerReadyPropsEqual_(before,after),
    actualPostInvoked:false,
    actualCreateOrUpdatePerformed:false,
    actualReceiptDeleted:false,
    actualJournalWritten:false,
    cleanupAuthorized:false,
    automaticRetryAuthorized:false
  };
  out.pass=!!(out.journalStableAcrossReads &&
    out.journalReady && out.journalRevision===2 &&
    receiptReady && matchesJournal &&
    out.v1PreviousSyntheticRowPreserved &&
    out.newRequestNotDuplicatedInV1 &&
    out.historicReadyCount===4 &&
    out.historicReadyUnchangedAcrossInspection &&
    out.scriptPropertiesUnchangedDuringInspection);
  // The target ID is returned ONLY to the internal one-shot caller; never
  // printed, even when a public inspector is run manually.
  const privateTargetId=receiptReady?receipt.spreadsheetId:'';
  console.log('VAA_QA_LEDGER_V2_E2E_CREATE_INSPECT '+
    JSON.stringify(out));
  Object.defineProperty(out,'verifiedTargetId',{
    value:privateTargetId,enumerable:false
  });
  return out;
}
