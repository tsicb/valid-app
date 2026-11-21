/**
 * Authoritative V2 request journal production gateway.
 *
 * This source is DORMANT until all explicit PROD properties are set.
 * It reuses the same immutable journal, READY archive, and ScriptLock
 * ordering proven in isolated TEST. No production action is authorized
 * by merely merging/syncing this source.
 *
 * Safety invariants:
 *  - all new CREATE/UPDATE require a VERIFIED RESERVED event BEFORE
 *    target creation, UPDATE lease, or REQ_ writes;
 *  - existing REQ_ entries remain authoritative for legacy requests;
 *  - archived READY (V1 or V2) can replay with REQ_ absent, never re-run;
 *  - RESERVED/ERROR, invalid/corrupt/unavailable ledger or mismatch HALT;
 *  - sticky production fence HALTs if the journal mode is turned OFF;
 *  - retiring newly finalized READY properties requires a *separate*
 *    explicit setting, is disabled by default, and never touches legacy.
 *
 * Never print requestId, receipt JSON, private ledger IDs or config values.
 */
const VAA_LEDGER_PROD_MODE_='PROD_V2_GATED';
const VAA_LEDGER_PROD_JOURNAL_MODE_='PROD_RESERVATION_V2';
const VAA_LEDGER_PROD_FENCE_PROP_='VAA_PROD_LEDGER_FENCE';
const VAA_LEDGER_PROD_FENCE_ON_='ACTIVE_V1';
const VAA_LEDGER_PROD_ROOT_PROP_='VAA_PROD_LEDGER_ROOT_ID';
const VAA_LEDGER_PROD_OUTPUT_PROP_='VAA_PROD_LEDGER_OUTPUT_ID';
const VAA_LEDGER_PROD_RETIRE_PROP_='VAA_PROD_READY_RETIRE_MODE';
const VAA_LEDGER_PROD_RETIRE_ON_='RETIRE_VERIFIED_NEW_READY_V1';
// Independent one-request canary; broad retirement remains separately gated.
// The canary must be identified by a specific reserved namespace and mode.
const VAA_LEDGER_PROD_RETIRE_CANARY_ON_='CANARY_ONE_NEW_READY_V1';
const VAA_LEDGER_PROD_RETIRE_CANARY_ID_PROP_=
  'VAA_PROD_READY_RETIRE_CANARY_REQUEST_ID';
const VAA_LEDGER_PROD_RETIRE_CANARY_KIND_PROP_=
  'VAA_PROD_READY_RETIRE_CANARY_OPERATION_MODE';

/** Pure read of exact canary identity; no wildcard or general-purpose IDs. */
function vaaLedgerProdRetireCanary_(props){
  const id=String(props.getProperty(
    VAA_LEDGER_PROD_RETIRE_CANARY_ID_PROP_
  )||'').trim();
  const kind=String(props.getProperty(
    VAA_LEDGER_PROD_RETIRE_CANARY_KIND_PROP_
  )||'').trim();
  const match=/^VAA_READY_RETIRE_CANARY_(CREATE|UPDATE)_[0-9]{8}_[A-Z0-9]{8}$/
    .exec(id);
  if(!match || kind!==match[1])return null;
  return {id:id,operationMode:kind};
}

function vaaLedgerProdModeStatus_(props) {
  const dop=String(props.getProperty(VAA_JOURNAL_DOP_MODE_PROP_)||'').trim();
  const journal=String(props.getProperty(VAA_LEDGER_JOURNAL_MODE_PROP_)||'').trim();
  const fence=String(props.getProperty(VAA_LEDGER_PROD_FENCE_PROP_)||'').trim();
  const retire=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim();
  if (retire && retire!=='OFF' && retire!==VAA_LEDGER_PROD_RETIRE_ON_ &&
      retire!==VAA_LEDGER_PROD_RETIRE_CANARY_ON_) {
    return {state:'HALT',code:'JOURNAL_PROD_RETIRE_MODE_INVALID'};
  }
  if(retire===VAA_LEDGER_PROD_RETIRE_CANARY_ON_){
    const canary=vaaLedgerProdRetireCanary_(props);
    const legacy=String(props.getProperty(
      'VAA_PROD_LEGACY_MIGRATION_MODE'
    )||'').trim();
    if(!canary || (legacy && legacy!=='OFF')){
      return {state:'HALT',code:'JOURNAL_PROD_CANARY_SCOPE_INVALID'};
    }
  }
  if (!dop || dop==='OFF') {
    // Prevent accidentally falling back to legacy admission after cutover.
    if (fence===VAA_LEDGER_PROD_FENCE_ON_ ||
        retire===VAA_LEDGER_PROD_RETIRE_ON_ ||
        retire===VAA_LEDGER_PROD_RETIRE_CANARY_ON_ ||
        journal===VAA_LEDGER_PROD_JOURNAL_MODE_) {
      return {state:'HALT',code:'JOURNAL_PROD_STICKY_FENCE'};
    }
    return {state:'DISABLED'};
  }
  if (dop!==VAA_LEDGER_PROD_MODE_) {
    // The existing TEST bridge rejects unknown / mismatched TEST modes.
    if (fence===VAA_LEDGER_PROD_FENCE_ON_) {
      return {state:'HALT',code:'JOURNAL_PROD_STICKY_FENCE'};
    }
    return {state:'DISABLED'};
  }
  if (fence!==VAA_LEDGER_PROD_FENCE_ON_ ||
      journal!==VAA_LEDGER_PROD_JOURNAL_MODE_) {
    return {state:'HALT',code:'JOURNAL_PROD_NOT_ARMED'};
  }
  return {state:'ENABLED'};
}

