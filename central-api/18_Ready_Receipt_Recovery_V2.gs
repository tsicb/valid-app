/**
 * Manual-only READY performance compaction V2.
 * Independently staged from V1. The original V1 private backup is untouched.
 * Allows unrelated property changes between PREPARE and COMMIT ONLY if the
 * exact selected receipts are unchanged and fresh capacity projection passes.
 *
 * No property deletion, request-ID deletion, automatic retry, or rollback.
 * Three separate explicit editor actions; never called by doPost/doGet.
 */
const VAA_COMPACTION_V2_PLAN_KEY_ = 'VAA_READY_PERF_COMPACTION_PLAN_V2';
const VAA_COMPACTION_V2_APPROVAL_KEY_ = 'VAA_READY_PERF_COMPACTION_APPROVAL_V2';
const VAA_COMPACTION_V2_PREFIX_ = 'VAA_PRIVATE_REQ_PERFORMANCE_BACKUP_V2_';
const VAA_COMPACTION_V2_SCHEMA_ = 'VAA_READY_PERFORMANCE_BACKUP_V2';
const VAA_COMPACTION_V2_TARGET_BYTES_ = 384000;

function vaaRecoveryV2Pending_() {
  const userProps = PropertiesService.getUserProperties();
  const raw = userProps.getProperty(VAA_COMPACTION_V2_PLAN_KEY_);
  if (!raw) throw new Error('VAA_COMPACTION_V2_BACKUP_REQUIRED');
  let plan;
  try { plan = JSON.parse(raw); }
  catch (_) { throw new Error('VAA_COMPACTION_V2_PLAN_INVALID'); }
  if (!plan || plan.version !== 2 || !plan.fileId ||
      !plan.backupDigest || !plan.sourceSnapshotDigest ||
      !Number.isFinite(plan.preparedAt) ||
      !Number.isInteger(plan.count) || plan.count < 1 ||
      !Number.isFinite(plan.expectedSavingsBytes) ||
      plan.expectedSavingsBytes <= 0 ||
      Date.now() < plan.preparedAt ||
      Date.now() > plan.preparedAt + VAA_COMPACTION_PLAN_TTL_MS_) {
    throw new Error('VAA_COMPACTION_V2_PLAN_EXPIRED_OR_INVALID');
  }
  return { userProps: userProps, plan: plan };
}

function vaaRecoveryV2Backup_(plan) {
  let file;
  try { file = DriveApp.getFileById(plan.fileId); }
  catch (_) { throw new Error('VAA_COMPACTION_V2_BACKUP_NOT_FOUND'); }
  if (file.isTrashed() ||
      file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      file.getName().indexOf(VAA_COMPACTION_V2_PREFIX_) !== 0) {
    throw new Error('VAA_COMPACTION_V2_BACKUP_NOT_PRIVATE');
  }
  const text = file.getBlob().getDataAsString('UTF-8');
  if (vaaRecoveryDigest_(text) !== plan.backupDigest) {
    throw new Error('VAA_COMPACTION_V2_BACKUP_DIGEST_MISMATCH');
  }
  let backup;
  try { backup = JSON.parse(text); }
  catch (_) { throw new Error('VAA_COMPACTION_V2_BACKUP_INVALID'); }
  if (!backup || backup.schema !== VAA_COMPACTION_V2_SCHEMA_ ||
      backup.preparedAt !== plan.preparedAt ||
      backup.sourceSnapshotDigest !== plan.sourceSnapshotDigest ||
      !Array.isArray(backup.selected) ||
      backup.selected.length !== plan.count) {
    throw new Error('VAA_COMPACTION_V2_BACKUP_PLAN_MISMATCH');
  }
  return backup;
}

