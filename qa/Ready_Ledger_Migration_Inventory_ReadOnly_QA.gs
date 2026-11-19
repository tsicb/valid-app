/**
 * READY request history migration: PROPERTY-ONLY READ-ONLY inventory.
 *
 * Manual editor-only QA for isolated TEST first. No doPost integration,
 * migration, ledger read/write, Drive/Sheets access, backup, replay switch,
 * cleanup or property mutation. Safe to install as a separate .gs file.
 *
 * Requires central-api/15_Property_Capacity_Diagnostics.gs and
 * central-api/20_Request_Ready_Ledger_Foundation.gs.
 * The result contains aggregate counts/byte estimates ONLY. A candidate
 * is NOT verified for archival or deletion until later independent checks.
 */

function vaaQaReadyMigrationSameSnapshot_(a, b) {
  const ak = Object.keys(a || {}).sort();
  const bk = Object.keys(b || {}).sort();
  return ak.length === bk.length && ak.every(function(key, i) {
    return key === bk[i] && a[key] === b[key];
  });
}

function vaaQaReadyMigrationInventorySummary_(snapshot, nowMs) {
  const data = snapshot || {};
  const now = Number(nowMs) || Date.now();
  const prefix = API_CONFIG.REQUEST_PROPERTY_PREFIX;
  const groups = {
    CREATE: {count: 0, estimatedPropertyBytes: 0},
    UPDATE: {count: 0, estimatedPropertyBytes: 0}
  };
  const exclusions = {
    malformedJson: 0,
    nonReady: 0,
    readyStageMismatch: 0,
    invalidRequestId: 0,
    journalTestNamespace: 0,
    invalidReadyReceipt: 0,
    activeOrInvalidReceiptLease: 0,
    updateTargetLeasePresent: 0
  };
  let requestCount = 0;
  let structurallyCopyableCount = 0;
  let candidatePropertyBytes = 0;
  let candidateCreatedAtUnknownOrFuture = 0;
  let candidateAtLeast30DaysOld = 0;

  Object.keys(data).forEach(function(key) {
    if (key.indexOf(prefix) !== 0) return;
    requestCount++;
    const raw = String(data[key] == null ? '' : data[key]);
    let record;
    try {
      record = JSON.parse(raw);
      if (!record || typeof record !== 'object' ||
          Array.isArray(record)) throw Error('INVALID');
    } catch (_) {
      exclusions.malformedJson++;
      return;
    }
    if (record.status !== 'READY') {
      exclusions.nonReady++;
      return;
    }
    if (record.stage !== 'READY') {
      exclusions.readyStageMismatch++;
      return;
    }
    const requestId = key.slice(prefix.length);
    if (!requestId || requestId.length > 120 ||
        requestId !== String(record.requestId || '') ||
        requestId !== requestId.trim()) {
      exclusions.invalidRequestId++;
      return;
    }
    // These test-only requests already belong to the V2 journal.
    // Do not include them in the legacy READY_ARCHIVE_V1 copy inventory.
    if (/^QA_JOURNAL_E2E_(CREATE|UPDATE)_/.test(requestId)) {
      exclusions.journalTestNamespace++;
      return;
    }
    try {
      // Use the EXACT validator from the existing V1 READY archive.
      vaaLedgerReadyValidateRaw_(requestId, raw);
    } catch (_) {
      exclusions.invalidReadyReceipt++;
      return;
    }
    const lease = String(record.leaseUntil || '');
    const expires = lease ? Date.parse(lease) : 0;
    if (lease && (!Number.isFinite(expires) || expires > now)) {
      exclusions.activeOrInvalidReceiptLease++;
      return;
    }
    if (record.operationMode === 'UPDATE' &&
        Object.prototype.hasOwnProperty.call(
          data, 'VAA_TARGET_UPDATE_' + record.targetSpreadsheetId
        )) {
      // Even an empty/expired target lease needs independent review.
      exclusions.updateTargetLeasePresent++;
      return;
    }

    const bytes = vaaUtf8ByteLength_(key) + vaaUtf8ByteLength_(raw);
    const group = groups[record.operationMode];
    group.count++;
    group.estimatedPropertyBytes += bytes;
    structurallyCopyableCount++;
    candidatePropertyBytes += bytes;

    const createdAt = Date.parse(String(record.createdAt || ''));
    if (!Number.isFinite(createdAt) || createdAt > now) {
      candidateCreatedAtUnknownOrFuture++;
    } else if (now - createdAt >= 30 * 86400000) {
      candidateAtLeast30DaysOld++;
    }
  });

  const exclusionCount = Object.keys(exclusions).reduce(function(sum, key) {
    return sum + exclusions[key];
  }, 0);
  const capacity = vaaScriptPropertyCapacitySummary_(data, now);
  return {
    phase: 'READY_LEDGER_MIGRATION_INVENTORY_READ_ONLY',
    strictReadOnly: true,
    includesPropertyKeys: false,
    includesPropertyValues: false,
    includesRequestIds: false,
    requestPropertyCount: requestCount,
    estimatedTotalPropertyBytes: capacity.estimatedTotalBytes,
    estimatedRequestPropertyBytes:
      capacity.groups.filter(function(group) {
        return group.category === 'REQUEST_RECORDS';
      })[0].estimatedTotalBytes,
    structurallyCopyableCount: structurallyCopyableCount,
    structurallyCopyableByMode: groups,
    structurallyCopyablePropertyBytes: candidatePropertyBytes,
    candidateCreatedAtUnknownOrFuture:
      candidateCreatedAtUnknownOrFuture,
    candidateAtLeast30DaysOld: candidateAtLeast30DaysOld,
    exclusionCounts: exclusions,
    exclusionCount: exclusionCount,
    countsReconciled:
      requestCount === structurallyCopyableCount + exclusionCount,
    ledgerReadOrWritten: false,
    driveTargetsChecked: false,
    archiveCoverageChecked: false,
    migrationAuthorized: false,
    deletionAuthorized: false,
    cleanupPerformed: false,
    // This is an upper bound on future savings, NOT a release forecast.
    candidateBytesAreUpperBoundOnly: true
  };
}

function vaaQaReadyMigrationInventoryReadOnly() {
  const props = PropertiesService.getScriptProperties();
  const before = props.getProperties();
  const result = vaaQaReadyMigrationInventorySummary_(
    before, Date.now()
  );
  const after = props.getProperties();
  result.snapshotReads = 2;
  result.sourceStableAcrossReads =
    vaaQaReadyMigrationSameSnapshot_(before, after);
  result.pass = result.countsReconciled &&
    result.sourceStableAcrossReads;
  console.log(
    'VAA_QA_READY_MIGRATION_INVENTORY ' + JSON.stringify(result)
  );
  return result;
}