/**
 * Scope/ACL validation on EACH admission and finalize. No TEST-only
 * hardcoded folders or IDs. Production root must match explicit operator
 * confirmation; ledger must be private, one-parent, direct root child.
 */
function vaaLedgerProdAssertScope_(props) {
  if (vaaLedgerProdModeStatus_(props).state!=='ENABLED') {
    throw vaaLedgerJournalError_('JOURNAL_PROD_MODE_REQUIRED');
  }
  const root=String(props.getProperty(VAA_LEDGER_PROD_ROOT_PROP_)||'').trim();
  const output=String(props.getProperty(VAA_LEDGER_PROD_OUTPUT_PROP_)||'').trim();
  if(!root || !output || root===output ||
     root!==API_CONFIG.ROOT_FOLDER_ID ||
     output!==API_CONFIG.SHEET_OUTPUT_FOLDER_ID) {
    throw vaaLedgerJournalError_('JOURNAL_PROD_SCOPE_DENIED');
  }
  const ledgerId=String(props.getProperty(VAA_LEDGER_READY_PROPERTY_)||'').trim();
  if(!ledgerId || ledgerId===root || ledgerId===output ||
     !/^[A-Za-z0-9_-]{20,}$/.test(ledgerId)) {
    throw vaaLedgerJournalError_('JOURNAL_PROD_LEDGER_UNVERIFIED');
  }
  try{
    const file=DriveApp.getFileById(ledgerId);
    if(file.getMimeType()!==MimeType.GOOGLE_SHEETS ||
       file.getSharingAccess()!==DriveApp.Access.PRIVATE ||
       (typeof file.isTrashed==='function' && file.isTrashed())) {
      throw Error('INVALID_LEDGER');
    }
    const parents=file.getParents();
    let count=0,matched=true;
    while(parents.hasNext() && count<2){
      const parent=parents.next();count++;
      if(parent.getId()!==root)matched=false;
    }
    if(count!==1 || !matched)throw Error('INVALID_PARENT');
  }catch(_){
    throw vaaLedgerJournalError_('JOURNAL_PROD_LEDGER_UNVERIFIED');
  }
}

/** This helper handles both hot legacy REQ_ and fully archived histories. */
function vaaLedgerProdDecideUnderLock_(props,id,mode,target,strategy,
  digest,storedReceiptExists) {
  const active=vaaLedgerProdModeStatus_(props);
  if(active.state!=='ENABLED')return active;
  try{
    vaaLedgerProdAssertScope_(props);
    const tabs=vaaLedgerJournalOpenReadOnly_(props);
    const old=vaaLedgerReadyLookupFromSheet_(tabs.readySheet,id);
    const modern=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
    const raw=String(props.getProperty(getRequestPropertyKey_(id))||'');
    if(!!raw!==!!storedReceiptExists){
      return {state:'HALT',code:'JOURNAL_PROD_PROPERTY_RACE'};
    }
    if(modern.state==='RESERVED' || modern.state==='ERROR'){
      return {state:'HALT',code:'JOURNAL_PROD_REQUEST_PENDING_REVIEW'};
    }

    if(modern.state==='READY' || old.state==='FOUND'){
      if(modern.state==='READY' && old.state==='FOUND' &&
         JSON.stringify(modern.latest.body.receipt)!==old.raw){
        return {state:'HALT',code:'JOURNAL_PROD_ARCHIVE_CONFLICT'};
      }
      const rec=modern.state==='READY'?modern.latest.body.receipt:old.record;
      const serialized=modern.state==='READY'?
        JSON.stringify(rec):old.raw;
      if(raw && raw!==serialized){
        return {state:'HALT',code:'JOURNAL_PROD_PROPERTY_CONFLICT'};
      }
      if(!vaaLedgerDopReceiptMatches_(rec,id,mode,target,
        strategy,digest,API_CONFIG.SHEET_OUTPUT_FOLDER_ID)){
        return {state:'HALT',code:'JOURNAL_PROD_READY_UNVERIFIED'};
      }
      return {state:'READY',record:rec};
    }
    if(modern.state!=='ABSENT' || old.state!=='NOT_FOUND'){
      return {state:'HALT',code:'JOURNAL_PROD_LEDGER_UNVERIFIED'};
    }
    // A pre-cutover, existing REQ_ (READY/PROCESSING/ERROR) must continue
    // down the exact legacy processing path. Do not retro-reserve it.
    if(raw)return {state:'LEGACY'};

    // An accidentally reused canary ID with the wrong operation must not
    // reserve a new request or reach any CREATE / UPDATE side effects.
    if(String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim()===
       VAA_LEDGER_PROD_RETIRE_CANARY_ON_){
      const canary=vaaLedgerProdRetireCanary_(props);
      if(canary && canary.id===id && canary.operationMode!==mode){
        return {state:'HALT',code:'JOURNAL_PROD_CANARY_MODE_MISMATCH'};
      }
    }
    const budget=vaaCheckNewRequestCapacityReadOnly_(props);
    if(!budget.allowed){
      return {state:'HALT',code:'PROPERTY_CAPACITY_NEAR_LIMIT'};
    }
    const identity={
      requestId:id,operationMode:mode,
      targetSpreadsheetId:mode==='UPDATE'?target:'',
      updateStrategy:mode==='UPDATE'?strategy:'',
      updatePayloadDigest:mode==='UPDATE'?digest:''
    };
    const reserved=vaaLedgerJournalReserveUnderLock_(props,identity,'PROD');
    if(reserved.state!=='RESERVED'||reserved.revision!==1){
      return {state:'HALT',code:'JOURNAL_PROD_RESERVE_UNVERIFIED'};
    }
    return {state:'ADMITTED'};
  }catch(_){
    // Lost-response append may have committed: NEVER start a new request.
    return {state:'HALT',code:'JOURNAL_PROD_UNVERIFIED'};
  }
}

