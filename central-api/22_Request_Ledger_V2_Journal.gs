/**
 * Request ledger V2 — isolated TEST reservation journal, default OFF.
 *
 * DORMANT: not connected to doPost. No REQ_ property removal, CAS, Drive
 * creation, automatic replay or production cutover. In particular, a
 * RESERVED or ERROR request is NEVER eligible for automatic retry.
 *
 * Uses the PRIVATE TEST spreadsheet already configured for READY_ARCHIVE_V1;
 * its new "journal_v2" tab records immutable append-only events:
 *   RESERVED revision 1 -> READY/ERROR revision 2.
 *
 * This phase is intentionally restricted to synthetic TEST requests. It
 * proves the reservation-before-side-effects data model, not end-to-end
 * application recovery.
 */
const VAA_LEDGER_JOURNAL_V2_TAB_='journal_v2';
const VAA_LEDGER_JOURNAL_V2_VERSION_='REQUEST_JOURNAL_V2';
const VAA_LEDGER_JOURNAL_V2_HEADERS_=[
  'requestKey','revision','phase','recordJson','recordDigest',
  'prevDigest','updatedAt','schemaVersion'
];
const VAA_LEDGER_JOURNAL_MODE_PROP_='VAA_REQUEST_JOURNAL_MODE';
const VAA_LEDGER_JOURNAL_TEST_MODE_='TEST_RESERVATION_V1';
const VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_='VAA_JOURNAL_TEST_ROOT_ID';
const VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_='VAA_JOURNAL_TEST_OUTPUT_ID';

function vaaLedgerJournalError_(code) {
  const e=new Error(code);
  e.code=code;
  return e;
}

function vaaLedgerJournalIdentity_(input) {
  const id=vaaLedgerReadyRequestId_(input&&input.requestId);
  const operationMode=String(input&&input.operationMode||'').trim();
  if (operationMode!=='CREATE' && operationMode!=='UPDATE') {
    throw vaaLedgerJournalError_('JOURNAL_IDENTITY_INVALID');
  }
  const targetSpreadsheetId=String(
    input&&input.targetSpreadsheetId||''
  ).trim();
  const updateStrategy=String(input&&input.updateStrategy||'').trim();
  const updatePayloadDigest=String(
    input&&input.updatePayloadDigest||''
  ).trim();
  if (
    (operationMode==='CREATE' &&
      (targetSpreadsheetId||updateStrategy||updatePayloadDigest)) ||
    (operationMode==='UPDATE' &&
      (!targetSpreadsheetId ||
       (updateStrategy!=='APPEND'&&updateStrategy!=='REPLACE') ||
       !updatePayloadDigest))
  ) throw vaaLedgerJournalError_('JOURNAL_IDENTITY_INVALID');
  return {
    requestId:id,operationMode:operationMode,
    targetSpreadsheetId:targetSpreadsheetId,
    updateStrategy:updateStrategy,
    updatePayloadDigest:updatePayloadDigest
  };
}

function vaaLedgerJournalIdentityMatches_(a,b) {
  return a.requestId===b.requestId &&
    a.operationMode===b.operationMode &&
    a.targetSpreadsheetId===b.targetSpreadsheetId &&
    a.updateStrategy===b.updateStrategy &&
    a.updatePayloadDigest===b.updatePayloadDigest;
}

function vaaLedgerJournalAssertTestScope_(props) {
  const mode=String(props.getProperty(VAA_LEDGER_JOURNAL_MODE_PROP_)||'');
  if(mode!==VAA_LEDGER_JOURNAL_TEST_MODE_) {
    throw vaaLedgerJournalError_('JOURNAL_TEST_MODE_REQUIRED');
  }
  const root=String(props.getProperty(
    VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_
  )||'');
  const output=String(props.getProperty(
    VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_
  )||'');
  if(!root || !output || root===output ||
     root!==API_CONFIG.ROOT_FOLDER_ID ||
     output!==API_CONFIG.SHEET_OUTPUT_FOLDER_ID) {
    throw vaaLedgerJournalError_('JOURNAL_TEST_SCOPE_DENIED');
  }
  const id=String(props.getProperty(VAA_LEDGER_READY_PROPERTY_)||'').trim();
  try {
    const ledger=DriveApp.getFileById(id);
    if (ledger.getMimeType()!==MimeType.GOOGLE_SHEETS ||
        ledger.getSharingAccess()!==DriveApp.Access.PRIVATE) {
      throw Error('invalid ledger');
    }
    const parents=ledger.getParents();
    let count=0,allMatch=true;
    while(parents.hasNext()&&count<2) {
      const p=parents.next();
      count++;
      if(p.getId()!==root)allMatch=false;
    }
    if(count!==1||!allMatch)throw Error('wrong parent');
  } catch (_) {
    throw vaaLedgerJournalError_('JOURNAL_TEST_LEDGER_NOT_VERIFIED');
  }
}

