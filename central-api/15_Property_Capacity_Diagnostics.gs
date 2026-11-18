/**
 * Script Properties saturation: read-only, secret-safe capacity audit.
 *
 * Run vaaAuditScriptPropertyCapacityReadOnly() in the Apps Script editor
 * AFTER explicitly syncing this GitHub source into the target GAS project.
 *
 * This code does not set/delete properties, access Sheets/Drive, trigger
 * work, or return/log any keys, raw values, tokens, spreadsheet IDs or
 * request IDs. It estimates UTF-8 bytes for keys + values, not Google's
 * authoritative quota consumption.
 */

function vaaScriptPropertyCategory_(key) {
  if (key.indexOf('REQ_') === 0) return 'REQUEST_RECORDS';
  if (key.indexOf('RPTREG_') === 0) return 'REPORT_REGISTRY';
  if (key.indexOf('VIEWER_') === 0) return 'VIEWER_MAPPINGS';
  if (key.indexOf('VAA_TARGET_UPDATE_') === 0) return 'UPDATE_LEASES';
  if (
    key === 'ACCESS_KEY' ||
    key === 'SCHEMA_VERSION' ||
    key === 'APP_VERSION' ||
    key === 'VAA_APPLICATION_IDENTITY_HMAC_V1'
  ) return 'PROTECTED_CONFIG';
  if (key.indexOf('SYSTEM_') === 0) return 'SYSTEM_CONFIG';
  return 'OTHER_UNCLASSIFIED';
}

function vaaUtf8ByteLength_(text) {
  return Utilities.newBlob(String(text)).getBytes().length;
}

/**
 * Pure summarizer (except Utilities UTF-8 byte conversion); callable
 * with mocked Properties in regression tests. No side effects.
 */
function vaaScriptPropertyCapacitySummary_(properties, nowMs) {
  const capacityBytes = 500 * 1024;
  const perValueLimitBytes = 9 * 1024;
  const now = Number(nowMs) || Date.now();
  const dayMs = 86400000;
  const groupNames = [
    'REQUEST_RECORDS',
    'REPORT_REGISTRY',
    'VIEWER_MAPPINGS',
    'UPDATE_LEASES',
    'PROTECTED_CONFIG',
    'SYSTEM_CONFIG',
    'OTHER_UNCLASSIFIED'
  ];
  const categories = {};
  groupNames.forEach(function(name) {
    categories[name] = {
      category: name,
      count: 0,
      keyBytes: 0,
      valueBytes: 0,
      estimatedTotalBytes: 0,
      largestValueBytes: 0,
      overSingleValueLimit: 0
    };
  });

  const requests = {
    ready: 0,
    error: 0,
    inProgressOrOther: 0,
    malformed: 0,
    olderThan30Days: 0,
    olderThan90Days: 0,
    missingCreatedAt: 0,
    activeLease: 0,
    completedOrErrorOlderThan30DaysNoActiveLease: 0
  };

  // All values stay local to this function; never attach them to results.
  Object.entries(properties || {}).forEach(function(entry) {
    const key = String(entry[0]);
    const value = String(entry[1] == null ? '' : entry[1]);
    const category = vaaScriptPropertyCategory_(key);
    const group = categories[category];
    const keyBytes = vaaUtf8ByteLength_(key);
    const valueBytes = vaaUtf8ByteLength_(value);

    group.count++;
    group.keyBytes += keyBytes;
    group.valueBytes += valueBytes;
    group.estimatedTotalBytes += keyBytes + valueBytes;
    group.largestValueBytes = Math.max(group.largestValueBytes, valueBytes);
    if (valueBytes > perValueLimitBytes) group.overSingleValueLimit++;

    if (category !== 'REQUEST_RECORDS') return;

    let parsed;
    try {
      parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        requests.malformed++;
        return;
      }
    } catch (_) {
      requests.malformed++;
      return;
    }

    const status = String(parsed.status || '').toUpperCase();
    if (status === 'READY') requests.ready++;
    else if (status === 'ERROR') requests.error++;
    else requests.inProgressOrOther++;

    const dateMs = Date.parse(String(parsed.createdAt || ''));
    const ageDays = Number.isFinite(dateMs) && dateMs <= now
      ? (now - dateMs) / dayMs
      : null;
    if (ageDays === null) requests.missingCreatedAt++;
    if (ageDays !== null && ageDays >= 30) requests.olderThan30Days++;
    if (ageDays !== null && ageDays >= 90) requests.olderThan90Days++;

    const leaseMs = Date.parse(String(parsed.leaseUntil || ''));
    const leaseActive = Number.isFinite(leaseMs) && leaseMs > now;
    if (leaseActive) requests.activeLease++;

    // Count only as a POSSIBLE future cleanup candidate, NOT a deletion
    // authorization. An operator must first check request/Registry state.
    if (
      ageDays !== null && ageDays >= 30 &&
      !leaseActive &&
      (status === 'READY' || status === 'ERROR')
    ) {
      requests.completedOrErrorOlderThan30DaysNoActiveLease++;
    }
  });

  const groups = groupNames.map(function(name) {
    return categories[name];
  });
  const propertyCount = groups.reduce(function(sum, group) {
    return sum + group.count;
  }, 0);
  const estimatedTotalBytes = groups.reduce(function(sum, group) {
    return sum + group.estimatedTotalBytes;
  }, 0);
  const maxValueBytes = groups.reduce(function(max, group) {
    return Math.max(max, group.largestValueBytes);
  }, 0);

  return {
    audit: 'SCRIPT_PROPERTY_CAPACITY_READ_ONLY',
    strictReadOnly: true,
    includesPropertyKeys: false,
    includesPropertyValues: false,
    measuredAt: new Date(now).toISOString(),
    quotaLimitBytes: capacityBytes,
    quotaPerValueLimitBytes: perValueLimitBytes,
    byteCountMethod: 'UTF8_KEY_PLUS_VALUE_ESTIMATE',
    propertyCount: propertyCount,
    estimatedTotalBytes: estimatedTotalBytes,
    estimatedValueBytes: groups.reduce(function(sum, group) {
      return sum + group.valueBytes;
    }, 0),
    estimatedUsagePercent: Math.round(1000 * estimatedTotalBytes / capacityBytes) / 10,
    largestValueBytes: maxValueBytes,
    groups: groups,
    requestLifecycle: requests,
    note: 'READ_ONLY. The byte estimate does not establish deletion safety.'
  };
}


