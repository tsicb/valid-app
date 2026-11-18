/**
 * G5-B / G5-C QA ONLY. Install as a NEW file in the isolated TEST GAS.
 * Dependencies: G4_Isolated_Create_Replay_QA.gs and
 * G5_Isolated_Append_Preflight_QA.gs.
 *
 * G5-B: vaaQaG5AppendOnce() — ONE intentional TEST workbook UPDATE.
 * G5-C: vaaQaG5ReplayReady() — same requestId only after READY validation.
 *
 * Never sync this file into the production GAS project. Never rerun
 * vaaQaG5AppendOnce() after any failure, interruption or partial response.
 */

function vaaQaG5ExpectedSnapshot_() {
  const baseline = VAAAppendMergeCore.merge({
    mode: 'REPLACE',
    incoming: vaaQaG4SyntheticPayload_().datasets,
    maxRows: API_CONFIG.MAX_DATASET_ROWS
  });
  const incoming = vaaQaG5AppendPayload_('QA_TARGET_PLACEHOLDER');
  return VAAAppendMergeCore.merge({
    mode: 'APPEND',
    incoming: incoming.datasets,
    existing: {
      applicationIdentityVersion: VAAAppendMergeCore.VERSION,
      applicationData: baseline.applicationData,
      jobAnalysisMaster: baseline.jobAnalysisMaster
    },
    maxRows: API_CONFIG.MAX_DATASET_ROWS
  });
}

/**
 * No writes. Requires the target to be a G4 READY workbook inside TEST
 * output, and its active DataStore to be inside TEST root.
 */
function vaaQaG5VerifyFinalReadOnly_(targetId) {
  const base = vaaQaG5GetReadyG4Receipt_();
  if (targetId !== base.receipt.spreadsheetId) {
    throw new Error('QA_G5_TARGET_CHANGED');
  }
  const target = SpreadsheetApp.openById(targetId);
  const current = vaaQaG5ReadTestDataStore_(target);
  const expected = vaaQaG5ExpectedSnapshot_();
  const matches =
    JSON.stringify(current.applicationData) ===
      JSON.stringify(expected.applicationData) &&
    JSON.stringify(current.jobAnalysisMaster) ===
      JSON.stringify(expected.jobAnalysisMaster);
  return {
    dataStoreMatchesExpected: matches,
    finalApplications: current.applicationData.rows.length,
    finalJobs: current.jobAnalysisMaster.rows.length
  };
}

function vaaQaG5StoredAppendReceipt_(props) {
  const raw = props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G5_APPEND_REQUEST_ID_
  );
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {
    // Treat a malformed receipt as a replay-blocking error.
    throw new Error('QA_G5_RECEIPT_UNREADABLE');
  }
}

function vaaQaG5Summary_(response, phase, expectedTargetId) {
  const props = vaaQaG4IsolatedConfig_();
  const receipt = vaaQaG5StoredAppendReceipt_(props);
  const responseStats = response && response.updateStats || {};
  const savedStats = receipt && receipt.updateStats || {};
  const stats = Object.keys(responseStats).length ? responseStats : savedStats;
  const output = {
    phase: phase,
    ok: !!response && response.ok === true,
    status: String(response && response.status || ''),
    stage: String(response && response.stage || ''),
    code: String(response && response.code || ''),
    reused: !!response && response.reused === true,
    updateStrategy: String(response && response.updateStrategy || ''),
    sameTarget: !!response && response.spreadsheetId === expectedTargetId,
    requestIdMatched: !!response &&
      response.requestId === VAA_QA_G5_APPEND_REQUEST_ID_,
    receiptExists: !!receipt,
    receiptReady: !!receipt && receipt.status === 'READY' &&
      receipt.stage === 'READY',
    receiptMatchesTarget: !!receipt &&
      receipt.spreadsheetId === expectedTargetId &&
      receipt.targetSpreadsheetId === expectedTargetId,
    receiptStrategyMatches: !!receipt &&
      receipt.updateStrategy === 'APPEND',
    updateLeaseExists: !!props.getProperty(vaaTargetUpdateLeaseKey_(expectedTargetId)),
    oldApplications: stats.oldApplications == null ? null : Number(stats.oldApplications),
    addedApplications: stats.addedApplications == null ? null : Number(stats.addedApplications),
    finalApplications: stats.finalApplications == null ? null : Number(stats.finalApplications),
    finalJobs: stats.finalJobs == null ? null : Number(stats.finalJobs),
    dataStoreMatchesExpected: false,
    dataStoreVerified: false,
    testOutputOnly: true
  };
  // Don't hide an incomplete commit; include a safe status flag, not raw IDs.
  if (output.ok && output.status === 'READY' && output.receiptReady) {
    try {
      const verified = vaaQaG5VerifyFinalReadOnly_(expectedTargetId);
      output.dataStoreVerified = true;
      output.dataStoreMatchesExpected = verified.dataStoreMatchesExpected;
      output.actualFinalApplications = verified.finalApplications;
      output.actualFinalJobs = verified.finalJobs;
    } catch (_) {
      output.dataStoreVerified = false;
      output.dataStoreMatchesExpected = false;
    }
  }
  output.pass = output.ok && output.status === 'READY' &&
    output.stage === 'READY' && output.sameTarget &&
    output.requestIdMatched && output.receiptReady &&
    output.receiptMatchesTarget && output.receiptStrategyMatches &&
    !output.updateLeaseExists && output.dataStoreVerified &&
    output.dataStoreMatchesExpected &&
    output.oldApplications === 1 &&
    output.addedApplications === 1 &&
    output.finalApplications === 2 && output.finalJobs === 1 &&
    output.actualFinalApplications === 2 && output.actualFinalJobs === 1;
  return output;
}

