/**
 * Legacy READY migration phase 2: isolated TEST pre-COPY target/ledger audit.
 *
 * NO mutation: no doPost, setProperty, appendRow, copy, delete, repair,
 * archive or Web App deployment. Do not use on the production GAS.
 *
 * Precondition: historical 4 READY REQ_ + old failed CREATE V1
 * + CREATE V2 READY + UPDATE V1 READY. 7 REQ_ entries in isolated TEST.
 * Existing V1 READY synthetic archive row and V2 journal remain untouched.
 *
 * Depends on existing TEST QA modules for G4 isolation, original 4 IDs,
 * private ledger check, inventory & source snapshot equality; and the
 * central-api/20 and 22 read-only ledger lookup helpers.
 */
function vaaQaReadyMigrationTargetArchiveReadOnly() {
  const out={
    phase:'READY_LEDGER_TARGET_ARCHIVE_PRECOPY_READ_ONLY',
    strictReadOnly:true,
    testOnly:true,
    propertySnapshotReads:0,
    propertiesStableAcrossReads:false,
    modesOff:false,
    expectedSevenReceipts:false,
    fourHistoricCandidatesVerified:false,
    historicalCandidateCount:0,
    targetFilesVerified:0,
    targetValidationFailed:0,
    v1ArchiveExactMatchCount:0,
    v1ArchiveMissingCount:0,
    v1ArchiveConflictCount:0,
    v2LegacyAbsentCount:0,
    v2LegacyCollisionCount:0,
    v1SyntheticOriginalPreserved:false,
    v1ArchiveExpectedRowCount:false,
    v2PreviousFiveEventsPreserved:false,
    v2ReadyReceiptsMatchProperties:false,
    failedCreateV1Preserved:false,
    ledgerReadOnly:true,
    driveReadOnly:true,
    archiveWrites:0,
    propertyWrites:0,
    journalWrites:0,
    deletionAuthorized:false,
    migrationAuthorized:false,
    replaySwitchAuthorized:false,
    productionChanged:false,
    failureStage:'NONE',
    pass:false
  };
  // Fixed labels only. Exception text might include private identifiers.
  let phase='TEST_SCOPE';
  try{
    const props=vaaQaG4IsolatedConfig_();
    const before=props.getProperties();
    out.propertySnapshotReads=1;
    const first=String(before.VAA_JOURNAL_DOP_MODE||'');
    const second=String(before.VAA_REQUEST_JOURNAL_MODE||'');
    const replay=String(before.VAA_REQUEST_LEDGER_REPLAY_MODE||'');
    out.modesOff=(!first||first==='OFF') &&
      (!second||second==='OFF') &&
      (!replay||replay==='OFF');

    phase='INVENTORY';
    const summary=vaaQaReadyMigrationInventorySummary_(before,Date.now());
    const ids=vaaQaLedgerE2EHistoricIds_();
    const uniqueIds=Array.isArray(ids)&&ids.length===4 &&
      ids.every(function(id,i){return typeof id==='string' &&
        ids.indexOf(id)===i;});
    const expectedExclusions=summary.exclusionCounts;
    out.expectedSevenReceipts=summary.requestPropertyCount===7 &&
      summary.structurallyCopyableCount===4 &&
      summary.exclusionCount===3 &&
      expectedExclusions.nonReady===1 &&
      expectedExclusions.journalTestNamespace===2 &&
      Object.keys(expectedExclusions).every(function(key){
        return (key==='nonReady'||key==='journalTestNamespace') ||
          expectedExclusions[key]===0;
      });
    out.fourHistoricCandidatesVerified=out.expectedSevenReceipts &&
      uniqueIds && vaaQaLedgerE2EHistoryValid_(
        vaaQaLedgerE2EHistorySnapshot_(props)
      );
    // Fail closed BEFORE any external Drive or ledger reads if the snapshot
    // does not exactly match the known synthetic TEST inventory baseline.
    if(!out.modesOff || !out.fourHistoricCandidatesVerified) {
      phase='BASELINE_NOT_VERIFIED';
    } else {
      phase='PRIVATE_LEDGER';
      const v1=vaaQaLedgerReadyCheckPrivateTestLedger_(props);
      const v2=vaaLedgerJournalOpenReadOnly_(props);
      // The same V1 sheet instance must be read by both helpers.
      if(v2.readySheet.getSheetName()!==v1.getSheetName() ||
         v2.readySheet.getParent().getId()!==v1.getParent().getId()){
        throw Error('QA_LEDGER_MISMATCH');
      }
      const existingSynthetic=vaaLedgerReadyLookupFromSheet_(
        v1,VAA_QA_LEDGER_READY_SYNTHETIC_ID_
      );
      out.v1SyntheticOriginalPreserved=
        existingSynthetic.state==='FOUND';
      out.v1ArchiveExpectedRowCount=v1.getLastRow()===2;

      phase='EXISTING_JOURNAL';
      const old=vaaLedgerJournalLookupFromSheet_(
        v2.sheet,VAA_QA_LEDGER_E2E_CREATE_.requestId
      );
      const create=vaaLedgerJournalLookupFromSheet_(
        v2.sheet,VAA_QA_LEDGER_V2_RETEST_.requestId
      );
      const update=vaaLedgerJournalLookupFromSheet_(
        v2.sheet,VAA_QA_LEDGER_V2_UPDATE_.requestId
      );
      out.failedCreateV1Preserved=
        old.state==='RESERVED' && old.revision===1;
      out.v2ReadyReceiptsMatchProperties=
        create.state==='READY' && create.revision===2 &&
        update.state==='READY' && update.revision===2 &&
        JSON.stringify(create.latest.body.receipt) ===
          String(before[getRequestPropertyKey_(
            VAA_QA_LEDGER_V2_RETEST_.requestId
          )]||'') &&
        JSON.stringify(update.latest.body.receipt) ===
          String(before[getRequestPropertyKey_(
            VAA_QA_LEDGER_V2_UPDATE_.requestId
          )]||'');
      out.v2PreviousFiveEventsPreserved=v2.sheet.getLastRow()===6 &&
        out.failedCreateV1Preserved &&
        out.v2ReadyReceiptsMatchProperties;

      phase='HISTORIC_TARGET_AND_LEDGER_LOOKUP';
      ids.forEach(function(id){
        const raw=before[getRequestPropertyKey_(id)];
        const receipt=vaaLedgerReadyValidateRaw_(id,raw);
        out.historicalCandidateCount++;
        try{
          const file=validateUpdateTargetDriveFile_(
            receipt.spreadsheetId,VAA_QA_G4_CONFIG_.testOutputId
          );
          if(file && typeof file.isTrashed==='function' &&
             file.isTrashed())throw Error('TRASHED');
          out.targetFilesVerified++;
        }catch(_){
          out.targetValidationFailed++;
        }
        // Duplicate, malformed or inaccessible external ledger is NOT
        // counted as NOT_FOUND: the full audit instead fails closed.
        const legacy=vaaLedgerReadyLookupFromSheet_(v1,id);
        if(legacy.state==='NOT_FOUND'){
          out.v1ArchiveMissingCount++;
        }else if(legacy.state==='FOUND' && legacy.raw===raw){
          out.v1ArchiveExactMatchCount++;
        }else{
          out.v1ArchiveConflictCount++;
        }
        const modern=vaaLedgerJournalLookupFromSheet_(v2.sheet,id);
        if(modern.state==='ABSENT'){
          out.v2LegacyAbsentCount++;
        }else{
          out.v2LegacyCollisionCount++;
        }
      });
    }

    phase='SOURCE_STABILITY';
    const after=props.getProperties();
    out.propertySnapshotReads=2;
    out.propertiesStableAcrossReads=
      vaaQaReadyMigrationSameSnapshot_(before,after);
    out.pass=!!(
      out.modesOff &&
      out.fourHistoricCandidatesVerified &&
      out.historicalCandidateCount===4 &&
      out.targetFilesVerified===4 &&
      out.targetValidationFailed===0 &&
      out.v1SyntheticOriginalPreserved &&
      out.v1ArchiveExpectedRowCount &&
      out.v2PreviousFiveEventsPreserved &&
      out.v2ReadyReceiptsMatchProperties &&
      out.v1ArchiveExactMatchCount+out.v1ArchiveMissingCount===4 &&
      out.v1ArchiveConflictCount===0 &&
      out.v2LegacyAbsentCount===4 &&
      out.v2LegacyCollisionCount===0 &&
      out.propertiesStableAcrossReads
    );
    out.failureStage=out.pass?'NONE':'VALIDATION';
  } catch(_){
    // No errors, ID, tokens, file names or raw record text in the log.
    out.failureStage=phase;
    out.pass=false;
  }
  console.log('VAA_QA_READY_TARGET_ARCHIVE_PREFLIGHT '+
    JSON.stringify(out));
  return out;
}
