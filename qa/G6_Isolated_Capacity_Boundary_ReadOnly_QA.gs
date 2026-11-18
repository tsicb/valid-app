/**
 * G6-A: TEST-only, strictly READ_ONLY capacity-boundary QA.
 * Copy to a NEW file in the isolated TEST GAS only. Requires:
 * - G4_Isolated_Create_Replay_QA.gs
 * - central-api/15_Property_Capacity_Diagnostics.gs
 * - central-api/19_Request_Property_Byte_Guard.gs
 *
 * This exercises the canonical production guard functions with entirely
 * synthetic in-memory property snapshots. It NEVER fills real Properties,
 * calls doPost or creates files.
 */
function vaaQaG6SyntheticSnapshotAtBytes_(desiredBytes) {
  if (!Number.isSafeInteger(desiredBytes) ||
      desiredBytes < 0 || desiredBytes > 512000) {
    throw new Error('QA_G6_SYNTHETIC_BUDGET_INVALID');
  }
  const snapshot = {};
  let remaining = desiredBytes;
  let seq = 0;
  let lastKey = '';
  while (remaining > 0) {
    const key = 'QA_G6_FAKE_PROPERTY_' +
      String(seq++).padStart(4, '0');
    const keyBytes = vaaUtf8ByteLength_(key);
    if (remaining < keyBytes) {
      if (!lastKey || snapshot[lastKey].length + remaining > 9000) {
        throw new Error('QA_G6_SYNTHETIC_PADDING_FAILURE');
      }
      snapshot[lastKey] += 'x'.repeat(remaining);
      remaining = 0;
      break;
    }
    const valueBytes = Math.min(8000, remaining - keyBytes);
    snapshot[key] = 'x'.repeat(valueBytes);
    lastKey = key;
    remaining -= keyBytes + valueBytes;
  }
  if (vaaRequestPropertyTotalEstimatedBytes_(snapshot) !== desiredBytes) {
    throw new Error('QA_G6_SYNTHETIC_LENGTH_MISMATCH');
  }
  return snapshot;
}

function vaaQaG6FakeProps_(snapshot) {
  return {
    getProperties: function() { return snapshot; }
  };
}

