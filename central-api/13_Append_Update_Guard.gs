/**
 * UPDATE request protocol and per-company coordination.
 * No change to public Viewer authentication or Spreadsheet schema 3.0.
 */

// Disabled in production unless explicitly armed via Script Properties.
// The feature is opt-in per request; old APPEND/REPLACE signatures are unchanged.
function vaaLimitedAppendEnabled_() {
  try {
    return PropertiesService.getScriptProperties()
      .getProperty('VAA_LIMITED_APPEND_ENABLED') === 'true';
  } catch (_) {
    return false;
  }
}

function vaaLimitedAppendRequested_(payload) {
  return !!payload && (
    Object.prototype.hasOwnProperty.call(payload,'limitedAppendProtocol') ||
    Object.prototype.hasOwnProperty.call(payload,'limitedAppendCandidates')
  );
}

function vaaUpdateCapabilities_() {
  return {
    updateProtocol: 'IDENTITY_V1',
    updateStrategies: ['APPEND', 'REPLACE'],
    applicationIdentityVersion: VAAAppendMergeCore.VERSION,
    limitedAppend: {
      protocol:'LIMITED_APPEND_V1',
      enabled:vaaLimitedAppendEnabled_()
    }
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
  if (vaaLimitedAppendRequested_(payload)) {
    if (strategy !== 'APPEND' ||
        normalizeString_(payload.limitedAppendProtocol) !==
          'LIMITED_APPEND_V1' ||
        !payload.limitedAppendCandidates ||
        !payload.limitedAppendCandidates.applicationData ||
        !payload.limitedAppendCandidates.jobAnalysisMaster) {
      return invalid_(
        'LIMITED_APPEND_PROTOCOL_INVALID',
        '限定更新データの形式が一致しません。ページを再読み込みしてください。'
      );
    }
    if (!vaaLimitedAppendEnabled_()) {
      return invalid_(
        'LIMITED_APPEND_NOT_ENABLED',
        '限定更新機能は現在利用できません。通常の差分追加をご利用ください。'
      );
    }
  }
  return {ok:true, strategy:strategy, protocol:protocol};
}

function vaaDigestUpdateRequest_(payload) {
  // Bound requestId to exactly one uploaded payload and strategy. Digest data
  // never persists the raw applicant CSV or any personally identifying data.
  const baseDigestFields = [
    normalizeString_(payload.updateStrategy).toUpperCase(),
    normalizeString_(payload.updateProtocol),
    normalizeString_(payload.targetSpreadsheetUrl ||
      payload.targetSpreadsheetId),
    payload.datasets
  ];
  // Preserve the exact legacy digest material for requests without the
  // limited protocol. For opted-in requests, bind the one-time candidates
  // and protocol to the same requestId/replay digest as ordinary datasets.
  if (vaaLimitedAppendRequested_(payload)) {
    baseDigestFields.push([
      normalizeString_(payload.limitedAppendProtocol),
      payload.limitedAppendCandidates === undefined
        ? null : payload.limitedAppendCandidates
    ]);
  }
  const material = JSON.stringify(baseDigestFields);
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
      ? stats.aggregateDecreases.length : Number(stats.aggregateDecreaseGroups || 0),
    statusUpdatedApplications: Number(stats.statusUpdatedApplications || 0),
    statusUpdateSkippedDifferentEvent: Number(stats.statusUpdateSkippedDifferentEvent || 0),
    statusUpdateSkippedAmbiguous: Number(stats.statusUpdateSkippedAmbiguous || 0),
    updatedFromSupplementalCandidates: Number(stats.updatedFromSupplementalCandidates || 0),
    jobPromotedToCsv: Number(stats.jobPromotedToCsv || 0),
    jobAddedForExistingApplications: Number(stats.jobAddedForExistingApplications || 0),
    applicationsNewlyMatchedToJobCsv: Number(stats.applicationsNewlyMatchedToJobCsv || 0)
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
