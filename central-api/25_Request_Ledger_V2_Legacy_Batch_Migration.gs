/**
 * Production legacy READY history migration: dual-archive batch workflow.
 *
 * DEFAULT OFF, ONLY manual GAS editor operation, never called by doPost.
 * Uses the current V1 receipts ledger AND an independent PRIVATE backup
 * Google Sheet in the same verified admin root. COPY preserves all REQ_;
 * RETIRE is independently gated and only removes READY REQ_ after BOTH
 * copies match the exact source JSON, with journal replay verified.
 *
 * Protected historic UPDATEs and missing/trashed targets are preserved,
 * but no longer block the independent, verified set of READY receipts.
 *
 * Every run obtains ScriptLock and caps itself at 10 histories. A failed
 * write response is UNKNOWN: inspect the read-only summary before any
 * manually approved further run. No automatic retry, no triggers, no
 * sweeping ERROR/PROCESSING/RESERVED histories, no personal data in logs.
 */
const VAA_PROD_LEGACY_MODE_PROP_='VAA_PROD_LEGACY_MIGRATION_MODE';
const VAA_PROD_LEGACY_COPY_MODE_='COPY_DUAL_ARCHIVE_READY_V1';
const VAA_PROD_LEGACY_RETIRE_MODE_='RETIRE_DUAL_VERIFIED_READY_V1';
const VAA_PROD_LEGACY_BACKUP_PROP_='VAA_PROD_LEGACY_BACKUP_SPREADSHEET_ID';
const VAA_PROD_LEGACY_BATCH_LIMIT_=10;

function vaaLedgerProdLegacySnapshotsEqual_(left,right){
  const ak=Object.keys(left||{}).sort();
  const bk=Object.keys(right||{}).sort();
  return ak.length===bk.length && ak.every(function(key,i){
    return key===bk[i] && left[key]===right[key];
  });
}

function vaaLedgerProdLegacyBackupSheet_(props){
  vaaLedgerProdAssertScope_(props);
  const id=String(props.getProperty(VAA_PROD_LEGACY_BACKUP_PROP_)||'').trim();
  const main=String(props.getProperty(VAA_LEDGER_READY_PROPERTY_)||'').trim();
  const root=String(props.getProperty(VAA_LEDGER_PROD_ROOT_PROP_)||'').trim();
  if(!/^[A-Za-z0-9_-]{20,}$/.test(id) ||
     id===main || id===root ||
     id===String(props.getProperty(VAA_LEDGER_PROD_OUTPUT_PROP_)||'')){
    throw vaaLedgerReadyError_('LEGACY_BACKUP_NOT_CONFIGURED');
  }
  try{
    const file=DriveApp.getFileById(id);
    if(file.getMimeType()!==MimeType.GOOGLE_SHEETS ||
       file.getSharingAccess()!==DriveApp.Access.PRIVATE ||
       (typeof file.isTrashed==='function'&&file.isTrashed())){
      throw Error('invalid');
    }
    const parents=file.getParents();
    let count=0,valid=true;
    while(parents.hasNext()&&count<2){
      count++;
      if(parents.next().getId()!==root)valid=false;
    }
    if(count!==1||!valid)throw Error('invalid');
  }catch(_){
    throw vaaLedgerReadyError_('LEGACY_BACKUP_PRIVATE_SCOPE_FAILED');
  }
  const adapter={
    getProperty:function(key){
      if(key===VAA_LEDGER_READY_PROPERTY_)return id;
      return props.getProperty(key);
    }
  };
  return {sheet:vaaLedgerReadyOpenReadOnly_(adapter),adapter:adapter};
}

function vaaLedgerProdLegacyEntries_(props,snapshot){
  const data=snapshot||props.getProperties();
  const prefix=API_CONFIG.REQUEST_PROPERTY_PREFIX;
  const result={ready:[],nonReady:0,modern:0,quarantined:[]};
  Object.keys(data).sort().forEach(function(key){
    if(key.indexOf(prefix)!==0)return;
    const id=key.slice(prefix.length);
    if(/^QA_JOURNAL_E2E_(CREATE|UPDATE)_/.test(id)){
      result.modern++;
      return;
    }
    let record;
    try{record=JSON.parse(data[key]);}catch(_){
      throw vaaLedgerReadyError_('LEGACY_SOURCE_INVALID');
    }
    if(!record||record.status!=='READY'){
      result.nonReady++;
      return;
    }
    try {
      vaaLedgerReadyValidateRaw_(id,data[key]);
    } catch (err) {
      // Historic UPDATE READY receipts may predate strategy/digest tracking.
      // They cannot safely replay from V1: protect the original REQ_ and
      // quarantine only this precisely known missing-metadata shape.
      // Any other invalid READY receipt still HALTs the entire batch.
      const legacyNoReplayProof=
        record && !Array.isArray(record) &&
        record.requestId===id && record.status==='READY' &&
        record.stage==='READY' && record.operationMode==='UPDATE' &&
        // Do not add stricter ID-format requirements than the original
        // READY validator. This is a protected/non-replayable category,
        // never permission to archive, replay or retire the old record.
        // Older receipts can contain noncanonical target references.
        !!record.spreadsheetId &&
        record.targetSpreadsheetId===record.spreadsheetId &&
        !String(record.updatePayloadDigest||'').trim() &&
        record.updateStrategy!=='APPEND' &&
        record.updateStrategy!=='REPLACE';
      if(!legacyNoReplayProof)throw err;
      vaaLedgerReadyRequestId_(id);
      result.quarantined.push({id:id});
      return;
    }
    if(record.leaseUntil){
      const end=Date.parse(record.leaseUntil);
      if(!Number.isFinite(end)||end>Date.now()){
        throw vaaLedgerReadyError_('LEGACY_SOURCE_ACTIVE');
      }
    }
    if(record.operationMode==='UPDATE' &&
       props.getProperty(vaaTargetUpdateLeaseKey_(record.targetSpreadsheetId))){
      throw vaaLedgerReadyError_('LEGACY_TARGET_LEASE_PRESENT');
    }
    result.ready.push({id:id,raw:data[key],record:record});
  });
  return result;
}

/**
 * Classify historical target availability without weakening the managed
 * output-folder rule for any receipt allowed into the READY replay ledger.
 * A former target that is inaccessible, trashed, wrong MIME or outside the
 * managed tree is protected as a source-only legacy REQ_, never copied.
 * Unknown Drive/validation errors continue to fail CLOSED.
 */
function vaaLedgerProdLegacyTargetStatus_(spreadsheetId){
  let file;
  try{
    file=DriveApp.getFileById(spreadsheetId);
  }catch(_){
    return 'CANNOT_OPEN';
  }
  if(file && typeof file.isTrashed==='function' && file.isTrashed()){
    return 'TRASHED';
  }
  if(!file || file.getMimeType()!==MimeType.GOOGLE_SHEETS){
    return 'WRONG_MIME';
  }
  try{
    const verified=validateUpdateTargetDriveFile_(
      spreadsheetId,API_CONFIG.SHEET_OUTPUT_FOLDER_ID
    );
    if(verified && typeof verified.isTrashed==='function' &&
       verified.isTrashed())return 'TRASHED';
  }catch(err){
    if(err&&err.code==='TARGET_INVALID')return 'CANNOT_OPEN';
    if(err&&err.code==='TARGET_OUTSIDE_OUTPUT_FOLDER')return 'OUTSIDE';
    throw err;
  }
  return 'VERIFIED';
}

function vaaLedgerProdLegacyReview_(props,entries,v1,backup,v2){
  const summary={
    legacyReady:0,legacyReadySeen:0,
    nonReady:entries.nonReady,modernExcluded:entries.modern,
    quarantinedLegacyReady:0,quarantinedTargetReady:0,
    targetCannotOpen:0,targetWrongMime:0,targetTrashed:0,
    targetOutsideManagedOutput:0,
    verifiedBoth:0,needPrimaryCopy:0,needBackupCopy:0,
    conflicting:0,modernJournalExcluded:0,targetsVerified:0
  };
  const toCopy=[];
  const toRetire=[];
  // Quarantined history is not COPY/RETIRE eligible. Checking V2 absence
  // prevents hiding a damaged modern READY journal behind legacy shape.
  entries.quarantined.forEach(function(item){
    const state=vaaLedgerJournalLookupFromSheet_(v2,item.id);
    if(state.state!=='ABSENT'){
      throw vaaLedgerReadyError_('LEGACY_QUARANTINE_JOURNAL_COLLISION');
    }
    summary.quarantinedLegacyReady++;
  });
  entries.ready.forEach(function(item){
    const journal=vaaLedgerJournalLookupFromSheet_(v2,item.id);
    if(journal.state==='READY' && journal.revision===2){
      // Fresh V2 request. Its retention is governed only by PROD new READY
      // mode, never by this legacy migration.
      summary.modernJournalExcluded++;
      return;
    }
    if(journal.state!=='ABSENT'){
      throw vaaLedgerReadyError_('LEGACY_JOURNAL_COLLISION');
    }
    summary.legacyReadySeen++;
    // Check both archives for conflicts BEFORE excluding an unavailable
    // historic target. Exclusion is never permission to hide a mismatch.
    const first=vaaLedgerReadyLookupFromSheet_(v1,item.id);
    const second=vaaLedgerReadyLookupFromSheet_(backup,item.id);
    if((first.state==='FOUND'&&first.raw!==item.raw) ||
       (second.state==='FOUND'&&second.raw!==item.raw) ||
       (first.state!=='FOUND'&&first.state!=='NOT_FOUND') ||
       (second.state!=='FOUND'&&second.state!=='NOT_FOUND')){
      summary.conflicting++;
      throw vaaLedgerReadyError_('LEGACY_ARCHIVE_CONFLICT');
    }
    const status=vaaLedgerProdLegacyTargetStatus_(
      item.record.spreadsheetId
    );
    if(status!=='VERIFIED'){
      summary.quarantinedTargetReady++;
      if(status==='CANNOT_OPEN')summary.targetCannotOpen++;
      else if(status==='WRONG_MIME')summary.targetWrongMime++;
      else if(status==='TRASHED')summary.targetTrashed++;
      else if(status==='OUTSIDE')summary.targetOutsideManagedOutput++;
      else throw vaaLedgerReadyError_('LEGACY_TARGET_CLASSIFICATION_INVALID');
      return; // Preserve original REQ_, never archive or retire this ID.
    }
    summary.legacyReady++;
    summary.targetsVerified++;
    if(first.state==='FOUND' && second.state==='FOUND'){
      summary.verifiedBoth++;
      toRetire.push(item);
    }else{
      if(first.state==='NOT_FOUND')summary.needPrimaryCopy++;
      if(second.state==='NOT_FOUND')summary.needBackupCopy++;
      toCopy.push(item);
    }
  });
  return {summary:summary,toCopy:toCopy,toRetire:toRetire};
}

