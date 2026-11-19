/**
 * G6-C — isolated TEST-only FAULT-DOMAIN provisioning preflight, READ ONLY.
 *
 * This function only checks whether a SEPARATE synthetic test workbook
 * could safely be provisioned in a future step. It does not provision it,
 * call doPost, inject failures, edit Properties, or mutate Drive/Sheets.
 *
 * Dependencies: G4/G5 QA files, G6-B file, canonical central-api sources.
 * Install manually as a new file in the isolated TEST Apps Script ONLY.
 */
const VAA_QA_G6C_CONFIG_ = Object.freeze({
  createRequestId: 'QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1',
  company: 'QA_SYNTHETIC_ONLY_G6C_FAULT'
});

function vaaQaG6CFaultDomainPayload_() {
  const p = vaaQaG4SyntheticPayload_();
  p.requestId = VAA_QA_G6C_CONFIG_.createRequestId;
  p.companyDisplayName = VAA_QA_G6C_CONFIG_.company;
  p.outputFolderId = VAA_QA_G4_CONFIG_.testOutputId;
  // CREATE must not accidentally become an UPDATE to the G4/G5 workbook.
  delete p.targetSpreadsheetId;
  delete p.targetSpreadsheetUrl;
  delete p.updateStrategy;
  return p;
}

/**
 * Validate the canonical stage ordering from the deployed TEST GAS.
 * This checks stage gates only; it does NOT simulate a partial commit.
 */
function vaaQaG6CStagePlanReadOnly_() {
  const stages = [
    'TARGET_VALIDATED', 'OPENED', 'DATA_WRITTEN',
    'REPORT_DONE', 'READY'
  ];
  const stageRanks = stages.map(function(s) { return stageRank_(s); });
  const strictlyIncreasing = stageRanks.every(function(rank, i) {
    return i === 0 || rank > stageRanks[i - 1];
  });
  const updateHelpersPresent = [
    'vaaStageAppendDataStore_',
    'vaaCommitStagedAppendDataStore_',
    'vaaExecuteAppendDataStoreUpdate_',
    'vaaClaimTargetUpdateLease_',
    'vaaReleaseTargetUpdateLease_',
    'saveRequestRecord_',
    'getRequestRecord_',
    'vaaCheckNewRequestCapacityReadOnly_'
  ].every(function(name) {
    // Tests and editor both expose canonical GAS functions as global bindings.
    switch (name) {
      case 'vaaStageAppendDataStore_':
        return typeof vaaStageAppendDataStore_ === 'function';
      case 'vaaCommitStagedAppendDataStore_':
        return typeof vaaCommitStagedAppendDataStore_ === 'function';
      case 'vaaExecuteAppendDataStoreUpdate_':
        return typeof vaaExecuteAppendDataStoreUpdate_ === 'function';
      case 'vaaClaimTargetUpdateLease_':
        return typeof vaaClaimTargetUpdateLease_ === 'function';
      case 'vaaReleaseTargetUpdateLease_':
        return typeof vaaReleaseTargetUpdateLease_ === 'function';
      case 'saveRequestRecord_':
        return typeof saveRequestRecord_ === 'function';
      case 'getRequestRecord_':
        return typeof getRequestRecord_ === 'function';
      case 'vaaCheckNewRequestCapacityReadOnly_':
        return typeof vaaCheckNewRequestCapacityReadOnly_ === 'function';
      default:
        return false;
    }
  });

  return {
    canonicalStageOrderValid: strictlyIncreasing &&
      stageRanks[0] > 0 && stageRanks[4] > stageRanks[0],
    updateHelpersPresent: updateHelpersPresent,
    faultPointsPlanned: [
      'BEFORE_NEW_RECEIPT_WRITE',
      'AFTER_TARGET_VALIDATED',
      'AFTER_DATASTORE_STAGE_BEFORE_CAS',
      'AFTER_DATASTORE_CAS_BEFORE_MIRROR',
      'AFTER_DATA_WRITTEN_BEFORE_REPORT_DONE',
      'AFTER_REPORT_DONE_BEFORE_READY'
    ],
    actualFailureInjected: false,
    actualResumeTested: false
  };
}