/** PREPARE: ScriptLock and private Drive backup only. No Script Property writes. */
function vaaPrepareReadyPerformanceCompactionV2Backup() {
  const userProps = PropertiesService.getUserProperties();
  const prior = userProps.getProperty(VAA_COMPACTION_V2_PLAN_KEY_);
  if (prior) {
    let old;
    try { old = JSON.parse(prior); } catch (_) {}
    if (old && Number(old.preparedAt) + VAA_COMPACTION_PLAN_TTL_MS_ > Date.now()) {
      throw new Error('VAA_COMPACTION_V2_PLAN_ALREADY_PREPARED');
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let response;
  try {
    const snapshot = PropertiesService.getScriptProperties().getProperties();
    const preparedAt = Date.now();
    const internal = vaaRecoveryBuildInternalPlan_(snapshot, preparedAt);
    const selected = internal.selected;
    const savings = internal.publicPlan.proposedSavingsBytes;
    if (selected.length < 1 ||
        internal.publicPlan.projectedEstimatedBytes > VAA_COMPACTION_V2_TARGET_BYTES_) {
      throw new Error('VAA_COMPACTION_V2_TARGET_UNREACHABLE');
    }
    const packageData = {
      schema: VAA_COMPACTION_V2_SCHEMA_,
      preparedAt: preparedAt,
      sourceSnapshotDigest: vaaRecoverySnapshotDigest_(snapshot),
      selected: selected.map(function(item) {
        return {
          key: item.key,
          original: item.original,
          compacted: item.compacted,
          savingsBytes: item.savingsBytes
        };
      })
    };
    const backupText = JSON.stringify(packageData);
    // Prove the new Drive file is private WHILE EMPTY.
    const filename = VAA_COMPACTION_V2_PREFIX_ +
      new Date(preparedAt).toISOString().replace(/[:.]/g, '-') + '.json';
    const file = DriveApp.createFile(filename, '', 'application/json');
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw new Error('VAA_COMPACTION_V2_BACKUP_NOT_PRIVATE');
    }
    file.setContent(backupText);
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
        vaaRecoveryDigest_(file.getBlob().getDataAsString('UTF-8')) !==
          vaaRecoveryDigest_(backupText)) {
      throw new Error('VAA_COMPACTION_V2_BACKUP_VERIFY_FAILED');
    }
    const plan = {
      version: 2,
      fileId: file.getId(),
      preparedAt: preparedAt,
      backupDigest: vaaRecoveryDigest_(backupText),
      sourceSnapshotDigest: packageData.sourceSnapshotDigest,
      count: selected.length,
      expectedSavingsBytes: savings,
      preparedEstimatedBytes: internal.publicPlan.beforeEstimatedBytes
    };
    userProps.setProperty(VAA_COMPACTION_V2_PLAN_KEY_, JSON.stringify(plan));
    userProps.deleteProperty(VAA_COMPACTION_V2_APPROVAL_KEY_);
    response = {
      phase: 'V2_PREPARED_PRIVATE_BACKUP',
      scriptPropertiesModified: 0,
      scriptPropertiesDeleted: 0,
      privateBackupCreated: true,
      approvalRequired: true,
      proposedCount: plan.count,
      proposedSavingsBytes: savings,
      estimatedBeforeBytes: plan.preparedEstimatedBytes,
      estimatedAfterBytes: internal.publicPlan.projectedEstimatedBytes,
      oldV1BackupUntouched: true,
      note: 'SEPARATE EXPLICIT V2 AUTHORIZATION AND COMMIT REQUIRED'
    };
  } catch (_) {
    // Never expose private Drive IDs, keys or original values in exceptions.
    throw new Error('VAA_COMPACTION_V2_BACKUP_PREPARATION_FAILED');
  } finally {
    lock.releaseLock();
  }
  console.log('VAA_COMPACTION_V2_BACKUP_PREPARED ' + JSON.stringify(response));
  return response;
}