/** Static allowlist: return no raw Error.message or dynamic identifiers. */
function vaaLedgerProdLegacyAuditErrorCode_(err){
  const code=String(err&&err.code||'');
  const allowed=[
    'LEDGER_RECEIPT_INVALID','LEDGER_REQUEST_ID_INVALID',
    'LEGACY_SOURCE_INVALID','LEGACY_SOURCE_ACTIVE',
    'LEGACY_TARGET_LEASE_PRESENT','LEGACY_QUARANTINE_JOURNAL_COLLISION',
    'LEGACY_JOURNAL_COLLISION','LEGACY_TARGET_TRASHED',
    'LEGACY_ARCHIVE_CONFLICT','JOURNAL_UNAVAILABLE',
    'JOURNAL_ROW_UNVERIFIED','JOURNAL_SCHEMA_MISMATCH',
    'JOURNAL_CHAIN_UNVERIFIED','JOURNAL_EVENT_COUNT_INVALID',
    'LEDGER_UNAVAILABLE','LEDGER_ROW_UNVERIFIED',
    'LEDGER_SCHEMA_MISMATCH','LEDGER_DUPLICATE_KEY',
    'TARGET_INVALID','TARGET_OUTSIDE_OUTPUT_FOLDER',
    'LEGACY_BACKUP_NOT_CONFIGURED',
    'LEGACY_BACKUP_PRIVATE_SCOPE_FAILED',
    'JOURNAL_PROD_SCOPE_DENIED','JOURNAL_PROD_MODE_REQUIRED',
    'JOURNAL_PROD_LEDGER_UNVERIFIED'
  ];
  return allowed.indexOf(code)>=0?code:'UNCLASSIFIED';
}

/** Read-only aggregate inventory. IDs, original REQ data and error strings
 * never appear in output. Safe after an unknown COPY/RETIRE result.
 */
function vaaLedgerProdLegacyAuditReadOnly(){
  const out={
    phase:'PROD_LEGACY_DUAL_ARCHIVE_AUDIT_READ_ONLY',
    strictReadOnly:true,sourceStable:false,
    ready:0,legacyReadySeen:0,nonReady:0,modernExcluded:0,
    quarantinedLegacyReady:0,quarantinedTargetReady:0,
    targetCannotOpen:0,targetWrongMime:0,targetTrashed:0,
    targetOutsideManagedOutput:0,
    verifiedBoth:0,needPrimaryCopy:0,needBackupCopy:0,
    modernJournalExcluded:0,targetsVerified:0,
    copyAuthorized:false,retireAuthorized:false,
    propertyWrites:0,archiveWrites:0,
    errorStage:'NONE',errorCode:'NONE',pass:false
  };
  let stage='SCOPE';
  try{
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    vaaLedgerProdAssertScope_(props);
    const v1=vaaLedgerReadyOpenReadOnly_(props);
    const backup=vaaLedgerProdLegacyBackupSheet_(props).sheet;
    const journal=vaaLedgerJournalOpenReadOnly_(props).sheet;
    stage='ENUMERATE';
    const entries=vaaLedgerProdLegacyEntries_(props,before);
    stage='REVIEW';
    const reviewed=vaaLedgerProdLegacyReview_(
      props,entries,v1,backup,journal
    ).summary;
    Object.assign(out,{
      ready:reviewed.legacyReady,legacyReadySeen:reviewed.legacyReadySeen,
      nonReady:reviewed.nonReady,modernExcluded:reviewed.modernExcluded,
      quarantinedLegacyReady:reviewed.quarantinedLegacyReady,
      quarantinedTargetReady:reviewed.quarantinedTargetReady,
      targetCannotOpen:reviewed.targetCannotOpen,
      targetWrongMime:reviewed.targetWrongMime,
      targetTrashed:reviewed.targetTrashed,
      targetOutsideManagedOutput:reviewed.targetOutsideManagedOutput,
      verifiedBoth:reviewed.verifiedBoth,
      needPrimaryCopy:reviewed.needPrimaryCopy,
      needBackupCopy:reviewed.needBackupCopy,
      modernJournalExcluded:reviewed.modernJournalExcluded,
      targetsVerified:reviewed.targetsVerified
    });
    out.sourceStable=vaaLedgerProdLegacySnapshotsEqual_(
      before,props.getProperties()
    );
    out.pass=out.sourceStable && reviewed.conflicting===0;
    out.errorStage=out.pass?'NONE':'SOURCE_CHANGED';
    out.errorCode=out.pass?'NONE':'SOURCE_CHANGED';
  }catch(err){
    out.pass=false;
    out.errorStage=stage;
    out.errorCode=vaaLedgerProdLegacyAuditErrorCode_(err);
  }
  console.log('VAA_PROD_LEGACY_AUDIT '+JSON.stringify(out));
  return out;
}

/** Under lock, copy up to ten old READY records to independent backup
 * then primary V1; both read back exactly. NEVER deletes REQ_.
 */
function vaaLedgerProdLegacyCopyBatchOnce(){
  return vaaLedgerProdLegacyMutateBatch_('COPY');
}
/** Under lock, retire up to ten independently dual-verified eligible
 * historic READY REQ_ records; protected and non-READY sources are NEVER
 * selected. Every eligible (non-protected) READY must be dual archived.
 */
function vaaLedgerProdLegacyRetireBatchOnce(){
  return vaaLedgerProdLegacyMutateBatch_('RETIRE');
}

