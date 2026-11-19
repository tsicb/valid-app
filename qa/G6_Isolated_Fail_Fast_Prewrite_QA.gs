/**
 * G6-G: isolated TEST-only real-helper fail-fast checks, READ ONLY.
 *
 * Install MANUALLY as a NEW .gs file in isolated TEST GAS after G6-F PASS.
 * Prerequisites: G4/G5/G6-A, G6-D, G6-E and G6-F QA files and canonical API.
 *
 * All calls to staging/CAS helpers are deliberately invalid and must throw
 * BEFORE Drive, ScriptLock, Spreadsheet or Properties side effects.
 * A source-shape fence is checked before making those helper calls.
 * For receipt write-guard checks use a fake in-memory Properties object only.
 *
 * Absolutely no doPost, no real UPDATE, no actual fault injection,
 * no automatic retry, no real property writes and no file mutations.
 */

/** Capture an expected throw without exposing exception text or raw values. */
function vaaQaG6GExpectException_(name, code, fn) {
  let observed = 'NO_EXCEPTION';
  try {
    fn();
  } catch (err) {
    observed = String(err && err.code || 'UNKNOWN_EXCEPTION');
  }
  return {
    probe: name, expectedCode: code, actualCode: observed,
    pass: observed === code
  };
}

/** For validations returning {ok:false,code}, not throwing. */
function vaaQaG6GExpectRejection_(name, code, fn) {
  let observed = 'NOT_REJECTED';
  try {
    const r = fn();
    observed = r && r.ok === false ?
      String(r.code || 'REJECTED_WITHOUT_CODE') : 'NOT_REJECTED';
  } catch (_) {
    observed = 'UNEXPECTED_EXCEPTION';
  }
  return {
    probe: name, expectedCode: code, actualCode: observed,
    pass: observed === code
  };
}

/**
 * Strict source-order fence on canonical helpers. If the implementation
 * changes, do NOT call even an intentionally-invalid stage/CAS function.
 */
function vaaQaG6GGuardSourceFenceReadOnly_() {
  const stageSource = Function.prototype.toString.call(
    vaaStageAppendDataStore_
  );
  const commitSource = Function.prototype.toString.call(
    vaaCommitStagedAppendDataStore_
  );
  const stagePlanGuard = stageSource.indexOf('if (!plan ||');
  const stageRequestGuard = stageSource.indexOf('if (!rid)');
  const stageDataBuild = stageSource.indexOf(
    'buildAnalysisDataStoreObject_('
  );
  const stageDriveWrite = stageSource.indexOf('folder.createFile(');
  const commitInputGuard = commitSource.indexOf('if (!stage ||');
  const commitLock = commitSource.indexOf('LockService.getScriptLock()');
  const commitCas = commitSource.indexOf('rptSetStateValues_(');
  return {
    stageGuardBeforeDataBuild:
      stagePlanGuard >= 0 && stageRequestGuard > stagePlanGuard &&
      stageDataBuild > stageRequestGuard &&
      stageDriveWrite > stageDataBuild,
    commitGuardBeforeLock:
      commitInputGuard >= 0 && commitLock > commitInputGuard &&
      commitCas > commitLock
  };
}

/**
 * Create a fake Properties object, with a trap that fails before any write.
 * Never wrap or override PropertiesService's actual Script Properties.
 */
function vaaQaG6GFakeProperties_(snapshot, fakeEffects) {
  return {
    getProperties: function() { return snapshot; },
    getProperty: function(key) {
      return Object.prototype.hasOwnProperty.call(snapshot, key) ?
        snapshot[key] : null;
    },
    setProperty: function() {
      fakeEffects.attemptedWrites++;
      throw new Error('QA_G6G_FAKE_PROPERTY_WRITE_TRAPPED');
    },
    deleteProperty: function() {
      fakeEffects.attemptedDeletes++;
      throw new Error('QA_G6G_FAKE_PROPERTY_DELETE_TRAPPED');
    }
  };
}

