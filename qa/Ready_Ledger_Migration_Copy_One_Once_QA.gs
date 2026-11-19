/**
 * READY_ARCHIVE_V1: ONE legacy synthetic READY copy into isolated TEST V1
 * receipts sheet, with independent read-only preflight and inspection.
 *
 * Editor-only QA; NEVER install in PROD. Default OFF. One selected original
 * CREATE (G4). All other historical REQ_ receipts, failed V2 CREATE, V2
 * journal and existing V1 synthetic row must remain untouched.
 *
 * OFF preflight -> explicit arming -> armed preflight -> ONE COPY ONLY
 * -> independent inspect, regardless of success/error/unknown response.
 *
 * No doPost/replay switch, auto-retry, cleanup or REQ_ deletion.
 * Depends on preinstalled migration target/archive QA and central-api/20.
 */
const VAA_QA_READY_COPY_ONE_MODE_PROPERTY_='VAA_QA_READY_COPY_ONE_MODE';
const VAA_QA_READY_COPY_ONE_ARMED_VALUE_='TEST_ONE_LEGACY_READY_COPY_V1';

function vaaQaReadyCopyOneMode_(props) {
  return String(props.getProperty(VAA_QA_READY_COPY_ONE_MODE_PROPERTY_)||'').trim();
}

function vaaQaReadyCopyOneSelectedId_() {
  // A single hard-scoped historic G4 CREATE. Never accept a user-supplied ID.
  return VAA_QA_G4_CONFIG_.requestId;
}

function vaaQaReadyCopyOnePreflight_(requireArmed) {
  const result={
    phase:requireArmed?
      'READY_COPY_ONE_ARMED_PREFLIGHT_READ_ONLY':
      'READY_COPY_ONE_OFF_PREFLIGHT_READ_ONLY',
    strictReadOnly:true,
    isolatedTestVerified:false,
    previousTargetArchivePreflightPassed:false,
    knownOneG4CreateTarget:false,
    existingV1OnlyOriginalSynthetic:false,
    selectedLegacyReadyAbsentFromV1:false,
    selectedLegacyReadyAbsentFromV2:false,
    copyModeOff:false,
    correctlyArmed:false,
    expectedModeSelected:false,
    propertySnapshotReads:0,
    propertySnapshotsStable:false,
    copyAttempted:false,
    archiveWritten:false,
    propertiesWritten:false,
    retryAuthorized:false,
    deletionAuthorized:false,
    replaySwitchAuthorized:false,
    productionChanged:false,
    failureStage:'NONE',
    pass:false
  };
  let stage='ISOLATION';
  try{
    const props=vaaQaG4IsolatedConfig_();
    result.isolatedTestVerified=true;
    const before=props.getProperties();
    result.propertySnapshotReads=1;
    const selected=vaaQaReadyCopyOneSelectedId_();
    const historic=vaaQaLedgerE2EHistoricIds_();
    const mode=vaaQaReadyCopyOneMode_(props);
    result.copyModeOff=!mode||mode==='OFF';
    result.correctlyArmed=mode===VAA_QA_READY_COPY_ONE_ARMED_VALUE_;
    result.expectedModeSelected=requireArmed?
      result.correctlyArmed:result.copyModeOff;

    stage='PREVIOUS_AUDIT';
    const prior=vaaQaReadyMigrationTargetArchiveReadOnly();
    result.previousTargetArchivePreflightPassed=prior.pass===true &&
      prior.propertySnapshotReads===2 &&
      prior.propertiesStableAcrossReads===true &&
      prior.targetFilesVerified===4 &&
      prior.v1ArchiveMissingCount===4 &&
      prior.v1ArchiveConflictCount===0 &&
      prior.v2LegacyAbsentCount===4 &&
      prior.v2PreviousFiveEventsPreserved===true &&
      prior.archiveWrites===0 && prior.propertyWrites===0;
    result.existingV1OnlyOriginalSynthetic=
      prior.v1ArchiveExpectedRowCount===true &&
      prior.v1SyntheticOriginalPreserved===true;
    result.knownOneG4CreateTarget=historic.length===4 &&
      historic[0]===selected &&
      !!before[getRequestPropertyKey_(selected)] &&
      vaaLedgerReadyValidateRaw_(selected,
        before[getRequestPropertyKey_(selected)]
      ).operationMode==='CREATE';
    result.selectedLegacyReadyAbsentFromV1=
      prior.v1ArchiveMissingCount===4 &&
      prior.v1ArchiveExactMatchCount===0;
    result.selectedLegacyReadyAbsentFromV2=
      prior.v2LegacyAbsentCount===4 &&
      prior.v2LegacyCollisionCount===0;

    stage='SNAPSHOT_STABILITY';
    const after=props.getProperties();
    result.propertySnapshotReads=2;
    result.propertySnapshotsStable=
      vaaQaReadyMigrationSameSnapshot_(before,after);
    result.pass=!!(result.isolatedTestVerified &&
      result.previousTargetArchivePreflightPassed &&
      result.existingV1OnlyOriginalSynthetic &&
      result.knownOneG4CreateTarget &&
      result.selectedLegacyReadyAbsentFromV1 &&
      result.selectedLegacyReadyAbsentFromV2 &&
      result.expectedModeSelected &&
      result.propertySnapshotsStable
    );
    result.failureStage=result.pass?'NONE':'VALIDATION';
  }catch(_){
    result.failureStage=stage;
    result.pass=false;
  }
  console.log('VAA_QA_READY_COPY_ONE_PREFLIGHT '+
    JSON.stringify(result));
  return result;
}