/**
 * After the canonical REQ_ READY is written, use a new ScriptLock to
 * append V2 READY. Source retirement, if separately enabled, happens ONLY
 * after dual-ledger readback and matching original READY JSON.
 */
function vaaLedgerProdFinalizeReady_(props,id,mode) {
  const state=vaaLedgerProdModeStatus_(props);
  if(state.state!=='ENABLED'){
    return {state:'HALT',code:state.code||'JOURNAL_PROD_MODE_REQUIRED'};
  }
  const lock=LockService.getScriptLock();
  let held=false;
  try{
    lock.waitLock(20000);held=true;
    vaaLedgerProdAssertScope_(props);
    const finalized=vaaLedgerJournalFinalizeReadyUnderLock_(props,id,'PROD');
    if(finalized.state!=='READY'||finalized.revision!==2){
      return {state:'HALT',code:'JOURNAL_PROD_FINALIZE_UNVERIFIED'};
    }
    const retireSetting=String(
      props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||''
    ).trim();
    const canary=retireSetting===VAA_LEDGER_PROD_RETIRE_CANARY_ON_ ?
      vaaLedgerProdRetireCanary_(props) : null;
    const retire=retireSetting===VAA_LEDGER_PROD_RETIRE_ON_ ||
      !!(canary && canary.id===id && canary.operationMode===mode);
    if(retire){
      const key=getRequestPropertyKey_(id);
      const raw=props.getProperty(key);
      const parsed=vaaLedgerReadyValidateRaw_(id,raw);
      if(parsed.operationMode!==mode){
        throw vaaLedgerJournalError_('JOURNAL_PROD_SOURCE_CHANGED');
      }
      const before=vaaLedgerJournalReadOnly_(props,id);
      if(before.state!=='READY' || before.revision!==2 ||
         JSON.stringify(before.latest.body.receipt)!==raw){
        throw vaaLedgerJournalError_('JOURNAL_PROD_RETIRE_UNVERIFIED');
      }
      if(props.getProperty(key)!==raw){
        throw vaaLedgerJournalError_('JOURNAL_PROD_SOURCE_CHANGED');
      }
      // Only NEW requests admitted by this V2 gateway reach here. Never
      // retire legacy REQ_ records by this path.
      props.deleteProperty(key);
      const after=vaaLedgerJournalReadOnly_(props,id);
      if(props.getProperty(key) ||
         after.state!=='READY' ||
         JSON.stringify(after.latest.body.receipt)!==raw){
        throw vaaLedgerJournalError_('JOURNAL_PROD_RETIRE_UNVERIFIED');
      }
    }
    return {state:'READY',retired:retire};
  }catch(_){
    return {state:'HALT',code:'JOURNAL_PROD_FINALIZE_UNVERIFIED'};
  }finally{
    if(held){
      try{lock.releaseLock();}catch(_){}
    }
  }
}

/**
 * Manually invoked, production READ-ONLY readiness assessment for the
 * independently gated NEW V2 READY source-retirement mode.
 *
 * Does not change mode properties, edit the journal or delete any REQ_.
 * Historical non-V2 READY/ERROR receipts are not considered for retirement.
 * Requires an intact PRIVATE V2 ledger. Caps journal scan to avoid a
 * potentially expensive whole-sheet read at future large scales.
 * Returns aggregate counts only; never logs IDs, raw records or errors.
 */
