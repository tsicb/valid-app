/**
 * G6-J: isolated TEST-only, one-shot PRE-CAS STAGE file creation.
 *
 * This is NOT a doPost fault injection. One synthetic JSON DataStore
 * STAGE file is written to the existing TEST DataStore folder. No CAS,
 * Sheets state changes, REQ writes, update lease, POST, or cleanup.
 *
 * vaaQaG6JStageOnlyOnce(): run MANUALLY EXACTLY ONCE. Never rerun after
 * an error, timeout, lost response, or pass:false.
 *
 * vaaQaG6JInspectStageReadOnly(): safe separate forensic inspector, no
 * writes, no retries, no staged-file deletion. Use for uncertain outcomes.
 *
 * Requires G4/G5 and G6-C/D/E/F/G/H/I QA plus canonical central-api.
 */

function vaaQaG6JStageDetailsReadOnly_() {
  const props = vaaQaG4IsolatedConfig_();
  const historicalBefore = vaaQaG6DHistorySnapshot_(props);
  const createKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const createBefore = props.getProperty(createKey);
  const domain = vaaQaG6DInspectFaultDomainReadOnly();
  if (!domain.pass || domain.readyCount !== 4 ||
      !domain.dataStoreMatchesSynthetic) {
    throw new Error('QA_G6J_TEST_DOMAIN_BASELINE_FAILED');
  }

  const create = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  if (!create || create.status !== 'READY' ||
      create.operationMode !== 'CREATE' ||
      create.outputFolderId !== VAA_QA_G4_CONFIG_.testOutputId ||
      !create.spreadsheetId) {
    throw new Error('QA_G6J_CREATE_RECEIPT_UNVERIFIED');
  }
  const targetId = create.spreadsheetId;
  const original = vaaQaG5ReplaceReadyGateReadOnly_();
  if (targetId === original.targetId) {
    throw new Error('QA_G6J_NOT_AN_INDEPENDENT_WORKBOOK');
  }
  validateUpdateTargetDriveFile_(
    targetId, VAA_QA_G4_CONFIG_.testOutputId
  );
  const ss = SpreadsheetApp.openById(targetId);
  const stateBefore = rptReadStateData_(ss).map;
  const originalPointer = String(
    stateBefore.analysisDataStoreFileId || ''
  );
  const originalOwner = String(
    stateBefore.analysisDataStoreRequestId || ''
  );
  if (!originalPointer || originalPointer === original.pointer ||
      originalOwner !== VAA_QA_G6C_CONFIG_.createRequestId) {
    throw new Error('QA_G6J_ORIGINAL_POINTER_UNVERIFIED');
  }
  const existingData = vaaQaG5ReadTestDataStore_(ss);
  if (existingData.applicationData.rows.length !== 1 ||
      existingData.jobAnalysisMaster.rows.length !== 1) {
    throw new Error('QA_G6J_ORIGINAL_DATASTORE_CHANGED');
  }

  const source = vaaReadAppendStoreSource_(ss);
  if (!source || source.fileId !== originalPointer ||
      !source.dataObject ||
      source.dataObject.requestId !== originalOwner) {
    throw new Error('QA_G6J_ORIGINAL_SOURCE_UNVERIFIED');
  }
  const plan = vaaBuildAppendStorePlan_(
    vaaQaG6EUpdatePayload_(targetId), source.dataObject, 'APPEND'
  );
  const planExpected = plan.strategy === 'APPEND' &&
    plan.stats.oldApplications === 1 &&
    plan.stats.uploadedApplications === 2 &&
    plan.stats.addedApplications === 1 &&
    plan.stats.skippedAsExisting === 1 &&
    plan.stats.finalApplications === 2 &&
    plan.stats.finalJobs === 1;
  if (!planExpected) {
    throw new Error('QA_G6J_MERGE_PLAN_NOT_EXPECTED');
  }

  const folderId = String(props.getProperty(
    API_CONFIG.ANALYSIS_DATASTORE_FOLDER_PROPERTY
  ) || '');
  if (!folderId) {
    throw new Error('QA_G6J_DATASTORE_FOLDER_POINTER_MISSING');
  }
  // Only read existing folder; no get-or-create helper.
  const folder = DriveApp.getFolderById(folderId);
  if (folder.getName() !== API_CONFIG.ANALYSIS_DATASTORE_FOLDER_NAME ||
      !folderIsDirectChildOf_(folder, VAA_QA_G4_CONFIG_.testRootId)) {
    throw new Error('QA_G6J_DATASTORE_FOLDER_OUTSIDE_TEST');
  }
  const files = folder.getFilesByName(
    vaaQaG6IStageCandidateFileName_(targetId)
  );
  let count = 0;
  let file = null;
  while (files.hasNext() && count < 2) {
    file = files.next();
    count++;
  }

  let validationCode = 'STAGE_ABSENT';
  let stageInTestFolder = false;
  let stageBodyMatchesExpected = false;
  let stageCountsMatchExpected = false;
  let stageIsUnlinked = false;
  let stagePointerNotFlipped = true;
  let stageFileId = '';
  if (count === 1 && file) {
    stageFileId = file.getId();
    stageInTestFolder = folderIsDirectChildOf_(file, folderId);
    stageIsUnlinked = stageFileId !== originalPointer;
    try {
      if (!stageInTestFolder || !stageIsUnlinked) {
        validationCode = 'STAGE_NOT_ISOLATED';
      } else {
        const raw = JSON.parse(
          file.getBlob().getDataAsString('UTF-8')
        );
        const validated = validateAnalysisDataStoreObject_(
          raw, targetId, VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
        );
        const checks = validated.ok &&
          raw.applicationIdentityVersion === VAAAppendMergeCore.VERSION &&
          raw.updateStrategy === 'APPEND';
        stageCountsMatchExpected = !!checks &&
          raw.datasets.applicationData.rows.length === 2 &&
          raw.datasets.jobAnalysisMaster.rows.length === 1 &&
          !!raw.updateStats &&
          raw.updateStats.addedApplications === 1 &&
          raw.updateStats.skippedAsExisting === 1 &&
          raw.updateStats.finalApplications === 2 &&
          raw.updateStats.finalJobs === 1;
        stageBodyMatchesExpected = !!checks &&
          JSON.stringify(raw.datasets.applicationData) ===
            JSON.stringify(plan.datasets.applicationData) &&
          JSON.stringify(raw.datasets.jobAnalysisMaster) ===
            JSON.stringify(plan.datasets.jobAnalysisMaster);
        validationCode = stageCountsMatchExpected &&
          stageBodyMatchesExpected ? 'OK' : 'STAGE_CONTENT_MISMATCH';
      }
    } catch (_) {
      validationCode = 'STAGE_READ_OR_PARSE_FAILED';
    }
  } else if (count > 1) {
    validationCode = 'MULTIPLE_STAGE_FILES';
  }

  const afterState = rptReadStateData_(ss).map;
  const pointerUnchanged =
    String(afterState.analysisDataStoreFileId || '') === originalPointer &&
    String(afterState.analysisDataStoreRequestId || '') === originalOwner;
  if (count === 1 && file) {
    stagePointerNotFlipped = pointerUnchanged &&
      stageFileId !== String(afterState.analysisDataStoreFileId || '');
  }
  const oldNow = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalDataStoreUnchanged =
    oldNow.targetId === original.targetId &&
    oldNow.pointer === original.pointer;
  const historicalReceiptsUnchanged = vaaQaG6DHistoryEqual_(
    historicalBefore, vaaQaG6DHistorySnapshot_(props)
  );
  const createReceiptUnchanged =
    !!createBefore && props.getProperty(createKey) === createBefore;
  const stageReceiptUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
  );
  const reservedUpdateUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const updateLeaseAbsent = !props.getProperty(
    vaaTargetUpdateLeaseKey_(targetId)
  );
  const safeCore = domain.pass && count === 1 &&
    validationCode === 'OK' &&
    stageInTestFolder && stageIsUnlinked &&
    stageBodyMatchesExpected && stageCountsMatchExpected &&
    stagePointerNotFlipped && pointerUnchanged &&
    historicalReceiptsUnchanged && createReceiptUnchanged &&
    originalDataStoreUnchanged && stageReceiptUnused &&
    reservedUpdateUnused && updateLeaseAbsent;

  return {
    output: {
      phase: 'G6_STAGE_ONLY_INSPECT_READ_ONLY',
      strictReadOnly: true,
      faultDomainInspectionPass: domain.pass,
      actualReadyReceipts: domain.readyCount,
      stageFileCount: count,
      stageFileExists: count === 1,
      stageInTestFolder: stageInTestFolder,
      stageBodyMatchesExpected: stageBodyMatchesExpected,
      stageCountsMatchExpected: stageCountsMatchExpected,
      stageDataStoreApplications: stageCountsMatchExpected ? 2 : null,
      stageDataStoreJobs: stageCountsMatchExpected ? 1 : null,
      validationCode: validationCode,
      stageIsUnlinked: stageIsUnlinked,
      stagePointerNotFlipped: stagePointerNotFlipped,
      originalPointerUnchanged: pointerUnchanged,
      historicalReceiptsUnchanged: historicalReceiptsUnchanged,
      createReceiptUnchanged: createReceiptUnchanged,
      originalDataStoreUnchanged: originalDataStoreUnchanged,
      stageReceiptUnused: stageReceiptUnused,
      reservedUpdateRequestUnused: reservedUpdateUnused,
      updateLeaseAbsent: updateLeaseAbsent,
      casPerformed: false,
      actualUpdatePerformed: false,
      dataStoreStageCreatedInThisInspection: false,
      automaticRetryAuthorized: false,
      propertiesModified: 0,
      propertiesDeleted: 0,
      workbookModified: false,
      driveModified: false,
      pass: !!safeCore
    },
    // Private, never serialized in logs.
    stageFileId: stageFileId,
    targetId: targetId,
    originalPointer: originalPointer,
    plan: plan,
    ss: ss
  };
}