/**
 * Phase 2: preview only. Determine how much space can be recovered by
 * retiring verified OLD / READY request receipts. No deletes, no writes,
 * no backup creation, no Drive or external calls.
 *
 * A deletion of a READY receipt changes requestId replay/idempotency.
 * Future cleanup MUST be independently authorized, backed up and locked;
 * this preview is NOT permission to remove anything.
 */
function vaaOldReadyRequestCleanupPreview_(snapshot, nowMs) {
  const now = Number(nowMs) || Date.now();
  const minAgeDays = 30;
  const targetPercent = 75;
  const maxBytes = 500 * 1024;
  const targetBytes = Math.floor(maxBytes * targetPercent / 100);
  const total = vaaScriptPropertyCapacitySummary_(snapshot, now);
  const eligible = [];
  const excluded = {
    notReady: 0,
    statusOrStageMismatch: 0,
    tooRecent: 0,
    unknownDate: 0,
    activeOrUnverifiableLease: 0,
    missingOrMismatchedRequestId: 0,
    missingTarget: 0,
    unknownOperationMode: 0,
    malformed: 0
  };
  const modes = {
    CREATE: { count: 0, estimatedBytes: 0 },
    UPDATE: { count: 0, estimatedBytes: 0 }
  };
  const prefix = API_CONFIG.REQUEST_PROPERTY_PREFIX;
  Object.entries(snapshot || {}).forEach(function(entry) {
    const key = String(entry[0]);
    if (key.indexOf(prefix) !== 0) return;
    const raw = String(entry[1] == null ? '' : entry[1]);
    let record;
    try {
      record = JSON.parse(raw);
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        excluded.malformed++;
        return;
      }
    } catch (_) {
      excluded.malformed++;
      return;
    }
    const status = String(record.status || '').toUpperCase();
    const stage = String(record.stage || '').toUpperCase();
    if (status === 'ERROR' || status === 'PROCESSING' || status === 'CREATED') {
      excluded.notReady++;
      return;
    }
    if (status !== 'READY' || stage !== 'READY') {
      excluded.statusOrStageMismatch++;
      return;
    }
    const createdAt = Date.parse(String(record.createdAt || ''));
    if (!Number.isFinite(createdAt) || createdAt > now) {
      excluded.unknownDate++;
      return;
    }
    if (now - createdAt < minAgeDays * 86400000) {
      excluded.tooRecent++;
      return;
    }
    const leaseString = String(record.leaseUntil || '');
    const leaseUntil = leaseString ? Date.parse(leaseString) : 0;
    if (leaseString && (!Number.isFinite(leaseUntil) || leaseUntil > now)) {
      excluded.activeOrUnverifiableLease++;
      return;
    }
    const requestId = key.slice(prefix.length);
    if (!requestId || requestId !== String(record.requestId || '')) {
      excluded.missingOrMismatchedRequestId++;
      return;
    }
    if (!String(record.spreadsheetId || '').trim()) {
      excluded.missingTarget++;
      return;
    }
    const mode = String(record.operationMode || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(modes, mode)) {
      excluded.unknownOperationMode++;
      return;
    }
    const estimatedBytes = vaaUtf8ByteLength_(key) +
      vaaUtf8ByteLength_(raw);
    eligible.push({ createdAt: createdAt, estimatedBytes: estimatedBytes, mode: mode });
    modes[mode].count++;
    modes[mode].estimatedBytes += estimatedBytes;
  });
  // Deterministic oldest-first plan. Only aggregate statistics leave this
  // function; keys and raw values are not included in the result.
  eligible.sort(function(a, b) {
    return a.createdAt - b.createdAt ||
      a.estimatedBytes - b.estimatedBytes;
  });
  let remainingBytes = total.estimatedTotalBytes;
  let selectedCount = 0;
  let selectedBytes = 0;
  const selectedModes = {
    CREATE: { count: 0, estimatedBytes: 0 },
    UPDATE: { count: 0, estimatedBytes: 0 }
  };
  eligible.forEach(function(item) {
    if (remainingBytes <= targetBytes) return;
    selectedCount++;
    selectedBytes += item.estimatedBytes;
    remainingBytes -= item.estimatedBytes;
    selectedModes[item.mode].count++;
    selectedModes[item.mode].estimatedBytes += item.estimatedBytes;
  });
  return {
    plan: 'OLD_READY_REQUEST_HISTORY_READ_ONLY_PREVIEW',
    strictReadOnly: true,
    includesPropertyKeys: false,
    includesPropertyValues: false,
    cleanupExecuted: false,
    minimumAgeDays: minAgeDays,
    quotaBytes: maxBytes,
    targetUsagePercent: targetPercent,
    targetBytes: targetBytes,
    currentEstimatedBytes: total.estimatedTotalBytes,
    eligibleCount: eligible.length,
    eligibleEstimatedBytes: eligible.reduce(function(n, x) {
      return n + x.estimatedBytes;
    }, 0),
    eligibleByMode: modes,
    exclusionCounts: excluded,
    proposedCount: selectedCount,
    proposedEstimatedFreedBytes: selectedBytes,
    proposedByMode: selectedModes,
    projectedEstimatedBytes: remainingBytes,
    projectedUsagePercent: Math.round(remainingBytes / maxBytes * 1000) / 10,
    canReachTargetWithOldReadyOnly: remainingBytes <= targetBytes,
    caveat: 'PREVIEW ONLY. No deletion authorization, backup or requestId replay guarantee.'
  };
}