function vaaLedgerProdLegacyMutateBatch_(action){
  const out={
    phase:action==='COPY'?'PROD_LEGACY_COPY_BATCH':
      'PROD_LEGACY_RETIRE_BATCH',
    action:action,scriptLockHeld:false,scopeVerified:false,
    beforeReadyCount:0,alreadyDualVerified:0,
    quarantinedLegacyReady:0,quarantinedTargetReady:0,
    targetCannotOpen:0,targetWrongMime:0,targetTrashed:0,
    targetOutsideManagedOutput:0,
    copied:0,retired:0,remainingNeedCopy:0,
    sourceStableAfter:false,unknownCompletion:false,
    automaticRetryAuthorized:false,cleanupAuthorized:false,
    pass:false,errorStage:'NONE'
  };
  let stage='MODE';
  let lock=null,held=false;
  try{
    const props=PropertiesService.getScriptProperties();
    const desired=action==='COPY'?VAA_PROD_LEGACY_COPY_MODE_:
      VAA_PROD_LEGACY_RETIRE_MODE_;
    if(String(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)||'')!==desired){
      throw vaaLedgerReadyError_('LEGACY_MODE_NOT_ARMED');
    }
    stage='LOCK';
    lock=LockService.getScriptLock();
    lock.waitLock(20000);held=true;
    out.scriptLockHeld=true;
    // The operator may have turned the legacy mode OFF while this batch
    // waited for ScriptLock. Re-check only AFTER acquiring that lock.
    stage='MODE_UNDER_LOCK';
    if(String(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)||'')!==desired){
      throw vaaLedgerReadyError_('LEGACY_MODE_CHANGED');
    }
    stage='SCOPE';
    vaaLedgerProdAssertScope_(props);
    const v1=vaaLedgerReadyOpenReadOnly_(props);
    const backupInfo=vaaLedgerProdLegacyBackupSheet_(props);
    const journal=vaaLedgerJournalOpenReadOnly_(props).sheet;
    out.scopeVerified=true;
    stage='INVENTORY';
    const before=props.getProperties();
    const entries=vaaLedgerProdLegacyEntries_(props,before);
    const review=vaaLedgerProdLegacyReview_(
      props,entries,v1,backupInfo.sheet,journal
    );
    out.beforeReadyCount=review.summary.legacyReady;
    out.quarantinedLegacyReady=review.summary.quarantinedLegacyReady;
    out.quarantinedTargetReady=review.summary.quarantinedTargetReady;
    out.targetCannotOpen=review.summary.targetCannotOpen;
    out.targetWrongMime=review.summary.targetWrongMime;
    out.targetTrashed=review.summary.targetTrashed;
    out.targetOutsideManagedOutput=review.summary.targetOutsideManagedOutput;
    out.alreadyDualVerified=review.summary.verifiedBoth;
    // Protected old UPDATEs and missing/trashed/out-of-tree targets
    // must never be COPY/RETIRE candidates. Do not globally block
    // independently verified dual-archived READY receipts because of
    // unrelated protected records: keep the latter's REQ_ intact.
    // Only review.toRetire, independently proven by BOTH exact archives
    // and a verified live target, may be selected below.
    out.remainingNeedCopy=review.toCopy.length;
    if(action==='RETIRE' && review.toCopy.length>0){
      throw vaaLedgerReadyError_('LEGACY_DUAL_ARCHIVE_INCOMPLETE');
    }
    const selected=action==='COPY'?review.toCopy.slice(0,VAA_PROD_LEGACY_BATCH_LIMIT_):
      review.toRetire.slice(0,VAA_PROD_LEGACY_BATCH_LIMIT_);
    for(let i=0;i<selected.length;i++){
      const item=selected[i];
      const key=getRequestPropertyKey_(item.id);
      if(props.getProperty(key)!==item.raw){
        throw vaaLedgerReadyError_('LEGACY_SOURCE_CHANGED');
      }
      if(action==='COPY'){
        stage='COPY_UNCERTAIN';
        const backed=vaaLedgerReadyCopyOneUnderLock_(
          backupInfo.adapter,item.id
        );
        if(backed.state!=='COPIED_AND_VERIFIED'&&
           backed.state!=='VERIFIED_EXISTING'){
          throw vaaLedgerReadyError_('LEGACY_BACKUP_UNVERIFIED');
        }
        const primary=vaaLedgerReadyCopyOneUnderLock_(props,item.id);
        if(primary.state!=='COPIED_AND_VERIFIED'&&
           primary.state!=='VERIFIED_EXISTING'){
          throw vaaLedgerReadyError_('LEGACY_PRIMARY_UNVERIFIED');
        }
        const v1Read=vaaLedgerReadyLookupFromSheet_(v1,item.id);
        const bRead=vaaLedgerReadyLookupFromSheet_(backupInfo.sheet,item.id);
        if(v1Read.state!=='FOUND'||v1Read.raw!==item.raw||
           bRead.state!=='FOUND'||bRead.raw!==item.raw||
           props.getProperty(key)!==item.raw){
          throw vaaLedgerReadyError_('LEGACY_COPY_READBACK_FAILED');
        }
        out.copied++;
      }else{
        stage='RETIRE_UNCERTAIN';
        // Re-read each exact source and two independent copies immediately
        // BEFORE deleting this one key. Any unknown result fails closed.
        const v1Read=vaaLedgerReadyLookupFromSheet_(v1,item.id);
        const bRead=vaaLedgerReadyLookupFromSheet_(backupInfo.sheet,item.id);
        if(v1Read.state!=='FOUND'||v1Read.raw!==item.raw||
           bRead.state!=='FOUND'||bRead.raw!==item.raw||
           props.getProperty(key)!==item.raw){
          throw vaaLedgerReadyError_('LEGACY_RETIRE_PRECHECK_FAILED');
        }
        props.deleteProperty(key);
        const replay=vaaLedgerProdDecideUnderLock_(
          props,item.id,item.record.operationMode,
          item.record.operationMode==='UPDATE'?
            item.record.targetSpreadsheetId:'',
          item.record.operationMode==='UPDATE'?
            item.record.updateStrategy:'',
          item.record.operationMode==='UPDATE'?
            item.record.updatePayloadDigest:'',
          false
        );
        if(props.getProperty(key)||replay.state!=='READY'){
          throw vaaLedgerReadyError_('LEGACY_RETIRE_REPLAY_UNVERIFIED');
        }
        out.retired++;
      }
    }
    stage='POST_CHECK';
    // The only permitted REQ mutations here are the selected retired keys.
    const after=props.getProperties();
    const acceptable=Object.assign({},before);
    if(action==='RETIRE'){
      selected.slice(0,out.retired).forEach(function(item){
        delete acceptable[getRequestPropertyKey_(item.id)];
      });
    }
    out.sourceStableAfter=vaaLedgerProdLegacySnapshotsEqual_(acceptable,after);
    if(!out.sourceStableAfter){
      throw vaaLedgerReadyError_('LEGACY_BATCH_SOURCE_CHANGED');
    }
    out.pass=true;
    out.errorStage='NONE';
  }catch(_){
    out.pass=false;out.errorStage=stage;
    out.unknownCompletion=
      stage==='COPY_UNCERTAIN'||stage==='RETIRE_UNCERTAIN';
  }finally{
    if(held)try{lock.releaseLock();}catch(_){
      out.pass=false;out.errorStage='LOCK_RELEASE';
    }
  }
  console.log('VAA_PROD_LEGACY_BATCH '+JSON.stringify(out));
  return out;
}

/**
 * Operator-only narrow mode switches for the Apps Script 50+ Properties UI.
 * These helpers ONLY alter the legacy migration mode key; they never copy,
 * retire, or log an ID/receipt. Defaults remain OFF. Calls are MANUAL,
 * independently authorized before running COPY/RETIRE batch mutators.
 */
function vaaLedgerProdLegacyArmCopyModeOnce(){
  return vaaLedgerProdLegacyArmBatchModeOnce_('COPY');
}
function vaaLedgerProdLegacyArmRetireModeOnce(){
  return vaaLedgerProdLegacyArmBatchModeOnce_('RETIRE');
}
function vaaLedgerProdLegacyArmBatchModeOnce_(action){
  const desired=action==='COPY'?VAA_PROD_LEGACY_COPY_MODE_:
    action==='RETIRE'?VAA_PROD_LEGACY_RETIRE_MODE_:'';
  const out={
    phase:'PROD_LEGACY_BATCH_MODE_ARM',action:action,
    armed:false,readOnlyAuditPassed:false,
    eligibleCount:0,protectedCount:0,
    propertyWrites:0,propertyDeletes:0,
    archiveWrites:0,requestPosts:0,
    pass:false,errorCode:'NONE'
  };
  const lock=LockService.getScriptLock();
  let held=false,writeAttempted=false;
  try{
    if(!desired)throw vaaLedgerReadyError_('LEGACY_ARM_ACTION_DENIED');
    lock.waitLock(20000);held=true;
    const props=PropertiesService.getScriptProperties();
    const mode=String(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)||'').trim();
    if(mode&&mode!=='OFF'){
      throw vaaLedgerReadyError_('LEGACY_ARM_NOT_OFF');
    }
    const audit=vaaLedgerProdLegacyAuditReadOnly();
    out.readOnlyAuditPassed=audit.pass===true && audit.sourceStable===true &&
      audit.strictReadOnly===true &&
      audit.propertyWrites===0 && audit.archiveWrites===0;
    if(!out.readOnlyAuditPassed){
      throw vaaLedgerReadyError_('LEGACY_ARM_AUDIT_FAILED');
    }
    out.eligibleCount=action==='COPY'?Math.max(audit.needPrimaryCopy,
      audit.needBackupCopy):audit.verifiedBoth;
    out.protectedCount=audit.quarantinedLegacyReady+
      audit.quarantinedTargetReady+audit.nonReady+
      audit.modernJournalExcluded+audit.modernExcluded;
    if(action==='COPY' && out.eligibleCount<1){
      throw vaaLedgerReadyError_('LEGACY_ARM_NOTHING_TO_COPY');
    }
    if(action==='RETIRE' &&
       (out.eligibleCount<1 || audit.needPrimaryCopy!==0 ||
        audit.needBackupCopy!==0)){
      throw vaaLedgerReadyError_('LEGACY_ARM_DUAL_ARCHIVE_INCOMPLETE');
    }
    writeAttempted=true;
    props.setProperty(VAA_PROD_LEGACY_MODE_PROP_,desired);
    out.propertyWrites++;
    if(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)!==desired ||
       vaaLedgerProdModeStatus_(props).state!=='ENABLED'){
      throw vaaLedgerReadyError_('LEGACY_ARM_READBACK_FAILED');
    }
    out.armed=true;out.pass=true;
  }catch(err){
    const code=String(err&&err.code||'');
    const allowed=['LEGACY_ARM_ACTION_DENIED','LEGACY_ARM_NOT_OFF',
      'LEGACY_ARM_AUDIT_FAILED','LEGACY_ARM_NOTHING_TO_COPY',
      'LEGACY_ARM_DUAL_ARCHIVE_INCOMPLETE','LEGACY_ARM_READBACK_FAILED'];
    out.errorCode=allowed.indexOf(code)>=0?code:'LEGACY_ARM_FAILED';
    if(writeAttempted){
      try{
        const props=PropertiesService.getScriptProperties();
        if(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)===desired){
          props.setProperty(VAA_PROD_LEGACY_MODE_PROP_,'OFF');
          out.propertyWrites++;
        }
      }catch(_){out.errorCode='LEGACY_ARM_OFF_UNVERIFIED';}
    }
    out.armed=false;out.pass=false;
  }finally{
    if(held)try{lock.releaseLock();}catch(_){}
  }
  console.log('VAA_PROD_LEGACY_MODE_ARM '+JSON.stringify(out));
  return out;
}

