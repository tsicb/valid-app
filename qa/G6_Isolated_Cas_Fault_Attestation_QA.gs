/**
 * G6-H: isolated TEST-only canonical CAS source attestation (READ ONLY).
 *
 * The actual fault injection tests for this phase are on GitHub Actions,
 * where the real canonical stage/CAS functions run with in-memory fake
 * Google services (see tests/qa-g6-cas-fault-inmemory.test.cjs).
 *
 * This one GAS function checks that the source installed in isolated TEST
 * still has the same safety-critical call order. It does NOT inject faults,
 * call doPost, change globals, stage files, acquire locks, or write anywhere.
 *
 * Requires: G4/G5/G6-C/D/E/F/G QA and central-api source in isolated TEST.
 */

function vaaQaG6HTextOrderReadOnly_(source, tokens) {
  let previous = -1;
  return tokens.every(function(token) {
    const found = source.indexOf(token, previous + 1);
    if (found < 0 || found <= previous) return false;
    previous = found;
    return true;
  });
}

function vaaQaG6HSourceAttestationReadOnly_() {
  const stage = Function.prototype.toString.call(vaaStageAppendDataStore_);
  const cas = Function.prototype.toString.call(vaaCommitStagedAppendDataStore_);
  const execute = Function.prototype.toString.call(vaaExecuteAppendDataStoreUpdate_);
  const entrypoint = Function.prototype.toString.call(doPost);
  const stageGuardFirst = vaaQaG6HTextOrderReadOnly_(stage, [
    'if (!plan ||',
    'if (!rid)',
    'buildAnalysisDataStoreObject_(',
    'folder.createFile(',
    'validateAnalysisDataStoreObject_('
  ]);
  const stageFailedFileCleanup =
    stage.indexOf('catch (error)') >= 0 &&
    stage.indexOf('newFile.setTrashed(true)') >
      stage.indexOf('catch (error)');
  const casOrder = vaaQaG6HTextOrderReadOnly_(cas, [
    'if (!stage ||',
    'LockService.getScriptLock()',
    'const state = rptReadStateData_(ss)',
    'if (currentId === stage.fileId',
    'else if (currentId !==',
    'validateAnalysisDataStoreObject_(',
    'rptSetStateValues_(ss, {',
    'SpreadsheetApp.flush();',
    'const proof = rptReadStateData_(ss)',
    "'DATASTORE_COMMIT_UNCERTAIN'",
    'lock.releaseLock()'
  ]);
  const casCleanupAfterProof =
    cas.indexOf('formerBackupId !== previousId') >
      cas.indexOf('lock.releaseLock()') &&
    cas.indexOf('setTrashed(true)') >
      cas.indexOf('formerBackupId !== previousId');
  const casIdempotentSameRequest =
    cas.indexOf('currentRequestId === stage.requestId') >
      cas.indexOf('if (currentId === stage.fileId') &&
    cas.indexOf('alreadyCommitted = true;') >= 0;
  const executeReusesCommittedSnapshot =
    vaaQaG6HTextOrderReadOnly_(execute, [
      'vaaReadAppendStoreSource_(ss)',
      'source.dataObject.requestId',
      'commit: {',
      'reused: true'
    ]) &&
    execute.indexOf('vaaCommitStagedAppendDataStore_(') >
      execute.indexOf('vaaStageAppendDataStore_(');
  const entrypointUsesCanonicalUpdate =
    entrypoint.indexOf('vaaExecuteAppendDataStoreUpdate_(') >= 0 &&
    entrypoint.indexOf("requestRecord.stage =") >= 0 &&
    entrypoint.indexOf("'DATA_WRITTEN'") >= 0 &&
    entrypoint.indexOf("'REPORT_DONE'") >= 0 &&
    entrypoint.indexOf("'READY'") >= 0;
  return {
    stageGuardBeforeCreateFile: stageGuardFirst,
    stageFailedFileCleanup: stageFailedFileCleanup,
    casGuardProofAndReleaseOrdered: casOrder,
    casOldBackupCleanupAfterProof: casCleanupAfterProof,
    casSameRequestIdempotency: casIdempotentSameRequest,
    executeReusesCommittedSnapshot: executeReusesCommittedSnapshot,
    entrypointUsesCanonicalUpdate: entrypointUsesCanonicalUpdate
  };
}