/** AUTHORIZE: validate the private backup, then write User Properties only. */
function vaaAuthorizeReadyPerformanceCompactionV2() {
  const pending = vaaRecoveryV2Pending_();
  vaaRecoveryV2Backup_(pending.plan);
  pending.userProps.setProperty(
    VAA_COMPACTION_V2_APPROVAL_KEY_,
    vaaRecoveryDigest_(JSON.stringify(pending.plan))
  );
  const result = {
    phase: 'V2_APPROVED_NOT_COMMITTED',
    scriptPropertiesModified: 0,
    scriptPropertiesDeleted: 0,
    privateBackupVerified: true,
    proposedCount: pending.plan.count,
    nextStepRequiresSeparateExplicitCommit: true
  };
  console.log('VAA_COMPACTION_V2_APPROVED_NO_CHANGES ' + JSON.stringify(result));
  return result;
}

/** Diagnostic categories are constants; never print raw Google error messages. */
function vaaRecoveryV2ErrorCategory_(err) {
  const msg = String(err && err.message || '');
  if (/^VAA_COMPACTION_V2_[A-Z_]+$/.test(msg)) return msg;
  if (/quota|capacity|exceed|limit|保存容量|上限/i.test(msg)) {
    return 'CAPACITY_LIMIT_SUSPECTED';
  }
  return 'EXTERNAL_ERROR_REDACTED';
}

/**
 * COMMIT: exact target-value fence; unrelated changes are tolerated only
 * after live projected capacity is rechecked. Full final snapshot must equal
 * the locked baseline with ONLY selected performance objects removed.
 */