/** Restore only the legacy migration mode to OFF after a completed batch. */
function vaaLedgerProdLegacyModeOffOnce(){
  const out={
    phase:'PROD_LEGACY_MODE_OFF',off:false,
    propertyWrites:0,propertyDeletes:0,
    archiveWrites:0,requestPosts:0,
    pass:false,errorCode:'NONE'
  };
  const lock=LockService.getScriptLock();let held=false;
  try{
    lock.waitLock(20000);held=true;
    const props=PropertiesService.getScriptProperties();
    const mode=String(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)||'').trim();
    if(mode && mode!=='OFF' && mode!==VAA_PROD_LEGACY_COPY_MODE_ &&
       mode!==VAA_PROD_LEGACY_RETIRE_MODE_){
      throw vaaLedgerReadyError_('LEGACY_OFF_MODE_INVALID');
    }
    if(mode && mode!=='OFF'){
      props.setProperty(VAA_PROD_LEGACY_MODE_PROP_,'OFF');
      out.propertyWrites++;
    }
    out.off=!props.getProperty(VAA_PROD_LEGACY_MODE_PROP_) ||
      props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)==='OFF';
    if(!out.off)throw vaaLedgerReadyError_('LEGACY_OFF_READBACK_FAILED');
    out.pass=true;
  }catch(err){
    const code=String(err&&err.code||'');
    out.errorCode=code==='LEGACY_OFF_MODE_INVALID' ||
      code==='LEGACY_OFF_READBACK_FAILED'?code:'LEGACY_OFF_FAILED';
  }finally{
    if(held)try{lock.releaseLock();}catch(_){}
  }
  console.log('VAA_PROD_LEGACY_MODE_OFF '+JSON.stringify(out));
  return out;
}


/**
 * Operator-only read-only triage of residual legacy request receipts.
 * Runs once; never copies, deletes, migrates, or authorizes cleanup.
 * No request IDs, spreadsheet IDs, URLs, client names or raw JSON in logs.
 */
function vaaLedgerResidualFolderSnapshot_(){
  const root=DriveApp.getFolderById(API_CONFIG.SHEET_OUTPUT_FOLDER_ID);
  if(typeof root.isTrashed==='function' && root.isTrashed()){
    throw Error('TRIAGE_ROOT_TRASHED');
  }
  const folderCap=500, fileCap=10000;
  const folders=[root], ids={}, seenFolders={};
  seenFolders[root.getId()]=true;
  const children=root.getFolders();
  while(children.hasNext()){
    if(folders.length>=folderCap)throw Error('TRIAGE_FOLDER_LIMIT');
    const child=children.next();
    if(typeof child.isTrashed==='function'&&child.isTrashed())continue;
    const id=child.getId();
    if(seenFolders[id])throw Error('TRIAGE_FOLDER_DUPLICATE');
    seenFolders[id]=true;
    folders.push(child);
  }
  let checked=0;
  for(let i=0;i<folders.length;i++){
    const files=folders[i].getFilesByType(MimeType.GOOGLE_SHEETS);
    while(files.hasNext()){
      if(checked>=fileCap)throw Error('TRIAGE_FILE_LIMIT');
      const file=files.next();
      checked++;
      if(typeof file.isTrashed==='function'&&file.isTrashed())continue;
      ids[file.getId()]=true;
    }
  }
  return {ids:ids,folderCount:folders.length,fileCount:checked,
    uniqueSheetCount:Object.keys(ids).length,inventoryComplete:true};
}

/** Existing Registry/Viewer mappings are conservative references, not proof
 * that the spreadsheet is currently managed. Any malformed reference source
 * prevents classification as unlinked.
 */
function vaaLedgerResidualReferences_(snapshot){
  const ids={}, stat={registry:0,viewer:0,malformed:0};
  Object.keys(snapshot).forEach(function(key){
    const registry=key.indexOf(API_CONFIG.REPORT_REGISTRY_PREFIX)===0;
    const viewer=key.indexOf('VIEWER_')===0;
    if(!registry&&!viewer)return;
    if(registry){
      stat.registry++;
      const suffix=key.slice(API_CONFIG.REPORT_REGISTRY_PREFIX.length);
      if(suffix)ids[suffix]=true;
    }else stat.viewer++;
    try{
      const rec=JSON.parse(snapshot[key]);
      if(!rec||typeof rec!=='object'||Array.isArray(rec)||
         !String(rec.spreadsheetId||'').trim()){
        stat.malformed++;
        return;
      }
      ids[String(rec.spreadsheetId).trim()]=true;
      if(registry &&
         key.slice(API_CONFIG.REPORT_REGISTRY_PREFIX.length)!==
           String(rec.spreadsheetId).trim())stat.malformed++;
    }catch(_){stat.malformed++;}
  });
  return {ids:ids,registryCount:stat.registry,
    viewerCount:stat.viewer,malformedCount:stat.malformed,
    referencesComplete:stat.malformed===0};
}

/**
 * Source classification deliberately reuses the existing strict legacy
 * receipt validator. No V1/backup archive writes or Drive target validation.
 */
function vaaLedgerResidualSources_(props,snapshot){
  const entries=vaaLedgerProdLegacyEntries_(props,snapshot);
  const journal=vaaLedgerJournalOpenReadOnly_(props).sheet;
  const rows=[], keyPrefix=API_CONFIG.REQUEST_PROPERTY_PREFIX;
  entries.quarantined.forEach(function(item){
    const state=vaaLedgerJournalLookupFromSheet_(journal,item.id);
    if(state.state!=='ABSENT')throw Error('TRIAGE_JOURNAL_COLLISION');
    const raw=snapshot[keyPrefix+item.id];
    const record=JSON.parse(raw);
    rows.push({type:'OLD_UPDATE_NO_PROOF',
      id:item.id,record:record,raw:raw});
  });
  let modern=entries.modern;
  entries.ready.forEach(function(item){
    const state=vaaLedgerJournalLookupFromSheet_(journal,item.id);
    if(state.state==='READY'&&state.revision===2){
      modern++;
      return;
    }
    if(state.state!=='ABSENT')throw Error('TRIAGE_JOURNAL_COLLISION');
    rows.push({type:'OLD_READY_TARGET',
      id:item.id,record:item.record,raw:item.raw});
  });
  Object.keys(snapshot).sort().forEach(function(key){
    if(key.indexOf(keyPrefix)!==0)return;
    const id=key.slice(keyPrefix.length);
    if(/^QA_JOURNAL_E2E_(CREATE|UPDATE)_/.test(id))return;
    const raw=snapshot[key],rec=JSON.parse(raw);
    if(!rec||rec.status==='READY')return;
    rows.push({type:'NON_READY',id:id,record:rec,raw:raw});
  });
  if(rows.length!==entries.quarantined.length+entries.nonReady+
      entries.ready.length-(modern-entries.modern)){
    throw Error('TRIAGE_SOURCE_COUNT_MISMATCH');
  }
  return {rows:rows,modernExcluded:modern,
    oldUpdateNoProof:entries.quarantined.length,
    nonReady:entries.nonReady};
}

function vaaLedgerResidualEmptyCount_(){
  return {count:0,estimatedBytes:0};
}

