/**
 * Production legacy READY history migration: dual-archive batch workflow.
 *
 * DEFAULT OFF, ONLY manual GAS editor operation, never called by doPost.
 * Uses the current V1 receipts ledger AND an independent PRIVATE backup
 * Google Sheet in the same verified admin root. COPY preserves all REQ_;
 * RETIRE is independently gated and only removes READY REQ_ after BOTH
 * copies match the exact source JSON, with journal replay verified.
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
  const result={ready:[],nonReady:0,modern:0};
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
    vaaLedgerReadyValidateRaw_(id,data[key]);
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

function vaaLedgerProdLegacyReview_(props,entries,v1,backup,v2){
  const summary={
    legacyReady:0,nonReady:entries.nonReady,modernExcluded:entries.modern,
    verifiedBoth:0,needPrimaryCopy:0,needBackupCopy:0,
    conflicting:0,modernJournalExcluded:0,targetsVerified:0
  };
  const toCopy=[];
  const toRetire=[];
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
    summary.legacyReady++;
    const file=validateUpdateTargetDriveFile_(
      item.record.spreadsheetId,API_CONFIG.SHEET_OUTPUT_FOLDER_ID
    );
    if(file && typeof file.isTrashed==='function' && file.isTrashed()){
      throw vaaLedgerReadyError_('LEGACY_TARGET_TRASHED');
    }
    summary.targetsVerified++;
    const first=vaaLedgerReadyLookupFromSheet_(v1,item.id);
    const second=vaaLedgerReadyLookupFromSheet_(backup,item.id);
    if((first.state==='FOUND'&&first.raw!==item.raw) ||
       (second.state==='FOUND'&&second.raw!==item.raw) ||
       (first.state!=='FOUND'&&first.state!=='NOT_FOUND') ||
       (second.state!=='FOUND'&&second.state!=='NOT_FOUND')){
      summary.conflicting++;
      throw vaaLedgerReadyError_('LEGACY_ARCHIVE_CONFLICT');
    }
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

/** Read-only aggregate inventory. IDs, original REQ data and error strings
 * never appear in output. Safe after an unknown COPY/RETIRE result.
 */
function vaaLedgerProdLegacyAuditReadOnly(){
  const out={
    phase:'PROD_LEGACY_DUAL_ARCHIVE_AUDIT_READ_ONLY',
    strictReadOnly:true,sourceStable:false,
    ready:0,nonReady:0,modernExcluded:0,
    verifiedBoth:0,needPrimaryCopy:0,needBackupCopy:0,
    modernJournalExcluded:0,targetsVerified:0,
    copyAuthorized:false,retireAuthorized:false,
    propertyWrites:0,archiveWrites:0,
    errorStage:'NONE',pass:false
  };
  let stage='SCOPE';
  try{
    const props=PropertiesService.getScriptProperties();
    const before=props.getProperties();
    vaaLedgerProdAssertScope_(props);
    const v1=vaaLedgerReadyOpenReadOnly_(props);
    const backup=vaaLedgerProdLegacyBackupSheet_(props).sheet;
    const journal=vaaLedgerJournalOpenReadOnly_(props).sheet;
    stage='REVIEW';
    const entries=vaaLedgerProdLegacyEntries_(props,before);
    const reviewed=vaaLedgerProdLegacyReview_(
      props,entries,v1,backup,journal
    ).summary;
    Object.assign(out,{
      ready:reviewed.legacyReady,nonReady:reviewed.nonReady,
      modernExcluded:reviewed.modernExcluded,
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
  }catch(_){
    out.pass=false;
    out.errorStage=stage;
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
/** Under lock, retire up to ten legacy REQ_ only if ALL remaining READY
 * sources are verified in BOTH independent private archive files.
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
    out.alreadyDualVerified=review.summary.verifiedBoth;
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