function vaaLedgerJournalOpenReadOnly_(props) {
  // The V1 tab must also remain readable. Its rows are never modified.
  const readySheet=vaaLedgerReadyOpenReadOnly_(props);
  let sheet;
  try {
    sheet=readySheet.getParent().getSheetByName(
      VAA_LEDGER_JOURNAL_V2_TAB_
    );
  } catch (_) {
    throw vaaLedgerJournalError_('JOURNAL_UNAVAILABLE');
  }
  if(!sheet)throw vaaLedgerJournalError_('JOURNAL_SHEET_MISSING');
  let headers;
  try {
    headers=sheet.getRange(1,1,1,8).getValues()[0];
  } catch (_) {
    throw vaaLedgerJournalError_('JOURNAL_UNAVAILABLE');
  }
  if(!headers || !VAA_LEDGER_JOURNAL_V2_HEADERS_.every(
    function(v,i){return headers[i]===v;}
  )){
    throw vaaLedgerJournalError_('JOURNAL_SCHEMA_MISMATCH');
  }
  return {sheet:sheet,readySheet:readySheet};
}

function vaaLedgerJournalDecodeRow_(id,row) {
  if(!row||row.length!==8 ||
     row[0]!==vaaLedgerReadyHash_(id) ||
     !Number.isInteger(Number(row[1])) ||
     Number(row[1])<1 || Number(row[1])>2 ||
     (row[2]!=='RESERVED'&&row[2]!=='READY'&&row[2]!=='ERROR') ||
     typeof row[3]!=='string'||!row[3] ||
     row[4]!==vaaLedgerReadyHash_(row[3]) ||
     typeof row[5]!=='string' ||
     !String(row[6]||'') ||
     row[7]!==VAA_LEDGER_JOURNAL_V2_VERSION_) {
    throw vaaLedgerJournalError_('JOURNAL_ROW_UNVERIFIED');
  }
  let body;
  try{body=JSON.parse(row[3]);}catch(_){
    throw vaaLedgerJournalError_('JOURNAL_ROW_UNVERIFIED');
  }
  const identity=vaaLedgerJournalIdentity_(body);
  if(identity.requestId!==id ||
     body.phase!==row[2] ||
     (row[2]==='READY' && !body.receipt) ||
     (row[2]!=='READY' && !!body.receipt)){
    throw vaaLedgerJournalError_('JOURNAL_ROW_UNVERIFIED');
  }
  if(row[2]==='READY'){
    const raw=JSON.stringify(body.receipt);
    const validated=vaaLedgerReadyValidateRaw_(id,raw);
    if (validated.operationMode!==identity.operationMode ||
        (identity.operationMode==='UPDATE' && (
          validated.targetSpreadsheetId!==identity.targetSpreadsheetId ||
          validated.updateStrategy!==identity.updateStrategy ||
          validated.updatePayloadDigest!==identity.updatePayloadDigest
        ))) throw vaaLedgerJournalError_('JOURNAL_ROW_UNVERIFIED');
  }
  return {
    revision:Number(row[1]), phase:row[2],identity:identity,
    body:body,digest:row[4],previousDigest:row[5]
  };
}