/** No destructive permission is conveyed by ANY triage classification. */
function vaaLedgerProdResidualReqTriageReadOnly(){
  const categories=[
    'CURRENT_MANAGED','OUTSIDE_WITH_LINK','OUTSIDE_NO_LINK',
    'TRASHED','ERROR_REVIEW','UNKNOWN'
  ];
  const kinds=['OLD_UPDATE_NO_PROOF','OLD_READY_TARGET','NON_READY'];
  const buckets={},bySource={};
  categories.forEach(function(k){buckets[k]=vaaLedgerResidualEmptyCount_();});
  kinds.forEach(function(k){bySource[k]=vaaLedgerResidualEmptyCount_();});
  const out={
    phase:'PROD_RESIDUAL_REQ_TRIAGE_READ_ONLY',
    strictReadOnly:true,inventoryComplete:false,
    referencesComplete:false,sourceStable:false,
    folderCount:0,filesEnumerated:0,uniqueManagedSheets:0,
    registryReferences:0,viewerReferences:0,malformedReferences:0,
    residualReqCount:0,modernExcluded:0,
    oldUpdateNoProof:0,nonReady:0,
    uniqueTargetCount:0,missingTargetCount:0,
    driveCannotOpen:0,driveTrashed:0,
    linkedOutsideCount:0,
    categories:categories.map(function(k){
      return {category:k,count:0,estimatedBytes:0};
    }),
    sourceKinds:kinds.map(function(k){
      return {category:k,count:0,estimatedBytes:0};
    }),
    propertyWrites:0,propertyDeletes:0,
    archiveWrites:0,requestPosts:0,
    cleanupAuthorized:false,pass:false,
    errorStage:'NONE',errorCode:'NONE'
  };
  let stage='SOURCE';
  try{
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    const source=vaaLedgerResidualSources_(props,before);
    const refs=vaaLedgerResidualReferences_(before);
    stage='FOLDER_INVENTORY';
    const folders=vaaLedgerResidualFolderSnapshot_();
    out.inventoryComplete=folders.inventoryComplete;
    out.folderCount=folders.folderCount;
    out.filesEnumerated=folders.fileCount;
    out.uniqueManagedSheets=folders.uniqueSheetCount;
    out.referencesComplete=refs.referencesComplete;
    out.registryReferences=refs.registryCount;
    out.viewerReferences=refs.viewerCount;
    out.malformedReferences=refs.malformedCount;
    stage='CLASSIFY';
    const seenTargets={},driveStates={};
    source.rows.forEach(function(item){
      const rec=item.record||{};
      const target=String(rec.spreadsheetId||'').trim();
      const bytes=vaaUtf8ByteLength_(API_CONFIG.REQUEST_PROPERTY_PREFIX+
        item.id)+vaaUtf8ByteLength_(item.raw);
      let disposition='UNKNOWN';
      bySource[item.type].count++;
      bySource[item.type].estimatedBytes+=bytes;
      if(target)seenTargets[target]=true;
      else out.missingTargetCount++;
      if(item.type==='NON_READY'){
        disposition='ERROR_REVIEW';
      }else if(target && folders.ids[target]){
        disposition='CURRENT_MANAGED';
      }else if(target){
        if(!Object.prototype.hasOwnProperty.call(driveStates,target)){
          let status='CANNOT_OPEN';
          try{
            const file=DriveApp.getFileById(target);
            if(typeof file.isTrashed==='function'&&file.isTrashed()){
              status='TRASHED';
            }else if(fileIsInManagedOutputTree_(
              file,API_CONFIG.SHEET_OUTPUT_FOLDER_ID)){
              // Complete folder inventory must agree with Drive parents.
              throw Error('TRIAGE_ROSTER_MISMATCH');
            }else status='OUTSIDE';
          }catch(err){
            if(err&&err.message==='TRIAGE_ROSTER_MISMATCH')throw err;
            status='CANNOT_OPEN';
          }
          driveStates[target]=status;
        }
        if(driveStates[target]==='CANNOT_OPEN')out.driveCannotOpen++;
        if(driveStates[target]==='TRASHED')out.driveTrashed++;
        if(driveStates[target]==='TRASHED'){
          disposition='TRASHED';
        }else if(refs.ids[target]){
          disposition='OUTSIDE_WITH_LINK';
          out.linkedOutsideCount++;
        }else if(refs.referencesComplete){
          disposition='OUTSIDE_NO_LINK';
        }else disposition='UNKNOWN';
      }
      buckets[disposition].count++;
      buckets[disposition].estimatedBytes+=bytes;
      out.residualReqCount++;
    });
    out.uniqueTargetCount=Object.keys(seenTargets).length;
    out.modernExcluded=source.modernExcluded;
    out.oldUpdateNoProof=source.oldUpdateNoProof;
    out.nonReady=source.nonReady;
    out.categories=categories.map(function(k){
      return {category:k,count:buckets[k].count,
        estimatedBytes:buckets[k].estimatedBytes};
    });
    out.sourceKinds=kinds.map(function(k){
      return {category:k,count:bySource[k].count,
        estimatedBytes:bySource[k].estimatedBytes};
    });
    stage='SOURCE_STABILITY';
    out.sourceStable=vaaLedgerProdLegacySnapshotsEqual_(
      before,props.getProperties());
    if(!out.sourceStable)throw Error('TRIAGE_SOURCE_CHANGED');
    out.pass=true;
  }catch(_){
    out.pass=false;
    out.errorStage=stage;
    out.errorCode=stage==='FOLDER_INVENTORY'?
      'TRIAGE_FOLDER_INVENTORY_FAILED':
      stage==='SOURCE_STABILITY'?'TRIAGE_SOURCE_CHANGED':
      stage==='SOURCE'?'TRIAGE_SOURCE_UNVERIFIED':
      'TRIAGE_CLASSIFICATION_UNVERIFIED';
    // Never publish a partial classification as if it were complete.
    if(!out.pass)out.cleanupAuthorized=false;
  }
  console.log('VAA_RESIDUAL_REQ_TRIAGE '+JSON.stringify(out));
  return out;
}


/**
 * Read-only follow-up: determine how many legacy REQs and distinct target
 * sheets are linked to stale Registry / Viewer mappings outside the
 * managed output folder. Mapping presence is NOT evidence of active access.
 * Never returns IDs, hashes, URLs, names, or individual timestamps.
 */
function vaaLedgerResidualLinkageIndex_(snapshot,nowMs){
  const byId=Object.create(null);
  let registryProperties=0,viewerProperties=0,malformed=0;
  const recentCutoff=nowMs-30*86400000;
  Object.keys(snapshot).forEach(function(key){
    const registry=key.indexOf(API_CONFIG.REPORT_REGISTRY_PREFIX)===0;
    const viewer=key.indexOf('VIEWER_')===0;
    if(!registry&&!viewer)return;
    if(registry)registryProperties++;else viewerProperties++;
    let rec;
    try{rec=JSON.parse(snapshot[key]);}catch(_){malformed++;return;}
    if(!rec||typeof rec!=='object'||Array.isArray(rec)){
      malformed++;return;
    }
    const id=String(rec.spreadsheetId||'').trim();
    if(!id || (registry &&
      key.slice(API_CONFIG.REPORT_REGISTRY_PREFIX.length)!==id)){
      malformed++;return;
    }
    const state=byId[id]||(byId[id]={
      registryProperties:0,viewerProperties:0,
      hasDatedAccess:false,recentViewerAccess:false
    });
    if(registry){state.registryProperties++;return;}
    state.viewerProperties++;
    const accessTime=Date.parse(String(rec.lastAccessAt||''));
    if(Number.isFinite(accessTime)&&accessTime<=nowMs){
      state.hasDatedAccess=true;
      if(accessTime>=recentCutoff)state.recentViewerAccess=true;
    }
  });
  return {
    byId:byId,registryProperties:registryProperties,
    viewerProperties:viewerProperties,malformed:malformed,
    referencesComplete:malformed===0
  };
}

function vaaLedgerResidualLinkageMetric_(){
  return {requests:0,uniqueTargets:0,estimatedReqBytes:0};
}
function vaaLedgerResidualLinkageMappedMetric_(){
  return {uniqueTargets:0,registryProperties:0,viewerProperties:0,
    targetsWithDatedViewerAccess:0,targetsWithRecentViewerAccess30Days:0};
}

/**
 * One-shot, aggregate only, no deletion authorization. A complete folder
 * snapshot proves only "not in the managed folder at scan time"; it does
 * not prove Drive file deletion or permanent loss of permission.
 */
