/**
 * READY ledger replay gate — TEST-ONLY cutover rehearsal.
 *
 * Disabled by default: no property means OFF and legacy doPost behavior
 * is unchanged. When explicitly enabled, ONE allowlisted synthetic request
 * can replay from a verified private TEST ledger even if REQ_ is absent.
 *
 * IMPORTANT: READY_ARCHIVE_V1 is NOT a complete new-request journal.
 * Therefore: when TEST gate is enabled and no archived READY exists, HALT,
 * never classify as "new". This test gate must NOT be used as production
 * admission control or as authority to delete any REQ_ property.
 *
 * Only call from doPost WHILE holding ScriptLock, AFTER real REQ_ absence
 * has been confirmed. This module has no mutation path.
 */
const VAA_LEDGER_REPLAY_MODE_PROPERTY_ =
  'VAA_REQUEST_LEDGER_REPLAY_MODE';
const VAA_LEDGER_REPLAY_TEST_MODE_ =
  'TEST_READY_REPLAY_ONLY_V1';
const VAA_LEDGER_REPLAY_TEST_ROOT_PROPERTY_ =
  'VAA_LEDGER_REPLAY_TEST_ROOT_ID';
const VAA_LEDGER_REPLAY_TEST_OUTPUT_PROPERTY_ =
  'VAA_LEDGER_REPLAY_TEST_OUTPUT_ID';
const VAA_LEDGER_REPLAY_TEST_REQUEST_PROPERTY_ =
  'VAA_LEDGER_REPLAY_TEST_REQUEST_ID';

function vaaLedgerReplayDecisionReadOnly_(
  props, requestId, operationMode, targetSpreadsheetId,
  updateStrategy, updateRequestDigest
) {
  const mode=String(
    props.getProperty(VAA_LEDGER_REPLAY_MODE_PROPERTY_)||''
  ).trim();
  if (!mode || mode==='OFF') return {state:'DISABLED'};
  if (mode!==VAA_LEDGER_REPLAY_TEST_MODE_) {
    return {state:'HALT',code:'LEDGER_REPLAY_CONFIG_INVALID'};
  }

  // Test-only admission: root, output, AND exactly one requestId must match.
  const testRoot=String(
    props.getProperty(VAA_LEDGER_REPLAY_TEST_ROOT_PROPERTY_)||''
  );
  const testOutput=String(
    props.getProperty(VAA_LEDGER_REPLAY_TEST_OUTPUT_PROPERTY_)||''
  );
  const allowedId=String(
    props.getProperty(VAA_LEDGER_REPLAY_TEST_REQUEST_PROPERTY_)||''
  );
  if (!testRoot || !testOutput || !allowedId ||
      testRoot===testOutput ||
      API_CONFIG.ROOT_FOLDER_ID!==testRoot ||
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID!==testOutput ||
      requestId!==allowedId) {
    return {state:'HALT',code:'LEDGER_REPLAY_TEST_SCOPE_DENIED'};
  }

  // Fail closed before lookup if any other actor creates an REQ_ receipt.
  if (props.getProperty(getRequestPropertyKey_(requestId))) {
    return {state:'HALT',code:'LEDGER_REPLAY_PROPERTY_COLLISION'};
  }

  try {
    const sheetId=String(
      props.getProperty(VAA_LEDGER_READY_PROPERTY_)||''
    ).trim();
    if (!sheetId || sheetId===testRoot ||
        sheetId===testOutput) {
      return {state:'HALT',code:'LEDGER_REPLAY_TEST_LEDGER_INVALID'};
    }
    const ledgerFile=DriveApp.getFileById(sheetId);
    if (ledgerFile.getMimeType()!==MimeType.GOOGLE_SHEETS ||
        ledgerFile.getSharingAccess()!==DriveApp.Access.PRIVATE) {
      return {state:'HALT',code:'LEDGER_REPLAY_TEST_LEDGER_INVALID'};
    }
    const parents=ledgerFile.getParents();
    let count=0,allTest=true;
    while(parents.hasNext()&&count<2) {
      const parent=parents.next();
      count++;
      if(parent.getId()!==testRoot)allTest=false;
    }
    if (count!==1 || !allTest) {
      return {state:'HALT',code:'LEDGER_REPLAY_TEST_LEDGER_INVALID'};
    }

    // Look up the FULL verified archived READY, never a partial record.
    const found=vaaLedgerReadyLookupReadOnly_(props,requestId);
    if(found.state!=='FOUND') {
      // READY_ARCHIVE_V1 has no PROCESSING/RESERVED journal.
      return {state:'HALT',code:'LEDGER_REPLAY_NOT_FOUND_TEST_ONLY'};
    }
    const rec=found.record;
    if (!rec || rec.status!=='READY'||rec.stage!=='READY') {
      return {state:'HALT',code:'LEDGER_REPLAY_RECORD_INVALID'};
    }
    const recMode=String(rec.operationMode||'').trim();
    if (recMode!==operationMode) {
      return {state:'HALT',code:'REQUEST_TARGET_MISMATCH'};
    }
    if (recMode==='UPDATE') {
      if (rec.targetSpreadsheetId!==targetSpreadsheetId ||
          rec.spreadsheetId!==targetSpreadsheetId) {
        return {state:'HALT',code:'REQUEST_TARGET_MISMATCH'};
      }
      const check=vaaValidateUpdateRequestRecord_(
        rec,updateStrategy,updateRequestDigest
      );
      if (!check.ok) return {state:'HALT',code:check.code};
    } else if (targetSpreadsheetId) {
      return {state:'HALT',code:'REQUEST_TARGET_MISMATCH'};
    }
    const target=DriveApp.getFileById(rec.spreadsheetId);
    if (target.getMimeType()!==MimeType.GOOGLE_SHEETS ||
        !fileIsInManagedOutputTree_(target,testOutput)) {
      return {state:'HALT',code:'LEDGER_REPLAY_TARGET_UNVERIFIED'};
    }
    return {state:'READY',record:rec};
  } catch (_) {
    // No external exception details or potentially sensitive IDs in logs.
    return {state:'HALT',code:'LEDGER_REPLAY_UNVERIFIED'};
  }
}
