/**
 * G6-I — PRE-CAS real-Drive STAGE-ONLY fault test preparation.
 *
 * Strictly READ ONLY. The intended future fault test (G6-J) must use a
 * SEPARATE synthetic requestId, NEVER G6-E's reserved APPEND requestId,
 * and must not attempt CAS, process receipts, or alter existing sheets.
 *
 * Requires isolated TEST GAS containing G4/G5/G6-A/D/E/F/G/H QA and
 * canonical 01/02/04/12/13/19 central-api source functions.
 *
 * This G6-I file does not create/delete Drive files, acquire locks, call
 * doPost, stage blobs, commit CAS, or write Script Properties/Sheets.
 */
const VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_ =
  'QA_G6I_STAGE_ONLY_PRECAS_20261119_V1';

function vaaQaG6IStageCandidateFileName_(targetId) {
  const safeId = VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 48) || 'req';
  return 'analysis_data_' + targetId + '_' + safeId + '.json';
}

/** A compact, safety-first operator contract; these are not executable hooks. */
function vaaQaG6IFaultPlanReadOnly_() {
  return {
    injectionBoundary: 'AFTER_VERIFIED_STAGE_BEFORE_CAS',
    stageFileAllowedInFutureTest: true,
    casAllowed: false,
    updatePostAllowed: false,
    receiptWriteAllowed: false,
    targetLeaseAllowed: false,
    originalPointerMustRemain: true,
    cleanupRequiresReadOnlyForensics: true,
    retryAllowed: false
  };
}