function vaaLedgerProdResidualLinkageAuditReadOnly(){
  const locKinds=[
    'CURRENT_MANAGED','OUTSIDE_WITH_LINK','OUTSIDE_NO_LINK',
    'TRASHED','UNKNOWN'
  ];
  const linkKinds=['REGISTRY_AND_VIEWER','REGISTRY_ONLY','VIEWER_ONLY'];
  const mapKinds=[
    'CURRENT_MANAGED','OUTSIDE_WITH_READY_REQ',
    'OUTSIDE_WITHOUT_READY_REQ'
  ];
  const location={},linkType={},mapping={};
  locKinds.forEach(function(k){location[k]=vaaLedgerResidualLinkageMetric_();});
  linkKinds.forEach(function(k){linkType[k]=vaaLedgerResidualLinkageMetric_();});
  mapKinds.forEach(function(k){mapping[k]=vaaLedgerResidualLinkageMappedMetric_();});
  const out={
    phase:'PROD_RESIDUAL_LINKAGE_AUDIT_READ_ONLY',
    strictReadOnly:true,sourceStable:false,
    inventoryComplete:false,referencesComplete:false,
    folderCount:0,filesEnumerated:0,uniqueManagedSheets:0,
    registryProperties:0,viewerProperties:0,malformedReferences:0,
    uniqueMappedTargets:0,
    residualReqCount:0,readyReqCount:0,nonReadyCount:0,
    modernExcluded:0,uniqueReadyTargets:0,
    linkedReadyReqCount:0,linkedReadyUniqueTargets:0,
    mappedOutsideUniqueTargets:0,
    locations:locKinds.map(function(k){
      return {category:k,requests:0,uniqueTargets:0,estimatedReqBytes:0};
    }),
    linkedReadyByMapping:linkKinds.map(function(k){
      return {category:k,requests:0,uniqueTargets:0,estimatedReqBytes:0};
    }),
    mappedTargets:mapKinds.map(function(k){
      return {category:k,uniqueTargets:0,registryProperties:0,
        viewerProperties:0,targetsWithDatedViewerAccess:0,
        targetsWithRecentViewerAccess30Days:0};
    }),
    propertyWrites:0,propertyDeletes:0,
    archiveWrites:0,requestPosts:0,
    cleanupAuthorized:false,pass:false,
    errorStage:'NONE',errorCode:'NONE'
  };
  let stage='SOURCE';
  try{
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    const source=vaaLedgerResidualSources_(props,before);
    const nowMs=Date.now();
    const index=vaaLedgerResidualLinkageIndex_(before,nowMs);
    out.registryProperties=index.registryProperties;
    out.viewerProperties=index.viewerProperties;
    out.malformedReferences=index.malformed;
    out.referencesComplete=index.referencesComplete;
    if(!index.referencesComplete)throw Error('LINKAGE_REFERENCES_INVALID');

    stage='FOLDER_INVENTORY';
    const folder=vaaLedgerResidualFolderSnapshot_();
    out.inventoryComplete=folder.inventoryComplete;
    out.folderCount=folder.folderCount;
    out.filesEnumerated=folder.fileCount;
    out.uniqueManagedSheets=folder.uniqueSheetCount;

    stage='CLASSIFY';
    const seenReady=Object.create(null);
    const seenByLocation=Object.create(null);
    const seenByLink=Object.create(null);
    const targetStatuses=Object.create(null);
    source.rows.forEach(function(item){
      out.residualReqCount++;
      if(item.type==='NON_READY'){
        out.nonReadyCount++;
        return; // ERROR is never treated as a READY cleanup candidate.
      }
      out.readyReqCount++;
      const target=String(item.record&&item.record.spreadsheetId||'').trim();
      if(!target)throw Error('LINKAGE_TARGET_MISSING');
      seenReady[target]=true;
      let status=targetStatuses[target];
      if(!status){
        if(folder.ids[target])status='CURRENT_MANAGED';
        else{
          let file;
          try{file=DriveApp.getFileById(target);}
          catch(_){status='CANNOT_OPEN';}
          if(file){
            if(typeof file.isTrashed==='function'&&file.isTrashed()){
              status='TRASHED';
            }else if(fileIsInManagedOutputTree_(
              file,API_CONFIG.SHEET_OUTPUT_FOLDER_ID)){
              // A new parent membership with an old roster is not proof of absence.
              throw Error('LINKAGE_ROSTER_MISMATCH');
            }else status='OUTSIDE';
          }
        }
        targetStatuses[target]=status;
      }
      const linked=index.byId[target];
      const category=status==='CURRENT_MANAGED'?'CURRENT_MANAGED':
        status==='TRASHED'?'TRASHED':
        linked?'OUTSIDE_WITH_LINK':'OUTSIDE_NO_LINK';
      if(!location[category])throw Error('LINKAGE_CATEGORY_UNKNOWN');
      const bytes=vaaUtf8ByteLength_(
        API_CONFIG.REQUEST_PROPERTY_PREFIX+item.id
      )+vaaUtf8ByteLength_(item.raw);
      location[category].requests++;
      location[category].estimatedReqBytes+=bytes;
      if(!seenByLocation[category])seenByLocation[category]=Object.create(null);
      if(!seenByLocation[category][target]){
        seenByLocation[category][target]=true;
        location[category].uniqueTargets++;
      }
      if(category==='OUTSIDE_WITH_LINK'){
        const linkKind=linked.registryProperties>0&&linked.viewerProperties>0?
          'REGISTRY_AND_VIEWER':linked.registryProperties>0?
          'REGISTRY_ONLY':'VIEWER_ONLY';
        linkType[linkKind].requests++;
        linkType[linkKind].estimatedReqBytes+=bytes;
        if(!seenByLink[linkKind])seenByLink[linkKind]=Object.create(null);
        if(!seenByLink[linkKind][target]){
          seenByLink[linkKind][target]=true;
          linkType[linkKind].uniqueTargets++;
        }
      }
    });
    out.modernExcluded=source.modernExcluded;
    out.uniqueReadyTargets=Object.keys(seenReady).length;
    out.linkedReadyReqCount=location.OUTSIDE_WITH_LINK.requests;
    out.linkedReadyUniqueTargets=location.OUTSIDE_WITH_LINK.uniqueTargets;
    const mappingTargets=Object.keys(index.byId);
    out.uniqueMappedTargets=mappingTargets.length;
    mappingTargets.forEach(function(target){
      const ref=index.byId[target];
      const kind=folder.ids[target]?'CURRENT_MANAGED':
        seenReady[target]?'OUTSIDE_WITH_READY_REQ':
          'OUTSIDE_WITHOUT_READY_REQ';
      const stat=mapping[kind];
      stat.uniqueTargets++;
      stat.registryProperties+=ref.registryProperties;
      stat.viewerProperties+=ref.viewerProperties;
      if(ref.hasDatedAccess)stat.targetsWithDatedViewerAccess++;
      if(ref.recentViewerAccess)stat.targetsWithRecentViewerAccess30Days++;
    });
    out.mappedOutsideUniqueTargets=
      mapping.OUTSIDE_WITH_READY_REQ.uniqueTargets+
      mapping.OUTSIDE_WITHOUT_READY_REQ.uniqueTargets;
    out.locations=locKinds.map(function(k){
      return {category:k,requests:location[k].requests,
        uniqueTargets:location[k].uniqueTargets,
        estimatedReqBytes:location[k].estimatedReqBytes};
    });
    out.linkedReadyByMapping=linkKinds.map(function(k){
      return {category:k,requests:linkType[k].requests,
        uniqueTargets:linkType[k].uniqueTargets,
        estimatedReqBytes:linkType[k].estimatedReqBytes};
    });
    out.mappedTargets=mapKinds.map(function(k){
      return {category:k,uniqueTargets:mapping[k].uniqueTargets,
        registryProperties:mapping[k].registryProperties,
        viewerProperties:mapping[k].viewerProperties,
        targetsWithDatedViewerAccess:
          mapping[k].targetsWithDatedViewerAccess,
        targetsWithRecentViewerAccess30Days:
          mapping[k].targetsWithRecentViewerAccess30Days};
    });
    stage='SOURCE_STABILITY';
    out.sourceStable=vaaLedgerProdLegacySnapshotsEqual_(
      before,props.getProperties()
    );
    if(!out.sourceStable)throw Error('LINKAGE_SOURCE_CHANGED');
    out.pass=true;
  }catch(_){
    out.pass=false;
    out.errorStage=stage;
    out.errorCode=stage==='SOURCE'?'LINKAGE_SOURCE_UNVERIFIED':
      stage==='FOLDER_INVENTORY'?'LINKAGE_FOLDER_INVENTORY_FAILED':
      stage==='CLASSIFY'?'LINKAGE_CLASSIFICATION_UNVERIFIED':
      'LINKAGE_SOURCE_CHANGED';
    out.cleanupAuthorized=false;
  }
  console.log('VAA_RESIDUAL_LINKAGE_AUDIT '+JSON.stringify(out));
  return out;
}


/**
 * Legacy quarantine v1. Editor-only operators, never invoked by doPost.
 *
 * COPY preserves source REQ_ and writes one complete isolated private tab.
 * COMPACT replaces 97 source values with occupied-key tombstones; it never
 * deletes REQ_ keys, changes V1/V2 journal, or touches Registry/Viewer.
 * No automatic retry after an unknown mutation completion.
 */
const VAA_QUARANTINE_TAB_='legacy_quarantine_v1';
const VAA_QUARANTINE_SCHEMA_='LEGACY_QUARANTINE_V1';
const VAA_QUARANTINE_MARKER_=
  '{"status":"RETIRED","archiveSchema":"LEGACY_QUARANTINE_V1"}';
const VAA_QUARANTINE_HEADERS_=[
  'requestHash','rawJson','rawDigest','sourceKind',
  'location','archivedAt','schemaVersion'
];
const VAA_QUARANTINE_EXPECTED_={
  readyOutside:97,managedReady:2,errors:4,modern:1,
  linked:81,unlinked:1,trashed:15
};

function vaaQuarantineError_(code){
  const e=new Error(code);e.code=code;return e;
}

/** Full original READY validation; incomplete old UPDATE has a distinct
 * strictly defined shape, and is never converted to a replayable receipt.
 */
function vaaQuarantineRawKind_(id,raw){
  vaaLedgerReadyRequestId_(id);
  let rec;
  try{rec=JSON.parse(raw);}catch(_){
    throw vaaQuarantineError_('QUARANTINE_RAW_INVALID');
  }
  if(!rec||Array.isArray(rec)||rec.requestId!==id ||
     rec.status!=='READY'||rec.stage!=='READY'||
     !String(rec.spreadsheetId||'').trim()){
    throw vaaQuarantineError_('QUARANTINE_RAW_INVALID');
  }
  let kind='OLD_READY_TARGET';
  try{vaaLedgerReadyValidateRaw_(id,raw);}
  catch(_){
    const ok=rec.operationMode==='UPDATE' &&
      rec.targetSpreadsheetId===rec.spreadsheetId &&
      !String(rec.updatePayloadDigest||'').trim() &&
      rec.updateStrategy!=='APPEND'&&rec.updateStrategy!=='REPLACE';
    if(!ok)throw vaaQuarantineError_('QUARANTINE_RAW_INVALID');
    kind='OLD_UPDATE_NO_PROOF';
  }
  if(rec.leaseUntil){
    const until=Date.parse(String(rec.leaseUntil));
    if(!Number.isFinite(until)||until>Date.now()){
      throw vaaQuarantineError_('QUARANTINE_LEASE_PRESENT');
    }
  }
  return {record:rec,kind:kind};
}

/** Only authorized private backup workbook; the already configured receipts
 * tab is opened/validated but NEVER written by this workflow.
 */
function vaaQuarantineBook_(props){
  const verified=vaaLedgerProdLegacyBackupSheet_(props);
  const book=verified.sheet.getParent();
  if(!book||!book.getSheetByName){
    throw vaaQuarantineError_('QUARANTINE_BACKUP_UNVERIFIED');
  }
  return {book:book,receipts:verified.sheet};
}

/** Read all hashed keys once, not 97 independent TextFinder calls. A
 * candidate overlapping V1 or V2 is unsafe to tombstone.
 */
function vaaQuarantineLedgerHashSet_(sheet){
  let last,hashes;
  try{
    last=sheet.getLastRow();
    if(last<1)throw Error('INVALID');
    hashes=last===1?[]:
      sheet.getRange(2,1,last-1,1).getValues();
  }catch(_){
    throw vaaQuarantineError_('QUARANTINE_LEDGER_UNAVAILABLE');
  }
  const found=Object.create(null);
  hashes.forEach(function(row){
    const hash=String(row[0]||'');
    if(!/^[0-9a-f]{64}$/.test(hash)){
      throw vaaQuarantineError_('QUARANTINE_LEDGER_INVALID');
    }
    found[hash]=true;
  });
  return found;
}