/** Reread every matching event; ambiguity, gaps or corruption all stop. */
function vaaLedgerJournalLookupFromSheet_(sheet, requestId) {
  const id=vaaLedgerReadyRequestId_(requestId);
  let matches=[];
  try {
    const last=sheet.getLastRow();
    if(last<1)throw vaaLedgerJournalError_('JOURNAL_SCHEMA_MISMATCH');
    if(last===1)return {state:'ABSENT'};
    matches=sheet.getRange(2,1,last-1,1).createTextFinder(
      vaaLedgerReadyHash_(id)
    ).matchEntireCell(true).matchCase(true).findAll();
  } catch(err) {
    if(err&&err.code)throw err;
    throw vaaLedgerJournalError_('JOURNAL_UNAVAILABLE');
  }
  if(matches.length===0)return {state:'ABSENT'};
  if(matches.length>2){
    throw vaaLedgerJournalError_('JOURNAL_EVENT_COUNT_INVALID');
  }
  const indices=matches.map(function(m){return m.getRow();})
    .sort(function(a,b){return a-b;});
  const events=[];
  for(let i=0;i<indices.length;i++){
    let row;
    try{
      row=sheet.getRange(indices[i],1,1,8).getValues()[0];
    }catch(_){
      throw vaaLedgerJournalError_('JOURNAL_UNAVAILABLE');
    }
    const event=vaaLedgerJournalDecodeRow_(id,row);
    const previous=events.length?events[events.length-1]:null;
    if(event.revision!==i+1 ||
       (i===0 && (event.phase!=='RESERVED' ||
                 event.previousDigest!=='')) ||
       (i===1 && (previous.phase!=='RESERVED' ||
                 event.previousDigest!==previous.digest ||
                 (event.phase!=='READY'&&event.phase!=='ERROR') ||
                 !vaaLedgerJournalIdentityMatches_(
                   event.identity,previous.identity
                 )))) {
      throw vaaLedgerJournalError_('JOURNAL_CHAIN_UNVERIFIED');
    }
    events.push(event);
  }
  const latest=events[events.length-1];
  return {state:latest.phase,identity:latest.identity,
    latest:latest,revision:latest.revision};
}

function vaaLedgerJournalReadOnly_(props,requestId) {
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  return vaaLedgerJournalLookupFromSheet_(tabs.sheet,requestId);
}

function vaaLedgerJournalAppendVerified_(sheet,id,identity,phase,
  receipt,revision,previousDigest) {
  const body=Object.assign({},identity,{
    phase:phase,receipt:receipt||null
  });
  const raw=JSON.stringify(body);
  const digest=vaaLedgerReadyHash_(raw);
  const row=[
    vaaLedgerReadyHash_(id),revision,phase,raw,
    digest,previousDigest,new Date().toISOString(),
    VAA_LEDGER_JOURNAL_V2_VERSION_
  ];
  try{sheet.appendRow(row);}catch(_){
    // Unknown write completion. Never blindly retry.
    throw vaaLedgerJournalError_('JOURNAL_WRITE_UNCERTAIN');
  }
  const read=vaaLedgerJournalLookupFromSheet_(sheet,id);
  if(read.state!==phase ||
     read.revision!==revision ||
     read.latest.digest!==digest ||
     read.latest.previousDigest!==previousDigest ||
     !vaaLedgerJournalIdentityMatches_(read.identity,identity)){
    throw vaaLedgerJournalError_('JOURNAL_WRITE_UNVERIFIED');
  }
  return {state:phase,revision:revision};
}

/**
 * MUST be called under ScriptLock BEFORE any target/lease/REQ side effect.
 * TEST-only and not integrated into doPost. RESERVED itself never authorizes
 * resuming or launching side effects without a separate reviewed cutover.
 */
/**
 * Scope is explicit: existing calls without a third parameter remain
 * strictly TEST-only. PROD requires the independent gated ACL assertion.
 */
function vaaLedgerJournalAssertWriteScope_(props,scope) {
  if(scope==='PROD')return vaaLedgerProdAssertScope_(props);
  if(scope==null)return vaaLedgerJournalAssertTestScope_(props);
  throw vaaLedgerJournalError_('JOURNAL_SCOPE_INVALID');
}

function vaaLedgerJournalReserveUnderLock_(props,input,scope) {
  vaaLedgerJournalAssertWriteScope_(props,scope);
  const identity=vaaLedgerJournalIdentity_(input);
  if(props.getProperty(getRequestPropertyKey_(identity.requestId))){
    throw vaaLedgerJournalError_('JOURNAL_PROPERTY_COLLISION');
  }
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const legacy=vaaLedgerReadyLookupFromSheet_(
    tabs.readySheet,identity.requestId
  );
  if(legacy.state!=='NOT_FOUND'){
    throw vaaLedgerJournalError_('JOURNAL_LEGACY_READY_EXISTS');
  }
  const existing=vaaLedgerJournalLookupFromSheet_(
    tabs.sheet,identity.requestId
  );
  if(existing.state!=='ABSENT'){
    throw vaaLedgerJournalError_('JOURNAL_ALREADY_RESERVED');
  }
  return vaaLedgerJournalAppendVerified_(
    tabs.sheet,identity.requestId,identity,'RESERVED',
    null,1,''
  );
}

