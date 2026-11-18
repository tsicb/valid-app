/**
 * Isolated TEST-only QA for G5-E/F/G. Manual installation as a NEW GAS file.
 * Required prior QA files: G4, G5 APPEND preflight and once/replay,
 * G5 REPLACE preflight. Never put this file in central-api/ or production.
 *
 * G5-E: vaaQaG5ReplaceOnce — writes once after G5-D preflight.
 * G5-F: vaaQaG5ReplaceReplayReady — tests READY idempotency.
 * G5-G: vaaQaG5ReplaceRejectPayloadMismatch — expects API rejection.
 *
 * Never repeat ReplaceOnce after error, timeout or uncertain response.
 */
function vaaQaG5ReplaceStoredReceipt_(props) {
  const raw = props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G5_REPLACE_REQUEST_ID_
  );
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (_) { throw new Error('QA_G5_REPLACE_RECEIPT_UNREADABLE'); }
}

/**
 * Read only: ensure the active DataStore equals the exact expected synthetic
 * REPLACE snapshot, not just matching row counts.
 */
function vaaQaG5ReplaceVerifyFinalReadOnly_(targetId) {
  const base = vaaQaG5GetReadyG4Receipt_();
  if (base.receipt.spreadsheetId !== targetId) {
    throw new Error('QA_G5_REPLACE_WRONG_TARGET');
  }
  const ss = SpreadsheetApp.openById(targetId);
  const stored = vaaQaG5ReadTestDataStore_(ss);
  const expected = vaaQaG5ReplacePlan_(
    vaaQaG5ReplacePayload_(targetId)
  );
  return {
    dataStoreMatchesExpected:
      JSON.stringify(stored.applicationData) ===
        JSON.stringify(expected.applicationData) &&
      JSON.stringify(stored.jobAnalysisMaster) ===
        JSON.stringify(expected.jobAnalysisMaster),
    actualFinalApplications: stored.applicationData.rows.length,
    actualFinalJobs: stored.jobAnalysisMaster.rows.length
  };
}

function vaaQaG5ReplaceSummary_(response, phase, targetId) {
  const props = vaaQaG4IsolatedConfig_();
  const receipt = vaaQaG5ReplaceStoredReceipt_(props);
  const expected = vaaQaG5ReplacePlan_(
    vaaQaG5ReplacePayload_(targetId)
  ).stats;
  const stats = response && response.updateStats ||
    receipt && receipt.updateStats || {};
  const s = key => stats[key] == null ? null : Number(stats[key]);
  const out = {
    phase: phase,
    ok: !!response && response.ok === true,
    status: String(response && response.status || ''),
    stage: String(response && response.stage || ''),
    code: String(response && response.code || ''),
    reused: !!response && response.reused === true,
    updateStrategy: String(response && response.updateStrategy || ''),
    sameTarget: !!response && response.spreadsheetId === targetId,
    requestIdMatched: !!response &&
      response.requestId === VAA_QA_G5_REPLACE_REQUEST_ID_,
    receiptExists: !!receipt,
    receiptReady: !!receipt &&
      receipt.status === 'READY' && receipt.stage === 'READY',
    receiptMatchesTarget: !!receipt &&
      receipt.spreadsheetId === targetId &&
      receipt.targetSpreadsheetId === targetId,
    receiptStrategyMatches: !!receipt &&
      receipt.updateStrategy === 'REPLACE',
    updateLeaseExists: !!props.getProperty(vaaTargetUpdateLeaseKey_(targetId)),
    oldApplications: s('oldApplications'),
    uploadedApplications: s('uploadedApplications'),
    addedApplications: s('addedApplications'),
    finalApplications: s('finalApplications'),
    finalJobs: s('finalJobs'),
    expectedOldApplications: expected.oldApplications,
    expectedFinalApplications: expected.finalApplications,
    expectedFinalJobs: expected.finalJobs,
    dataStoreVerified: false,
    dataStoreMatchesExpected: false,
    testOutputOnly: true
  };
  if (out.ok && out.status === 'READY' && out.receiptReady) {
    try {
      const checked = vaaQaG5ReplaceVerifyFinalReadOnly_(targetId);
      out.dataStoreVerified = true;
      out.dataStoreMatchesExpected = checked.dataStoreMatchesExpected;
      out.actualFinalApplications = checked.actualFinalApplications;
      out.actualFinalJobs = checked.actualFinalJobs;
    } catch (_) {
      out.dataStoreVerified = false;
    }
  }
  out.pass = !!(
    out.ok && out.status === 'READY' && out.stage === 'READY' &&
    out.updateStrategy === 'REPLACE' && out.sameTarget &&
    out.requestIdMatched && out.receiptReady &&
    out.receiptMatchesTarget && out.receiptStrategyMatches &&
    !out.updateLeaseExists && out.dataStoreVerified &&
    out.dataStoreMatchesExpected &&
    out.oldApplications === expected.oldApplications &&
    out.uploadedApplications === expected.uploadedApplications &&
    out.addedApplications === expected.addedApplications &&
    out.finalApplications === expected.finalApplications &&
    out.finalJobs === expected.finalJobs &&
    out.actualFinalApplications === 1 && out.actualFinalJobs === 1
  );
  return out;
}