function vaaQaReadyCopyOneOffPreflightReadOnly() {
  return vaaQaReadyCopyOnePreflight_(false);
}
function vaaQaReadyCopyOneArmedPreflightReadOnly() {
  return vaaQaReadyCopyOnePreflight_(true);
}

/**
 * Manual one-shot actual append. Caller never repeats after ANY result,
 * including a timeout or lost response. Lock only encloses preflight+copy.
 * A thrown append may have written the row: report UNKNOWN, inspect only.
 */
function vaaQaReadyCopyFirstOnce() {
  const out={
    phase:'READY_COPY_ONE_ACTUAL_ONCE',
    isolatedTestVerified:false,
    armedPreflightPassed:false,
    lockAcquired:false,
    actualCopyAttempted:false,
    copyAndReadbackVerified:false,
    originalReadyPropertyPreserved:false,
    allScriptPropertiesUnchanged:false,
    copiedRowState:'UNKNOWN',
    errorStage:'NONE',
    retryAuthorized:false,
    cleanupAuthorized:false,
    deletionAuthorized:false,
    replaySwitchAuthorized:false,
    productionChanged:false,
    pass:false
  };
  let stage='ISOLATION';
  let lock=null;
  let held=false;
  try{
    const props=vaaQaG4IsolatedConfig_();
    out.isolatedTestVerified=true;
    stage='LOCK';
    lock=LockService.getScriptLock();
    lock.waitLock(20000);
    held=true;
    out.lockAcquired=true;

    stage='ARMED_PREFLIGHT';
    const pre=vaaQaReadyCopyOneArmedPreflightReadOnly();
    out.armedPreflightPassed=pre.pass===true;
    if(!out.armedPreflightPassed)throw Error('QA_PREFLIGHT_DENIED');
    const selected=vaaQaReadyCopyOneSelectedId_();
    const before=props.getProperties();
    const raw=String(before[getRequestPropertyKey_(selected)]||'');

    stage='COPY_OR_UNKNOWN';
    out.actualCopyAttempted=true;
    const copied=vaaLedgerReadyCopyOneUnderLock_(props,selected);
    out.copiedRowState=copied && copied.state==='COPIED_AND_VERIFIED'?
      'COPIED_AND_VERIFIED':'UNEXPECTED_RESULT';
    out.copyAndReadbackVerified=out.copiedRowState==='COPIED_AND_VERIFIED';

    stage='SOURCE_RECHECK';
    const after=props.getProperties();
    out.allScriptPropertiesUnchanged=
      vaaQaReadyMigrationSameSnapshot_(before,after);
    out.originalReadyPropertyPreserved=
      String(after[getRequestPropertyKey_(selected)]||'')===raw;
    out.pass=!!(out.copyAndReadbackVerified &&
      out.originalReadyPropertyPreserved &&
      out.allScriptPropertiesUnchanged);
    out.errorStage=out.pass?'NONE':'POST_COPY_VERIFICATION';
  }catch(_){
    out.errorStage=stage;
    // Actual outcome may be UNKNOWN, even if the Sheets API threw.
    out.pass=false;
  }finally{
    if(held){
      try{lock.releaseLock();}catch(_){out.pass=false;out.errorStage='LOCK_RELEASE';}
    }
  }
  console.log('VAA_QA_READY_COPY_ONE '+JSON.stringify(out));
  return out;
}

/**
 * Independent, side-effect-free inspection after success, timeout or
 * unknown result. Does NOT call the PRE-copy preflight because that
 * intentionally requires the original archive to have exactly two rows.
 */
