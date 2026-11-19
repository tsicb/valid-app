/**
 * V2 journal/doPost bridge. Strictly TEST-only and default OFF.
 *
 * Only an EXACT allowlisted synthetic request can enter journal mode.
 * For all regular requests (mode unset/OFF), old doPost behavior is unchanged.
 *
 * The TEST gate needs the separate G4 TEST configuration and both V2/READY
 * journals in the private TEST root. This guard fails closed if the QA
 * configuration is absent, the roots disagree or the allowlist is missing.
 *
 * All decisions are taken UNDER doPost's ScriptLock. The reserve write MUST
 * be verified before SpreadsheetApp.create, UPDATE lease, or REQ_ writes.
 * A prior RESERVED, ERROR, malformed or partial journal is never retried.
 *
 * Never treat this as a PRODUCTION cutover, automatic recovery or permission
 * to delete any Script Property. The final READY is written to both REQ_
 * and journal before a success response is returned.
 */
const VAA_JOURNAL_DOP_MODE_PROP_='VAA_JOURNAL_DOP_MODE';
const VAA_JOURNAL_DOP_TEST_MODE_='TEST_ONE_SYNTHETIC_REQUEST_V1';
const VAA_JOURNAL_DOP_ID_PROP_='VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID';

function vaaLedgerDopMode_(props) {
  const mode=String(
    props.getProperty(VAA_JOURNAL_DOP_MODE_PROP_)||''
  ).trim();
  if(!mode||mode==='OFF')return 'DISABLED';
  if(mode!==VAA_JOURNAL_DOP_TEST_MODE_)return 'INVALID';
  return 'ENABLED';
}

function vaaLedgerDopScopeCode_(props,id,operationMode) {
  const allowed=String(
    props.getProperty(VAA_JOURNAL_DOP_ID_PROP_)||''
  ).trim();
  const qa=
    typeof VAA_QA_G4_CONFIG_!=='undefined' ?
      VAA_QA_G4_CONFIG_ : null;
  if(!qa || !qa.testRootId || !qa.testOutputId ||
     !/^QA_JOURNAL_E2E_(CREATE|UPDATE)_[0-9]{8}_V[12]$/.test(id) ||
     allowed!==id ||
     (operationMode==='CREATE' &&
      id.indexOf('QA_JOURNAL_E2E_CREATE_')!==0) ||
     (operationMode==='UPDATE' &&
      id.indexOf('QA_JOURNAL_E2E_UPDATE_')!==0) ||
     API_CONFIG.ROOT_FOLDER_ID!==qa.testRootId ||
     API_CONFIG.SHEET_OUTPUT_FOLDER_ID!==qa.testOutputId ||
     props.getProperty(VAA_LEDGER_JOURNAL_MODE_PROP_) !==
       VAA_LEDGER_JOURNAL_TEST_MODE_ ||
     props.getProperty(VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_) !==
       qa.testRootId ||
     props.getProperty(VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_) !==
       qa.testOutputId) {
    return 'JOURNAL_DOP_TEST_SCOPE_DENIED';
  }
  return '';
}

function vaaLedgerDopReceiptMatches_(record, id, mode, target,
  strategy,digest,outputFolder) {
  if(!record || record.requestId!==id ||
     record.status!=='READY' || record.stage!=='READY' ||
     record.operationMode!==mode ||
     !record.spreadsheetId) return false;
  if(mode==='UPDATE' && (
    record.targetSpreadsheetId!==target ||
    record.spreadsheetId!==target ||
    record.updateStrategy!==strategy ||
    record.updatePayloadDigest!==digest
  ))return false;
  if(mode==='CREATE' && target)return false;
  try{
    const file=DriveApp.getFileById(record.spreadsheetId);
    return file.getMimeType()===MimeType.GOOGLE_SHEETS &&
      fileIsInManagedOutputTree_(file,outputFolder);
  } catch(_){return false;}
}

/**
 * Under doPost's existing ScriptLock. Result: DISABLED | HALT | READY |
 * ADMITTED. ADMITTED is valid ONLY after the RESERVED sheet write and
 * its readback verification have both completed.
 */