function vaaLedgerProdReadyRetirePreflightReadOnly(){
  const out={
    phase:'PROD_NEW_V2_READY_RETIRE_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,sourceStable:false,
    prodV2Enabled:false,retireModeOff:false,legacyMigrationOff:false,
    journalEvents:0,journalReady:0,journalPending:0,
    modernReadyWithReq:0,modernReadyWithoutReq:0,
    eligibleForFutureRetirement:0,
    propertyWrites:0,journalWrites:0,propertyDeletes:0,
    activationAuthorized:false,errorStage:'NONE',
    errorCode:'NONE',pass:false
  };
  let stage='MODE';
  try {
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    out.prodV2Enabled=vaaLedgerProdModeStatus_(props).state==='ENABLED';
    const retire=String(
      props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||''
    ).trim();
    const legacy=String(
      props.getProperty('VAA_PROD_LEGACY_MIGRATION_MODE')||''
    ).trim();
    out.retireModeOff=!retire||retire==='OFF';
    out.legacyMigrationOff=!legacy||legacy==='OFF';
    if(!out.prodV2Enabled||!out.retireModeOff||
       !out.legacyMigrationOff){
      throw vaaLedgerJournalError_('PREFLIGHT_MODE_NOT_SAFE');
    }
    stage='SCOPE';
    vaaLedgerProdAssertScope_(props);
    const tabs=vaaLedgerJournalOpenReadOnly_(props);
    stage='JOURNAL';
    const sheet=tabs.sheet;
    const last=sheet.getLastRow();
    if(last<1||last-1>1000){
      throw vaaLedgerJournalError_('PREFLIGHT_JOURNAL_SCAN_BOUNDS');
    }
    const rows=last===1?[]:
      sheet.getRange(2,1,last-1,8).getValues();
    out.journalEvents=rows.length;
    const seen={};
    const pendingHashes={};
    const completedHashes={};
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      if(row[2]==='RESERVED'||row[2]==='ERROR'){
        pendingHashes[String(row[0])]=true;
        continue;
      }
      if(row[2]!=='READY'||Number(row[1])!==2){
        throw vaaLedgerJournalError_('PREFLIGHT_JOURNAL_UNEXPECTED');
      }
      let body;
      try{body=JSON.parse(row[3]);}catch(_){
        throw vaaLedgerJournalError_('PREFLIGHT_JOURNAL_UNEXPECTED');
      }
      const id=vaaLedgerReadyRequestId_(body&&body.requestId);
      if(Object.prototype.hasOwnProperty.call(seen,id)){
        throw vaaLedgerJournalError_('PREFLIGHT_JOURNAL_DUPLICATE');
      }
      seen[id]=true;
      completedHashes[String(row[0])]=true;
      const journal=vaaLedgerJournalLookupFromSheet_(sheet,id);
      if(journal.state!=='READY'||journal.revision!==2){
        throw vaaLedgerJournalError_('PREFLIGHT_JOURNAL_UNVERIFIED');
      }
      const rec=journal.latest.body.receipt;
      const serialized=JSON.stringify(rec);
      vaaLedgerReadyValidateRaw_(id,serialized);
      out.journalReady++;
      const old=vaaLedgerReadyLookupFromSheet_(tabs.readySheet,id);
      if(old.state!=='NOT_FOUND'){
        throw vaaLedgerJournalError_('PREFLIGHT_V1_COLLISION');
      }
      const raw=before[getRequestPropertyKey_(id)];
      if(!raw){
        out.modernReadyWithoutReq++;
        continue;
      }
      out.modernReadyWithReq++;
      vaaLedgerReadyValidateRaw_(id,raw);
      if(raw!==serialized || isLeaseActive_(rec) ||
         (rec.operationMode==='UPDATE' &&
          props.getProperty(vaaTargetUpdateLeaseKey_(
            rec.targetSpreadsheetId
          )))){
        throw vaaLedgerJournalError_('PREFLIGHT_RECEIPT_MISMATCH');
      }
      const verified=vaaLedgerDopReceiptMatches_(
        rec,id,rec.operationMode,
        rec.operationMode==='UPDATE'?rec.targetSpreadsheetId:'',
        rec.operationMode==='UPDATE'?rec.updateStrategy:'',
        rec.operationMode==='UPDATE'?rec.updatePayloadDigest:'',
        API_CONFIG.SHEET_OUTPUT_FOLDER_ID
      );
      if(!verified){
        throw vaaLedgerJournalError_('PREFLIGHT_TARGET_UNVERIFIED');
      }
      out.eligibleForFutureRetirement++;
    }
    out.journalPending=Object.keys(pendingHashes)
      .filter(function(hash){return !completedHashes[hash];}).length;
    stage='SOURCE_STABILITY';
    const after=props.getProperties();
    const keys=Object.keys(before).sort();
    const next=Object.keys(after).sort();
    out.sourceStable=keys.length===next.length &&
      keys.every(function(key,i){
        return key===next[i] && before[key]===after[key];
      });
    if(!out.sourceStable){
      throw vaaLedgerJournalError_('PREFLIGHT_SOURCE_CHANGED');
    }
    out.pass=out.journalReady>0 && out.journalPending===0;
    out.errorStage=out.pass?'NONE':
      out.journalPending>0?'PENDING_JOURNAL':'NO_MODERN_READY';
    out.errorCode=out.pass?'NONE':
      out.journalPending>0?'PREFLIGHT_JOURNAL_PENDING':'PREFLIGHT_NO_READY';
  }catch(err){
    out.pass=false;out.errorStage=stage;
    // Never echo Error.message or values potentially derived from IDs.
    const allowed=[
      'PREFLIGHT_MODE_NOT_SAFE','PREFLIGHT_JOURNAL_SCAN_BOUNDS',
      'PREFLIGHT_JOURNAL_UNEXPECTED','PREFLIGHT_JOURNAL_DUPLICATE',
      'PREFLIGHT_JOURNAL_UNVERIFIED','PREFLIGHT_V1_COLLISION',
      'PREFLIGHT_RECEIPT_MISMATCH','PREFLIGHT_TARGET_UNVERIFIED',
      'PREFLIGHT_SOURCE_CHANGED','LEDGER_RECEIPT_INVALID',
      'JOURNAL_UNAVAILABLE','JOURNAL_CHAIN_UNVERIFIED'
    ];
    const code=String(err&&err.code||'');
    out.errorCode=allowed.indexOf(code)>=0?code:'UNCLASSIFIED';
  }
  console.log('VAA_PROD_READY_RETIRE_PREFLIGHT '+JSON.stringify(out));
  return out;
}

