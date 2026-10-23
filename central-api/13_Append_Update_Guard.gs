/**
 * UPDATE request protocol and per-company coordination.
 * No change to public Viewer authentication or Spreadsheet schema 3.0.
 */

function vaaUpdateCapabilities_() {
  return {
    updateProtocol: 'IDENTITY_V1',
    updateStrategies: ['APPEND', 'REPLACE'],
    applicationIdentityVersion: VAAAppendMergeCore.VERSION
  };
}

function vaaValidateUpdateProtocol_(payload) {
  if (!payload) return invalid_('INVALID_PAYLOAD', '更新データがありません。');
  const strategy = normalizeString_(payload.updateStrategy).toUpperCase();
  const protocol = normalizeString_(payload.updateProtocol);
  if ((strategy !== 'APPEND' && strategy !== 'REPLACE') ||
      protocol !== 'IDENTITY_V1') {
    return invalid_(
      'UPDATE_PROTOCOL_REQUIRED',
      'データ更新方式を認識できません。差分追加対応の新しい更新ページを開き直してください。'
    );
  }
  const application = payload.datasets && payload.datasets.applicationData;
  if (!application ||
      !Array.isArray(application.headers) ||
      application.headers.indexOf('応募識別キー') < 0 ||
      application.headers.indexOf('応募識別方式') < 0) {
    return invalid_(
      'APPLICATION_IDENTITY_REQUIRED',
      '応募識別キーがありません。新しい更新ページでCSVを読み直してください。'
    );
  }
  return {ok:true, strategy:strategy, protocol:protocol};
}

function vaaDigestUpdateRequest_(payload) {
  // Bound requestId to exactly one uploaded payload and strategy. Digest data
  // never persists the raw applicant CSV or any personally identifying data.
  const material = JSON.stringify([
    normalizeString_(payload.updateStrategy).toUpperCase(),
    normalizeString_(payload.updateProtocol),
    normalizeString_(payload.targetSpreadsheetUrl ||
      payload.targetSpreadsheetId),
    payload.datasets
  ]);
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    return ('0' + (byte & 255).toString(16)).slice(-2);
  }).join('');
}

function vaaValidateUpdateRequestRecord_(record, strategy, digest) {
  if (normalizeString_(record.updateStrategy) !== strategy ||
      normalizeString_(record.updatePayloadDigest) !== digest) {
    return {
      ok:false,
      code:'REQUEST_PAYLOAD_MISMATCH',
      message:'同じrequestIdで更新方法またはCSV内容が変更されました。新しい更新として再実行してください。'
    };
  }
  return {ok:true};
}

function vaaTargetUpdateLeaseKey_(spreadsheetId) {
  return 'VAA_TARGET_UPDATE_' + spreadsheetId;
}

/**
 * Call while already holding ScriptLock, before commencing any workbook I/O.
 */
function vaaClaimTargetUpdateLease_(props, spreadsheetId, requestId) {
  const key = vaaTargetUpdateLeaseKey_(spreadsheetId);
  const raw = props.getProperty(key);
  let existing = null;
  if (raw) {
    try { existing = JSON.parse(raw); } catch (_) {}
  }
  if (existing &&
      existing.requestId !== requestId &&
      Number(existing.expiresAt || 0) > Date.now()) {
    return {
      ok:false,
      code:'TARGET_UPDATE_BUSY',
      message:'この企業のデータ更新が別の処理で進行中です。完了後に再実行してください。'
    };
  }
  // The current request owns this target until READY/error or expiry.
  props.setProperty(key, JSON.stringify({
    requestId:requestId,
    expiresAt:Date.now() + API_CONFIG.PROCESS_LEASE_MS
  }));
  return {ok:true};
}

function vaaReleaseTargetUpdateLease_(props, spreadsheetId, requestId) {
  if (!spreadsheetId || !requestId) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const key = vaaTargetUpdateLeaseKey_(spreadsheetId);
    const raw = props.getProperty(key);
    if (!raw) return;
    let value = {};
    try { value = JSON.parse(raw); } catch (_) {}
    if (value.requestId === requestId) {
      props.deleteProperty(key);
    }
  } finally {
    lock.releaseLock();
  }
}

function vaaSummarizeUpdateStats_(stats) {
  if (!stats) return null;
  return {
    strategy: stats.strategy,
    oldApplications: Number(stats.oldApplications || 0),
    uploadedApplications: Number(stats.uploadedApplications || 0),
    duplicateWithinUpload: Number(stats.duplicateWithinUpload || 0),
    skippedAsExisting: Number(stats.skippedAsExisting || 0),
    addedApplications: Number(stats.addedApplications || 0),
    finalApplications: Number(stats.finalApplications || 0),
    oldJobs: Number(stats.oldJobs || 0),
    addedJobs: Number(stats.addedJobs || 0),
    finalJobs: Number(stats.finalJobs || 0),
    aggregateDecreaseGroups: Array.isArray(stats.aggregateDecreases)
      ? stats.aggregateDecreases.length : Number(stats.aggregateDecreaseGroups || 0)
  };
}

function vaaFinalDatasetCounts_(payload, record) {
  const stats = record && record.updateStats;
  if (stats && Number.isFinite(Number(stats.finalApplications)) &&
      Number.isFinite(Number(stats.finalJobs))) {
    return {
      applications: Number(stats.finalApplications),
      jobs: Number(stats.finalJobs)
    };
  }
  return {
    applications: Number(payload.datasets.applicationData.rows.length || 0),
    jobs: Number(payload.datasets.jobAnalysisMaster.rows.length || 0)
  };
}