/** Public forensic function. Safe even after a lost/uncertain stage response. */
function vaaQaG6JInspectStageReadOnly() {
  const details = vaaQaG6JStageDetailsReadOnly_();
  const output = details.output;
  console.log('VAA_QA_G6_STAGE_ONLY_INSPECT ' + JSON.stringify(output));
  return output;
}

/**
 * Sole G6-J write entrypoint. MUST run once, never auto-retry.
 * Intentional stop BEFORE CAS: this function does NOT call the CAS helper.
 */
function vaaQaG6JStageOnlyOnce() {
  const preflight = vaaQaG6IStagePreflightReadOnly();
  if (preflight.readyForStageOnlyDesignReview !== true ||
      preflight.stageFileAlreadyPresent !== false ||
      preflight.candidateStageReceiptExists !== false ||
      preflight.targetLeaseExists !== false ||
      preflight.reservedUpdateReceiptExists !== false ||
      preflight.actualReadyReceipts !== 4) {
    throw new Error('QA_G6J_STAGE_BLOCKED_BY_PREFLIGHT');
  }

  const props = vaaQaG4IsolatedConfig_();
  const historyBefore = vaaQaG6DHistorySnapshot_(props);
  const createKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const createBefore = props.getProperty(createKey);
  const created = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  if (!created || created.status !== 'READY' ||
      created.operationMode !== 'CREATE' ||
      created.outputFolderId !== VAA_QA_G4_CONFIG_.testOutputId ||
      !created.spreadsheetId) {
    throw new Error('QA_G6J_CREATE_RECEIPT_NOT_READY');
  }
  const targetId = created.spreadsheetId;
  validateUpdateTargetDriveFile_(
    targetId, VAA_QA_G4_CONFIG_.testOutputId
  );
  const ss = SpreadsheetApp.openById(targetId);
  const beforeState = rptReadStateData_(ss).map;
  const beforePointer = String(
    beforeState.analysisDataStoreFileId || ''
  );
  const beforeOwner = String(
    beforeState.analysisDataStoreRequestId || ''
  );
  if (!beforePointer ||
      beforeOwner !== VAA_QA_G6C_CONFIG_.createRequestId ||
      targetId === vaaQaG5ReplaceReadyGateReadOnly_().targetId) {
    throw new Error('QA_G6J_NOT_INDEPENDENT_TEST_TARGET');
  }
  const source = vaaReadAppendStoreSource_(ss);
  if (source.fileId !== beforePointer ||
      !source.dataObject ||
      source.dataObject.requestId !== beforeOwner) {
    throw new Error('QA_G6J_APPEND_SOURCE_CHANGED');
  }
  const plan = vaaBuildAppendStorePlan_(
    vaaQaG6EUpdatePayload_(targetId), source.dataObject, 'APPEND'
  );
  if (plan.stats.oldApplications !== 1 ||
      plan.stats.uploadedApplications !== 2 ||
      plan.stats.addedApplications !== 1 ||
      plan.stats.skippedAsExisting !== 1 ||
      plan.stats.finalApplications !== 2 ||
      plan.stats.finalJobs !== 1) {
    throw new Error('QA_G6J_MERGE_PLAN_CHANGED');
  }

  // Exactly ONE real TEST Drive file write. A timeout or exception may
  // occur after the file exists. Never retry this function in that case.
  const stage = vaaStageAppendDataStore_(
    ss, plan, VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_, beforePointer
  );

  // The inspector is strictly READ ONLY, even if this write succeeded.
  const checked = vaaQaG6JStageDetailsReadOnly_();
  const receiptUnchanged = vaaQaG6DHistoryEqual_(
    historyBefore, vaaQaG6DHistorySnapshot_(props)
  ) && !!createBefore && props.getProperty(createKey) === createBefore;
  const stageMatchesResult =
    stage.fileId === checked.stageFileId &&
    stage.spreadsheetId === targetId &&
    stage.requestId === VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_ &&
    stage.expectedSourceFileId === beforePointer &&
    stage.strategy === 'APPEND' &&
    stage.stats.finalApplications === 2 &&
    stage.stats.finalJobs === 1;

  const result = {
    phase: 'G6_STAGE_ONLY_ONCE',
    stageCreated: !!stage.fileId,
    stageResultMatchesInspection: stageMatchesResult,
    actualReadyReceipts: checked.output.actualReadyReceipts,
    stageFileCount: checked.output.stageFileCount,
    stageValidationCode: checked.output.validationCode,
    stageInTestFolder: checked.output.stageInTestFolder,
    stageDataStoreMatchesExpected:
      checked.output.stageBodyMatchesExpected &&
      checked.output.stageCountsMatchExpected,
    expectedFinalApplications: 2,
    expectedFinalJobs: 1,
    targetPointerUnchanged: checked.output.originalPointerUnchanged,
    stageUnlinkedFromWorkbook: checked.output.stageIsUnlinked,
    historicalReceiptsUnchanged: receiptUnchanged &&
      checked.output.historicalReceiptsUnchanged,
    createReceiptUnchanged: checked.output.createReceiptUnchanged,
    originalDataStoreUnchanged: checked.output.originalDataStoreUnchanged,
    stageReceiptUnused: checked.output.stageReceiptUnused,
    reservedUpdateRequestUnused: checked.output.reservedUpdateRequestUnused,
    updateLeaseAbsent: checked.output.updateLeaseAbsent,
    casPerformed: false,
    actualUpdatePerformed: false,
    fullDoPostFaultInjected: false,
    automaticRetryAuthorized: false,
    propertyWrites: 0,
    workbookModified: false,
    driveFilesCreatedExpected: 1,
    driveFileDeletionAttempted: false
  };
  result.pass = !!(
    checked.output.pass && stageMatchesResult &&
    result.stageCreated && result.stageFileCount === 1 &&
    receiptUnchanged && result.targetPointerUnchanged &&
    result.stageUnlinkedFromWorkbook &&
    result.stageReceiptUnused &&
    result.reservedUpdateRequestUnused &&
    result.updateLeaseAbsent
  );
  console.log('VAA_QA_G6_STAGE_ONLY_CREATE ' + JSON.stringify(result));
  return result;
}
