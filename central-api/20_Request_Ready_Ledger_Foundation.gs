/**
 * Request receipt ledger — Phase 1: READY archival COPY, no migration.
 *
 * Dormant module. None of the existing doPost/read/write paths call this file.
 * It does not create a spreadsheet, delete REQ_ properties, switch replay
 * behavior, or run in PROD unless separately installed and invoked.
 *
 * Contract: an operator pre-creates a PRIVATE Google Spreadsheet with a
 * "receipts" tab and the exact seven headers below, and configures
 * VAA_REQUEST_LEDGER_SPREADSHEET_ID in the ISOLATED TEST Script Properties.
 * Never put the spreadsheet ID or the records in a public repository/log.
 *
 * This is a deliberately narrow append-only READY archive, NOT yet the
 * complete authoritative ledger for new requests and PROCESSING/ERROR.
 */
const VAA_LEDGER_READY_SHEET_ = 'receipts';
const VAA_LEDGER_READY_SCHEMA_ = 'READY_ARCHIVE_V1';
const VAA_LEDGER_READY_PROPERTY_ = 'VAA_REQUEST_LEDGER_SPREADSHEET_ID';
const VAA_LEDGER_READY_HEADERS_ = [
  'requestKey',
  'recordJson',
  'recordDigest',
  'revision',
  'updatedAt',
  'schemaVersion',
  'recordStatus'
];

function vaaLedgerReadyError_(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function vaaLedgerReadyRequestId_(value) {
  const id = String(value == null ? '' : value).trim();
  if (!id || id.length > 120) {
    throw vaaLedgerReadyError_('LEDGER_REQUEST_ID_INVALID');
  }
  return id;
}

function vaaLedgerReadyHash_(input) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(input),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    return ('0' + (byte & 255).toString(16)).slice(-2);
  }).join('');
}

/**
 * Fail CLOSED on absence of config, unavailable spreadsheet, missing sheet,
 * changed header, duplicate keys, invalid record, or bad digest.
 */
function vaaLedgerReadyOpenReadOnly_(props) {
  const id = String(
    props.getProperty(VAA_LEDGER_READY_PROPERTY_) || ''
  ).trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw vaaLedgerReadyError_('LEDGER_NOT_CONFIGURED');
  }
  let sheet;
  try {
    const book = SpreadsheetApp.openById(id);
    sheet = book.getSheetByName(VAA_LEDGER_READY_SHEET_);
  } catch (_) {
    throw vaaLedgerReadyError_('LEDGER_UNAVAILABLE');
  }
  if (!sheet) throw vaaLedgerReadyError_('LEDGER_SHEET_MISSING');
  let header;
  try {
    header = sheet.getRange(1, 1, 1, 7).getValues()[0];
  } catch (_) {
    throw vaaLedgerReadyError_('LEDGER_UNAVAILABLE');
  }
  if (!header || header.length !== 7 ||
      !VAA_LEDGER_READY_HEADERS_.every(function(name, i) {
        return header[i] === name;
      })) {
    throw vaaLedgerReadyError_('LEDGER_SCHEMA_MISMATCH');
  }
  return sheet;
}

function vaaLedgerReadyValidateRaw_(requestId, raw) {
  if (typeof raw !== 'string' || !raw) {
    throw vaaLedgerReadyError_('LEDGER_RECEIPT_INVALID');
  }
  let record;
  try { record = JSON.parse(raw); } catch (_) {
    throw vaaLedgerReadyError_('LEDGER_RECEIPT_INVALID');
  }
  const mode = record && record.operationMode;
  if (!record || Array.isArray(record) ||
      record.requestId !== requestId ||
      record.status !== 'READY' || record.stage !== 'READY' ||
      !record.spreadsheetId ||
      (mode !== 'CREATE' && mode !== 'UPDATE') ||
      (mode === 'UPDATE' && (
        !record.updatePayloadDigest ||
        (record.updateStrategy !== 'APPEND' &&
         record.updateStrategy !== 'REPLACE') ||
        !record.targetSpreadsheetId ||
        record.targetSpreadsheetId !== record.spreadsheetId
      ))) {
    throw vaaLedgerReadyError_('LEDGER_RECEIPT_INVALID');
  }
  return record;
}

function vaaLedgerReadyDecodeRow_(requestId, row) {
  if (!row || row.length < 7 ||
      row[0] !== vaaLedgerReadyHash_(requestId) ||
      typeof row[1] !== 'string' ||
      row[2] !== vaaLedgerReadyHash_(row[1]) ||
      Number(row[3]) !== 1 ||
      !String(row[4] || '') ||
      row[5] !== VAA_LEDGER_READY_SCHEMA_ ||
      row[6] !== 'READY') {
    throw vaaLedgerReadyError_('LEDGER_ROW_UNVERIFIED');
  }
  return {
    record: vaaLedgerReadyValidateRaw_(requestId, row[1]),
    raw: row[1],
    revision: 1
  };
}

