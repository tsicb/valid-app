/**
 * Manual-only, two-stage recovery of old READY request performance diagnostics.
 *
 * NEVER deletes a Script Property or a requestId receipt. Stores a private
 * backup of exact original receipt values in the executing user's My Drive.
 * An operator must explicitly run PREPARE, then AUTHORIZE, then COMMIT
 * in the Apps Script editor. No web application / doPost entry point calls
 * these functions.
 *
 * Script Property mutation occurs ONLY inside vaaCommitReadyPerformanceCompaction,
 * after a private backup, explicit same-user approval, ScriptLock, full
 * snapshot integrity check, and exact candidate re-evaluation.
 *
 * A mid-operation failure is fail-closed: stop, keep backup, and do not
 * auto-retry. Re-running with a changed snapshot is refused.
 */
const VAA_COMPACTION_USER_PLAN_KEY_ = 'VAA_READY_PERF_COMPACTION_PLAN_V1';
const VAA_COMPACTION_USER_APPROVAL_KEY_ = 'VAA_READY_PERF_COMPACTION_APPROVAL_V1';
const VAA_COMPACTION_BACKUP_PREFIX_ = 'VAA_PRIVATE_REQ_PERFORMANCE_BACKUP_';
const VAA_COMPACTION_PLAN_TTL_MS_ = 2 * 60 * 60 * 1000;

/**
 * Compute a deterministic, private digest over the *entire* Script Properties
 * snapshot. The digest is never used as an authentication secret or exposed
 * to the user; it only detects changes between PREPARE and COMMIT.
 */
function vaaRecoveryDigest_(data) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(data),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b) {
    return ('0' + (b & 255).toString(16)).slice(-2);
  }).join('');
}

function vaaRecoverySnapshotDigest_(snapshot) {
  return vaaRecoveryDigest_(JSON.stringify(
    Object.keys(snapshot || {}).sort().map(function(key) {
      return [key, String(snapshot[key])];
    })
  ));
}

function vaaRecoveryIsOldReady_(key, record, nowMs) {
  const prefix = API_CONFIG.REQUEST_PROPERTY_PREFIX;
  if (key.indexOf(prefix) !== 0 ||
      record.status !== 'READY' ||
      record.stage !== 'READY') return false;
  const when = Date.parse(String(record.createdAt || ''));
  if (!Number.isFinite(when) || when > nowMs ||
      nowMs - when < 30 * 86400000) return false;
  const leaseText = String(record.leaseUntil || '');
  const leaseMs = leaseText ? Date.parse(leaseText) : 0;
  if (leaseText && (!Number.isFinite(leaseMs) || leaseMs > nowMs)) {
    return false;
  }
  const requestId = key.slice(prefix.length);
  if (!requestId || requestId !== String(record.requestId || '')) {
    return false;
  }
  if (!String(record.spreadsheetId || '').trim()) return false;
  const mode = String(record.operationMode || '').toUpperCase();
  return mode === 'CREATE' || mode === 'UPDATE';
}

function vaaRecoveryBuildInternalPlan_(snapshot, nowMs) {
  const publicPlan = vaaReadyRequestPerformancePreview_(snapshot, nowMs);
  if (!publicPlan.canReachTargetWithPerformanceOnly ||
      publicPlan.proposedCount < 1) {
    throw new Error('VAA_COMPACTION_CANNOT_REACH_SAFE_TARGET');
  }

  const candidates = [];
  const prefix = API_CONFIG.REQUEST_PROPERTY_PREFIX;
  Object.keys(snapshot || {}).forEach(function(key) {
    if (key.indexOf(prefix) !== 0) return;
    const original = String(snapshot[key]);
    let record;
    try { record = JSON.parse(original); } catch (_) { return; }
    if (!record || typeof record !== 'object' ||
        Array.isArray(record) || !vaaRecoveryIsOldReady_(key, record, nowMs)) {
      return;
    }
    if (!record.performance ||
        typeof record.performance !== 'object' ||
        Array.isArray(record.performance)) return;
    const compact = Object.assign({}, record);
    delete compact.performance;
    const compacted = JSON.stringify(compact);
    const saving = vaaUtf8ByteLength_(original) -
      vaaUtf8ByteLength_(compacted);
    if (saving <= 0) return;
    candidates.push({
      key: key,
      original: original,
      compacted: compacted,
      createdAt: Date.parse(String(record.createdAt)),
      mode: String(record.operationMode).toUpperCase(),
      savingsBytes: saving
    });
  });
  candidates.sort(function(a, b) {
    return a.createdAt - b.createdAt || b.savingsBytes - a.savingsBytes;
  });

  let projected = publicPlan.beforeEstimatedBytes;
  const selected = [];
  candidates.forEach(function(item) {
    if (projected <= publicPlan.targetBytes) return;
    projected -= item.savingsBytes;
    selected.push(item);
  });
  const proposedSavings = selected.reduce(function(sum, item) {
    return sum + item.savingsBytes;
  }, 0);
  if (
    candidates.length !== publicPlan.eligibleCount ||
    selected.length !== publicPlan.proposedCount ||
    proposedSavings !== publicPlan.proposedSavingsBytes ||
    projected !== publicPlan.projectedEstimatedBytes ||
    projected > publicPlan.targetBytes
  ) {
    throw new Error('VAA_COMPACTION_PLAN_MISMATCH');
  }
  return { publicPlan: publicPlan, selected: selected };
}

