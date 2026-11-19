/**
 * G6-E — isolated TEST-only UPDATE fault-plan preflight (READ ONLY).
 *
 * Installed MANUALLY as a new file in isolated TEST Apps Script only.
 * Requires G4/G5 QA, G6-D QA and canonical central-api functions.
 *
 * Does not POST, update workbooks, write Script Properties, stage DataStore,
 * change Drive files, inject failures or authorize a retry.
 */
const VAA_QA_G6E_UPDATE_REQUEST_ID_ =
  'QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1';

/** A fresh APPEND payload targeting G6-D's separate synthetic workbook. */
function vaaQaG6EUpdatePayload_(targetId) {
  const payload = vaaQaG6CFaultDomainPayload_();
  const data = payload.datasets.applicationData;
  const added = data.rows[0].slice();
  function set_(name, value) {
    const column = data.headers.indexOf(name);
    if (column < 0) throw new Error('QA_G6E_MISSING_FIXTURE_COLUMN');
    added[column] = value;
  }
  set_('レコードID', 'APP000002');
  set_('応募日時', '2026/11/19 12:00');
  set_('応募年月', '2026/11');
  set_('応募日', '2026/11/19');
  set_('応募曜日', '木');
  set_('応募識別キー', 'I1:' + Array(65).join('e'));
  data.rows.push(added);
  payload.requestId = VAA_QA_G6E_UPDATE_REQUEST_ID_;
  payload.action = 'update';
  payload.operationMode = 'update';
  payload.targetSpreadsheetId = targetId;
  payload.updateStrategy = 'APPEND';
  payload.updateProtocol = 'IDENTITY_V1';
  return payload;
}

/**
 * An operator-facing outline only. No fault hook is installed here.
 * All mid-write / CAS uncertainty must stop automatic retries.
 */
function vaaQaG6EFaultPlanReadOnly_() {
  return [
    {
      point: 'BEFORE_NEW_REQUEST_ADMISSION',
      expectedReceipt: 'ABSENT',
      expectedPointer: 'ORIGINAL',
      restartDecision: 'FRESH_ONLY_AFTER_READ_ONLY_AUDIT'
    },
    {
      point: 'AFTER_TARGET_LEASE_BEFORE_RECEIPT',
      expectedReceipt: 'ABSENT_OR_INCOMPLETE',
      expectedPointer: 'ORIGINAL',
      restartDecision: 'BLOCK_UNTIL_LEASE_AND_TARGET_AUDITED'
    },
    {
      point: 'AFTER_PROCESSING_RECEIPT_BEFORE_STAGE',
      expectedReceipt: 'PROCESSING',
      expectedPointer: 'ORIGINAL',
      restartDecision: 'NO_AUTOMATIC_RETRY'
    },
    {
      point: 'AFTER_DATASTORE_STAGE_BEFORE_CAS',
      expectedReceipt: 'PROCESSING',
      expectedPointer: 'ORIGINAL',
      restartDecision: 'NO_AUTOMATIC_RETRY'
    },
    {
      point: 'AFTER_DATASTORE_CAS_BEFORE_MIRRORS',
      expectedReceipt: 'PROCESSING_OR_ERROR',
      expectedPointer: 'NEW_OR_UNCERTAIN',
      restartDecision: 'NO_AUTOMATIC_RETRY'
    },
    {
      point: 'AFTER_READY_BEFORE_RESPONSE',
      expectedReceipt: 'READY',
      expectedPointer: 'NEW',
      restartDecision: 'REPLAY_ONLY_AFTER_SAFE_READ_ONLY_VERIFICATION'
    }
  ];
}

