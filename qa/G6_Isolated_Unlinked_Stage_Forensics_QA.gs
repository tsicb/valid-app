/**
 * G6-K — after G6-J: independent, two-pass READ-ONLY orphan-Stage audit.
 *
 * Use ONLY the isolated TEST GAS where G6-J has already created exactly one
 * synthetic Stage file and deliberately stopped before CAS.
 *
 * NO call to G6-I preflight (it must now reject an existing Stage).
 * NO call to G6-J creation, doPost, CAS, file writes/trash, lock, leases,
 * receipt writes, automated retry or cleanup.
 *
 * Main public function: vaaQaG6KVerifyUnlinkedStageReadOnly()
 */

/** Validate one Stage body against the already verified G6-J merge plan. */
function vaaQaG6KValidateBodyReadOnly_(body, details) {
  if (!body || !details || !details.plan ||
      !body.datasets || !body.updateStats) return false;
  const original = details.plan.datasets;
  const stats = details.plan.stats;
  const verified = validateAnalysisDataStoreObject_(
    body, details.targetId, VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
  );
  return verified.ok === true &&
    body.applicationIdentityVersion === VAAAppendMergeCore.VERSION &&
    body.updateStrategy === 'APPEND' &&
    body.requestId === VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_ &&
    body.spreadsheetId === details.targetId &&
    body.updateStats.oldApplications === 1 &&
    body.updateStats.uploadedApplications === 2 &&
    body.updateStats.addedApplications === 1 &&
    body.updateStats.skippedAsExisting === 1 &&
    body.updateStats.finalApplications === 2 &&
    body.updateStats.finalJobs === 1 &&
    body.updateStats.finalApplications === stats.finalApplications &&
    body.updateStats.finalJobs === stats.finalJobs &&
    JSON.stringify(body.datasets.applicationData) ===
      JSON.stringify(original.applicationData) &&
    JSON.stringify(body.datasets.jobAnalysisMaster) ===
      JSON.stringify(original.jobAnalysisMaster);
}