/** Only public G6-G function. Runs canonical prewrite guards in TEST GAS. */
function vaaQaG6GFailFastPrewriteReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const historyBefore = vaaQaG6DHistorySnapshot_(props);
  const createKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const createBefore = props.getProperty(createKey);
  const prior = vaaQaG6FSyntheticFaultReviewReadOnly();
  if (!prior.pass || !prior.simulatedDecisionsPass ||
      !prior.negativeGatesPass || prior.actualReadyReceipts !== 4 ||
      !prior.candidateRequestIdUnused || !prior.targetLeaseNotCreated) {
    throw new Error('QA_G6G_PRIOR_FAILURE_REVIEW_NOT_READY');
  }

  const record = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  if (!record || record.status !== 'READY' ||
      record.operationMode !== 'CREATE' || !record.spreadsheetId ||
      record.outputFolderId !== VAA_QA_G4_CONFIG_.testOutputId) {
    throw new Error('QA_G6G_TEST_DOMAIN_RECEIPT_UNVERIFIED');
  }
  const targetId = record.spreadsheetId;
  const orig = vaaQaG5ReplaceReadyGateReadOnly_();
  if (targetId === orig.targetId) {
    throw new Error('QA_G6G_TEST_DOMAIN_NOT_INDEPENDENT');
  }
  validateUpdateTargetDriveFile_(
    targetId, VAA_QA_G4_CONFIG_.testOutputId
  );
  const ss = SpreadsheetApp.openById(targetId);
  const beforeState = rptReadStateData_(ss).map;
  const pointer = String(beforeState.analysisDataStoreFileId || '');
  const pointerOwner = String(beforeState.analysisDataStoreRequestId || '');
  if (!pointer || pointer === orig.pointer ||
      pointerOwner !== VAA_QA_G6C_CONFIG_.createRequestId) {
    throw new Error('QA_G6G_DATASTORE_BASELINE_INVALID');
  }
  const requestId = VAA_QA_G6E_UPDATE_REQUEST_ID_;
  const pendingKey = API_CONFIG.REQUEST_PROPERTY_PREFIX + requestId;
  if (props.getProperty(pendingKey) ||
      props.getProperty(vaaTargetUpdateLeaseKey_(targetId))) {
    throw new Error('QA_G6G_CANDIDATE_ALREADY_STARTED');
  }

  const fence = vaaQaG6GGuardSourceFenceReadOnly_();
  if (!fence.stageGuardBeforeDataBuild ||
      !fence.commitGuardBeforeLock) {
    throw new Error('QA_G6G_PREWRITE_SOURCE_FENCE_UNVERIFIED');
  }
  if (typeof vaaQaG6SyntheticSnapshotAtBytes_ !== 'function') {
    throw new Error('QA_G6G_G6A_SNAPSHOT_HELPER_MISSING');
  }
  const fakeSS = {
    getId: function() { return targetId; }
  };
  const fakeEffects = {
    attemptedWrites: 0, attemptedDeletes: 0
  };
  const payload = vaaQaG6EUpdatePayload_(targetId);
  const probes = [];

  // Pure merge validation failures: no staging or file allocation.
  probes.push(vaaQaG6GExpectException_(
    'INVALID_MERGE_STRATEGY', 'INVALID_UPDATE_STRATEGY',
    function() { vaaBuildAppendStorePlan_(payload, null, 'QA_INVALID'); }
  ));
  probes.push(vaaQaG6GExpectException_(
    'MISSING_MERGE_PAYLOAD', 'INVALID_PAYLOAD',
    function() { vaaBuildAppendStorePlan_(null, null, 'APPEND'); }
  ));

  // Actual stage helper must abort at its preconditions, BEFORE any blob.
  probes.push(vaaQaG6GExpectException_(
    'STAGE_PLAN_MISSING', 'INVALID_APPEND_PLAN',
    function() {
      vaaStageAppendDataStore_(fakeSS, null, requestId, pointer);
    }
  ));
  probes.push(vaaQaG6GExpectException_(
    'STAGE_IDENTITY_VERSION_INVALID', 'INVALID_APPEND_PLAN',
    function() {
      vaaStageAppendDataStore_(fakeSS, {
        payload: {}, applicationIdentityVersion: 'QA_WRONG_VERSION'
      }, requestId, pointer);
    }
  ));
  probes.push(vaaQaG6GExpectException_(
    'STAGE_REQUEST_ID_MISSING', 'INVALID_REQUEST_ID',
    function() {
      vaaStageAppendDataStore_(fakeSS, {
        payload: {}, applicationIdentityVersion: VAAAppendMergeCore.VERSION
      }, '', pointer);
    }
  ));

  // Actual CAS helper must abort BEFORE LockService and pointer I/O.
  probes.push(vaaQaG6GExpectException_(
    'CAS_STAGE_MISSING', 'INVALID_APPEND_STAGE',
    function() { vaaCommitStagedAppendDataStore_(fakeSS, null); }
  ));
  probes.push(vaaQaG6GExpectException_(
    'CAS_WRONG_WORKBOOK', 'INVALID_APPEND_STAGE',
    function() {
      vaaCommitStagedAppendDataStore_(fakeSS, {
        spreadsheetId: 'QA_DIFFERENT_SYNTHETIC_SHEET',
        fileId: 'QA_UNREAL_STAGE', requestId: requestId
      });
    }
  ));
  probes.push(vaaQaG6GExpectException_(
    'CAS_FILE_ID_MISSING', 'INVALID_APPEND_STAGE',
    function() {
      vaaCommitStagedAppendDataStore_(fakeSS, {
        spreadsheetId: targetId, fileId: '', requestId: requestId
      });
    }
  ));

  // Pure protocol rejection on copies of an entirely synthetic payload.
  const badProtocol = JSON.parse(JSON.stringify(payload));
  badProtocol.updateProtocol = 'QA_WRONG_PROTOCOL';
  probes.push(vaaQaG6GExpectRejection_(
    'UNSUPPORTED_UPDATE_PROTOCOL', 'UPDATE_PROTOCOL_REQUIRED',
    function() { return vaaValidateUpdateProtocol_(badProtocol); }
  ));
  const missingIdentity = JSON.parse(JSON.stringify(payload));
  const headers = missingIdentity.datasets.applicationData.headers;
  const identityIndex = headers.indexOf('応募識別キー');
  if (identityIndex < 0) {
    throw new Error('QA_G6G_SYNTHETIC_IDENTITY_COLUMN_MISSING');
  }
  headers.splice(identityIndex, 1);
  probes.push(vaaQaG6GExpectRejection_(
    'MISSING_APPLICATION_IDENTITY', 'APPLICATION_IDENTITY_REQUIRED',
    function() { return vaaValidateUpdateProtocol_(missingIdentity); }
  ));

  // Receipt budget errors use ONLY a fake Properties instance. If the real
  // guard accidentally attempts to call setProperty, the trap records it.
  const bigFakeProps = vaaQaG6GFakeProperties_({}, fakeEffects);
  const oversizedRecord = {
    requestId: 'QA_G6G_FAKE_ONLY',
    operationMode: 'UPDATE',
    spreadsheetId: 'QA_NONREAL_TARGET',
    status: 'PROCESSING',
    diagnosticPadding: Array(9501).join('X')
  };
  probes.push(vaaQaG6GExpectException_(
    'RECEIPT_SINGLE_VALUE_TOO_LARGE', 'PROPERTY_VALUE_TOO_LARGE',
    function() {
      saveRequestRecord_(
        bigFakeProps, 'QA_G6G_FAKE_ONLY', oversizedRecord
      );
    }
  ));

  const fakeCapacitySnapshot = vaaQaG6SyntheticSnapshotAtBytes_(
    VAA_REQUEST_PROPERTY_WRITE_CEILING_BYTES_
  );
  const fakeFullProps = vaaQaG6GFakeProperties_(
    fakeCapacitySnapshot, fakeEffects
  );
  const newAdmissionRejected =
    vaaCheckNewRequestCapacityReadOnly_(
      fakeFullProps
    ).allowed === false;
  probes.push(vaaQaG6GExpectException_(
    'RECEIPT_AT_NEW_REQUEST_WRITE_CEILING',
    'PROPERTY_CAPACITY_NEAR_LIMIT',
    function() {
      saveRequestRecord_(fakeFullProps, 'QA_G6G_FAKE_ONLY', {
        requestId: 'QA_G6G_FAKE_ONLY',
        operationMode: 'UPDATE',
        status: 'PROCESSING',
        spreadsheetId: 'QA_NONREAL_TARGET'
      });
    }
  ));

  const afterState = rptReadStateData_(ss).map;
  const pointerUnchanged =
    String(afterState.analysisDataStoreFileId || '') === pointer &&
    String(afterState.analysisDataStoreRequestId || '') === pointerOwner;
  const historyUnchanged = vaaQaG6DHistoryEqual_(
    historyBefore, vaaQaG6DHistorySnapshot_(props)
  );
  const createUnchanged =
    !!createBefore && createBefore === props.getProperty(createKey);
  const candidateRequestStillUnused = !props.getProperty(pendingKey);
  const targetLeaseStillAbsent = !props.getProperty(
    vaaTargetUpdateLeaseKey_(targetId)
  );
  const originalStillValid = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalDataStoreUnchanged =
    originalStillValid.targetId === orig.targetId &&
    originalStillValid.pointer === orig.pointer;
  const probePass = probes.length === 12 && probes.every(
    function(item) { return item.pass; }
  );
  const out = {
    phase: 'G6_FAIL_FAST_PREWRITE_READ_ONLY',
    strictReadOnly: true,
    priorSyntheticReviewPass: prior.pass === true,
    actualReadyReceipts: prior.actualReadyReceipts,
    sourceGuardBeforeWritesVerified: fence.stageGuardBeforeDataBuild &&
      fence.commitGuardBeforeLock,
    syntheticNewRequestAdmissionRejected: newAdmissionRejected,
    probeCount: probes.length,
    probes: probes,
    allPrewriteProbesPass: probePass,
    fakePropertySetAttempts: fakeEffects.attemptedWrites,
    fakePropertyDeleteAttempts: fakeEffects.attemptedDeletes,
    historicalReceiptsUnchanged: historyUnchanged,
    createReceiptUnchanged: createUnchanged,
    originalDataStoreUnchanged: originalDataStoreUnchanged,
    candidateDataStorePointerUnchanged: pointerUnchanged,
    candidateRequestStillUnused: candidateRequestStillUnused,
    targetLeaseStillAbsent: targetLeaseStillAbsent,
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
    out.sourceGuardBeforeWritesVerified && newAdmissionRejected &&
    probePass && out.fakePropertySetAttempts === 0 &&
    out.fakePropertyDeleteAttempts === 0 &&
    historyUnchanged && createUnchanged && originalDataStoreUnchanged &&
    pointerUnchanged && candidateRequestStillUnused && targetLeaseStillAbsent
  );
  // No payloads, IDs, URLs, tokens or real receipt bodies are emitted.
  console.log('VAA_QA_G6_FAIL_FAST_PREWRITE ' + JSON.stringify(out));
  return out;
}
