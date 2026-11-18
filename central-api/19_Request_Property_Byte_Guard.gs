/**
 * Non-destructive request-receipt capacity safeguards (review-only until
 * explicitly deployed). No cleanup of historic REQ_ receipts, VIEWER_,
 * RPTREG_, protected configuration or identity data is performed.
 *
 * All detailed performance timing remains in the in-memory request record
 * for the immediate API response. Replayed READY responses may have
 * performance: {} (as already supported for compacted historic receipts).
 */
const VAA_REQUEST_PROPERTY_QUOTA_BYTES_ = 500 * 1024;
const VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_ = 9 * 1024;
const VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_ =
  Math.floor(VAA_REQUEST_PROPERTY_QUOTA_BYTES_ * 0.90);
const VAA_REQUEST_START_RESERVE_BYTES_ = 24 * 1024;

function vaaSerializeRequestReceiptForStorage_(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('VAA_RECEIPT_RECORD_INVALID');
  }
  const stored = Object.assign({}, record);
  // Performance is optional diagnostic data, never a replay safety field.
  // Do not mutate the live record: the immediate API response needs timings.
  delete stored.performance;
  return JSON.stringify(stored);
}

/**
 * A lightweight estimate for the hot write path. Avoid parsing the
 * existing request JSON and constructing full lifecycle diagnostics on
 * every state transition. Same UTF-8 key+value estimate as the audit.
 */
function vaaRequestPropertyTotalEstimatedBytes_(snapshot) {
  return Object.keys(snapshot || {}).reduce(function(sum, key) {
    const value = snapshot[key] == null ? '' : String(snapshot[key]);
    return sum + vaaUtf8ByteLength_(key) + vaaUtf8ByteLength_(value);
  }, 0);
}

/**
 * Byte estimate assumes the same UTF-8 key+value convention as the
 * incident post-audit. Do not count an overwriting key twice.
 * Pure calculations; no keys, values or IDs in the returned object.
 */
function vaaRequestPropertyWriteProjection_(snapshot, key, nextValue) {
  const current = vaaRequestPropertyTotalEstimatedBytes_(snapshot);
  const hasCurrent = Object.prototype.hasOwnProperty.call(snapshot, key);
  const oldEntryBytes = hasCurrent
    ? vaaUtf8ByteLength_(key) + vaaUtf8ByteLength_(String(snapshot[key]))
    : 0;
  const nextValueBytes = vaaUtf8ByteLength_(nextValue);
  const nextEntryBytes = vaaUtf8ByteLength_(key) + nextValueBytes;
  return {
    propertyExists: hasCurrent,
    currentEstimatedBytes: current,
    projectedEstimatedBytes: current - oldEntryBytes + nextEntryBytes,
    valueBytes: nextValueBytes
  };
}

/**
 * Fresh request admission is intentionally BEFORE any workbook creation,
 * target lease acquisition or request-receipt write. Leave a 24-KiB margin
 * inside the 90% store budget for subsequent updates/viewer/registry writes.
 *
 * This is a guard, not an automatic garbage collector or clean-up approval.
 */
function vaaCheckNewRequestCapacityReadOnly_(props) {
  const snapshot = props.getProperties();
  const current = vaaRequestPropertyTotalEstimatedBytes_(snapshot);
  return {
    allowed: current + VAA_REQUEST_START_RESERVE_BYTES_ <=
      VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_,
    estimatedCurrentBytes: current,
    admissionCeilingBytes: VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_,
    reservedBytes: VAA_REQUEST_START_RESERVE_BYTES_
  };
}

/**
 * Existing requestIds may be finalized within the hard quota even after
 * the new-request ceiling is hit; this avoids stranding an in-progress
 * CREATE/UPDATE merely because the conservative 90% threshold was crossed.
 */
function vaaCheckRequestReceiptWriteReadOnly_(props, requestId, storedText) {
  const key = API_CONFIG.REQUEST_PROPERTY_PREFIX + requestId;
  const projection = vaaRequestPropertyWriteProjection_(
    props.getProperties(), key, storedText
  );
  const ceiling = projection.propertyExists
    ? VAA_REQUEST_PROPERTY_QUOTA_BYTES_
    : VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_;
  return {
    allowed:
      projection.valueBytes <= VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_ &&
      projection.projectedEstimatedBytes <= ceiling,
    valueTooLarge:
      projection.valueBytes > VAA_REQUEST_PROPERTY_VALUE_LIMIT_BYTES_,
    propertyExists: projection.propertyExists,
    projectedEstimatedBytes: projection.projectedEstimatedBytes,
    ceilingBytes: ceiling
  };
}

function vaaRequestCapacityError_(code) {
  const e = new Error(
    code === 'PROPERTY_VALUE_TOO_LARGE'
      ? '保存情報が単一プロパティの容量上限を超えました。管理者へご連絡ください。'
      : '保存履歴の容量が安全上限に近づいています。管理者へご連絡ください。'
  );
  e.code = code;
  return e;
}