function vaaPreviewOldReadyRequestCleanupReadOnly() {
  const snapshot = PropertiesService.getScriptProperties().getProperties();
  const preview = vaaOldReadyRequestCleanupPreview_(snapshot, Date.now());
  console.log('VAA_REQUEST_CLEANUP_PREFLIGHT_READONLY ' + JSON.stringify(preview));
  return preview;
}

/**
 * Alternative to deleting old READY request receipts:
 * preview shrinking ONLY the optional performance timing diagnostics.
 *
 * Keep requestId, operationMode, status/stage, spreadsheetId/URL,
 * updateStrategy/updatePayloadDigest, viewer URLs, updateStats and all
 * other fields unchanged. The original request receipt stays in place,
 * keeping the replay and target-mismatch checks available.
 *
 * READ ONLY: this function never calls setProperty or deleteProperty.
 */
function vaaReadyRequestPerformancePreview_(snapshot, nowMs) {
  const now = Number(nowMs) || Date.now();
  const minimumAgeDays = 30;
  const quotaBytes = 500 * 1024;
  const targetBytes = Math.floor(quotaBytes * 0.75);
  const current = vaaScriptPropertyCapacitySummary_(snapshot, now);
  const prefix = API_CONFIG.REQUEST_PROPERTY_PREFIX;
  const eligible = [];
  const byMode = {
    CREATE: { count: 0, estimatedSavingsBytes: 0 },
    UPDATE: { count: 0, estimatedSavingsBytes: 0 }
  };
  const exclusions = {
    nonReady: 0,
    recent: 0,
    missingOrFutureDate: 0,
    activeOrInvalidLease: 0,
    invalidRequestId: 0,
    noSpreadsheetId: 0,
    unknownMode: 0,
    missingOrEmptyPerformance: 0,
    invalidJson: 0
  };

  Object.entries(snapshot || {}).forEach(function(entry) {
    const key = String(entry[0]);
    if (key.indexOf(prefix) !== 0) return;
    const raw = String(entry[1] == null ? '' : entry[1]);
    let record;
    try {
      record = JSON.parse(raw);
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        exclusions.invalidJson++;
        return;
      }
    } catch (_) {
      exclusions.invalidJson++;
      return;
    }

    if (record.status !== 'READY' || record.stage !== 'READY') {
      exclusions.nonReady++;
      return;
    }
    const createdAt = Date.parse(String(record.createdAt || ''));
    if (!Number.isFinite(createdAt) || createdAt > now) {
      exclusions.missingOrFutureDate++;
      return;
    }
    if (now - createdAt < minimumAgeDays * 86400000) {
      exclusions.recent++;
      return;
    }
    const leaseRaw = String(record.leaseUntil || '');
    const leaseMs = leaseRaw ? Date.parse(leaseRaw) : 0;
    if (leaseRaw && (!Number.isFinite(leaseMs) || leaseMs > now)) {
      exclusions.activeOrInvalidLease++;
      return;
    }
    if (!key.slice(prefix.length) ||
        key.slice(prefix.length) !== String(record.requestId || '')) {
      exclusions.invalidRequestId++;
      return;
    }
    if (!String(record.spreadsheetId || '').trim()) {
      exclusions.noSpreadsheetId++;
      return;
    }
    const mode = String(record.operationMode || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(byMode, mode)) {
      exclusions.unknownMode++;
      return;
    }
    if (!record.performance ||
        typeof record.performance !== 'object' ||
        Array.isArray(record.performance)) {
      exclusions.missingOrEmptyPerformance++;
      return;
    }

    // Construct a hypothetical smaller value in memory only.
    const hypothetical = Object.assign({}, record);
    delete hypothetical.performance;
    const saving = vaaUtf8ByteLength_(raw) -
      vaaUtf8ByteLength_(JSON.stringify(hypothetical));
    if (saving <= 0) {
      exclusions.missingOrEmptyPerformance++;
      return;
    }

    eligible.push({
      createdAt: createdAt,
      saving: saving,
      mode: mode
    });
    byMode[mode].count++;
    byMode[mode].estimatedSavingsBytes += saving;
  });

  eligible.sort(function(a, b) {
    return a.createdAt - b.createdAt || b.saving - a.saving;
  });

  let projectedBytes = current.estimatedTotalBytes;
  let proposedCount = 0;
  let proposedSavingsBytes = 0;
  const proposedByMode = {
    CREATE: { count: 0, estimatedSavingsBytes: 0 },
    UPDATE: { count: 0, estimatedSavingsBytes: 0 }
  };
  eligible.forEach(function(item) {
    if (projectedBytes <= targetBytes) return;
    projectedBytes -= item.saving;
    proposedCount++;
    proposedSavingsBytes += item.saving;
    proposedByMode[item.mode].count++;
    proposedByMode[item.mode].estimatedSavingsBytes += item.saving;
  });

  return {
    plan: 'READY_RECEIPT_PERFORMANCE_COMPACTION_READ_ONLY',
    strictReadOnly: true,
    propertiesModified: 0,
    propertiesDeleted: 0,
    includesPropertyKeys: false,
    includesPropertyValues: false,
    ageThresholdDays: minimumAgeDays,
    quotaBytes: quotaBytes,
    targetBytes: targetBytes,
    beforeEstimatedBytes: current.estimatedTotalBytes,
    eligibleCount: eligible.length,
    eligibleSavingsBytes: eligible.reduce(function(sum, item) {
      return sum + item.saving;
    }, 0),
    eligibleByMode: byMode,
    exclusionCounts: exclusions,
    proposedCount: proposedCount,
    proposedSavingsBytes: proposedSavingsBytes,
    proposedByMode: proposedByMode,
    projectedEstimatedBytes: projectedBytes,
    projectedUsagePercent: Math.round(projectedBytes / quotaBytes * 1000) / 10,
    canReachTargetWithPerformanceOnly: projectedBytes <= targetBytes,
    caveat: 'PREVIEW ONLY. Only optional performance is considered; no data has been modified.'
  };
}

function vaaPreviewReadyRequestPerformanceCompactionReadOnly() {
  const snapshot = PropertiesService.getScriptProperties().getProperties();
  const plan = vaaReadyRequestPerformancePreview_(snapshot, Date.now());
  console.log('VAA_PERFORMANCE_COMPACTION_PREFLIGHT_READONLY ' + JSON.stringify(plan));
  return plan;
}

/**
 * Editor-run entry point. Logs and returns only numeric/aggregated metadata.
 * No properties are written, removed or modified.
 */
function vaaAuditScriptPropertyCapacityReadOnly() {
  const props = PropertiesService.getScriptProperties();
  const snapshot = props.getProperties();
  const summary = vaaScriptPropertyCapacitySummary_(snapshot, Date.now());
  console.log('VAA_PROPERTY_CAPACITY_READONLY ' + JSON.stringify(summary));
  return summary;
}