/** G6-E public entry point: complete READ_ONLY gate for an independent UPDATE. */
function vaaQaG6EUpdateFaultPreflightReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const historyBefore = vaaQaG6DHistorySnapshot_(props);
  const newDomain = vaaQaG6DInspectFaultDomainReadOnly();
  if (newDomain.pass !== true ||
      newDomain.candidateReceiptReady !== true ||
      newDomain.receiptCount !== 4 ||
      newDomain.readyCount !== 4 ||
      newDomain.dataStoreMatchesSynthetic !== true) {
    throw new Error('QA_G6E_INDEPENDENT_FAULT_DOMAIN_NOT_READY');
  }

  const createId = VAA_QA_G6C_CONFIG_.createRequestId;
  const createRecord = getRequestRecord_(props, createId);
  if (!createRecord ||
      createRecord.requestId !== createId ||
      createRecord.operationMode !== 'CREATE' ||
      createRecord.status !== 'READY' ||
      createRecord.stage !== 'READY' ||
      createRecord.outputFolderId !== VAA_QA_G4_CONFIG_.testOutputId ||
      !createRecord.spreadsheetId) {
    throw new Error('QA_G6E_NEW_DOMAIN_RECEIPT_UNVERIFIED');
  }
  const targetId = createRecord.spreadsheetId;
  const originalTarget = vaaQaG5GetReadyG4Receipt_().receipt.spreadsheetId;
  if (targetId === originalTarget) {
    throw new Error('QA_G6E_NOT_AN_INDEPENDENT_TARGET');
  }
  validateUpdateTargetDriveFile_(
    targetId, VAA_QA_G4_CONFIG_.testOutputId
  );

  const ss = SpreadsheetApp.openById(targetId);
  const beforeState = rptReadStateData_(ss);
  const pointerBefore = String(
    beforeState.map.analysisDataStoreFileId || ''
  );
  const activeStoreRequestId = String(
    beforeState.map.analysisDataStoreRequestId || ''
  );
  const currentlyStored = vaaQaG5ReadTestDataStore_(ss);
  const existingApplications = currentlyStored.applicationData.rows.length;
  const existingJobs = currentlyStored.jobAnalysisMaster.rows.length;
  const payload = vaaQaG6EUpdatePayload_(targetId);
  const validate = validateEnvelope_(payload);
  const protocol = vaaValidateUpdateProtocol_(payload);
  const admission = vaaCheckNewRequestCapacityReadOnly_(props);
  const newRequestExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const updateLeaseExists = !!props.getProperty(
    vaaTargetUpdateLeaseKey_(targetId)
  );

  const independentRequestId =
    VAA_QA_G6E_UPDATE_REQUEST_ID_ !== createId &&
    VAA_QA_G6E_UPDATE_REQUEST_ID_ !== VAA_QA_G4_CONFIG_.requestId &&
    VAA_QA_G6E_UPDATE_REQUEST_ID_ !== VAA_QA_G5_APPEND_REQUEST_ID_ &&
    VAA_QA_G6E_UPDATE_REQUEST_ID_ !== VAA_QA_G5_REPLACE_REQUEST_ID_;
  const targetIsSeparate = targetId !== originalTarget &&
    payload.targetSpreadsheetId === targetId;
  const originalDataStorePointer = vaaQaG5ReplaceReadyGateReadOnly_().pointer;
  const dataStoreIsSeparate =
    !!pointerBefore && pointerBefore !== originalDataStorePointer;

  // Rebuild the exact expected normalized G6-D CREATE snapshot in memory.
  const originalSynthetic = VAAAppendMergeCore.merge({
    mode: 'REPLACE',
    incoming: vaaQaG6CFaultDomainPayload_().datasets,
    maxRows: API_CONFIG.MAX_DATASET_ROWS
  });
  const matchesSyntheticBaseline =
    JSON.stringify(currentlyStored.applicationData) ===
      JSON.stringify(originalSynthetic.applicationData) &&
    JSON.stringify(currentlyStored.jobAnalysisMaster) ===
      JSON.stringify(originalSynthetic.jobAnalysisMaster);

  let planCode = 'PRECONDITION_NOT_MET';
  let expectedApps = null;
  let expectedJobs = null;
  let expectedAdded = null;
  let expectedSkipped = null;
  let planIsExact = false;
  if (validate.ok && protocol.ok && existingApplications === 1 &&
      existingJobs === 1 && matchesSyntheticBaseline) {
    try {
      // Pure core. DOES NOT create a staged file or touch the state pointer.
      const plan = VAAAppendMergeCore.merge({
        mode: 'APPEND',
        existing: {
          applicationIdentityVersion: VAAAppendMergeCore.VERSION,
          applicationData: currentlyStored.applicationData,
          jobAnalysisMaster: currentlyStored.jobAnalysisMaster
        },
        incoming: payload.datasets,
        maxRows: API_CONFIG.MAX_DATASET_ROWS
      });
      expectedApps = plan.applicationData.rows.length;
      expectedJobs = plan.jobAnalysisMaster.rows.length;
      expectedAdded = plan.stats.addedApplications;
      expectedSkipped = plan.stats.skippedAsExisting;
      const identityIndex = plan.applicationData.headers.indexOf('応募識別キー');
      planIsExact =
        plan.stats.oldApplications === 1 &&
        plan.stats.uploadedApplications === 2 &&
        plan.stats.addedApplications === 1 &&
        plan.stats.skippedAsExisting === 1 &&
        plan.stats.oldJobs === 1 &&
        plan.stats.finalJobs === 1 &&
        plan.applicationData.rows.length === 2 &&
        plan.jobAnalysisMaster.rows.length === 1 &&
        plan.applicationData.rows[1][identityIndex] ===
          'I1:' + Array(65).join('e') &&
        JSON.stringify(plan.jobAnalysisMaster) ===
          JSON.stringify(currentlyStored.jobAnalysisMaster);
      planCode = planIsExact ? 'OK' : 'MERGE_RESULT_MISMATCH';
    } catch (err) {
      planCode = String(err && err.code || 'MERGE_PLAN_FAILED');
    }
  }

  const finalState = rptReadStateData_(ss);
  const pointerUnchanged = !!pointerBefore &&
    String(finalState.map.analysisDataStoreFileId || '') === pointerBefore &&
    String(finalState.map.analysisDataStoreRequestId || '') ===
      activeStoreRequestId;
  const historicalReceiptsUnchanged = vaaQaG6DHistoryEqual_(
    historyBefore, vaaQaG6DHistorySnapshot_(props)
  );
  const createStillReady = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + createId
  );
  const newRequestStillUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const faultScenarios = vaaQaG6EFaultPlanReadOnly_();

  const output = {
    phase: 'G6_UPDATE_FAULT_PREFLIGHT_READ_ONLY',
    strictReadOnly: true,
    faultDomainInspectionPass: true,
    priorReadyReceipts: newDomain.readyCount,
    candidateRequestIdAlreadyExists: newRequestExists,
    candidateIndependentOfHistoricalIds: independentRequestId,
    candidateTargetsIndependentTestWorkbook: targetIsSeparate,
    candidateDataStoreIndependent: dataStoreIsSeparate,
    currentDataStoreCreatedByG6D: activeStoreRequestId === createId,
    existingApplications: existingApplications,
    existingJobs: existingJobs,
    syntheticBaselineMatches: matchesSyntheticBaseline,
    payloadValidationCode: validate.ok ? 'OK' : validate.code,
    updateProtocolCode: protocol.ok ? 'OK' : protocol.code,
    budgetAllowed: admission.allowed === true,
    targetUpdateLeaseExists: updateLeaseExists,
    mergePlanCode: planCode,
    expectedFinalApplications: expectedApps,
    expectedFinalJobs: expectedJobs,
    expectedAddedApplications: expectedAdded,
    expectedSkippedApplications: expectedSkipped,
    pointerUnchangedDuringPreflight: pointerUnchanged,
    historicalReceiptsUnchanged: historicalReceiptsUnchanged,
    createReceiptStillPresent: createStillReady,
    newRequestStillUnused: newRequestStillUnused,
    plannedFaultPointCount: faultScenarios.length,
    planOnly: true,
    actualFaultInjected: false,
    actualResumeTested: false,
    faultInjectionAuthorized: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  output.readyForFaultInjectionDesignReview = !!(
    newDomain.pass && newDomain.readyCount === 4 &&
    !newRequestExists && independentRequestId && targetIsSeparate &&
    dataStoreIsSeparate && activeStoreRequestId === createId &&
    matchesSyntheticBaseline &&
    validate.ok && protocol.ok && admission.allowed &&
    !updateLeaseExists && planIsExact && pointerUnchanged &&
    historicalReceiptsUnchanged && createStillReady &&
    newRequestStillUnused && faultScenarios.length === 6
  );
  console.log('VAA_QA_G6_UPDATE_FAULT_PREFLIGHT ' +
    JSON.stringify(output));
  return output;
}