function vaaQaReadyCopyFirstInspectReadOnly() {
  const out={
    phase:'READY_COPY_ONE_INSPECT_READ_ONLY',
    strictReadOnly:true,
    isolatedTestVerified:false,
    propertySnapshotReads:0,
    propertySnapshotsStable:false,
    existingSevenReceiptsStable:false,
    historicFourReadyPreserved:false,
    selectedReceiptStillReady:false,
    originalV1SyntheticPreserved:false,
    archiveRowsExactlyThree:false,
    archiveReads:0,
    archivedState:'UNKNOWN',
    independentArchiveReadsMatch:false,
    archivedReceiptExactlyMatchesProperty:false,
    otherThreeV1Absent:false,
    otherThreeV2Absent:false,
    failedV2CreateReservationPreserved:false,
    successfulV2CreateAndUpdatePreserved:false,
    journalRowsStillSix:false,
    noTargetUpdateLease:true,
    archiveWrites:0,
    propertyWrites:0,
    journalWrites:0,
    deletionAuthorized:false,
    retryAuthorized:false,
    productionChanged:false,
    failureStage:'NONE',
    pass:false
  };
  let stage='ISOLATION';
  try{
    const props=vaaQaG4IsolatedConfig_();
    out.isolatedTestVerified=true;
    const before=props.getProperties();
    out.propertySnapshotReads=1;
    const id=vaaQaReadyCopyOneSelectedId_();
    const historical=vaaQaLedgerE2EHistoricIds_();
    const inventory=vaaQaReadyMigrationInventorySummary_(before,Date.now());
    out.existingSevenReceiptsStable=inventory.requestPropertyCount===7 &&
      inventory.structurallyCopyableCount===4 &&
      inventory.exclusionCount===3 &&
      inventory.exclusionCounts.nonReady===1 &&
      inventory.exclusionCounts.journalTestNamespace===2;
    out.historicFourReadyPreserved=
      vaaQaLedgerE2EHistoryValid_(vaaQaLedgerE2EHistorySnapshot_(props));
    const raw=String(before[getRequestPropertyKey_(id)]||'');
    out.selectedReceiptStillReady=!!raw &&
      vaaLedgerReadyValidateRaw_(id,raw).operationMode==='CREATE';
    out.noTargetUpdateLease=inventory.exclusionCounts.updateTargetLeasePresent===0;

    stage='ARCHIVE';
    const v1=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
    const original=vaaLedgerReadyLookupFromSheet_(
      v1,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
    );
    out.originalV1SyntheticPreserved=original.state==='FOUND';
    out.archiveRowsExactlyThree=v1.getLastRow()===3;
    const first=vaaLedgerReadyLookupFromSheet_(v1,id);
    const second=vaaLedgerReadyLookupFromSheet_(v1,id);
    out.archiveReads=2;
    out.archivedState=first.state;
    out.independentArchiveReadsMatch=
      first.state===second.state &&
      (first.state==='NOT_FOUND'||(
        first.state==='FOUND'&&first.raw===second.raw &&
        first.revision===second.revision
      ));
    out.archivedReceiptExactlyMatchesProperty=
      first.state==='FOUND' && first.raw===raw &&
      first.revision===1;
    out.otherThreeV1Absent=historical.slice(1).every(function(other){
      return vaaLedgerReadyLookupFromSheet_(v1,other).state==='NOT_FOUND';
    });

    stage='V2_JOURNAL';
    const v2=vaaLedgerJournalOpenReadOnly_(props);
    out.journalRowsStillSix=v2.sheet.getLastRow()===6;
    out.otherThreeV2Absent=historical.every(function(other){
      return vaaLedgerJournalLookupFromSheet_(
        v2.sheet,other
      ).state==='ABSENT';
    });
    const failed=vaaLedgerJournalLookupFromSheet_(
      v2.sheet,VAA_QA_LEDGER_E2E_CREATE_.requestId
    );
    const created=vaaLedgerJournalLookupFromSheet_(
      v2.sheet,VAA_QA_LEDGER_V2_RETEST_.requestId
    );
    const updated=vaaLedgerJournalLookupFromSheet_(
      v2.sheet,VAA_QA_LEDGER_V2_UPDATE_.requestId
    );
    out.failedV2CreateReservationPreserved=
      failed.state==='RESERVED' && failed.revision===1 &&
      !!before[getRequestPropertyKey_(
        VAA_QA_LEDGER_E2E_CREATE_.requestId
      )];
    out.successfulV2CreateAndUpdatePreserved=
      created.state==='READY'&&created.revision===2 &&
      updated.state==='READY'&&updated.revision===2 &&
      JSON.stringify(created.latest.body.receipt)===
        String(before[getRequestPropertyKey_(
          VAA_QA_LEDGER_V2_RETEST_.requestId
        )]||'') &&
      JSON.stringify(updated.latest.body.receipt)===
        String(before[getRequestPropertyKey_(
          VAA_QA_LEDGER_V2_UPDATE_.requestId
        )]||'');

    stage='SNAPSHOT_STABILITY';
    const after=props.getProperties();
    out.propertySnapshotReads=2;
    out.propertySnapshotsStable=
      vaaQaReadyMigrationSameSnapshot_(before,after);
    out.pass=!!(out.isolatedTestVerified &&
      out.existingSevenReceiptsStable &&
      out.historicFourReadyPreserved &&
      out.selectedReceiptStillReady &&
      out.originalV1SyntheticPreserved &&
      out.archiveRowsExactlyThree &&
      out.independentArchiveReadsMatch &&
      out.archivedReceiptExactlyMatchesProperty &&
      out.otherThreeV1Absent && out.otherThreeV2Absent &&
      out.journalRowsStillSix &&
      out.failedV2CreateReservationPreserved &&
      out.successfulV2CreateAndUpdatePreserved &&
      out.noTargetUpdateLease &&
      out.propertySnapshotsStable
    );
    out.failureStage=out.pass?'NONE':'VALIDATION';
  }catch(_){
    // Never expose raw exception strings or any confidential IDs.
    out.failureStage=stage;
    out.pass=false;
  }
  console.log('VAA_QA_READY_COPY_ONE_INSPECT '+JSON.stringify(out));
  return out;
}