/** Public: no mutations, no creation and no deletion. */
function vaaQaG6KVerifyUnlinkedStageReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const originalHistorical = vaaQaG6DHistorySnapshot_(props);
  const createKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const initialCreateReceipt = props.getProperty(createKey);

  // The Stage is already present. G6-J's independent forensic inspection
  // checks TEST ownership, exact Stage count, contents and pointer stability.
  const first = vaaQaG6JStageDetailsReadOnly_();
  const firstValid = first.output.pass === true &&
    first.output.actualReadyReceipts === 4 &&
    first.output.stageFileCount === 1 &&
    first.output.validationCode === 'OK' &&
    first.output.stageIsUnlinked === true &&
    first.output.stagePointerNotFlipped === true;
  if (!firstValid || !first.stageFileId || !first.targetId ||
      !first.originalPointer) {
    throw new Error('QA_G6K_FIRST_STAGE_AUDIT_NOT_READY');
  }

  // Directly re-open the ALREADY VERIFIED file, never create/list a new
  // candidate. Re-check TEST ownership rather than trusting file name alone.
  const folderId = String(props.getProperty(
    API_CONFIG.ANALYSIS_DATASTORE_FOLDER_PROPERTY
  ) || '');
  if (!folderId) throw new Error('QA_G6K_FOLDER_POINTER_MISSING');
  const folder = DriveApp.getFolderById(folderId);
  if (folder.getName() !== API_CONFIG.ANALYSIS_DATASTORE_FOLDER_NAME ||
      !folderIsDirectChildOf_(folder, VAA_QA_G4_CONFIG_.testRootId)) {
    throw new Error('QA_G6K_STAGE_FOLDER_NOT_TEST');
  }
  const file = DriveApp.getFileById(first.stageFileId);
  const expectedName = vaaQaG6IStageCandidateFileName_(first.targetId);
  const fileNameMatched = file.getName() === expectedName;
  const fileInTestFolder = folderIsDirectChildOf_(file, folderId);
  if (!fileNameMatched || !fileInTestFolder) {
    throw new Error('QA_G6K_STAGE_FILE_NOT_TEST_ISOLATED');
  }
  const firstContents = file.getBlob().getDataAsString('UTF-8');
  let firstBody = null;
  try { firstBody = JSON.parse(firstContents); } catch (_) {}
  const firstBodyValid = vaaQaG6KValidateBodyReadOnly_(firstBody, first);

  // A second independent pass reads the current linked state and Stage
  // name/collision count again. The stage ID and original pointer MUST match.
  const second = vaaQaG6JStageDetailsReadOnly_();
  const secondContents = file.getBlob().getDataAsString('UTF-8');
  let secondBody = null;
  try { secondBody = JSON.parse(secondContents); } catch (_) {}
  const secondBodyValid = vaaQaG6KValidateBodyReadOnly_(
    secondBody, second
  );
  const twoIndependentPasses = second.output.pass === true &&
    second.output.actualReadyReceipts === 4 &&
    second.output.stageFileCount === 1 &&
    second.output.validationCode === 'OK' &&
    second.stageFileId === first.stageFileId &&
    second.targetId === first.targetId &&
    second.originalPointer === first.originalPointer;
  const contentsUnchanged = firstContents === secondContents;
  const pointerNeverSelectedStage =
    first.stageFileId !== first.originalPointer &&
    second.stageFileId !== second.originalPointer &&
    first.output.originalPointerUnchanged &&
    second.output.originalPointerUnchanged &&
    first.output.stagePointerNotFlipped &&
    second.output.stagePointerNotFlipped;

  const historicalUnchanged = vaaQaG6DHistoryEqual_(
    originalHistorical, vaaQaG6DHistorySnapshot_(props)
  );
  const createUnchanged = !!initialCreateReceipt &&
    initialCreateReceipt === props.getProperty(createKey);
  const reservedUpdateUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const stageRequestUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
  );
  const updateLeaseAbsent = !props.getProperty(
    vaaTargetUpdateLeaseKey_(first.targetId)
  );
  const linkedDataStoreStillSynthetic =
    first.output.faultDomainInspectionPass === true &&
    second.output.faultDomainInspectionPass === true &&
    first.output.actualReadyReceipts === 4 &&
    second.output.actualReadyReceipts === 4;

  const output = {
    phase: 'G6_UNLINKED_STAGE_FORENSIC_READ_ONLY',
    strictReadOnly: true,
    independentReadPasses: 2,
    firstStageAuditPass: firstValid,
    secondStageAuditPass: second.output.pass === true,
    stageFileCount: second.output.stageFileCount,
    stageNameMatchesExpected: fileNameMatched,
    stageInTestFolder: fileInTestFolder,
    stageIdAndTargetStableAcrossPasses: twoIndependentPasses,
    stageBodyValidFirstRead: firstBodyValid,
    stageBodyValidSecondRead: secondBodyValid,
    stageContentsStableAcrossReads: contentsUnchanged,
    stageIsUnlinked: pointerNeverSelectedStage,
    originalDataStoreStillSynthetic: linkedDataStoreStillSynthetic,
    originalPointerUnchanged: pointerNeverSelectedStage,
    actualReadyReceipts: second.output.actualReadyReceipts,
    historicalReceiptsUnchanged: historicalUnchanged,
    createReceiptUnchanged: createUnchanged,
    reservedUpdateRequestUnused: reservedUpdateUnused,
    stageRequestUnused: stageRequestUnused,
    updateLeaseAbsent: updateLeaseAbsent,
    stagePreservationDecision: 'PRESERVE_FOR_NEXT_REVIEW',
    cleanupAuthorized: false,
    casAuthorized: false,
    updateAuthorized: false,
    automaticRetryAuthorized: false,
    actualCleanupPerformed: false,
    actualCasPerformed: false,
    actualUpdatePerformed: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  output.pass = !!(
    firstValid && twoIndependentPasses &&
    fileNameMatched && fileInTestFolder &&
    firstBodyValid && secondBodyValid && contentsUnchanged &&
    pointerNeverSelectedStage && linkedDataStoreStillSynthetic &&
    historicalUnchanged && createUnchanged &&
    reservedUpdateUnused && stageRequestUnused && updateLeaseAbsent
  );
  output.readyForCleanupDesignReview = output.pass;
  // Never print file IDs, raw staged JSON, access keys or application data.
  console.log('VAA_QA_G6_UNLINKED_STAGE_FORENSIC ' +
    JSON.stringify(output));
  return output;
}
