/**
 * G5-D: isolated TEST-only REPLACE preflight. READ ONLY.
 *
 * Install as a NEW file in TEST Apps Script after G4 and G5-A/B/C QA files.
 * This file must never be copied into production central-api/*.gs.
 *
 * No HTTP POST, no spreadsheet writes, no Script Properties mutations.
 */
const VAA_QA_G5_REPLACE_REQUEST_ID_ = 'QA_G5_SYNTHETIC_REPLACE_20261119_V1';

function vaaQaG5ReplacePayload_(targetId) {
  const payload = vaaQaG4SyntheticPayload_();
  const app = payload.datasets.applicationData;
  const row = app.rows[0].slice();
  function setApp_(header, value) {
    const col = app.headers.indexOf(header);
    if (col < 0) throw new Error('QA_G5_REPLACE_APP_COLUMN_MISSING');
    row[col] = value;
  }
  setApp_('レコードID', 'APP000001');
  setApp_('応募日時', '2026/11/20 14:00');
  setApp_('応募年月', '2026/11');
  setApp_('応募日', '2026/11/20');
  setApp_('応募曜日', '金');
  setApp_('応募識別キー', 'I1:' + Array(65).join('c'));
  app.rows = [row];

  const job = payload.datasets.jobAnalysisMaster;
  function setJob_(header, value) {
    const col = job.headers.indexOf(header);
    if (col < 0) throw new Error('QA_G5_REPLACE_JOB_COLUMN_MISSING');
    job.rows[0][col] = value;
  }
  setJob_('仕事名', 'QA架空求人_REPLACE後');
  setJob_('給与金額MIN', 1600);

  payload.requestId = VAA_QA_G5_REPLACE_REQUEST_ID_;
  payload.action = 'update';
  payload.operationMode = 'update';
  payload.targetSpreadsheetId = targetId;
  payload.updateStrategy = 'REPLACE';
  payload.updateProtocol = 'IDENTITY_V1';
  return payload;
}

/**
 * Verify stored G5 APPEND is READY, matches the exact historic test payload
 * and points to the original G4 TEST workbook.
 */
function vaaQaG5ReplacePriorReadyReadOnly_() {
  const base = vaaQaG5GetReadyG4Receipt_();
  const props = base.props;
  const targetId = base.receipt.spreadsheetId;
  const previous = vaaQaG5StoredAppendReceipt_(props);
  if (!previous ||
      previous.requestId !== VAA_QA_G5_APPEND_REQUEST_ID_ ||
      previous.operationMode !== 'UPDATE' ||
      previous.status !== 'READY' ||
      previous.stage !== 'READY' ||
      previous.updateStrategy !== 'APPEND' ||
      previous.targetSpreadsheetId !== targetId ||
      previous.spreadsheetId !== targetId) {
    throw new Error('QA_G5_REPLACE_PRIOR_APPEND_NOT_READY');
  }
  const originalAppend = vaaQaG5AppendPayload_(targetId);
  const digest = vaaDigestUpdateRequest_(originalAppend);
  const digestCheck = vaaValidateUpdateRequestRecord_(
    previous, 'APPEND', digest
  );
  if (!digestCheck.ok) throw new Error('QA_G5_REPLACE_PRIOR_APPEND_DIGEST_MISMATCH');
  return base;
}

/** Pure merge: no Drive or Properties mutations. */
function vaaQaG5ReplacePlan_(payload) {
  return VAAAppendMergeCore.merge({
    mode: 'REPLACE',
    incoming: payload.datasets,
    maxRows: API_CONFIG.MAX_DATASET_ROWS
  });
}

/**
 * G5-D — reading only: verify APPEND baseline (2 applicants, 1 job), target
 * isolation, lack of active lease/reused request ID, and REPLACE plan (1
 * applicant, changed job title/min salary). No actual UPDATE is performed.
 */
function vaaQaG5ReplacePreflightReadOnly() {
  vaaQaG4IsolatedConfig_();
  const base = vaaQaG5ReplacePriorReadyReadOnly_();
  const props = base.props;
  const targetId = base.receipt.spreadsheetId;
  const previousState = vaaQaG5VerifyFinalReadOnly_(targetId);
  const baselineMatches = (
    previousState.dataStoreMatchesExpected === true &&
    previousState.finalApplications === 2 &&
    previousState.finalJobs === 1
  );

  const payload = vaaQaG5ReplacePayload_(targetId);
  const validation = validateEnvelope_(payload);
  const protocol = vaaValidateUpdateProtocol_(payload);
  const capacity = vaaCheckNewRequestCapacityReadOnly_(props);
  const existingReceipt = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G5_REPLACE_REQUEST_ID_
  );
  const leaseExists = !!props.getProperty(
    vaaTargetUpdateLeaseKey_(targetId)
  );

  let planOk = false;
  let planError = '';
  let appCount = null, jobCount = null;
  let replacementJobTitleConfirmed = false;
  let replacementSalaryConfirmed = false;
  let replacementIdentityConfirmed = false;
  if (validation.ok && protocol.ok && baselineMatches) {
    try {
      const plan = vaaQaG5ReplacePlan_(payload);
      const app = plan.applicationData;
      const job = plan.jobAnalysisMaster;
      appCount = app.rows.length;
      jobCount = job.rows.length;
      replacementJobTitleConfirmed = job.rows.length === 1 &&
        job.rows[0][job.headers.indexOf('仕事名')] ===
          'QA架空求人_REPLACE後';
      replacementSalaryConfirmed = job.rows.length === 1 &&
        Number(job.rows[0][job.headers.indexOf('給与金額MIN')]) === 1600;
      replacementIdentityConfirmed = app.rows.length === 1 &&
        app.rows[0][app.headers.indexOf('応募識別キー')] ===
          'I1:' + Array(65).join('c');
      planOk = appCount === 1 && jobCount === 1 &&
        replacementJobTitleConfirmed && replacementSalaryConfirmed &&
        replacementIdentityConfirmed;
    } catch (e) {
      planError = String(e && e.code || 'REPLACE_MERGE_ERROR');
    }
  } else {
    planError = 'PRECONDITION_NOT_MET';
  }

  const output = {
    phase: 'G5_REPLACE_PREFLIGHT_READ_ONLY',
    safeToReplaceOnce: !!(
      validation.ok && protocol.ok && capacity.allowed &&
      !existingReceipt && !leaseExists && baselineMatches && planOk
    ),
    payloadValidationCode: validation.ok ? 'OK' : validation.code,
    updateProtocolCode: protocol.ok ? 'OK' : protocol.code,
    budgetAllowed: capacity.allowed,
    requestIdAlreadyExists: existingReceipt,
    updateLeaseExists: leaseExists,
    targetInTestOutput: true,
    dataStoreInTestRoot: true,
    priorAppendReady: true,
    priorAppendDigestMatches: true,
    previousApplications: previousState.finalApplications,
    previousJobs: previousState.finalJobs,
    baselineMatches: baselineMatches,
    mergePlanCode: planError || 'OK',
    expectedFinalApplications: appCount,
    expectedFinalJobs: jobCount,
    jobTitleReplacementPlanned: replacementJobTitleConfirmed,
    salaryReplacementPlanned: replacementSalaryConfirmed,
    identityReplacementPlanned: replacementIdentityConfirmed,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false
  };
  console.log('VAA_QA_G5_REPLACE_PREFLIGHT ' + JSON.stringify(output));
  return output;
}