function vaaQuarantineArchiveRead_(book){
  let sheet;
  try{sheet=book.getSheetByName(VAA_QUARANTINE_TAB_);}
  catch(_){throw vaaQuarantineError_('QUARANTINE_TAB_UNAVAILABLE');}
  if(!sheet)return {exists:false,sheet:null,items:[],byId:Object.create(null)};
  let values;
  try{
    const last=sheet.getLastRow();
    if(last<1 || last>VAA_QUARANTINE_EXPECTED_.readyOutside+1){
      throw Error('BAD_ROWS');
    }
    values=sheet.getRange(1,1,last,7).getValues();
  }catch(_){
    throw vaaQuarantineError_('QUARANTINE_TAB_UNVERIFIED');
  }
  if(!VAA_QUARANTINE_HEADERS_.every(function(h,i){
    return values[0][i]===h;
  })){
    throw vaaQuarantineError_('QUARANTINE_HEADER_INVALID');
  }
  const items=[],byId=Object.create(null);
  for(let i=1;i<values.length;i++){
    const row=values[i];
    if(!row||row.length!==7||typeof row[1]!=='string'||
       typeof row[0]!=='string'||
       typeof row[2]!=='string'||
       row[6]!==VAA_QUARANTINE_SCHEMA_||
       (row[3]!=='OLD_UPDATE_NO_PROOF' &&
        row[3]!=='OLD_READY_TARGET')||
       ['OUTSIDE_WITH_LINK','OUTSIDE_NO_LINK','TRASHED'].indexOf(row[4])<0 ||
       typeof row[5]!=='string' || !Number.isFinite(Date.parse(row[5]))){
      throw vaaQuarantineError_('QUARANTINE_ROW_INVALID');
    }
    let parsed;
    try{parsed=JSON.parse(row[1]);}catch(_){
      throw vaaQuarantineError_('QUARANTINE_ROW_INVALID');
    }
    const id=parsed&&parsed.requestId;
    if(typeof id!=='string'||byId[id]||
       row[0]!==vaaLedgerReadyHash_(id) ||
       row[2]!==vaaLedgerReadyHash_(row[1])){
      throw vaaQuarantineError_('QUARANTINE_ROW_INVALID');
    }
    const original=vaaQuarantineRawKind_(id,row[1]);
    if(original.kind!==row[3]){
      throw vaaQuarantineError_('QUARANTINE_ROW_INVALID');
    }
    const item={
      id:id,raw:row[1],record:original.record,kind:original.kind,
      location:row[4],hash:row[0]
    };
    byId[id]=item;
    items.push(item);
  }
  return {exists:true,sheet:sheet,items:items,byId:byId};
}

function vaaQuarantineLocation_(id,folders,refs,cache){
  if(folders.ids[id])return 'CURRENT_MANAGED';
  if(!Object.prototype.hasOwnProperty.call(cache,id)){
    let state='OUTSIDE';
    try{
      const file=DriveApp.getFileById(id);
      if(typeof file.isTrashed==='function'&&file.isTrashed()){
        state='TRASHED';
      }else if(fileIsInManagedOutputTree_(
        file,API_CONFIG.SHEET_OUTPUT_FOLDER_ID)){
        throw vaaQuarantineError_('QUARANTINE_FOLDER_ROSTER_CONFLICT');
      }
    }catch(err){
      if(err&&err.code==='QUARANTINE_FOLDER_ROSTER_CONFLICT')throw err;
      state='CANNOT_OPEN';
    }
    cache[id]=state;
  }
  if(cache[id]==='TRASHED')return 'TRASHED';
  return refs.ids[id]?'OUTSIDE_WITH_LINK':'OUTSIDE_NO_LINK';
}

/** Complete state proof for COPY or COMPACT. All returned private IDs/raw
 * remain in memory and are NEVER included in the public summary/log.
 */
function vaaQuarantinePrepare_(props,snapshot){
  if(String(props.getProperty(VAA_PROD_LEGACY_MODE_PROP_)||'OFF')!=='OFF'){
    throw vaaQuarantineError_('QUARANTINE_LEGACY_MODE_NOT_OFF');
  }
  vaaLedgerProdAssertScope_(props);
  const backup=vaaQuarantineBook_(props);
  const archive=vaaQuarantineArchiveRead_(backup.book);
  const folders=vaaLedgerResidualFolderSnapshot_();
  const refs=vaaLedgerResidualReferences_(snapshot);
  if(!folders.inventoryComplete||!refs.referencesComplete){
    throw vaaQuarantineError_('QUARANTINE_INVENTORY_UNVERIFIED');
  }
  const rawReady=Object.create(null),marked=Object.create(null);
  let errors=0,modern=0;
  const prefix=API_CONFIG.REQUEST_PROPERTY_PREFIX;
  Object.keys(snapshot).sort().forEach(function(key){
    if(key.indexOf(prefix)!==0)return;
    const id=key.slice(prefix.length);
    if(/^QA_JOURNAL_E2E_(CREATE|UPDATE)_/.test(id)){
      modern++;return;
    }
    const raw=snapshot[key];
    if(raw===VAA_QUARANTINE_MARKER_){
      marked[id]=true;return;
    }
    let rec;
    try{rec=JSON.parse(raw);}catch(_){
      throw vaaQuarantineError_('QUARANTINE_SOURCE_INVALID');
    }
    if(rec&&rec.status==='ERROR'){
      errors++;return;
    }
    if(!rec||rec.status!=='READY'){
      throw vaaQuarantineError_('QUARANTINE_SOURCE_INVALID');
    }
    rawReady[id]={id:id,raw:raw,...vaaQuarantineRawKind_(id,raw)};
  });
  if(errors!==VAA_QUARANTINE_EXPECTED_.errors ||
     modern!==VAA_QUARANTINE_EXPECTED_.modern){
    throw vaaQuarantineError_('QUARANTINE_BASELINE_CHANGED');
  }
  const archiveItems=archive.exists?archive.items:null;
  const ids=archiveItems?archiveItems.map(function(x){return x.id;}):
    Object.keys(rawReady).filter(function(id){
      return !folders.ids[rawReady[id].record.spreadsheetId];
    });
  if(ids.length!==VAA_QUARANTINE_EXPECTED_.readyOutside ||
     (archiveItems&&Object.keys(archive.byId).length!==ids.length)){
    throw vaaQuarantineError_('QUARANTINE_BASELINE_CHANGED');
  }
  const candidates=[],cache=Object.create(null);
  const totals={OUTSIDE_WITH_LINK:0,OUTSIDE_NO_LINK:0,TRASHED:0};
  let rawCount=0,markerCount=0;
  const idSet=Object.create(null);
  ids.forEach(function(id){
    if(idSet[id])throw vaaQuarantineError_('QUARANTINE_DUPLICATE');
    idSet[id]=true;
    const item=archiveItems?archive.byId[id]:rawReady[id];
    if(!item)throw vaaQuarantineError_('QUARANTINE_MISSING_SOURCE');
    const key=prefix+id;
    const live=snapshot[key];
    if(live===undefined){
      throw vaaQuarantineError_('QUARANTINE_MISSING_SOURCE');
    }
    if(live===VAA_QUARANTINE_MARKER_)markerCount++;
    else if(live===item.raw)rawCount++;
    else throw vaaQuarantineError_('QUARANTINE_SOURCE_MISMATCH');
    const loc=vaaQuarantineLocation_(
      item.record.spreadsheetId,folders,refs,cache
    );
    if(!totals.hasOwnProperty(loc) || loc==='CURRENT_MANAGED'){
      throw vaaQuarantineError_('QUARANTINE_TARGET_NOW_MANAGED');
    }
    if(archiveItems&&loc!==item.location){
      throw vaaQuarantineError_('QUARANTINE_TARGET_LOCATION_CHANGED');
    }
    totals[loc]++;
    candidates.push({
      id:id,raw:item.raw,record:item.record,kind:item.kind,
      location:loc,hash:vaaLedgerReadyHash_(id)
    });
  });
  if(Object.keys(marked).length!==markerCount){
    throw vaaQuarantineError_('QUARANTINE_UNKNOWN_MARKER');
  }
  let managedReady=0;
  Object.keys(rawReady).forEach(function(id){
    if(idSet[id])return;
    if(!folders.ids[rawReady[id].record.spreadsheetId]){
      throw vaaQuarantineError_('QUARANTINE_UNARCHIVED_READY');
    }
    managedReady++;
  });
  if(managedReady!==VAA_QUARANTINE_EXPECTED_.managedReady ||
     totals.OUTSIDE_WITH_LINK!==VAA_QUARANTINE_EXPECTED_.linked ||
     totals.OUTSIDE_NO_LINK!==VAA_QUARANTINE_EXPECTED_.unlinked ||
     totals.TRASHED!==VAA_QUARANTINE_EXPECTED_.trashed){
    throw vaaQuarantineError_('QUARANTINE_BASELINE_CHANGED');
  }
  const v1=vaaLedgerReadyOpenReadOnly_(props);
  const v2=vaaLedgerJournalOpenReadOnly_(props).sheet;
  const conflicts=[
    vaaQuarantineLedgerHashSet_(v1),
    vaaQuarantineLedgerHashSet_(backup.receipts),
    vaaQuarantineLedgerHashSet_(v2)
  ];
  candidates.forEach(function(item){
    if(conflicts.some(function(set){return !!set[item.hash];})){
      throw vaaQuarantineError_('QUARANTINE_LEDGER_CONFLICT');
    }
    if(item.record.operationMode==='UPDATE'){
      const target=item.record.targetSpreadsheetId;
      if(props.getProperty(vaaTargetUpdateLeaseKey_(target))){
        throw vaaQuarantineError_('QUARANTINE_TARGET_LEASE_PRESENT');
      }
    }
  });
  const beforeKinds={OLD_UPDATE_NO_PROOF:0,OLD_READY_TARGET:0};
  candidates.forEach(function(x){beforeKinds[x.kind]++;});
  if(beforeKinds.OLD_UPDATE_NO_PROOF>
     VAA_QUARANTINE_EXPECTED_.readyOutside ||
     beforeKinds.OLD_UPDATE_NO_PROOF!==39){
    throw vaaQuarantineError_('QUARANTINE_KIND_MISMATCH');
  }
  return {
    candidates:candidates,archive:archive,backup:backup,
    rawCount:rawCount,markerCount:markerCount,
    managedReady:managedReady,errors:errors,modern:modern,
    locationTotals:totals,folderCount:folders.folderCount,
    uniqueManagedSheets:folders.uniqueSheetCount
  };
}

