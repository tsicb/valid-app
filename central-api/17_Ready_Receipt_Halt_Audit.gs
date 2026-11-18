/**
 * Read-only forensic audit after a guarded READY compaction HALTED result.
 * The previous COMMIT intentionally hides its inner exception and may report
 * zero verified updates even if the first write was accepted but readback failed.
 *
 * NEVER writes Script/User Properties, Drive files, sheets, or any API.
 * NEVER logs/returns property keys, raw values, file IDs, request IDs, or digests.
 * A successful audit does NOT authorize rerunning the mutating COMMIT.
 */
function vaaAuditStoppedReadyPerformanceCompactionReadOnly() {
  const result = {
    phase: 'HALTED_COMPACTION_AUDIT_READONLY',
    strictReadOnly: true,
    scriptPropertiesModified: 0,
    scriptPropertiesDeleted: 0,
    userPropertiesModified: 0,
    driveFilesModified: 0,
    commitRetryAuthorized: false
  };
  function finish(code) {
    result.diagnostic = code;
    console.log('VAA_COMPACTION_HALT_AUDIT_READONLY ' + JSON.stringify(result));
    return result;
  }

  const userProps = PropertiesService.getUserProperties();
  const rawPlan = userProps.getProperty(VAA_COMPACTION_USER_PLAN_KEY_);
  if (!rawPlan) return finish('NO_PENDING_PLAN');
  let plan;
  try { plan = JSON.parse(rawPlan); }
  catch (_) { return finish('INVALID_PENDING_PLAN'); }
  if (!plan || plan.version !== 1 ||
      !Number.isFinite(plan.preparedAt) ||
      !plan.fileId || !plan.backupDigest || !plan.snapshotDigest ||
      !Number.isInteger(plan.count) || plan.count < 1) {
    return finish('INVALID_PENDING_PLAN');
  }
  result.planExpired = Date.now() > plan.preparedAt + VAA_COMPACTION_PLAN_TTL_MS_;
  result.approvalStillMatches =
    userProps.getProperty(VAA_COMPACTION_USER_APPROVAL_KEY_) ===
      vaaRecoveryDigest_(JSON.stringify(plan));
  result.plannedCount = plan.count;

  let backup;
  try {
    const file = vaaRecoveryPrivateBackup_(plan.fileId);
    const text = file.getBlob().getDataAsString('UTF-8');
    if (vaaRecoveryDigest_(text) !== plan.backupDigest) {
      return finish('BACKUP_DIGEST_MISMATCH');
    }
    backup = JSON.parse(text);
  } catch (_) {
    return finish('BACKUP_UNREADABLE_OR_NOT_PRIVATE');
  }
  if (!backup || backup.schema !== 'VAA_READY_PERFORMANCE_BACKUP_V1' ||
      backup.snapshotDigest !== plan.snapshotDigest ||
      backup.preparedAt !== plan.preparedAt ||
      !Array.isArray(backup.selected) || backup.selected.length !== plan.count) {
    return finish('BACKUP_STRUCTURE_MISMATCH');
  }
  result.backupVerifiedPrivateAndIntact = true;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const snapshot = PropertiesService.getScriptProperties().getProperties();
    const summary = vaaScriptPropertyCapacitySummary_(snapshot, Date.now());
    result.currentEstimatedBytes = summary.estimatedTotalBytes;
    result.currentPropertyCount = summary.propertyCount;
    result.snapshotUnchanged =
      vaaRecoverySnapshotDigest_(snapshot) === plan.snapshotDigest;
    result.selectedStillOriginal = 0;
    result.selectedAlreadyCompacted = 0;
    result.selectedUnexpectedValue = 0;
    result.selectedMissing = 0;

    backup.selected.forEach(function(item) {
      if (!item || typeof item.key !== 'string' ||
          typeof item.original !== 'string' ||
          typeof item.compacted !== 'string') {
        result.selectedUnexpectedValue++;
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(snapshot, item.key)) {
        result.selectedMissing++;
      } else if (snapshot[item.key] === item.original) {
        result.selectedStillOriginal++;
      } else if (snapshot[item.key] === item.compacted) {
        result.selectedAlreadyCompacted++;
      } else {
        result.selectedUnexpectedValue++;
      }
    });

    // Check every pre-write planning condition without attempting any write.
    if (result.snapshotUnchanged) {
      try {
        const internal = vaaRecoveryBuildInternalPlan_(snapshot, backup.preparedAt);
        let exact = internal.selected.length === backup.selected.length &&
          internal.publicPlan.beforeEstimatedBytes === plan.expectedBeforeBytes &&
          internal.publicPlan.projectedEstimatedBytes === plan.expectedAfterBytes;
        if (exact) {
          for (let i = 0; i < internal.selected.length; i++) {
            const a = internal.selected[i];
            const b = backup.selected[i];
            if (!b || a.key !== b.key || a.original !== b.original ||
                a.compacted !== b.compacted) {
              exact = false;
              break;
            }
          }
        }
        result.prewritePlanRevalidationPassed = exact;
      } catch (_) {
        result.prewritePlanRevalidationPassed = false;
      }
    } else {
      result.prewritePlanRevalidationPassed = null;
    }
  } finally {
    lock.releaseLock();
  }

  if (result.selectedAlreadyCompacted > 0) {
    return finish('TARGET_WRITE_DETECTED_DO_NOT_RETRY');
  }
  if (result.selectedUnexpectedValue > 0 || result.selectedMissing > 0) {
    return finish('TARGET_RECORDS_CHANGED_DO_NOT_RETRY');
  }
  if (!result.snapshotUnchanged) {
    return finish('SNAPSHOT_CHANGED_SINCE_PREPARE_DO_NOT_RETRY');
  }
  if (!result.prewritePlanRevalidationPassed) {
    return finish('PREWRITE_REVALIDATION_FAILED_DO_NOT_RETRY');
  }
  return finish('PREWRITE_CHECKS_PASS_FIRST_WRITE_OR_READBACK_FAILURE_SUSPECTED');
}