/**
 * Complete reservation only after canonical READY REQ_ exists.
 * Preserve REQ_. Never use this to mark PROCESSING/ERROR as READY.
 */
function vaaLedgerJournalFinalizeReadyUnderLock_(props,requestId,scope) {
  vaaLedgerJournalAssertWriteScope_(props,scope);
  const id=vaaLedgerReadyRequestId_(requestId);
  const tabs=vaaLedgerJournalOpenReadOnly_(props);
  const prior=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
  if(prior.state!=='RESERVED'||prior.revision!==1){
    throw vaaLedgerJournalError_('JOURNAL_NOT_RESERVED');
  }
  const raw=props.getProperty(getRequestPropertyKey_(id));
  const ready=vaaLedgerReadyValidateRaw_(id,raw);
  const identity=vaaLedgerJournalIdentity_(ready);
  if(!vaaLedgerJournalIdentityMatches_(identity,prior.identity)){
    throw vaaLedgerJournalError_('JOURNAL_READY_IDENTITY_MISMATCH');
  }
  if(isLeaseActive_(ready) || !requestRecordFileExists_(ready)){
    throw vaaLedgerJournalError_('JOURNAL_READY_TARGET_UNVERIFIED');
  }
  if(identity.operationMode==='UPDATE' &&
      props.getProperty(vaaTargetUpdateLeaseKey_(
        identity.targetSpreadsheetId
      ))){
    throw vaaLedgerJournalError_('JOURNAL_READY_LEASE_ACTIVE');
  }
  if(props.getProperty(getRequestPropertyKey_(id))!==raw){
    throw vaaLedgerJournalError_('JOURNAL_READY_SOURCE_CHANGED');
  }
  const result=vaaLedgerJournalAppendVerified_(
    tabs.sheet,id,identity,'READY',ready,2,prior.latest.digest
  );
  if(props.getProperty(getRequestPropertyKey_(id))!==raw){
    throw vaaLedgerJournalError_('JOURNAL_READY_SOURCE_CHANGED');
  }
  return {state:result.state,revision:result.revision,
    sourcePropertyPreserved:true};
}

/**
 * A journal read never returns "start new". Only a previously VERIFIED
 * READY is replayable. ABSENT/RESERVED/ERROR are NOT admission authority.
 */
function vaaLedgerJournalReplayDecisionReadOnly_(props,requestId,
  mode,target,strategy,digest) {
  try{
    const id=vaaLedgerReadyRequestId_(requestId);
    const tabs=vaaLedgerJournalOpenReadOnly_(props);
    const old=vaaLedgerReadyLookupFromSheet_(tabs.readySheet,id);
    const modern=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
    let record=null;
    if(modern.state==='READY') {
      record=modern.latest.body.receipt;
    } else if(modern.state==='ABSENT' && old.state==='FOUND') {
      record=old.record;
    } else {
      return {state:'HALT',code:'JOURNAL_NOT_SAFE_TO_REPLAY'};
    }
    if(old.state==='FOUND' && modern.state!=='ABSENT' &&
       (modern.state!=='READY' ||
        JSON.stringify(old.record)!==JSON.stringify(record))) {
      return {state:'HALT',code:'JOURNAL_ARCHIVE_CONFLICT'};
    }
    if(record.operationMode!==mode ||
       (mode==='UPDATE' && (
         record.targetSpreadsheetId!==target ||
         record.updateStrategy!==strategy ||
         record.updatePayloadDigest!==digest
       ))) {
      return {state:'HALT',code:'JOURNAL_REPLAY_IDENTITY_MISMATCH'};
    }
    if(!requestRecordFileExists_(record)){
      return {state:'HALT',code:'JOURNAL_READY_TARGET_UNVERIFIED'};
    }
    return {state:'READY',record:record};
  }catch(_){
    return {state:'HALT',code:'JOURNAL_REPLAY_UNVERIFIED'};
  }
}