function vaaLedgerDopDecideUnderLock_(props, id,mode,target,
  strategy,digest,storedReceiptExists) {
  const setting=vaaLedgerDopMode_(props);
  // A TEST requestId once reserved in the journal must NOT fall back to
  // legacy new-request admission if an operator flips the mode OFF.
  // The reserved test namespace stays fenced even without configuration.
  if(setting==='DISABLED') {
    return /^QA_JOURNAL_E2E_(CREATE|UPDATE)_/.test(id) ?
      {state:'HALT',code:'JOURNAL_DOP_SYNTHETIC_FENCE'} :
      {state:'DISABLED'};
  }
  if(setting!=='ENABLED')return {
    state:'HALT',code:'JOURNAL_DOP_MODE_INVALID'
  };
  const scopeError=vaaLedgerDopScopeCode_(props,id,mode);
  if(scopeError)return {state:'HALT',code:scopeError};

  try{
    vaaLedgerJournalAssertTestScope_(props);
    const tabs=vaaLedgerJournalOpenReadOnly_(props);
    const archived=vaaLedgerReadyLookupFromSheet_(
      tabs.readySheet,id
    );
    const modern=vaaLedgerJournalLookupFromSheet_(
      tabs.sheet,id
    );
    const raw=props.getProperty(getRequestPropertyKey_(id));
    // The caller and the journal must observe the same REQ_ snapshot under
    // this ScriptLock. A mismatch means doPost cannot safely proceed.
    if(!!raw!==!!storedReceiptExists) {
      return {state:'HALT',code:'JOURNAL_DOP_PROPERTY_RACE'};
    }

    if(modern.state==='READY' ||
       (modern.state==='ABSENT' && archived.state==='FOUND')) {
      const record=modern.state==='READY' ?
        modern.latest.body.receipt:archived.record;
      if(archived.state==='FOUND' && modern.state==='READY' &&
         JSON.stringify(archived.record)!==JSON.stringify(record)) {
        return {state:'HALT',code:'JOURNAL_DOP_ARCHIVE_CONFLICT'};
      }
      if(raw && raw!==JSON.stringify(record)) {
        return {state:'HALT',code:'JOURNAL_DOP_PROPERTY_CONFLICT'};
      }
      if(!vaaLedgerDopReceiptMatches_(record,id,mode,target,
        strategy,digest,API_CONFIG.SHEET_OUTPUT_FOLDER_ID)) {
        return {state:'HALT',code:'JOURNAL_DOP_READY_UNVERIFIED'};
      }
      return {state:'READY',record:record};
    }

    if(modern.state!=='ABSENT') {
      return {state:'HALT',code:'JOURNAL_DOP_REQUEST_RESERVED'};
    }
    if(archived.state!=='NOT_FOUND' || raw) {
      return {state:'HALT',code:'JOURNAL_DOP_RECEIPT_UNVERIFIED'};
    }
    const budget=vaaCheckNewRequestCapacityReadOnly_(props);
    if(!budget.allowed) {
      return {state:'HALT',code:'PROPERTY_CAPACITY_NEAR_LIMIT'};
    }
    const request={
      requestId:id, operationMode:mode,
      targetSpreadsheetId:mode==='UPDATE'?target:'',
      updateStrategy:mode==='UPDATE'?strategy:'',
      updatePayloadDigest:mode==='UPDATE'?digest:''
    };
    const reservation=vaaLedgerJournalReserveUnderLock_(props,request);
    if(reservation.state!=='RESERVED'||reservation.revision!==1) {
      return {state:'HALT',code:'JOURNAL_DOP_RESERVE_UNVERIFIED'};
    }
    return {state:'ADMITTED'};
  } catch(_){
    // Includes a lost-response append: it MAY have committed. No retry.
    return {state:'HALT',code:'JOURNAL_DOP_UNVERIFIED'};
  }
}

/** After REQ_ is durably READY, append READY event with a fresh ScriptLock.
 * UPDATE lease must be released before this call. On failure: leave REQ_
 * and RESERVED event untouched, return HALT, NEVER start CREATE again.
 */
function vaaLedgerDopFinalizeReady_(props,id,mode) {
  const setting=vaaLedgerDopMode_(props);
  if(setting==='DISABLED')return {state:'DISABLED'};
  if(setting!=='ENABLED')return {
    state:'HALT',code:'JOURNAL_DOP_MODE_INVALID'
  };
  const scopeError=vaaLedgerDopScopeCode_(props,id,mode);
  if(scopeError)return {state:'HALT',code:scopeError};
  const lock=LockService.getScriptLock();
  try{
    lock.waitLock(20000);
    const verified=vaaLedgerJournalFinalizeReadyUnderLock_(
      props,id
    );
    if(verified.state!=='READY'||verified.revision!==2) {
      return {state:'HALT',code:'JOURNAL_DOP_FINALIZE_UNVERIFIED'};
    }
    return {state:'READY'};
  } catch(_){
    return {state:'HALT',code:'JOURNAL_DOP_FINALIZE_UNVERIFIED'};
  } finally {
    try{lock.releaseLock();}catch(_){}
  }
}