/**
 * G5-E. This is the ONE intended write to the existing TEST workbook.
 * Runtime preflight includes TEST root, READY APPEND digest, exact 2-row
 * baseline, unused requestId, no target lease and capacity admission.
 */
function vaaQaG5ReplaceOnce() {
  vaaQaG4IsolatedConfig_();
  const preflight = vaaQaG5ReplacePreflightReadOnly();
  if (preflight.safeToReplaceOnce !== true) {
    throw new Error('QA_G5_REPLACE_BLOCKED_BY_PREFLIGHT');
  }
  const base = vaaQaG5GetReadyG4Receipt_();
  const targetId = base.receipt.spreadsheetId;
  const response = vaaQaG4Invoke_(
    vaaQaG5ReplacePayload_(targetId)
  );
  const out = vaaQaG5ReplaceSummary_(
    response, 'G5_REPLACE_ONCE', targetId
  );
  out.pass = out.pass && out.reused === false;
  console.log('VAA_QA_G5_REPLACE ' + JSON.stringify(out));
  return out;
}

/**
 * Shared read-only stop gate before READY replay or mismatch challenge.
 * It must NOT make any API POST.
 */
function vaaQaG5ReplaceReadyGateReadOnly_() {
  vaaQaG4IsolatedConfig_();
  const base = vaaQaG5GetReadyG4Receipt_();
  const targetId = base.receipt.spreadsheetId;
  const props = base.props;
  const receipt = vaaQaG5ReplaceStoredReceipt_(props);
  if (!receipt ||
      receipt.requestId !== VAA_QA_G5_REPLACE_REQUEST_ID_ ||
      receipt.operationMode !== 'UPDATE' ||
      receipt.status !== 'READY' || receipt.stage !== 'READY' ||
      receipt.updateStrategy !== 'REPLACE' ||
      receipt.spreadsheetId !== targetId ||
      receipt.targetSpreadsheetId !== targetId) {
    throw new Error('QA_G5_REPLACE_REPLAY_BLOCKED_NOT_READY');
  }
  if (props.getProperty(vaaTargetUpdateLeaseKey_(targetId))) {
    throw new Error('QA_G5_REPLACE_REPLAY_BLOCKED_LEASE');
  }
  const payload = vaaQaG5ReplacePayload_(targetId);
  const digestCheck = vaaValidateUpdateRequestRecord_(
    receipt, 'REPLACE', vaaDigestUpdateRequest_(payload)
  );
  if (!digestCheck.ok) {
    throw new Error('QA_G5_REPLACE_REPLAY_BLOCKED_DIGEST');
  }
  const checked = vaaQaG5ReplaceVerifyFinalReadOnly_(targetId);
  if (!checked.dataStoreMatchesExpected ||
      checked.actualFinalApplications !== 1 ||
      checked.actualFinalJobs !== 1) {
    throw new Error('QA_G5_REPLACE_REPLAY_BLOCKED_DATASTORE');
  }
  const ss = SpreadsheetApp.openById(targetId);
  const pointer = String(rptReadStateData_(ss).map.analysisDataStoreFileId || '');
  if (!pointer) throw new Error('QA_G5_REPLACE_REPLAY_BLOCKED_POINTER');
  return {targetId:targetId, props:props, receipt:receipt,
    payload:payload, pointer:pointer, spreadsheet:ss};
}