function vaaRecoveryReadPendingUserPlan_() {
  const userProps = PropertiesService.getUserProperties();
  const raw = userProps.getProperty(VAA_COMPACTION_USER_PLAN_KEY_);
  if (!raw) throw new Error('VAA_COMPACTION_BACKUP_REQUIRED');
  let plan;
  try { plan = JSON.parse(raw); }
  catch (_) { throw new Error('VAA_COMPACTION_PLAN_CORRUPT'); }
  if (!plan || plan.version !== 1 ||
      !plan.fileId || !plan.backupDigest || !plan.snapshotDigest ||
      !Number.isFinite(plan.preparedAt) ||
      Date.now() > plan.preparedAt + VAA_COMPACTION_PLAN_TTL_MS_ ||
      Date.now() < plan.preparedAt) {
    throw new Error('VAA_COMPACTION_PLAN_EXPIRED_OR_INVALID');
  }
  return {userProps: userProps, plan: plan};
}

function vaaRecoveryPrivateBackup_(fileId) {
  let file;
  try { file = DriveApp.getFileById(fileId); }
  catch (_) { throw new Error('VAA_COMPACTION_PRIVATE_BACKUP_NOT_FOUND'); }
  if (file.isTrashed() ||
      file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      file.getName().indexOf(VAA_COMPACTION_BACKUP_PREFIX_) !== 0) {
    throw new Error('VAA_COMPACTION_BACKUP_NOT_PRIVATE');
  }
  return file;
}

/**
 * STEP 1: Creates a private backup ONLY. Does not alter Script Properties.
 * Same executing account must run the later steps. Do not share backup URL.
 */
