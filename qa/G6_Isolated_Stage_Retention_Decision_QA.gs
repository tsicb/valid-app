/**
 * G6-M: retained orphan Stage decision/cleanup design gate (READ ONLY).
 *
 * Isolated TEST GAS ONLY. Never run in PROD.
 *
 * Outcome: PRESERVE the single synthetic G6-J Stage as evidence until the
 * failure/recovery QA programme is concluded and a human explicitly
 * approves a separately implemented, exact-file-ID cleanup.
 *
 * This module CANNOT delete, trash, move, create, CAS, POST, acquire leases,
 * edit receipts or run a retry. Approval is NOT an input to this module.
 *
 * Requires G6-J, K and L QA plus the existing isolated TEST central-api.
 */

/** A fixed human-review contract, not an executable cleanup recipe. */
function vaaQaG6MRetentionPolicyReadOnly_() {
  return {
    evidenceDisposition: 'PRESERVE_UNTIL_G6_RECOVERY_QA_COMPLETE',
    proposedCleanupTarget: 'ONE_VERIFIED_TEST_STAGE_ID_ONLY',
    noFolderWideCleanup: true,
    preserveCurrentAndBackupDataStores: true,
    preserveHistoricalReadyReceipts: true,
    requireFreshTwoPassAuditBeforeAnyFutureCleanup: true,
    requireExplicitHumanApproval: true,
    requireEvidenceRetentionDecision: true,
    externalReferencesNotFullyEnumerated: true,
    noAutomaticRetryOrCleanup: true
  };
}

/**
 * Only public G6-M entrypoint. The existing Stage is opened BY its verified
 * ID only after G6-L's known-pointer/ScriptProperties audit passes.
 */