function vaaCommitReadyPerformanceCompactionV2() {
  const pending = vaaRecoveryV2Pending_();
  const approval = pending.userProps.getProperty(VAA_COMPACTION_V2_APPROVAL_KEY_);
  if (!approval || approval !==
      vaaRecoveryDigest_(JSON.stringify(pending.plan))) {
    throw new Error('VAA_COMPACTION_V2_EXPLICIT_APPROVAL_REQUIRED');
  }
  const backup = vaaRecoveryV2Backup_(pending.plan);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let verified = 0;
  let writeAttempts = 0;
  let writeAccepted = 0;
  let stage = 'CHECK_BASELINE';
  let result;
  try {
    const props = PropertiesService.getScriptProperties();
    const baseline = props.getProperties();
    const capacity = vaaScriptPropertyCapacitySummary_(baseline, Date.now());
    const driftDetected = vaaRecoverySnapshotDigest_(baseline) !==
      pending.plan.sourceSnapshotDigest;
    const expected = Object.assign({}, baseline);
    let totalSavings = 0;
    const seen = {};
    const now = Date.now();
    stage = 'VERIFY_TARGETS';

    backup.selected.forEach(function(item) {
      if (!item || typeof item.key !== 'string' ||
          typeof item.original !== 'string' ||
          typeof item.compacted !== 'string' ||
          !Number.isFinite(item.savingsBytes) ||
          Object.prototype.hasOwnProperty.call(seen, item.key) ||
          !Object.prototype.hasOwnProperty.call(baseline, item.key) ||
          baseline[item.key] !== item.original) {
        throw new Error('VAA_COMPACTION_V2_TARGET_CHANGED');
      }
      seen[item.key] = true;
      let record;
      try { record = JSON.parse(item.original); }
      catch (_) { throw new Error('VAA_COMPACTION_V2_TARGET_INVALID'); }
      if (!record || typeof record !== 'object' ||
          Array.isArray(record) ||
          !vaaRecoveryIsOldReady_(item.key, record, now) ||
          !record.performance || typeof record.performance !== 'object' ||
          Array.isArray(record.performance)) {
        throw new Error('VAA_COMPACTION_V2_TARGET_NOT_ELIGIBLE');
      }
      const compact = Object.assign({}, record);
      delete compact.performance;
      const regenerated = JSON.stringify(compact);
      const computedSaving = vaaUtf8ByteLength_(item.original) -
        vaaUtf8ByteLength_(regenerated);
      if (regenerated !== item.compacted || computedSaving <= 0 ||
          computedSaving !== item.savingsBytes) {
        throw new Error('VAA_COMPACTION_V2_COMPACTION_MISMATCH');
      }
      totalSavings += computedSaving;
      expected[item.key] = item.compacted;
    });

    if (totalSavings !== pending.plan.expectedSavingsBytes) {
      throw new Error('VAA_COMPACTION_V2_SAVINGS_MISMATCH');
    }
    const projectedBytes = capacity.estimatedTotalBytes - totalSavings;
    stage = 'VERIFY_CAPACITY';
    if (projectedBytes > VAA_COMPACTION_V2_TARGET_BYTES_ ||
        capacity.estimatedTotalBytes <= VAA_COMPACTION_V2_TARGET_BYTES_) {
      throw new Error('VAA_COMPACTION_V2_CAPACITY_REPLAN_REQUIRED');
    }

    // Catch a concurrent non-cooperating update immediately before writes.
    stage = 'VERIFY_PREWRITE_SNAPSHOT';
    if (vaaRecoverySnapshotDigest_(props.getProperties()) !==
        vaaRecoverySnapshotDigest_(baseline)) {
      throw new Error('VAA_COMPACTION_V2_CONCURRENT_CHANGE');
    }
    const expectedFinalDigest = vaaRecoverySnapshotDigest_(expected);

    for (let i = 0; i < backup.selected.length; i++) {
      const item = backup.selected[i];
      stage = 'VERIFY_EACH_TARGET';
      if (props.getProperty(item.key) !== item.original) {
        throw new Error('VAA_COMPACTION_V2_TARGET_CHANGED');
      }
      stage = 'SET_PROPERTY';
      writeAttempts++;
      props.setProperty(item.key, item.compacted);
      writeAccepted++;
      stage = 'READ_BACK';
      if (props.getProperty(item.key) !== item.compacted) {
        throw new Error('VAA_COMPACTION_V2_READBACK_MISMATCH');
      }
      verified++;
    }

    stage = 'VERIFY_FINAL_SNAPSHOT';
    const finalSnapshot = props.getProperties();
    const after = vaaScriptPropertyCapacitySummary_(finalSnapshot, Date.now());
    if (vaaRecoverySnapshotDigest_(finalSnapshot) !== expectedFinalDigest ||
        after.propertyCount !== capacity.propertyCount ||
        after.estimatedTotalBytes !== projectedBytes ||
        after.estimatedTotalBytes > VAA_COMPACTION_V2_TARGET_BYTES_) {
      throw new Error('VAA_COMPACTION_V2_FINAL_MISMATCH');
    }
    result = {
      phase: 'V2_COMMITTED_VERIFIED',
      scriptPropertiesModified: verified,
      scriptPropertiesDeleted: 0,
      estimatedBeforeBytes: capacity.estimatedTotalBytes,
      estimatedAfterBytes: after.estimatedTotalBytes,
      estimatedUsagePercent: after.estimatedUsagePercent,
      nonTargetDriftSinceBackup: driftDetected,
      privateBackupRetained: true,
      oldV1BackupUntouched: true
    };
  } catch (err) {
    console.error('VAA_COMPACTION_V2_HALTED ' + JSON.stringify({
      phase: 'V2_STOPPED',
      failureStage: stage,
      failureCategory: vaaRecoveryV2ErrorCategory_(err),
      writeAttempts: writeAttempts,
      writeAccepted: writeAccepted,
      verifiedCount: verified,
      scriptPropertiesDeleted: 0,
      privateBackupRetained: true,
      doNotRetry: true
    }));
    throw new Error('VAA_COMPACTION_V2_STOPPED_CHECK_SAFE_LOG_NO_RETRY');
  } finally {
    lock.releaseLock();
  }

  // Only after complete verification. Old V1 plan and backup remain untouched.
  pending.userProps.deleteProperty(VAA_COMPACTION_V2_APPROVAL_KEY_);
  pending.userProps.deleteProperty(VAA_COMPACTION_V2_PLAN_KEY_);
  console.log('VAA_COMPACTION_V2_COMMITTED ' + JSON.stringify(result));
  return result;
}