function vaaPrepareReadyPerformanceCompactionBackup() {
  const userProps = PropertiesService.getUserProperties();
  const existing = userProps.getProperty(VAA_COMPACTION_USER_PLAN_KEY_);
  if (existing) {
    try {
      const prior = JSON.parse(existing);
      if (prior && Number(prior.preparedAt) + VAA_COMPACTION_PLAN_TTL_MS_ >
          Date.now()) {
        throw new Error('VAA_COMPACTION_PLAN_ALREADY_PREPARED');
      }
    } catch (err) {
      if (String(err && err.message) === 'VAA_COMPACTION_PLAN_ALREADY_PREPARED') throw err;
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let backup;
  let response;
  try {
    const snapshot = PropertiesService.getScriptProperties().getProperties();
    const preparedAt = Date.now();
    const internal = vaaRecoveryBuildInternalPlan_(snapshot, preparedAt);
    const selected = internal.selected;
    const packageData = {
      schema: 'VAA_READY_PERFORMANCE_BACKUP_V1',
      preparedAt: preparedAt,
      snapshotDigest: vaaRecoverySnapshotDigest_(snapshot),
      expectedBeforeBytes: internal.publicPlan.beforeEstimatedBytes,
      expectedAfterBytes: internal.publicPlan.projectedEstimatedBytes,
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
    const name = VAA_COMPACTION_BACKUP_PREFIX_ +
      new Date(preparedAt).toISOString().replace(/[:.]/g,'-') + '.json';
    backup = DriveApp.createFile(
      Utilities.newBlob(backupText, 'application/json', name)
    );
    // A newly created My Drive file should be private by default.
    // Do not call setSharing(PRIVATE, NONE): Apps Script rejects NONE in
    // File.setSharing for non-ANYONE access types. Fail closed instead.
    if (backup.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw new Error('VAA_COMPACTION_BACKUP_NOT_PRIVATE');
    }
    const pending = {
      version: 1,
      fileId: backup.getId(),
      preparedAt: preparedAt,
      backupDigest: vaaRecoveryDigest_(backupText),
      snapshotDigest: packageData.snapshotDigest,
      count: selected.length,
      expectedBeforeBytes: packageData.expectedBeforeBytes,
      expectedAfterBytes: packageData.expectedAfterBytes
    };
    // User Properties are separate from the exhausted Script Property store.
    userProps.setProperty(VAA_COMPACTION_USER_PLAN_KEY_, JSON.stringify(pending));
    userProps.deleteProperty(VAA_COMPACTION_USER_APPROVAL_KEY_);
    response = {
      phase: 'PREPARED_PRIVATE_BACKUP',
      scriptPropertiesModified: 0,
      scriptPropertiesDeleted: 0,
      privateBackupCreated: true,
      approvalRequired: true,
      proposedCount: selected.length,
      proposedSavingsBytes: internal.publicPlan.proposedSavingsBytes,
      estimatedBeforeBytes: packageData.expectedBeforeBytes,
      estimatedAfterBytes: packageData.expectedAfterBytes,
      backupRetainedInPrivateMyDrive: true,
      note: 'DO NOT RUN AUTHORIZE OR COMMIT WITHOUT SEPARATE APPROVAL.'
    };
  } catch (err) {
    // An orphaned backup must not be shared; never delete it automatically.
    // Do not propagate Drive error messages that may contain private IDs.
    throw new Error('VAA_COMPACTION_BACKUP_PREPARATION_FAILED');
  } finally {
    lock.releaseLock();
  }
  console.log('VAA_COMPACTION_BACKUP_PREPARED ' + JSON.stringify(response));
  return response;
}

/**
 * STEP 2 (manual, after approval): mark the SAME-USER, unexpired plan as
 * authorized. Still does not modify Script Properties.
 */
function vaaAuthorizeReadyPerformanceCompaction() {
  const pending = vaaRecoveryReadPendingUserPlan_();
  const file = vaaRecoveryPrivateBackup_(pending.plan.fileId);
  const text = file.getBlob().getDataAsString('UTF-8');
  if (vaaRecoveryDigest_(text) !== pending.plan.backupDigest) {
    throw new Error('VAA_COMPACTION_BACKUP_DIGEST_MISMATCH');
  }
  // Mark approval for this exact snapshot + exact backup, not globally.
  pending.userProps.setProperty(
    VAA_COMPACTION_USER_APPROVAL_KEY_,
    vaaRecoveryDigest_(JSON.stringify(pending.plan))
  );
  const summary = {
    phase: 'APPROVED_NOT_COMMITTED',
    scriptPropertiesModified: 0,
    scriptPropertiesDeleted: 0,
    proposedCount: pending.plan.count,
    estimatedAfterBytes: pending.plan.expectedAfterBytes,
    backupVerifiedPrivate: true,
    nextStepRequiresSeparateExplicitCommit: true
  };
  console.log('VAA_COMPACTION_APPROVED_NO_CHANGES ' + JSON.stringify(summary));
  return summary;
}

/**
 * STEP 3: MUTATING OPERATION, manual execution only, AFTER separate
 * operator approval. No Script Property is deleted. The private backup
 * stays in My Drive. Snapshot or backup changes force a complete abort.
 */
function vaaCommitReadyPerformanceCompaction() {
  const pending = vaaRecoveryReadPendingUserPlan_();
  const approval = pending.userProps.getProperty(
    VAA_COMPACTION_USER_APPROVAL_KEY_
  );
  if (!approval ||
      approval !== vaaRecoveryDigest_(JSON.stringify(pending.plan))) {
    throw new Error('VAA_COMPACTION_EXPLICIT_APPROVAL_REQUIRED');
  }

  const file = vaaRecoveryPrivateBackup_(pending.plan.fileId);
  const text = file.getBlob().getDataAsString('UTF-8');
  if (vaaRecoveryDigest_(text) !== pending.plan.backupDigest) {
    throw new Error('VAA_COMPACTION_BACKUP_DIGEST_MISMATCH');
  }
  let backup;
  try { backup = JSON.parse(text); }
  catch (_) { throw new Error('VAA_COMPACTION_BACKUP_INVALID_JSON'); }
  if (!backup ||
      backup.schema !== 'VAA_READY_PERFORMANCE_BACKUP_V1' ||
      backup.snapshotDigest !== pending.plan.snapshotDigest ||
      !Array.isArray(backup.selected) ||
      backup.selected.length !== pending.plan.count) {
    throw new Error('VAA_COMPACTION_BACKUP_MISMATCH');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let applied = 0;
  let after;
  try {
    const props = PropertiesService.getScriptProperties();
    const snapshot = props.getProperties();
    if (vaaRecoverySnapshotDigest_(snapshot) !== pending.plan.snapshotDigest) {
      throw new Error('VAA_COMPACTION_SCRIPT_PROPERTIES_CHANGED_REPREPARE');
    }
    const internal = vaaRecoveryBuildInternalPlan_(snapshot, backup.preparedAt);
    if (internal.selected.length !== backup.selected.length ||
        internal.publicPlan.beforeEstimatedBytes !== pending.plan.expectedBeforeBytes ||
        internal.publicPlan.projectedEstimatedBytes !== pending.plan.expectedAfterBytes) {
      throw new Error('VAA_COMPACTION_PLAN_CHANGED');
    }
    for (let i = 0; i < internal.selected.length; i++) {
      const actual = internal.selected[i];
      const expected = backup.selected[i];
      if (!expected ||
          actual.key !== expected.key ||
          actual.original !== expected.original ||
          actual.compacted !== expected.compacted) {
        throw new Error('VAA_COMPACTION_ITEM_INTEGRITY_MISMATCH');
      }
    }

    // The backup and all 55 prospective updates are verified BEFORE the
    // first write. ScriptLock excludes concurrent doPost coordination.
    for (let i = 0; i < internal.selected.length; i++) {
      const item = internal.selected[i];
      if (props.getProperty(item.key) !== item.original) {
        throw new Error('VAA_COMPACTION_RECEIPT_CHANGED_STOP');
      }
      props.setProperty(item.key, item.compacted);
      if (props.getProperty(item.key) !== item.compacted) {
        throw new Error('VAA_COMPACTION_RECEIPT_WRITE_VERIFY_FAILED');
      }
      applied++;
    }

    after = vaaScriptPropertyCapacitySummary_(props.getProperties(), Date.now());
    if (after.propertyCount !== Object.keys(snapshot).length ||
        after.estimatedTotalBytes !== pending.plan.expectedAfterBytes ||
        after.estimatedTotalBytes > 384000) {
      throw new Error('VAA_COMPACTION_FINAL_CAPACITY_CHECK_FAILED');
    }
  } catch (err) {
    // NO automatic rollback: restoring the original full values while at
    // quota may be impossible. Original values remain in private backup.
    console.error('VAA_COMPACTION_HALTED ' + JSON.stringify({
      appliedCount: applied,
      backupRetained: true,
      scriptPropertiesDeleted: 0
    }));
    throw new Error('VAA_COMPACTION_STOPPED_AFTER_' + applied +
      '_UPDATES_CHECK_LOG_AND_PRIVATE_BACKUP');
  } finally {
    lock.releaseLock();
  }

  // Commit completed. The private backup is retained for recovery.
  pending.userProps.deleteProperty(VAA_COMPACTION_USER_APPROVAL_KEY_);
  pending.userProps.deleteProperty(VAA_COMPACTION_USER_PLAN_KEY_);
  const result = {
    phase: 'COMMITTED_VERIFIED',
    scriptPropertiesModified: applied,
    scriptPropertiesDeleted: 0,
    estimatedAfterBytes: after.estimatedTotalBytes,
    estimatedUsagePercent: after.estimatedUsagePercent,
    privateBackupRetained: true,
    notes: 'Original requestId and all non-performance fields retained.'
  };
  console.log('VAA_COMPACTION_COMMITTED ' + JSON.stringify(result));
  return result;
}