/**
 * WRITE: one real UPDATE to the already-created isolated G4 workbook.
 * Call only after the G5-A preflight log is true. Never retry on failure.
 * Uses the exact synthetic payload previously checked by G5-A.
 */
function vaaQaG5AppendOnce() {
  vaaQaG4IsolatedConfig_();
  const preflight = vaaQaG5AppendPreflightReadOnly();
  if (preflight.safeToAppendOnce !== true) {
    throw new Error('QA_G5_APPEND_BLOCKED_BY_PREFLIGHT');
  }
  const base = vaaQaG5GetReadyG4Receipt_();
  const targetId = base.receipt.spreadsheetId;
  const response = vaaQaG4Invoke_(vaaQaG5AppendPayload_(targetId));
  const output = vaaQaG5Summary_(response, 'G5_APPEND_ONCE', targetId);
  // Safe aggregated fields only. No token, targetId or raw payload in logs.
  console.log('VAA_QA_G5_APPEND ' + JSON.stringify(output));
  return output;
}

/**
 * REPLAY: first verify the prior request is READY, refers to the TEST
 * target, has the SAME payload digest/strategy, and the final DataStore
 * matches the expected synthetic snapshot. If not, make no POST.
 */
function vaaQaG5ReplayReady() {
  vaaQaG4IsolatedConfig_();
  const base = vaaQaG5GetReadyG4Receipt_();
  const targetId = base.receipt.spreadsheetId;
  const props = base.props;
  const receipt = vaaQaG5StoredAppendReceipt_(props);
  if (!receipt ||
      receipt.requestId !== VAA_QA_G5_APPEND_REQUEST_ID_ ||
      receipt.operationMode !== 'UPDATE' ||
      receipt.status !== 'READY' || receipt.stage !== 'READY' ||
      receipt.updateStrategy !== 'APPEND' ||
      receipt.targetSpreadsheetId !== targetId ||
      receipt.spreadsheetId !== targetId) {
    throw new Error('QA_G5_REPLAY_BLOCKED_NOT_READY');
  }
  if (props.getProperty(vaaTargetUpdateLeaseKey_(targetId))) {
    throw new Error('QA_G5_REPLAY_BLOCKED_ACTIVE_LEASE');
  }
  const payload = vaaQaG5AppendPayload_(targetId);
  const digestCheck = vaaValidateUpdateRequestRecord_(
    receipt, 'APPEND', vaaDigestUpdateRequest_(payload)
  );
  if (!digestCheck.ok) {
    throw new Error('QA_G5_REPLAY_BLOCKED_DIGEST_MISMATCH');
  }
  const before = vaaQaG5VerifyFinalReadOnly_(targetId);
  if (!before.dataStoreMatchesExpected ||
      before.finalApplications !== 2 || before.finalJobs !== 1) {
    throw new Error('QA_G5_REPLAY_BLOCKED_DATASTORE_MISMATCH');
  }
  const ss = SpreadsheetApp.openById(targetId);
  const beforePointer = String(
    rptReadStateData_(ss).map.analysisDataStoreFileId || ''
  );
  if (!beforePointer) throw new Error('QA_G5_REPLAY_BLOCKED_POINTER_MISSING');

  const response = vaaQaG4Invoke_(payload);
  const output = vaaQaG5Summary_(response, 'G5_APPEND_REPLAY', targetId);
  const afterPointer = String(
    rptReadStateData_(ss).map.analysisDataStoreFileId || ''
  );
  output.dataStorePointerUnchanged =
    !!afterPointer && beforePointer === afterPointer;
  output.pass = output.pass && output.reused &&
    output.dataStorePointerUnchanged;
  console.log('VAA_QA_G5_APPEND_REPLAY ' + JSON.stringify(output));
  return output;
}