/** G5-F. Exactly one replay of the successfully completed REPLACE. */
function vaaQaG5ReplaceReplayReady() {
  const prior = vaaQaG5ReplaceReadyGateReadOnly_();
  const response = vaaQaG4Invoke_(prior.payload);
  const out = vaaQaG5ReplaceSummary_(
    response, 'G5_REPLACE_REPLAY', prior.targetId
  );
  const after = String(
    rptReadStateData_(prior.spreadsheet).map.analysisDataStoreFileId || ''
  );
  out.dataStorePointerUnchanged =
    !!after && after === prior.pointer;
  out.pass = out.pass && out.reused === true &&
    out.dataStorePointerUnchanged;
  console.log('VAA_QA_G5_REPLACE_REPLAY ' + JSON.stringify(out));
  return out;
}

/**
 * G5-G. Send DIFFERENT synthetic data using the SAME completed requestId.
 * This is an intentional negative API test, expected REQUEST_PAYLOAD_MISMATCH.
 * The guard checks a completed REPLACE first and refuses unknown targets.
 */
function vaaQaG5ReplaceRejectPayloadMismatch() {
  const prior = vaaQaG5ReplaceReadyGateReadOnly_();
  const key = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G5_REPLACE_REQUEST_ID_;
  const receiptBefore = prior.props.getProperty(key);
  // Only this synthetic salary value changes; requestId and mode are fixed.
  const altered = vaaQaG5ReplacePayload_(prior.targetId);
  const job = altered.datasets.jobAnalysisMaster;
  const salaryIndex = job.headers.indexOf('給与金額MIN');
  if (salaryIndex < 0) throw new Error('QA_G5_MISMATCH_FIXTURE_INVALID');
  job.rows[0][salaryIndex] = 1700;
  if (vaaDigestUpdateRequest_(altered) ===
      vaaDigestUpdateRequest_(prior.payload)) {
    throw new Error('QA_G5_MISMATCH_DIGEST_UNCHANGED');
  }

  const response = vaaQaG4Invoke_(altered);
  const receiptAfter = prior.props.getProperty(key);
  const pointerAfter = String(
    rptReadStateData_(prior.spreadsheet).map.analysisDataStoreFileId || ''
  );
  const stored = vaaQaG5ReplaceVerifyFinalReadOnly_(prior.targetId);
  const leaseExists = !!prior.props.getProperty(
    vaaTargetUpdateLeaseKey_(prior.targetId)
  );
  const out = {
    phase: 'G5_REPLACE_PAYLOAD_MISMATCH_REJECTION',
    rejectedByApi: !!response && response.ok === false,
    rejectionCode: String(response && response.code || ''),
    expectedRejectionCode: 'REQUEST_PAYLOAD_MISMATCH',
    sameRequestId: altered.requestId === VAA_QA_G5_REPLACE_REQUEST_ID_,
    differentPayloadDigest: true,
    receiptUnchanged: receiptBefore === receiptAfter,
    dataStorePointerUnchanged: !!pointerAfter &&
      pointerAfter === prior.pointer,
    dataStoreMatchesExpected: stored.dataStoreMatchesExpected,
    actualFinalApplications: stored.actualFinalApplications,
    actualFinalJobs: stored.actualFinalJobs,
    updateLeaseExists: leaseExists,
    testOutputOnly: true
  };
  out.pass = out.rejectedByApi &&
    out.rejectionCode === 'REQUEST_PAYLOAD_MISMATCH' &&
    out.sameRequestId && out.receiptUnchanged &&
    out.dataStorePointerUnchanged &&
    out.dataStoreMatchesExpected &&
    out.actualFinalApplications === 1 &&
    out.actualFinalJobs === 1 && !out.updateLeaseExists;
  console.log('VAA_QA_G5_REPLACE_MISMATCH ' + JSON.stringify(out));
  return out;
}
