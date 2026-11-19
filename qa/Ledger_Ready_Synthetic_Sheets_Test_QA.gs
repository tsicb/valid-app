/**
 * READY archive ledger: real Google Sheets integration QA (ISOLATED TEST).
 *
 * Three public functions:
 *  1. vaaQaLedgerReadySyntheticPreflightReadOnly()  // before write
 *  2. vaaQaLedgerReadySyntheticCopyOnce()           // ONE SHEETS ROW WRITE
 *  3. vaaQaLedgerReadySyntheticInspectReadOnly()   // after/uncertain write
 *
 * Runs only in the already-separated TEST Apps Script with canonical central
 * API module 20 + G4/G5/G6-D read-only QA. No real requestId is written,
 * no historic REQ/lease is modified, no CAS/doPost/cleanup is invoked.
 *
 * The synthetic READY references G6-D's already-verified TEST workbook
 * only to validate the target file exists. It never edits that workbook.
 *
 * The ledger ID MUST be supplied by the TEST Script Property
 * VAA_REQUEST_LEDGER_SPREADSHEET_ID, NOT hardcoded in this repo.
 */
const VAA_QA_LEDGER_READY_SYNTHETIC_ID_ =
  'QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1';

function vaaQaLedgerReadyPropsEqual_(a,b) {
  const keysA=Object.keys(a).sort();
  const keysB=Object.keys(b).sort();
  return keysA.length===keysB.length &&
    keysA.every(function(k,i) {
      return k===keysB[i] && a[k]===b[k];
    });
}

/** Exact single-parent ownership: a real TEST-folder file, not the PROD root. */
function vaaQaLedgerReadyCheckPrivateTestLedger_(props) {
  const id=String(props.getProperty(VAA_LEDGER_READY_PROPERTY_)||'');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error('QA_LEDGER_CONFIG_REQUIRED');
  }
  const file=DriveApp.getFileById(id);
  if (file.getMimeType() !== MimeType.GOOGLE_SHEETS ||
      file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      file.getName() !==
      'valid-app｜READY履歴台帳｜隔離TEST（空台帳）') {
    throw new Error('QA_LEDGER_PRIVATE_FILE_NOT_VERIFIED');
  }
  const parents=file.getParents();
  let count=0;
  let correct=true;
  while(parents.hasNext() && count<2) {
    const parent=parents.next();
    count++;
    if(parent.getId()!==VAA_QA_G4_CONFIG_.testRootId)correct=false;
  }
  if(count!==1 || !correct ||
     id===VAA_QA_G4_CONFIG_.testRootId ||
     id===VAA_QA_G4_CONFIG_.testOutputId) {
    throw new Error('QA_LEDGER_TEST_FOLDER_NOT_VERIFIED');
  }
  return vaaLedgerReadyOpenReadOnly_(props);
}

/**
 * In-memory Properties adapter. A fabricated READY is the sole REQ_ value;
 * the real TEST Script Properties are only read for the ledger location.
 */