/**
 * The sole G6-C entry point. Includes G6-B's real TEST READY/DataStore
 * attestation before examining the unused CREATE requestId and new,
 * isolated synthetic candidate payload. No existing workbook is targeted.
 */
function vaaQaG6CFaultDomainPreflightReadOnly() {
  vaaQaG4IsolatedConfig_();
  const prior = vaaQaG6BFailureGatesReadOnly();
  if (!prior.pass || prior.actualReadyReceipts !== 3 ||
      !prior.finalTestDataStoreMatches) {
    throw new Error('QA_G6C_BASELINE_NOT_READY');
  }

  const props = PropertiesService.getScriptProperties();
  const candidate = vaaQaG6CFaultDomainPayload_();
  const reqId = VAA_QA_G6C_CONFIG_.createRequestId;
  const receiptExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + reqId
  );
  const payloadValidation = validateEnvelope_(candidate);
  const capacity = vaaCheckNewRequestCapacityReadOnly_(props);
  const independentRequestId = reqId !== VAA_QA_G4_CONFIG_.requestId &&
    reqId !== VAA_QA_G5_APPEND_REQUEST_ID_ &&
    reqId !== VAA_QA_G5_REPLACE_REQUEST_ID_;
  const noExistingWorkbookTarget = !candidate.targetSpreadsheetId &&
    !candidate.targetSpreadsheetUrl && !candidate.updateStrategy;
  const outputIsTestOnly = candidate.outputFolderId ===
    VAA_QA_G4_CONFIG_.testOutputId;
  const companyIsSynthetic = candidate.companyDisplayName ===
    VAA_QA_G6C_CONFIG_.company &&
    candidate.companyDisplayName !== VAA_QA_G4_CONFIG_.company;
  const syntheticRows = candidate.datasets.applicationData.rows.length;
  const syntheticJobs = candidate.datasets.jobAnalysisMaster.rows.length;
  const stagePlan = vaaQaG6CStagePlanReadOnly_();

  const result = {
    phase: 'G6_FAULT_DOMAIN_PREFLIGHT_READ_ONLY',
    strictReadOnly: true,
    actualReadyReceipts: prior.actualReadyReceipts,
    baselinePass: prior.pass === true,
    finalTestDataStoreMatches: prior.finalTestDataStoreMatches,
    candidateRequestIdAlreadyExists: receiptExists,
    candidateIndependentOfHistoricalIds: independentRequestId,
    candidateDoesNotTargetExistingWorkbook: noExistingWorkbookTarget,
    candidateOutputIsTestOnly: outputIsTestOnly,
    candidateSyntheticCompany: companyIsSynthetic,
    candidatePayloadValidationCode:
      payloadValidation.ok ? 'OK' : payloadValidation.code,
    budgetAllowed: capacity.allowed === true,
    candidateSyntheticApplications: syntheticRows,
    candidateSyntheticJobs: syntheticJobs,
    canonicalStageOrderValid: stagePlan.canonicalStageOrderValid,
    updateHelpersPresent: stagePlan.updateHelpersPresent,
    plannedFaultPointCount: stagePlan.faultPointsPlanned.length,
    planOnly: true,
    faultDomainProvisioned: false,
    faultInjectionAuthorized: false,
    actualFailureInjected: false,
    actualResumeTested: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  result.readyForSeparateProvisioningPlan = !!(
    result.baselinePass &&
    result.finalTestDataStoreMatches &&
    !receiptExists && independentRequestId &&
    noExistingWorkbookTarget && outputIsTestOnly &&
    companyIsSynthetic && payloadValidation.ok &&
    capacity.allowed && syntheticRows === 1 && syntheticJobs === 1 &&
    stagePlan.canonicalStageOrderValid &&
    stagePlan.updateHelpersPresent &&
    stagePlan.faultPointsPlanned.length === 6
  );
  // Only aggregates. Never log IDs, credentials, receipt values, or payload.
  console.log('VAA_QA_G6_FAULT_DOMAIN_PREFLIGHT ' +
    JSON.stringify(result));
  return result;
}