/**
 * Exact-key lookup. NOT_FOUND means an accessible, valid ledger was checked;
 * missing/unavailable/corrupt/duplicate ledgers always THROW.
 *
 * DO NOT integrate NOT_FOUND into doPost until authoritative ledger coverage
 * and a fail-closed migration cutover have been reviewed.
 */
function vaaLedgerReadyLookupFromSheet_(sheet, requestId) {
  const id = vaaLedgerReadyRequestId_(requestId);
  let found;
  try {
    const last = sheet.getLastRow();
    if (last < 1) throw vaaLedgerReadyError_('LEDGER_SCHEMA_MISMATCH');
    if (last === 1) return {state: 'NOT_FOUND'};
    const range = sheet.getRange(2, 1, last - 1, 1);
    found = range.createTextFinder(
      vaaLedgerReadyHash_(id)
    ).matchEntireCell(true).matchCase(true).findAll();
  } catch (err) {
    if (err && err.code) throw err;
    throw vaaLedgerReadyError_('LEDGER_UNAVAILABLE');
  }
  if (found.length > 1) {
    throw vaaLedgerReadyError_('LEDGER_DUPLICATE_KEY');
  }
  if (found.length === 0) return {state: 'NOT_FOUND'};
  let row;
  try {
    row = sheet.getRange(found[0].getRow(), 1, 1, 7).getValues()[0];
  } catch (_) {
    throw vaaLedgerReadyError_('LEDGER_UNAVAILABLE');
  }
  const result = vaaLedgerReadyDecodeRow_(id, row);
  return {
    state: 'FOUND', record: result.record,
    raw: result.raw, revision: result.revision
  };
}

function vaaLedgerReadyLookupReadOnly_(props, requestId) {
  const sheet = vaaLedgerReadyOpenReadOnly_(props);
  return vaaLedgerReadyLookupFromSheet_(sheet, requestId);
}

/**
 * Insert-only, idempotent archive COPY. Caller MUST hold ScriptLock.
 * On write/response uncertainty, run a read-only lookup; NEVER delete the
 * original Script Property or blindly retry as if the row were absent.
 */
function vaaLedgerReadyCopyOneUnderLock_(props, requestId) {
  const id = vaaLedgerReadyRequestId_(requestId);
  const key = getRequestPropertyKey_(id);
  const raw = props.getProperty(key);
  vaaLedgerReadyValidateRaw_(id, raw);
  const record = JSON.parse(raw);
  if (isLeaseActive_(record) ||
      (record.operationMode === 'UPDATE' &&
       props.getProperty(vaaTargetUpdateLeaseKey_(
         record.targetSpreadsheetId
       )))) {
    throw vaaLedgerReadyError_('LEDGER_RECEIPT_ACTIVE');
  }
  if (!requestRecordFileExists_(record)) {
    throw vaaLedgerReadyError_('LEDGER_TARGET_UNVERIFIED');
  }

  const sheet = vaaLedgerReadyOpenReadOnly_(props);
  const existing = vaaLedgerReadyLookupFromSheet_(sheet, id);
  if (existing.state === 'FOUND') {
    if (existing.raw !== raw) {
      throw vaaLedgerReadyError_('LEDGER_EXISTING_CONFLICT');
    }
    return {state: 'VERIFIED_EXISTING', propertyPreserved: true};
  }

  if (props.getProperty(key) !== raw) {
    throw vaaLedgerReadyError_('LEDGER_SOURCE_CHANGED');
  }
  const row = [
    vaaLedgerReadyHash_(id), raw, vaaLedgerReadyHash_(raw),
    1, new Date().toISOString(), VAA_LEDGER_READY_SCHEMA_, 'READY'
  ];
  try {
    sheet.appendRow(row);
  } catch (_) {
    // A write can succeed and its response still fail. Never report "none".
    throw vaaLedgerReadyError_('LEDGER_WRITE_UNCERTAIN');
  }
  const verified = vaaLedgerReadyLookupFromSheet_(sheet, id);
  if (verified.state !== 'FOUND' || verified.raw !== raw ||
      props.getProperty(key) !== raw) {
    throw vaaLedgerReadyError_('LEDGER_WRITE_UNVERIFIED');
  }
  return {state: 'COPIED_AND_VERIFIED', propertyPreserved: true};
}

/**
 * Standalone manual TEST tool; NOT callable from doPost (which already
 * holds ScriptLock). No bulk loop, migration, deletion or automatic retry.
 * Intentionally emits neither requestId nor the protected receipt.
 */
function vaaLedgerReadyCopyOneStandalone_(requestId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = vaaLedgerReadyCopyOneUnderLock_(
      PropertiesService.getScriptProperties(), requestId
    );
    console.log('VAA_LEDGER_READY_COPY ' + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