/**
 * Editor-only read-only canary preflight. Configure an exact canary ID
 * and operation while RETIRE_MODE is OFF; check it has never been used.
 * It is NOT an activation command and does not authorize any deletion.
 */
function vaaLedgerProdRetireCanaryPreflightReadOnly(){
  const out={
    phase:'PROD_V2_SINGLE_CANARY_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,prodV2Enabled:false,
    globalRetireOff:false,legacyMigrationOff:false,
    canaryConfigValid:false,canaryUnused:false,
    sourceStable:false,propertyWrites:0,journalWrites:0,
    propertyDeletes:0,activationAuthorized:false,
    errorStage:'NONE',errorCode:'NONE',pass:false
  };
  let stage='MODE';
  try{
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    out.prodV2Enabled=vaaLedgerProdModeStatus_(props).state==='ENABLED';
    const retire=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||
      '').trim();
    const legacy=String(props.getProperty(
      'VAA_PROD_LEGACY_MIGRATION_MODE'
    )||'').trim();
    out.globalRetireOff=!retire||retire==='OFF';
    out.legacyMigrationOff=!legacy||legacy==='OFF';
    const canary=vaaLedgerProdRetireCanary_(props);
    out.canaryConfigValid=!!canary;
    if(!out.prodV2Enabled||!out.globalRetireOff||
       !out.legacyMigrationOff||!canary){
      throw vaaLedgerJournalError_('CANARY_PREFLIGHT_MODE_INVALID');
    }
    stage='SCOPE';
    vaaLedgerProdAssertScope_(props);
    const tabs=vaaLedgerJournalOpenReadOnly_(props);
    stage='ABSENCE';
    if(before[getRequestPropertyKey_(canary.id)]){
      throw vaaLedgerJournalError_('CANARY_PREFLIGHT_ID_IN_USE');
    }
    const old=vaaLedgerReadyLookupFromSheet_(tabs.readySheet,canary.id);
    const modern=vaaLedgerJournalLookupFromSheet_(tabs.sheet,canary.id);
    if(old.state!=='NOT_FOUND'||modern.state!=='ABSENT'){
      throw vaaLedgerJournalError_('CANARY_PREFLIGHT_ID_IN_USE');
    }
    out.canaryUnused=true;
    stage='SOURCE_STABILITY';
    const after=props.getProperties();
    const a=Object.keys(before).sort(),b=Object.keys(after).sort();
    out.sourceStable=a.length===b.length && a.every(function(key,i){
      return key===b[i] && before[key]===after[key];
    });
    if(!out.sourceStable){
      throw vaaLedgerJournalError_('CANARY_PREFLIGHT_SOURCE_CHANGED');
    }
    out.pass=true;
  }catch(err){
    out.pass=false;
    out.errorStage=stage;
    const code=String(err&&err.code||'');
    const allow=[
      'CANARY_PREFLIGHT_MODE_INVALID',
      'CANARY_PREFLIGHT_ID_IN_USE',
      'CANARY_PREFLIGHT_SOURCE_CHANGED',
      'JOURNAL_UNAVAILABLE','JOURNAL_ROW_UNVERIFIED',
      'JOURNAL_CHAIN_UNVERIFIED','LEDGER_UNAVAILABLE',
      'LEDGER_ROW_UNVERIFIED'
    ];
    out.errorCode=allow.indexOf(code)>=0?code:'UNCLASSIFIED';
  }
  console.log('VAA_PROD_RETIRE_CANARY_PREFLIGHT '+JSON.stringify(out));
  return out;
}

/**
 * Operator-only Script Properties control for the exact CREATE canary.
 * Required because the Apps Script property UI is read-only beyond 50 entries.
 * Run manually in the GAS editor; it never invokes doPost or modifies REQ_.
 * No Web App redeploy is needed for this editor-only helper.
 */