function vaaQuarantineSummary_(phase){
  return {
    phase:phase,sourceStable:false,
    archiveVerified:false,strictReadOnly:phase==='PROD_QUARANTINE_AUDIT_READ_ONLY',
    expectedOutside:VAA_QUARANTINE_EXPECTED_.readyOutside,
    backedUp:0,rawReady:0,compacted:0,
    preservedManagedReady:0,preservedErrors:0,modernExcluded:0,
    copied:0,propertyWrites:0,propertyDeletes:0,
    archiveWrites:0,requestPosts:0,
    lockHeld:false,unknownCompletion:false,
    automaticRetryAuthorized:false,
    compactAuthorized:false,cleanupAuthorized:false,
    pass:false,errorStage:'NONE',errorCode:'NONE'
  };
}
function vaaQuarantineSummaryFill_(out,plan){
  out.backedUp=plan.archive.exists?plan.archive.items.length:0;
  out.archiveVerified=plan.archive.exists &&
    plan.archive.items.length===VAA_QUARANTINE_EXPECTED_.readyOutside;
  out.rawReady=plan.rawCount;
  out.compacted=plan.markerCount;
  out.preservedManagedReady=plan.managedReady;
  out.preservedErrors=plan.errors;
  out.modernExcluded=plan.modern;
}
function vaaQuarantineLog_(out){
  console.log('VAA_PROD_QUARANTINE '+JSON.stringify(out));
  return out;
}

/** Safe after an unknown setValues/setProperties result; never mutates. */
function vaaLedgerProdQuarantineAuditReadOnly(){
  const out=vaaQuarantineSummary_('PROD_QUARANTINE_AUDIT_READ_ONLY');
  let stage='PREPARE';
  try{
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    const plan=vaaQuarantinePrepare_(props,before);
    vaaQuarantineSummaryFill_(out,plan);
    stage='SOURCE_STABILITY';
    out.sourceStable=vaaLedgerProdLegacySnapshotsEqual_(
      before,props.getProperties()
    );
    if(!out.sourceStable)throw vaaQuarantineError_('QUARANTINE_SOURCE_CHANGED');
    out.pass=true;
    out.errorStage='NONE';
  }catch(err){
    out.errorStage=stage;
    const code=String(err&&err.code||'');
    out.errorCode=/^QUARANTINE_[A-Z_]+$/.test(code)?code:
      'QUARANTINE_READ_ONLY_UNVERIFIED';
  }
  return vaaQuarantineLog_(out);
}

/** One explicit administrator invocation. If a tab already exists, it MUST
 * contain all 97 exact source rows or the operator must investigate.
 */
function vaaLedgerProdQuarantineCopyOnce(){
  const out=vaaQuarantineSummary_('PROD_QUARANTINE_COPY_ONCE');
  let lock=null,held=false,stage='LOCK';
  try{
    lock=LockService.getScriptLock();
    lock.waitLock(20000);held=true;out.lockHeld=true;
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    stage='PREPARE';
    const plan=vaaQuarantinePrepare_(props,before);
    vaaQuarantineSummaryFill_(out,plan);
    if(plan.markerCount!==0){
      throw vaaQuarantineError_('QUARANTINE_ALREADY_COMPACTED');
    }
    if(plan.archive.exists){
      out.archiveVerified=true;
    }else{
      stage='FINAL_SOURCE_CHECK';
      if(!vaaLedgerProdLegacySnapshotsEqual_(before,props.getProperties())){
        throw vaaQuarantineError_('QUARANTINE_SOURCE_CHANGED');
      }
      stage='CREATE_AND_WRITE_UNCERTAIN';
      const tab=plan.backup.book.insertSheet(VAA_QUARANTINE_TAB_);
      const now=new Date().toISOString();
      const rows=[VAA_QUARANTINE_HEADERS_].concat(
        plan.candidates.map(function(item){
          return [item.hash,item.raw,vaaLedgerReadyHash_(item.raw),
            item.kind,item.location,now,VAA_QUARANTINE_SCHEMA_];
        })
      );
      tab.getRange(1,1,rows.length,7).setValues(rows);
      SpreadsheetApp.flush();
      out.archiveWrites=plan.candidates.length;
      out.copied=plan.candidates.length;
    }
    stage='VERIFY_READBACK';
    const readback=vaaQuarantinePrepare_(props,props.getProperties());
    vaaQuarantineSummaryFill_(out,readback);
    if(!out.archiveVerified||readback.markerCount!==0 ||
       readback.rawCount!==VAA_QUARANTINE_EXPECTED_.readyOutside){
      throw vaaQuarantineError_('QUARANTINE_COPY_READBACK_FAILED');
    }
    stage='SOURCE_STABILITY';
    out.sourceStable=vaaLedgerProdLegacySnapshotsEqual_(
      before,props.getProperties()
    );
    if(!out.sourceStable)throw vaaQuarantineError_('QUARANTINE_SOURCE_CHANGED');
    out.pass=true;
    out.errorStage='NONE';
  }catch(err){
    out.errorStage=stage;
    out.errorCode=String(err&&err.code||'').indexOf('QUARANTINE_')===0?
      err.code:'QUARANTINE_COPY_UNVERIFIED';
    out.unknownCompletion=stage==='CREATE_AND_WRITE_UNCERTAIN' ||
      stage==='VERIFY_READBACK'||stage==='SOURCE_STABILITY';
  }finally{
    if(held)try{lock.releaseLock();}catch(_){
      out.pass=false;out.errorStage='LOCK_RELEASE';
      out.unknownCompletion=true;
    }
  }
  return vaaQuarantineLog_(out);
}

/** One explicit administrator invocation AFTER an exact private COPY.
 * Atomicity is not assumed: if batch write returns unknown, inspect
 * vaaLedgerProdQuarantineAuditReadOnly; never blindly run it again.
 */
function vaaLedgerProdQuarantineCompactOnce(){
  const out=vaaQuarantineSummary_('PROD_QUARANTINE_COMPACT_ONCE');
  let lock=null,held=false,stage='LOCK';
  try{
    lock=LockService.getScriptLock();
    lock.waitLock(20000);held=true;out.lockHeld=true;
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    stage='PREPARE';
    const plan=vaaQuarantinePrepare_(props,before);
    vaaQuarantineSummaryFill_(out,plan);
    if(!plan.archive.exists||!out.archiveVerified ||
       plan.markerCount!==0 ||
       plan.rawCount!==VAA_QUARANTINE_EXPECTED_.readyOutside){
      throw vaaQuarantineError_('QUARANTINE_COMPACT_NOT_READY');
    }
    // Recheck that no record changed between the proof and the batch.
    stage='FINAL_SOURCE_CHECK';
    if(!vaaLedgerProdLegacySnapshotsEqual_(before,props.getProperties())){
      throw vaaQuarantineError_('QUARANTINE_SOURCE_CHANGED');
    }
    const changes={};
    const afterExpected=Object.assign({},before);
    plan.candidates.forEach(function(item){
      const key=getRequestPropertyKey_(item.id);
      if(before[key]!==item.raw){
        throw vaaQuarantineError_('QUARANTINE_SOURCE_MISMATCH');
      }
      changes[key]=VAA_QUARANTINE_MARKER_;
      afterExpected[key]=VAA_QUARANTINE_MARKER_;
    });
    // A single Script Properties call reduces time under ScriptLock.
    // Unknown/partial completion is NOT assumed atomic or auto-retried.
    stage='COMPACT_WRITE_UNCERTAIN';
    props.setProperties(changes,false);
    out.propertyWrites=plan.candidates.length;
    stage='VERIFY_READBACK';
    const after=props.getProperties();
    if(!vaaLedgerProdLegacySnapshotsEqual_(afterExpected,after)){
      throw vaaQuarantineError_('QUARANTINE_COMPACT_READBACK_FAILED');
    }
    const readback=vaaQuarantinePrepare_(props,after);
    vaaQuarantineSummaryFill_(out,readback);
    if(!out.archiveVerified ||
       readback.markerCount!==VAA_QUARANTINE_EXPECTED_.readyOutside ||
       readback.rawCount!==0){
      throw vaaQuarantineError_('QUARANTINE_COMPACT_READBACK_FAILED');
    }
    out.sourceStable=true;
    out.pass=true;
    out.errorStage='NONE';
  }catch(err){
    out.errorStage=stage;
    out.errorCode=String(err&&err.code||'').indexOf('QUARANTINE_')===0?
      err.code:'QUARANTINE_COMPACT_UNVERIFIED';
    out.unknownCompletion=stage==='COMPACT_WRITE_UNCERTAIN' ||
      stage==='VERIFY_READBACK';
  }finally{
    if(held)try{lock.releaseLock();}catch(_){
      out.pass=false;out.errorStage='LOCK_RELEASE';out.unknownCompletion=true;
    }
  }
  return vaaQuarantineLog_(out);
}
