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