/** One TEST-only editor function; absolutely no writes or deletions. */
function vaaQaG6CapacityBoundaryReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const originalSnapshot = props.getProperties();
  const audit = vaaScriptPropertyCapacitySummary_(
    originalSnapshot, Date.now()
  );
  // Historical TEST receipts are kept intact. Do not compact or delete.
  const groups = {};
  audit.groups.forEach(function(group) {
    groups[group.category] = group.count;
  });
  const actualStatePass =
    audit.strictReadOnly === true &&
    audit.requestLifecycle.ready === 3 &&
    audit.requestLifecycle.error === 0 &&
    audit.requestLifecycle.malformed === 0 &&
    audit.requestLifecycle.activeLease === 0 &&
    groups.REQUEST_RECORDS === 3 &&
    groups.REPORT_REGISTRY === 1 &&
    groups.VIEWER_MAPPINGS === 1 &&
    groups.UPDATE_LEASES === 0 &&
    audit.largestValueBytes <= VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_ &&
    audit.estimatedTotalBytes < VAA_REQUEST_PROPERTY_QUOTA_BYTES_;

  const admissionCeiling =
    VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_ -
    VAA_REQUEST_START_RESERVE_BYTES_;
  const admissionAt = vaaCheckNewRequestCapacityReadOnly_(
    vaaQaG6FakeProps_(
      vaaQaG6SyntheticSnapshotAtBytes_(admissionCeiling)
    )
  );
  const admissionAbove = vaaCheckNewRequestCapacityReadOnly_(
    vaaQaG6FakeProps_(
      vaaQaG6SyntheticSnapshotAtBytes_(admissionCeiling + 1)
    )
  );

  const newRequestId = 'QA_G6_NEW_SYNTHETIC';
  const newReceiptKey = API_CONFIG.REQUEST_PROPERTY_PREFIX + newRequestId;
  const newValue = 'X'.repeat(256);
  const newValueBytes = vaaUtf8ByteLength_(newValue);
  const newKeyBytes = vaaUtf8ByteLength_(newReceiptKey);
  const atNewThreshold = vaaQaG6SyntheticSnapshotAtBytes_(
    VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_ -
    newKeyBytes - newValueBytes
  );
  const aboveNewThreshold = vaaQaG6SyntheticSnapshotAtBytes_(
    VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_ -
    newKeyBytes - newValueBytes + 1
  );
  const newAt = vaaCheckRequestReceiptWriteReadOnly_(
    vaaQaG6FakeProps_(atNewThreshold), newRequestId, newValue
  );
  const newAbove = vaaCheckRequestReceiptWriteReadOnly_(
    vaaQaG6FakeProps_(aboveNewThreshold), newRequestId, newValue
  );

  // Existing key can be overwritten up to the full 500-KiB quota, unlike
  // new requests that use the conservative 90% write ceiling.
  const existingRequestId = 'QA_G6_EXISTING_SYNTHETIC';
  const existingKey = API_CONFIG.REQUEST_PROPERTY_PREFIX + existingRequestId;
  const existingValue = 'A'.repeat(256);
  const replacementValue = 'B'.repeat(256);
  const existingKeyBytes = vaaUtf8ByteLength_(existingKey);
  const oldValueBytes = vaaUtf8ByteLength_(existingValue);
  const baseAtFullQuota = vaaQaG6SyntheticSnapshotAtBytes_(
    VAA_REQUEST_PROPERTY_QUOTA_BYTES_ - existingKeyBytes - oldValueBytes
  );
  baseAtFullQuota[existingKey] = existingValue;
  const existingAt = vaaCheckRequestReceiptWriteReadOnly_(
    vaaQaG6FakeProps_(baseAtFullQuota),
    existingRequestId, replacementValue
  );
  const existingOver = vaaCheckRequestReceiptWriteReadOnly_(
    vaaQaG6FakeProps_(baseAtFullQuota),
    existingRequestId, replacementValue + 'B'
  );
  const emptySyntheticProps = vaaQaG6FakeProps_({});
  const valueAt = vaaCheckRequestReceiptWriteReadOnly_(
    emptySyntheticProps, newRequestId,
    'Y'.repeat(VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_)
  );
  const valueOver = vaaCheckRequestReceiptWriteReadOnly_(
    emptySyntheticProps, newRequestId,
    'Y'.repeat(VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_ + 1)
  );

  const syntheticReceipt = {
    requestId: 'QA_FAKE_ONLY',
    status: 'READY',
    stage: 'READY',
    spreadsheetId: 'QA_FAKE_SHEET',
    updatePayloadDigest: 'QA_FAKE_DIGEST',
    performance: {diagnosticMs: 1234}
  };
  const serial = JSON.parse(
    vaaSerializeRequestReceiptForStorage_(syntheticReceipt)
  );
  const receiptPerformanceRemoved =
    !Object.prototype.hasOwnProperty.call(serial, 'performance') &&
    !!syntheticReceipt.performance;
  const receiptEssentialFieldsRetained =
    serial.requestId === syntheticReceipt.requestId &&
    serial.status === 'READY' &&
    serial.stage === 'READY' &&
    serial.spreadsheetId === syntheticReceipt.spreadsheetId &&
    serial.updatePayloadDigest === syntheticReceipt.updatePayloadDigest;

  const result = {
    phase: 'G6_CAPACITY_BOUNDARY_READ_ONLY',
    strictReadOnly: true,
    testEnvironmentMatched: true,
    actualReadyReceipts: audit.requestLifecycle.ready,
    actualMalformedReceipts: audit.requestLifecycle.malformed,
    actualActiveLeases: audit.requestLifecycle.activeLease,
    actualEstimatedBytes: audit.estimatedTotalBytes,
    actualProtectedRecordsPreserved: true,
    actualStatePass: actualStatePass,
    quotaBytes: VAA_REQUEST_PROPERTY_QUOTA_BYTES_,
    perValueLimitBytes: VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_,
    newRequestWriteCeilingBytes: VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_,
    newRequestAdmissionLimitBytes: admissionCeiling,
    syntheticAdmissionAtBoundaryAllowed: admissionAt.allowed === true,
    syntheticAdmissionAboveBoundaryRejected: admissionAbove.allowed === false,
    syntheticNewReceiptAtCeilingAllowed: newAt.allowed === true,
    syntheticNewReceiptAboveCeilingRejected: newAbove.allowed === false,
    syntheticExistingReceiptAtQuotaAllowed: existingAt.allowed === true,
    syntheticExistingReceiptAboveQuotaRejected: existingOver.allowed === false,
    syntheticSingleValueAtLimitAllowed: valueAt.allowed === true,
    syntheticSingleValueAboveLimitRejected:
      valueOver.allowed === false && valueOver.valueTooLarge === true,
    receiptPerformanceRemoved: receiptPerformanceRemoved,
    receiptEssentialFieldsRetained: receiptEssentialFieldsRetained,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false,
    syntheticSnapshotsOnly: true
  };
  result.pass = !!(
    actualStatePass &&
    result.syntheticAdmissionAtBoundaryAllowed &&
    result.syntheticAdmissionAboveBoundaryRejected &&
    result.syntheticNewReceiptAtCeilingAllowed &&
    result.syntheticNewReceiptAboveCeilingRejected &&
    result.syntheticExistingReceiptAtQuotaAllowed &&
    result.syntheticExistingReceiptAboveQuotaRejected &&
    result.syntheticSingleValueAtLimitAllowed &&
    result.syntheticSingleValueAboveLimitRejected &&
    result.receiptPerformanceRemoved &&
    result.receiptEssentialFieldsRetained
  );
  // Never print property names, values, access keys, spreadsheet IDs, raw
  // receipts, or fake credential payloads.
  console.log('VAA_QA_G6_CAPACITY_BOUNDARY ' + JSON.stringify(result));
  return result;
}