function vaaLedgerProdRetireCanaryArmOnce() {
  const out={
    phase:'PROD_CANARY_ARM_ONCE',
    enabled:false,propertyWrites:0,propertyDeletes:0,
    actualPostInvoked:false,postNotInvoked:true,
    errorCode:'NONE',pass:false
  };
  const lock=LockService.getScriptLock();
  let held=false,armingAttempted=false;
  try{
    lock.waitLock(20000);held=true;
    const props=PropertiesService.getScriptProperties();
    const before=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim();
    if(before && before!=='OFF'){
      throw vaaLedgerJournalError_('CANARY_ADMIN_NOT_OFF');
    }
    const pre=vaaLedgerProdRetireCanaryPreflightReadOnly();
    const canary=vaaLedgerProdRetireCanary_(props);
    if(!pre.pass || !canary || canary.operationMode!=='CREATE'){
      throw vaaLedgerJournalError_('CANARY_ADMIN_PREFLIGHT_FAILED');
    }
    armingAttempted=true;
    props.setProperty(
      VAA_LEDGER_PROD_RETIRE_PROP_,VAA_LEDGER_PROD_RETIRE_CANARY_ON_
    );
    out.propertyWrites++;
    if(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)!==
       VAA_LEDGER_PROD_RETIRE_CANARY_ON_ ||
       vaaLedgerProdModeStatus_(props).state!=='ENABLED'){
      throw vaaLedgerJournalError_('CANARY_ADMIN_READBACK_FAILED');
    }
    out.enabled=true;out.pass=true;
  }catch(err){
    const code=String(err&&err.code||'');
    const allowed=[
      'CANARY_ADMIN_NOT_OFF','CANARY_ADMIN_PREFLIGHT_FAILED',
      'CANARY_ADMIN_READBACK_FAILED'
    ];
    out.errorCode=allowed.indexOf(code)>=0?code:'CANARY_ADMIN_FAILED';
    // Only undo a write attempted by THIS call. A duplicate ARM invocation
    // must never turn OFF a canary that may be processing in another call.
    if(armingAttempted){
      try{
        const props=PropertiesService.getScriptProperties();
        if(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)===
           VAA_LEDGER_PROD_RETIRE_CANARY_ON_){
          props.setProperty(VAA_LEDGER_PROD_RETIRE_PROP_,'OFF');
          out.propertyWrites++;
        }
      }catch(_){out.errorCode='CANARY_ADMIN_OFF_UNVERIFIED';}
    }
    out.enabled=false;out.pass=false;
  }finally{
    if(held){try{lock.releaseLock();}catch(_){}}
  }
  // Log booleans and fixed error codes only; never IDs or property values.
  console.log('VAA_PROD_CANARY_ARM '+JSON.stringify(out));
  return out;
}

/**
 * Operator-only switch to OFF after the one-shot GAS execution has ENDED.
 * Unlike the unused-ID preflight, this may be called after the canary is used.
 * Do NOT call while its doPost execution is still running.
 */
function vaaLedgerProdRetireCanaryOffOnce() {
  const out={
    phase:'PROD_CANARY_OFF_ONCE',off:false,
    propertyWrites:0,propertyDeletes:0,
    actualPostInvoked:false,errorCode:'NONE',pass:false
  };
  const lock=LockService.getScriptLock();
  let held=false;
  try{
    lock.waitLock(20000);held=true;
    const props=PropertiesService.getScriptProperties();
    const mode=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim();
    if(mode && mode!=='OFF' &&
       mode!==VAA_LEDGER_PROD_RETIRE_CANARY_ON_){
      throw vaaLedgerJournalError_('CANARY_ADMIN_WRONG_MODE');
    }
    if(mode===VAA_LEDGER_PROD_RETIRE_CANARY_ON_){
      props.setProperty(VAA_LEDGER_PROD_RETIRE_PROP_,'OFF');
      out.propertyWrites++;
    }
    out.off=!props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_) ||
      props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)==='OFF';
    if(!out.off)throw vaaLedgerJournalError_('CANARY_ADMIN_READBACK_FAILED');
    out.pass=true;
  }catch(err){
    const code=String(err&&err.code||'');
    const allowed=['CANARY_ADMIN_WRONG_MODE','CANARY_ADMIN_READBACK_FAILED'];
    out.errorCode=allowed.indexOf(code)>=0?code:'CANARY_ADMIN_FAILED';
  }finally{
    if(held){try{lock.releaseLock();}catch(_){}}
  }
  console.log('VAA_PROD_CANARY_OFF '+JSON.stringify(out));
  return out;
}

/**
 * Post-canary exact-ID proof. READ ONLY: never submit doPost or call the
 * admission helper, which can reserve an ABSENT ID. Verifies all conditions
 * of the existing PROD READY replay branch for the configured CREATE ID,
 * including the target file; never prints ID/target/receipt.
 *
 * This establishes safe replay eligibility, NOT a second HTTP replay.
 */