function vaaQaG6IStagePreflightReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const historicalBefore = vaaQaG6DHistorySnapshot_(props);
  const createKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const createBefore = props.getProperty(createKey);

  const prior = vaaQaG6HCasFaultAttestationReadOnly();
  if (!prior.pass || !prior.sourceAttestationPass ||
      !prior.candidateRequestStillUnused ||
      !prior.targetLeaseStillAbsent ||
      prior.actualReadyReceipts !== 4) {
    throw new Error('QA_G6I_PREVIOUS_ATTESTATION_FAILED');
  }
  const create = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  if (!create || create.status !== 'READY' ||
      create.operationMode !== 'CREATE' ||
      !create.spreadsheetId ||
      create.outputFolderId !== VAA_QA_G4_CONFIG_.testOutputId) {
    throw new Error('QA_G6I_TEST_CREATE_RECEIPT_INVALID');
  }
  const targetId = create.spreadsheetId;
  const older = vaaQaG5ReplaceReadyGateReadOnly_();
  if (targetId === older.targetId) {
    throw new Error('QA_G6I_TARGET_NOT_INDEPENDENT');
  }
  validateUpdateTargetDriveFile_(
    targetId, VAA_QA_G4_CONFIG_.testOutputId
  );
  const ss = SpreadsheetApp.openById(targetId);
  const stateBefore = rptReadStateData_(ss).map;
  const pointerBefore = String(stateBefore.analysisDataStoreFileId || '');
  const pointerOwnerBefore = String(
    stateBefore.analysisDataStoreRequestId || ''
  );
  if (!pointerBefore || pointerBefore === older.pointer ||
      pointerOwnerBefore !== VAA_QA_G6C_CONFIG_.createRequestId) {
    throw new Error('QA_G6I_DATASTORE_POINTER_NOT_ISOLATED');
  }
  const existing = vaaQaG5ReadTestDataStore_(ss);
  if (existing.applicationData.rows.length !== 1 ||
      existing.jobAnalysisMaster.rows.length !== 1) {
    throw new Error('QA_G6I_SYNTHETIC_BASELINE_NOT_ONE_PLUS_ONE');
  }

  // Canonical read returns the entire DataStore metadata, not only datasets.
  // Pure canonical merge planning; absolutely no staging/file creation.
  const source = vaaReadAppendStoreSource_(ss);
  if (!source || source.fileId !== pointerBefore ||
      !source.dataObject ||
      source.dataObject.requestId !== VAA_QA_G6C_CONFIG_.createRequestId) {
    throw new Error('QA_G6I_DATASTORE_SOURCE_INVALID');
  }
  const payload = vaaQaG6EUpdatePayload_(targetId);
  const stageRequestId = VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_;
  const independentRequestId = [
    VAA_QA_G4_CONFIG_.requestId,
    VAA_QA_G5_APPEND_REQUEST_ID_,
    VAA_QA_G5_REPLACE_REQUEST_ID_,
    VAA_QA_G6C_CONFIG_.createRequestId,
    VAA_QA_G6E_UPDATE_REQUEST_ID_
  ].indexOf(stageRequestId) < 0;
  const stageReceiptExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + stageRequestId
  );
  const reservedUpdateReceiptExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const targetLeaseExists = !!props.getProperty(
    vaaTargetUpdateLeaseKey_(targetId)
  );
  const newCapacityAllowed =
    vaaCheckNewRequestCapacityReadOnly_(props).allowed === true;
  let mergeCode = 'UNKNOWN';
  let added = null;
  let skipped = null;
  let finalApplications = null;
  let finalJobs = null;
  try {
    const merge = vaaBuildAppendStorePlan_(
      payload, source.dataObject, 'APPEND'
    );
    const stats = merge.stats;
    added = stats.addedApplications;
    skipped = stats.skippedAsExisting;
    finalApplications = stats.finalApplications;
    finalJobs = stats.finalJobs;
    mergeCode =
      stats.oldApplications === 1 &&
      stats.uploadedApplications === 2 &&
      stats.addedApplications === 1 &&
      stats.skippedAsExisting === 1 &&
      stats.finalApplications === 2 &&
      stats.finalJobs === 1
      ? 'OK' : 'UNEXPECTED_MERGE_COUNTS';
  } catch (err) {
    mergeCode = String(err && err.code || 'MERGE_PLAN_REJECTED');
  }

  // Strict real Drive folder identity check without a create-or-get helper:
  // getOrCreateAnalysisDataStoreFolder_ could CREATE on missing state.
  const folderId = String(props.getProperty(
    API_CONFIG.ANALYSIS_DATASTORE_FOLDER_PROPERTY
  ) || '');
  if (!folderId) {
    throw new Error('QA_G6I_DATASTORE_FOLDER_PROPERTY_MISSING');
  }
  const folder = DriveApp.getFolderById(folderId);
  if (folder.getName() !== API_CONFIG.ANALYSIS_DATASTORE_FOLDER_NAME ||
      !folderIsDirectChildOf_(folder, VAA_QA_G4_CONFIG_.testRootId)) {
    throw new Error('QA_G6I_DATASTORE_FOLDER_NOT_ISOLATED');
  }
  const existingStageWithSameName = folder.getFilesByName(
    vaaQaG6IStageCandidateFileName_(targetId)
  ).hasNext();
  const stagedFileAlreadyPresent = existingStageWithSameName;

  const stateAfter = rptReadStateData_(ss).map;
  const pointerUnchanged =
    String(stateAfter.analysisDataStoreFileId || '') === pointerBefore &&
    String(stateAfter.analysisDataStoreRequestId || '') === pointerOwnerBefore;
  const historicalReceiptsUnchanged = vaaQaG6DHistoryEqual_(
    historicalBefore, vaaQaG6DHistorySnapshot_(props)
  );
  const createReceiptUnchanged = !!createBefore &&
    props.getProperty(createKey) === createBefore;
  const oldAfter = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalDataStoreUnchanged =
    older.targetId === oldAfter.targetId &&
    older.pointer === oldAfter.pointer;
  const candidateRequestStillUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + stageRequestId
  );
  const reservedUpdateRequestStillUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const targetLeaseStillAbsent = !props.getProperty(
    vaaTargetUpdateLeaseKey_(targetId)
  );
  const contract = vaaQaG6IFaultPlanReadOnly_();
  const result = {
    phase: 'G6_PRECAS_STAGE_PREFLIGHT_READ_ONLY',
    strictReadOnly: true,
    priorCasAttestationPass: prior.pass,
    actualReadyReceipts: prior.actualReadyReceipts,
    independentTestWorkbook: targetId !== older.targetId,
    independentDataStorePointer: pointerBefore !== older.pointer,
    candidateRequestIndependent: independentRequestId,
    candidateStageReceiptExists: stageReceiptExists,
    reservedUpdateReceiptExists: reservedUpdateReceiptExists,
    targetLeaseExists: targetLeaseExists,
    newCapacityAllowed: newCapacityAllowed,
    mergePlanCode: mergeCode,
    expectedAddedApplications: added,
    expectedSkippedApplications: skipped,
    expectedFinalApplications: finalApplications,
    expectedFinalJobs: finalJobs,
    stageFileAlreadyPresent: stagedFileAlreadyPresent,
    existingStageFolderInTestRoot: true,
    faultPlan: contract,
    historicalReceiptsUnchanged: historicalReceiptsUnchanged,
    createReceiptUnchanged: createReceiptUnchanged,
    originalDataStoreUnchanged: originalDataStoreUnchanged,
    pointerUnchangedDuringPreflight: pointerUnchanged,
    candidateRequestStillUnused: candidateRequestStillUnused,
    reservedUpdateRequestStillUnused: reservedUpdateRequestStillUnused,
    targetLeaseStillAbsent: targetLeaseStillAbsent,
    readyForStageOnlyDesignReview: false,
    stageOnlyExecutionAuthorized: false,
    actualStageFileCreated: false,
    actualFaultInjected: false,
    actualUpdatePerformed: false,
    actualResumeTested: false,
    automaticRetryAuthorized: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  result.readyForStageOnlyDesignReview = !!(
    result.priorCasAttestationPass &&
    result.actualReadyReceipts === 4 &&
    result.independentTestWorkbook &&
    result.independentDataStorePointer &&
    independentRequestId && !stageReceiptExists &&
    !reservedUpdateReceiptExists && !targetLeaseExists &&
    newCapacityAllowed && mergeCode === 'OK' &&
    !stagedFileAlreadyPresent && historicalReceiptsUnchanged &&
    createReceiptUnchanged && originalDataStoreUnchanged &&
    pointerUnchanged && candidateRequestStillUnused &&
    reservedUpdateRequestStillUnused && targetLeaseStillAbsent
  );
  // Never include folder, sheet, request, receipt, raw DataStore or file IDs.
  console.log('VAA_QA_G6_PRECAS_STAGE_PREFLIGHT ' +
    JSON.stringify(result));
  return result;
}