/** Single G6-H TEST editor entry point. NO UPDATE, CAS, stage or fault. */
function vaaQaG6HCasFaultAttestationReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const historyBefore = vaaQaG6DHistorySnapshot_(props);
  const createKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const createBefore = props.getProperty(createKey);
  const prior = vaaQaG6GFailFastPrewriteReadOnly();
  if (!prior.pass || prior.actualReadyReceipts !== 4 ||
      !prior.candidateRequestStillUnused ||
      !prior.targetLeaseStillAbsent) {
    throw new Error('QA_G6H_BASELINE_NOT_READY');
  }
  const created = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  if (!created || created.status !== 'READY' ||
      created.operationMode !== 'CREATE' ||
      !created.spreadsheetId) {
    throw new Error('QA_G6H_FAULT_DOMAIN_RECEIPT_UNVERIFIED');
  }
  const targetId = created.spreadsheetId;
  const ss = SpreadsheetApp.openById(targetId);
  const original = vaaQaG5ReplaceReadyGateReadOnly_();
  const stateBefore = rptReadStateData_(ss).map;
  const beforePointer = String(stateBefore.analysisDataStoreFileId || '');
  const beforeOwner = String(stateBefore.analysisDataStoreRequestId || '');
  if (!beforePointer || beforePointer === original.pointer ||
      beforeOwner !== VAA_QA_G6C_CONFIG_.createRequestId ||
      targetId === original.targetId) {
    throw new Error('QA_G6H_POINTER_NOT_ISOLATED');
  }

  const checks = vaaQaG6HSourceAttestationReadOnly_();
  const sourceMatches = Object.keys(checks).length === 7 &&
    Object.keys(checks).every(function(key) { return checks[key]; });
  const stateAfter = rptReadStateData_(ss).map;
  const pointerStable =
    String(stateAfter.analysisDataStoreFileId || '') === beforePointer &&
    String(stateAfter.analysisDataStoreRequestId || '') === beforeOwner;
  const historyStable = vaaQaG6DHistoryEqual_(
    historyBefore, vaaQaG6DHistorySnapshot_(props)
  );
  const createdStable = !!createBefore &&
    createBefore === props.getProperty(createKey);
  const newRequestUnused =
    !props.getProperty(API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6E_UPDATE_REQUEST_ID_);
  const leaseStillAbsent =
    !props.getProperty(vaaTargetUpdateLeaseKey_(targetId));
  const originalAfter = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalStable =
    originalAfter.pointer === original.pointer &&
    originalAfter.targetId === original.targetId;

  const out = {
    phase: 'G6_CAS_FAULT_ATTESTATION_READ_ONLY',
    strictReadOnly: true,
    priorFailFastPass: prior.pass === true,
    actualReadyReceipts: prior.actualReadyReceipts,
    sourceChecks: checks,
    sourceAttestationPass: sourceMatches,
    historicalReceiptsUnchanged: historyStable,
    createReceiptUnchanged: createdStable,
    originalDataStoreUnchanged: originalStable,
    candidateDataStorePointerUnchanged: pointerStable,
    candidateRequestStillUnused: newRequestUnused,
    targetLeaseStillAbsent: leaseStillAbsent,
    inMemoryFaultHarnessOnly: true,
    actualFaultInjected: false,
    actualUpdatePerformed: false,
    actualResumeTested: false,
    automaticRetryAuthorized: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  out.pass = !!(prior.pass && prior.actualReadyReceipts === 4 &&
    sourceMatches && historyStable && createdStable &&
    originalStable && pointerStable && newRequestUnused &&
    leaseStillAbsent);
  // Never print the source itself, file IDs, request IDs or credentials.
  console.log('VAA_QA_G6_CAS_FAULT_ATTESTATION ' + JSON.stringify(out));
  return out;
}