function vaaQaG6MStageRetentionDecisionReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const beforeProps = props.getProperties();

  const impact = vaaQaG6LStageRetentionImpactReadOnly();
  if (!impact.pass ||
      !impact.readyForSingleFileCleanupDesignReview ||
      impact.actualReadyReceipts !== 4 ||
      !impact.exactSingleTestParent ||
      impact.stageReferencedByKnownWorkbookPointers ||
      impact.propertyStageReferenceCount !== 0 ||
      !impact.knownWorkbookPointersStable ||
      !impact.scriptPropertiesStable ||
      impact.cleanupAuthorized !== false ||
      impact.externalReferenceScopeFullyAudited !== false) {
    throw new Error('QA_G6M_IMPACT_AUDIT_NOT_READY');
  }

  // G6-J's independent read-only inspector supplies a private file ID.
  // Do NOT log that ID or any raw contents.
  const details = vaaQaG6JStageDetailsReadOnly_();
  if (!details || !details.output ||
      details.output.pass !== true ||
      details.output.stageFileCount !== 1 ||
      details.output.validationCode !== 'OK' ||
      !details.stageFileId || !details.targetId) {
    throw new Error('QA_G6M_STAGE_AUDIT_NOT_READY');
  }

  const folderId = String(props.getProperty(
    API_CONFIG.ANALYSIS_DATASTORE_FOLDER_PROPERTY
  ) || '');
  if (!folderId) throw new Error('QA_G6M_TEST_FOLDER_NOT_REGISTERED');
  const folder = DriveApp.getFolderById(folderId);
  if (folder.getName() !== API_CONFIG.ANALYSIS_DATASTORE_FOLDER_NAME ||
      !folderIsDirectChildOf_(folder, VAA_QA_G4_CONFIG_.testRootId)) {
    throw new Error('QA_G6M_TEST_FOLDER_NOT_ISOLATED');
  }

  const file = DriveApp.getFileById(details.stageFileId);
  const expectedName = vaaQaG6IStageCandidateFileName_(details.targetId);
  const fileNameMatched = file.getName() === expectedName;
  let parentCount = 0;
  let exactParent = true;
  const parentIterator = file.getParents();
  while (parentIterator.hasNext() && parentCount < 2) {
    const parent = parentIterator.next();
    parentCount++;
    if (parent.getId() !== folderId) exactParent = false;
  }
  const exactSingleTestParent =
    parentCount === 1 && exactParent &&
    folderIsDirectChildOf_(file, folderId);

  const first = file.getBlob().getDataAsString('UTF-8');
  const second = file.getBlob().getDataAsString('UTF-8');
  let body = null;
  try { body = JSON.parse(second); } catch (_) {}
  const stageBodyStillValid =
    vaaQaG6KValidateBodyReadOnly_(body, details);
  const stageByteContentStable =
    first.length > 0 && first === second;
  const originalPointerStillUnchanged =
    details.output.originalPointerUnchanged === true &&
    details.output.stagePointerNotFlipped === true &&
    details.stageFileId !== details.originalPointer;

  // Defensive final check: known workbooks/Script Properties must still be
  // stable across the entire impact + retention review. This audit cannot
  // prove references from all external accounts/files are absent.
  const afterProps = props.getProperties();
  const scriptPropertiesStillStable =
    vaaQaG6LSamePropertySnapshot_(beforeProps, afterProps);
  const candidateStageReceiptUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
  );
  const reservedUpdateReceiptUnused = !props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const leaseStillAbsent = !props.getProperty(
    vaaTargetUpdateLeaseKey_(details.targetId)
  );
  const noKnownLiveReference =
    !impact.stageReferencedByKnownWorkbookPointers &&
    impact.propertyStageReferenceCount === 0 &&
    candidateStageReceiptUnused && reservedUpdateReceiptUnused &&
    leaseStillAbsent;

  const policy = vaaQaG6MRetentionPolicyReadOnly_();
  const out = {
    phase: 'G6_STAGE_RETENTION_DECISION_READ_ONLY',
    strictReadOnly: true,
    priorCleanupImpactPass: impact.pass === true,
    actualReadyReceipts: impact.actualReadyReceipts,
    singleStageIdentified: details.output.stageFileCount === 1,
    stageFileNameMatches: fileNameMatched,
    stageExactSingleTestParent: exactSingleTestParent,
    stageByteContentStableAcrossReads: stageByteContentStable,
    stageBodyStillMatchesSyntheticPlan: stageBodyStillValid,
    originalPointerStillUnchanged: originalPointerStillUnchanged,
    noKnownWorkbookOrPropertyStageReference: noKnownLiveReference,
    scriptPropertiesStillStable: scriptPropertiesStillStable,
    stageRequestReceiptUnused: candidateStageReceiptUnused,
    reservedUpdateReceiptUnused: reservedUpdateReceiptUnused,
    targetUpdateLeaseAbsent: leaseStillAbsent,
    externalReferencesFullyAudited: false,
    evidenceRetentionPolicy: policy.evidenceDisposition,
    noFolderWideCleanup: policy.noFolderWideCleanup,
    exactFileIdOnlyForFutureReview:
      policy.proposedCleanupTarget ===
      'ONE_VERIFIED_TEST_STAGE_ID_ONLY',
    requireFreshAuditBeforeFutureCleanup:
      policy.requireFreshTwoPassAuditBeforeAnyFutureCleanup,
    requireExplicitHumanApproval: policy.requireExplicitHumanApproval,
    retentionPeriodConfirmed: false,
    evidenceArchiveVerified: false,
    operatorCleanupApprovalRecorded: false,
    readyForRetentionAndCleanupPolicyReview: false,
    stagePreservationDecision: 'KEEP_STAGE_FOR_EVIDENCE',
    cleanupAuthorized: false,
    casAuthorized: false,
    updateAuthorized: false,
    automaticRetryAuthorized: false,
    actualCleanupPerformed: false,
    actualCasPerformed: false,
    actualUpdatePerformed: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  out.readyForRetentionAndCleanupPolicyReview = !!(
    out.priorCleanupImpactPass && out.actualReadyReceipts === 4 &&
    out.singleStageIdentified && fileNameMatched &&
    exactSingleTestParent && stageByteContentStable &&
    stageBodyStillValid && originalPointerStillUnchanged &&
    noKnownLiveReference && scriptPropertiesStillStable
  );
  out.pass = out.readyForRetentionAndCleanupPolicyReview;
  // Intentional: no file ID, folder ID, raw bytes, auth, or request JSON.
  console.log('VAA_QA_G6_STAGE_RETENTION_DECISION ' +
    JSON.stringify(out));
  return out;
}