function vaaLedgerProdCanaryReplayProofCore_(props) {
  const out={
    phase:'PROD_CANARY_REPLAY_PROOF_READ_ONLY',strictReadOnly:true,
    prodV2Enabled:false,retireModeOff:false,legacyMigrationOff:false,
    canaryConfigValid:false,canaryReady:false,canaryReqAbsent:false,
    v1Absent:false,targetVerified:false,replayEligible:false,
    sourceStable:false,propertyWrites:0,journalWrites:0,
    propertyDeletes:0,actualPostInvoked:false,
    replayPerformed:false,pass:false,
    errorStage:'NONE',errorCode:'NONE'
  };
  let stage='MODE';
  try{
    const before=props.getProperties();
    out.prodV2Enabled=vaaLedgerProdModeStatus_(props).state==='ENABLED';
    const retire=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim();
    const legacy=String(props.getProperty('VAA_PROD_LEGACY_MIGRATION_MODE')||'').trim();
    out.retireModeOff=!retire||retire==='OFF';
    out.legacyMigrationOff=!legacy||legacy==='OFF';
    const canary=vaaLedgerProdRetireCanary_(props);
    out.canaryConfigValid=!!canary && canary.operationMode==='CREATE';
    if(!out.prodV2Enabled||!out.retireModeOff||
       !out.legacyMigrationOff||!out.canaryConfigValid){
      throw vaaLedgerJournalError_('REPLAY_PROOF_MODE_INVALID');
    }
    stage='SCOPE';
    vaaLedgerProdAssertScope_(props);
    const tabs=vaaLedgerJournalOpenReadOnly_(props);
    stage='EXACT_CANARY';
    const id=canary.id;
    const old=vaaLedgerReadyLookupFromSheet_(tabs.readySheet,id);
    const modern=vaaLedgerJournalLookupFromSheet_(tabs.sheet,id);
    out.v1Absent=old.state==='NOT_FOUND';
    out.canaryReady=modern.state==='READY' && modern.revision===2;
    out.canaryReqAbsent=!props.getProperty(getRequestPropertyKey_(id));
    if(!out.v1Absent||!out.canaryReady||!out.canaryReqAbsent){
      throw vaaLedgerJournalError_('REPLAY_PROOF_LEDGER_NOT_READY');
    }
    const rec=modern.latest && modern.latest.body &&
      modern.latest.body.receipt;
    const raw=JSON.stringify(rec);
    vaaLedgerReadyValidateRaw_(id,raw);
    stage='TARGET';
    out.targetVerified=vaaLedgerDopReceiptMatches_(
      rec,id,'CREATE','','','',API_CONFIG.SHEET_OUTPUT_FOLDER_ID
    );
    if(!out.targetVerified){
      throw vaaLedgerJournalError_('REPLAY_PROOF_TARGET_UNVERIFIED');
    }
    stage='STABILITY';
    const after=props.getProperties();
    const a=Object.keys(before).sort(),b=Object.keys(after).sort();
    out.sourceStable=a.length===b.length &&
      a.every(function(key,i){return key===b[i] && before[key]===after[key];});
    if(!out.sourceStable){
      throw vaaLedgerJournalError_('REPLAY_PROOF_SOURCE_CHANGED');
    }
    out.replayEligible=true;
    out.pass=true;
  }catch(err){
    out.pass=false;
    out.errorStage=stage;
    const code=String(err&&err.code||'');
    const allowed=[
      'REPLAY_PROOF_MODE_INVALID','REPLAY_PROOF_LEDGER_NOT_READY',
      'REPLAY_PROOF_TARGET_UNVERIFIED','REPLAY_PROOF_SOURCE_CHANGED',
      'LEDGER_RECEIPT_INVALID','JOURNAL_UNAVAILABLE',
      'JOURNAL_CHAIN_UNVERIFIED','LEDGER_UNAVAILABLE'
    ];
    out.errorCode=allowed.indexOf(code)>=0?code:'REPLAY_PROOF_UNCLASSIFIED';
  }
  return out;
}

/** Manual editor call. Strictly non-mutating, exact used CREATE canary only. */
function vaaLedgerProdCanaryReplayProofReadOnly() {
  const lock=LockService.getScriptLock();
  let held=false;
  let out;
  try{
    lock.waitLock(20000);held=true;
    out=vaaLedgerProdCanaryReplayProofCore_(
      PropertiesService.getScriptProperties()
    );
  }catch(_){
    out={
      phase:'PROD_CANARY_REPLAY_PROOF_READ_ONLY',strictReadOnly:true,
      propertyWrites:0,journalWrites:0,propertyDeletes:0,
      actualPostInvoked:false,replayPerformed:false,
      pass:false,errorStage:'LOCK',errorCode:'REPLAY_PROOF_LOCK_UNAVAILABLE'
    };
  }finally{
    if(held){try{lock.releaseLock();}catch(_){}}
  }
  console.log('VAA_PROD_CANARY_REPLAY_PROOF '+JSON.stringify(out));
  return out;
}

/**
 * PREPARED, NOT ACTIVATED. Enabling ongoing retirement of ONLY new V2 READY
 * receipts requires explicit separate operator approval and manual call.
 * Existing/legacy REQ_ records are NOT touched by this helper.
 *
 * A single ScriptLock protects preconditions and the one-key write.
 * A duplicate ON invocation may not flip an already active setting to OFF.
 */