function vaaQaLedgerReadySyntheticSourceReadOnly_(realProps) {
  const domain=vaaQaG6DInspectFaultDomainReadOnly();
  if(!domain.pass || domain.readyCount!==4 ||
     !domain.dataStoreMatchesSynthetic ||
     !domain.historicalReceiptsStable ||
     !domain.originalDataStoreStable) {
    throw new Error('QA_LEDGER_G6D_TEST_DOMAIN_UNVERIFIED');
  }
  const source=getRequestRecord_(
    realProps,VAA_QA_G6C_CONFIG_.createRequestId
  );
  if(!source || source.operationMode!=='CREATE' ||
     source.status!=='READY' || source.stage!=='READY' ||
     source.outputFolderId!==VAA_QA_G4_CONFIG_.testOutputId ||
     !source.spreadsheetId) {
    throw new Error('QA_LEDGER_G6D_TARGET_UNVERIFIED');
  }
  validateUpdateTargetDriveFile_(
    source.spreadsheetId,VAA_QA_G4_CONFIG_.testOutputId
  );
  const record={
    requestId:VAA_QA_LEDGER_READY_SYNTHETIC_ID_,
    operationMode:'CREATE',
    status:'READY',
    stage:'READY',
    spreadsheetId:source.spreadsheetId,
    spreadsheetUrl:buildSpreadsheetUrl_(source.spreadsheetId),
    outputFolderId:VAA_QA_G4_CONFIG_.testOutputId,
    fileName:'QA_LEDGER_SYNTHETIC_ONLY',
    viewerEnabled:false
  };
  const raw=JSON.stringify(record);
  const recordKey=getRequestPropertyKey_(
    VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const ledgerKey=VAA_LEDGER_READY_PROPERTY_;
  const targetLeaseKey=vaaTargetUpdateLeaseKey_(
    source.spreadsheetId
  );
  const fake={
    getProperty:function(key) {
      if(key===recordKey)return raw;
      if(key===ledgerKey)return realProps.getProperty(ledgerKey);
      if(key===targetLeaseKey)return null;
      return null;
    },
    setProperty:function() {
      throw new Error('QA_LEDGER_FAKE_PROPERTY_WRITE_BLOCKED');
    },
    deleteProperty:function() {
      throw new Error('QA_LEDGER_FAKE_PROPERTY_DELETE_BLOCKED');
    }
  };
  if(realProps.getProperty(recordKey)) {
    throw new Error('QA_LEDGER_SYNTHETIC_ID_COLLIDES_WITH_REAL_REQ');
  }
  const eligible=vaaLedgerReadyValidateRaw_(
    VAA_QA_LEDGER_READY_SYNTHETIC_ID_,raw
  );
  if(eligible.spreadsheetId!==source.spreadsheetId) {
    throw new Error('QA_LEDGER_SYNTHETIC_TARGET_CHANGED');
  }
  return {fake:fake,raw:raw,targetId:source.spreadsheetId,domain:domain};
}

function vaaQaLedgerReadySyntheticPreflightReadOnly() {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const sheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
  const source=vaaQaLedgerReadySyntheticSourceReadOnly_(props);
  const existing=vaaLedgerReadyLookupFromSheet_(
    sheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const noOtherRows=sheet.getLastRow()===1;
  const after=props.getProperties();
  const out={
    phase:'LEDGER_READY_SYNTHETIC_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,
    ledgerIsPrivateInIsolatedTestRoot:true,
    exactSevenColumnSchema:true,
    historicReadyReceipts:source.domain.readyCount,
    syntheticReceiptUsesInMemoryProperties:true,
    existingSyntheticArchiveRow:existing.state==='FOUND',
    ledgerHasHeaderOnly:noOtherRows,
    scriptPropertiesUnchanged:vaaQaLedgerReadyPropsEqual_(before,after),
    actualWritePerformed:false,
    actualRequestReceiptCreated:false,
    actualUpdatePerformed:false,
    cleanupAuthorized:false
  };
  out.pass=!!(!out.existingSyntheticArchiveRow &&
    out.ledgerHasHeaderOnly &&
    out.scriptPropertiesUnchanged &&
    out.historicReadyReceipts===4);
  console.log('VAA_QA_LEDGER_READY_PREFLIGHT '+JSON.stringify(out));
  return out;
}

/**
 * ONLY allowed real write: one appendRow to the new private TEST ledger.
 * If there is ANY exception or timeout after entry, NEVER rerun this.
 * Invoke vaaQaLedgerReadySyntheticInspectReadOnly instead.
 */
function vaaQaLedgerReadySyntheticCopyOnce() {
  const preflight=vaaQaLedgerReadySyntheticPreflightReadOnly();
  if(!preflight.pass) {
    throw new Error('QA_LEDGER_READY_COPY_PREFLIGHT_FAILED');
  }
  const lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props=vaaQaG4IsolatedConfig_();
    const before=props.getProperties();
    const sheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
    const source=vaaQaLedgerReadySyntheticSourceReadOnly_(props);
    if(sheet.getLastRow()!==1 ||
       vaaLedgerReadyLookupFromSheet_(
         sheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
       ).state!=='NOT_FOUND') {
      throw new Error('QA_LEDGER_SYNTHETIC_ROW_ALREADY_EXISTS');
    }
    const written=vaaLedgerReadyCopyOneUnderLock_(
      source.fake,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
    );
    const result=vaaLedgerReadyLookupFromSheet_(
      sheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
    );
    const noPropertyWrites=vaaQaLedgerReadyPropsEqual_(
      before,props.getProperties()
    );
    const out={
      phase:'LEDGER_READY_SYNTHETIC_COPY_ONCE',
      syntheticReadyArchived:
        written.state==='COPIED_AND_VERIFIED' &&
        result.state==='FOUND' && result.raw===source.raw,
      syntheticArchiveRowCount:sheet.getLastRow()-1,
      historicReadyReceipts:source.domain.readyCount,
      originalRequestPropertiesUnchanged:noPropertyWrites,
      realRequestIdReplayed:false,
      actualUpdatePerformed:false,
      actualCasPerformed:false,
      actualRequestReceiptCreated:false,
      ledgerRowsCreatedExpected:1,
      cleanupAuthorized:false,
      automaticRetryAuthorized:false
    };
    out.pass=!!(out.syntheticReadyArchived &&
      out.syntheticArchiveRowCount===1 &&
      out.historicReadyReceipts===4 &&
      out.originalRequestPropertiesUnchanged);
    console.log('VAA_QA_LEDGER_READY_COPY '+JSON.stringify(out));
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** Safe after pass, exception, timeout or missing write response. */
function vaaQaLedgerReadySyntheticInspectReadOnly() {
  const props=vaaQaG4IsolatedConfig_();
  const before=props.getProperties();
  const sheet=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
  const source=vaaQaLedgerReadySyntheticSourceReadOnly_(props);
  const first=vaaLedgerReadyLookupFromSheet_(
    sheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const second=vaaLedgerReadyLookupFromSheet_(
    sheet,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
  );
  const identicalArchive=first.state==='FOUND' &&
    second.state==='FOUND' &&
    first.raw===second.raw &&
    first.raw===source.raw;
  const response=identicalArchive ?
    buildReadyResponse_(
      first.record,VAA_QA_LEDGER_READY_SYNTHETIC_ID_,
      true,Date.now()
    ) : null;
  const replayWouldBeReady=!!response &&
    response.ok===true && response.reused===true &&
    response.operationMode==='CREATE' &&
    response.status==='READY' &&
    response.spreadsheetId===source.targetId;
  const out={
    phase:'LEDGER_READY_SYNTHETIC_INSPECT_READ_ONLY',
    strictReadOnly:true,
    independentReadPasses:2,
    archiveRowCount:sheet.getLastRow()-1,
    exactLedgerMatchesSyntheticRecord:identicalArchive,
    replayResponseFromLedgerVerified:replayWouldBeReady,
    historicReadyReceipts:source.domain.readyCount,
    originalRequestPropertiesUnchanged:
      vaaQaLedgerReadyPropsEqual_(before,props.getProperties()),
    syntheticRequestIdNeverWrittenToRealProperties:
      !props.getProperty(getRequestPropertyKey_(
        VAA_QA_LEDGER_READY_SYNTHETIC_ID_
      )),
    actualWritePerformed:false,
    actualRequestReplayed:false,
    actualCasPerformed:false,
    cleanupAuthorized:false,
    automaticRetryAuthorized:false
  };
  out.pass=!!(out.archiveRowCount===1 &&
    identicalArchive && replayWouldBeReady &&
    out.historicReadyReceipts===4 &&
    out.originalRequestPropertiesUnchanged &&
    out.syntheticRequestIdNeverWrittenToRealProperties);
  console.log('VAA_QA_LEDGER_READY_INSPECT '+JSON.stringify(out));
  return out;
}