function vaaLedgerProdReadyRetireEnableAllNewOnce() {
  const out={
    phase:'PROD_NEW_READY_RETIRE_ENABLE_ONCE',enabled:false,
    replayProofPassed:false,aggregatePassed:false,
    propertyWrites:0,propertyDeletes:0,
    actualPostInvoked:false,existingReqDeleted:false,
    errorCode:'NONE',pass:false
  };
  const lock=LockService.getScriptLock();
  let held=false,writeAttempted=false;
  try{
    lock.waitLock(20000);held=true;
    const props=PropertiesService.getScriptProperties();
    const mode=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim();
    if(mode && mode!=='OFF'){
      throw vaaLedgerJournalError_('GLOBAL_RETIRE_ALREADY_SET');
    }
    const proof=vaaLedgerProdCanaryReplayProofCore_(props);
    out.replayProofPassed=proof.pass===true && proof.replayEligible===true;
    if(!out.replayProofPassed){
      throw vaaLedgerJournalError_('GLOBAL_RETIRE_REPLAY_NOT_VERIFIED');
    }
    const pre=vaaLedgerProdReadyRetirePreflightReadOnly();
    out.aggregatePassed=pre.pass===true && pre.journalPending===0 &&
      pre.modernReadyWithoutReq>=1 && pre.sourceStable===true &&
      pre.prodV2Enabled===true && pre.retireModeOff===true &&
      pre.legacyMigrationOff===true;
    if(!out.aggregatePassed){
      throw vaaLedgerJournalError_('GLOBAL_RETIRE_PREFLIGHT_FAILED');
    }
    writeAttempted=true;
    props.setProperty(VAA_LEDGER_PROD_RETIRE_PROP_,VAA_LEDGER_PROD_RETIRE_ON_);
    out.propertyWrites++;
    if(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)!==VAA_LEDGER_PROD_RETIRE_ON_ ||
       vaaLedgerProdModeStatus_(props).state!=='ENABLED'){
      throw vaaLedgerJournalError_('GLOBAL_RETIRE_READBACK_FAILED');
    }
    out.enabled=true;out.pass=true;
  }catch(err){
    const code=String(err&&err.code||'');
    const allowed=[
      'GLOBAL_RETIRE_ALREADY_SET','GLOBAL_RETIRE_REPLAY_NOT_VERIFIED',
      'GLOBAL_RETIRE_PREFLIGHT_FAILED','GLOBAL_RETIRE_READBACK_FAILED'
    ];
    out.errorCode=allowed.indexOf(code)>=0?code:'GLOBAL_RETIRE_FAILED';
    // Revert only a write attempted in THIS invocation.
    if(writeAttempted){
      try{
        const props=PropertiesService.getScriptProperties();
        if(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)===VAA_LEDGER_PROD_RETIRE_ON_){
          props.setProperty(VAA_LEDGER_PROD_RETIRE_PROP_,'OFF');
          out.propertyWrites++;
        }
      }catch(_){out.errorCode='GLOBAL_RETIRE_OFF_UNVERIFIED';}
    }
    out.enabled=false;out.pass=false;
  }finally{
    if(held){try{lock.releaseLock();}catch(_){}}
  }
  console.log('VAA_PROD_NEW_READY_RETIRE_ENABLE '+JSON.stringify(out));
  return out;
}

/**
 * Manual emergency OFF for the ongoing new-READY retirement mode.
 * Call only after active production requests have finished.
 * Does not disable the V2 sticky gate or mutate legacy REQ_ records.
 */
function vaaLedgerProdReadyRetireDisableAllNewOnce() {
  const out={
    phase:'PROD_NEW_READY_RETIRE_DISABLE_ONCE',off:false,
    propertyWrites:0,propertyDeletes:0,actualPostInvoked:false,
    errorCode:'NONE',pass:false
  };
  const lock=LockService.getScriptLock();
  let held=false;
  try{
    lock.waitLock(20000);held=true;
    const props=PropertiesService.getScriptProperties();
    const mode=String(props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||'').trim();
    if(mode && mode!=='OFF' && mode!==VAA_LEDGER_PROD_RETIRE_ON_){
      throw vaaLedgerJournalError_('GLOBAL_RETIRE_WRONG_MODE');
    }
    if(mode===VAA_LEDGER_PROD_RETIRE_ON_){
      props.setProperty(VAA_LEDGER_PROD_RETIRE_PROP_,'OFF');
      out.propertyWrites++;
    }
    out.off=!props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)||
      props.getProperty(VAA_LEDGER_PROD_RETIRE_PROP_)==='OFF';
    if(!out.off)throw vaaLedgerJournalError_('GLOBAL_RETIRE_READBACK_FAILED');
    out.pass=true;
  }catch(err){
    const code=String(err&&err.code||'');
    const allowed=['GLOBAL_RETIRE_WRONG_MODE','GLOBAL_RETIRE_READBACK_FAILED'];
    out.errorCode=allowed.indexOf(code)>=0?code:'GLOBAL_RETIRE_FAILED';
  }finally{
    if(held){try{lock.releaseLock();}catch(_){}}
  }
  console.log('VAA_PROD_NEW_READY_RETIRE_DISABLE '+JSON.stringify(out));
  return out;
}
