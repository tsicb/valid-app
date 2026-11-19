/**
 * G6-F: isolated TEST-only synthetic stop/recovery decision matrix (READ ONLY).
 *
 * Install manually as a NEW .gs file in the existing isolated TEST GAS.
 * Requires G4/G5/G6-D/G6-E QA and canonical central-api helpers.
 *
 * This file NEVER calls doPost, mutates Script Properties, stages or commits
 * DataStore, acquires/releases leases, changes any Sheets/Drive files,
 * or authorizes a resumed request. It exercises real guard functions against
 * wholly in-memory pretend receipts, leases, and pointer states.
 */
function vaaQaG6FReceipt_(requestId, targetId, digest, status, stage, until) {
  return {
    requestId: requestId,
    operationMode: 'UPDATE',
    updateStrategy: 'APPEND',
    updatePayloadDigest: digest,
    status: status,
    stage: stage,
    spreadsheetId: targetId,
    targetSpreadsheetId: targetId,
    leaseUntil: until || ''
  };
}

function vaaQaG6FState_(point, record, opts) {
  const x = opts || {};
  return {
    point: point,
    rawReceipt: record == null ? '' : JSON.stringify(record),
    rawTargetLease: x.rawTargetLease || '',
    pointerState: x.pointerState || 'ORIGINAL',
    pointerOwnedByCandidate: x.pointerOwnedByCandidate === true,
    stageBlobPresent: x.stageBlobPresent === true,
    dataStoreMatchesPlanned: x.dataStoreMatchesPlanned === true
  };
}

/**
 * "Decision" is for an operator's READ_ONLY next investigation step.
 * It is never permission to invoke doPost, retry, recover, or delete.
 *
 * This explicitly uses the canonical stored-receipt parser, update digest
 * guard, lease test and stage ranks from the central API.
 */
function vaaQaG6FClassifySynthetic_(state, requestId, targetId, digest) {
  if (!state || ['ORIGINAL','NEW','UNKNOWN'].indexOf(
      state.pointerState) < 0) {
    return 'HALT_UNKNOWN_POINTER';
  }
  const raw = String(state.rawReceipt || '');
  const simulatedProps = {
    getProperty: function() { return raw || null; }
  };
  const receipt = getRequestRecord_(simulatedProps, requestId);
  if (raw && !receipt) return 'HALT_UNVERIFIABLE_RECEIPT';

  let lease = null;
  const leaseRaw = String(state.rawTargetLease || '');
  if (leaseRaw) {
    try {
      lease = JSON.parse(leaseRaw);
      if (!lease || typeof lease !== 'object' ||
          !lease.requestId || !Number.isFinite(Number(lease.expiresAt))) {
        return 'HALT_UNVERIFIABLE_TARGET_LEASE';
      }
    } catch (_) {
      return 'HALT_UNVERIFIABLE_TARGET_LEASE';
    }
  }
  const leaseActive = !!lease && Number(lease.expiresAt) > Date.now();
  if (leaseActive && lease.requestId !== requestId) {
    return 'HALT_OTHER_REQUEST_OWNS_LEASE';
  }
  if (state.pointerState === 'NEW' &&
      state.pointerOwnedByCandidate !== true) {
    return 'HALT_UNVERIFIED_CAS_OWNER';
  }

  if (receipt) {
    if (receipt.requestId !== requestId ||
        receipt.operationMode !== 'UPDATE' ||
        receipt.targetSpreadsheetId !== targetId ||
        receipt.spreadsheetId !== targetId) {
      return 'HALT_RECEIPT_TARGET_MISMATCH';
    }
    const digestResult = vaaValidateUpdateRequestRecord_(
      receipt, 'APPEND', digest
    );
    if (!digestResult.ok) return 'HALT_PAYLOAD_OR_STRATEGY_MISMATCH';
    if (stageRank_(receipt.stage) === 0) {
      return 'HALT_UNKNOWN_RECEIPT_STAGE';
    }
  }

  if (!receipt) {
    if (state.pointerState !== 'ORIGINAL') {
      return 'HALT_POINTER_WITHOUT_RECEIPT';
    }
    if (leaseRaw) return 'HALT_LEASE_WITHOUT_RECEIPT';
    return 'REVIEW_FRESH_REQUEST_AFTER_AUDIT';
  }

  if (receipt.status === 'READY') {
    if (receipt.stage !== 'READY' || leaseRaw ||
        state.pointerState !== 'NEW' ||
        !state.dataStoreMatchesPlanned ||
        isLeaseActive_(receipt)) {
      return 'HALT_READY_STATE_INCONSISTENT';
    }
    const replayResponse = buildReadyResponse_(
      receipt, requestId, true, Date.now()
    );
    return replayResponse.ok === true &&
      replayResponse.status === 'READY' &&
      replayResponse.reused === true &&
      replayResponse.requestId === requestId
      ? 'REVIEW_READY_REPLAY_AFTER_AUDIT'
      : 'HALT_READY_RESPONSE_INCONSISTENT';
  }

  if (receipt.status === 'ERROR') {
    return 'HALT_ERROR_REQUIRES_FORENSICS';
  }
  if (receipt.status !== 'PROCESSING' ||
      stageRank_(receipt.stage) >= stageRank_('READY')) {
    return 'HALT_UNEXPECTED_LIFECYCLE';
  }
  if (state.pointerState === 'UNKNOWN') {
    return 'HALT_COMMIT_STATUS_UNCERTAIN';
  }
  if (state.pointerState === 'NEW') {
    return 'HALT_CAS_COMMITTED_MIRRORS_UNCERTAIN';
  }
  if (!isLeaseActive_(receipt)) {
    return 'HALT_EXPIRED_OR_MISSING_REQUEST_LEASE';
  }
  if (state.stageBlobPresent) {
    return 'HALT_STAGED_DATA_NOT_COMMITTED';
  }
  return 'HALT_PROCESSING_BEFORE_COMMIT';
}

/**
 * Pure six-point in-memory test matrix based on actual CREATE/APPEND code
 * phases, not on injecting exceptions into the TEST doPost implementation.
 */
function vaaQaG6FScenarios_(requestId, targetId, digest, nowMs) {
  const future = new Date(nowMs + 60000).toISOString();
  const processing = vaaQaG6FReceipt_(
    requestId, targetId, digest, 'PROCESSING', 'OPENED', future
  );
  const ready = vaaQaG6FReceipt_(
    requestId, targetId, digest, 'READY', 'READY', ''
  );
  const activeTargetLease = JSON.stringify({
    requestId: requestId, expiresAt: nowMs + 60000
  });
  return [
    {
      state: vaaQaG6FState_('BEFORE_NEW_REQUEST_ADMISSION', null, {
        pointerState: 'ORIGINAL'
      }),
      expected: 'REVIEW_FRESH_REQUEST_AFTER_AUDIT'
    },
    {
      state: vaaQaG6FState_('AFTER_TARGET_LEASE_BEFORE_RECEIPT', null, {
        pointerState: 'ORIGINAL', rawTargetLease: activeTargetLease
      }),
      expected: 'HALT_LEASE_WITHOUT_RECEIPT'
    },
    {
      state: vaaQaG6FState_('AFTER_PROCESSING_RECEIPT_BEFORE_STAGE',
        processing, {
          pointerState: 'ORIGINAL', rawTargetLease: activeTargetLease
        }),
      expected: 'HALT_PROCESSING_BEFORE_COMMIT'
    },
    {
      state: vaaQaG6FState_('AFTER_DATASTORE_STAGE_BEFORE_CAS',
        processing, {
          pointerState: 'ORIGINAL', rawTargetLease: activeTargetLease,
          stageBlobPresent: true
        }),
      expected: 'HALT_STAGED_DATA_NOT_COMMITTED'
    },
    {
      state: vaaQaG6FState_('AFTER_DATASTORE_CAS_BEFORE_MIRRORS',
        processing, {
          pointerState: 'NEW', pointerOwnedByCandidate: true,
          rawTargetLease: activeTargetLease,
          dataStoreMatchesPlanned: true
        }),
      expected: 'HALT_CAS_COMMITTED_MIRRORS_UNCERTAIN'
    },
    {
      state: vaaQaG6FState_('AFTER_READY_BEFORE_RESPONSE', ready, {
        pointerState: 'NEW', pointerOwnedByCandidate: true,
        dataStoreMatchesPlanned: true
      }),
      expected: 'REVIEW_READY_REPLAY_AFTER_AUDIT'
    }
  ];
}

function vaaQaG6FNegativeGates_(requestId, targetId, digest) {
  const now = Date.now();
  const ready = vaaQaG6FReceipt_(
    requestId, targetId, digest, 'READY', 'READY', ''
  );
  const processing = vaaQaG6FReceipt_(
    requestId, targetId, digest, 'PROCESSING', 'OPENED',
    new Date(now - 1000).toISOString()
  );
  const changedDigest = Object.assign({}, ready, {
    updatePayloadDigest: 'OTHER_SYNTHETIC_DIGEST'
  });
  const changedStrategy = Object.assign({}, ready, {
    updateStrategy: 'REPLACE'
  });
  const missingTarget = Object.assign({}, ready, {spreadsheetId: ''});
  const readySnapshot = {
    pointerState: 'NEW', pointerOwnedByCandidate: true,
    dataStoreMatchesPlanned: true
  };
  const otherLease = JSON.stringify({
    requestId: 'OTHER_SYNTHETIC_REQUEST', expiresAt: now + 60000
  });
  const check = function(state, expected) {
    return vaaQaG6FClassifySynthetic_(
      state, requestId, targetId, digest
    ) === expected;
  };
  return {
    corruptStoredReceiptBlocked: check({
      rawReceipt: '{CORRUPT', pointerState: 'ORIGINAL'
    }, 'HALT_UNVERIFIABLE_RECEIPT'),
    missingStoredTargetBlocked: check(
      vaaQaG6FState_('NEGATIVE_MISSING_TARGET', missingTarget,
        readySnapshot), 'HALT_UNVERIFIABLE_RECEIPT'
    ),
    changedDigestBlocked: check(
      vaaQaG6FState_('NEGATIVE_DIGEST', changedDigest,
        readySnapshot), 'HALT_PAYLOAD_OR_STRATEGY_MISMATCH'
    ),
    changedStrategyBlocked: check(
      vaaQaG6FState_('NEGATIVE_STRATEGY', changedStrategy,
        readySnapshot), 'HALT_PAYLOAD_OR_STRATEGY_MISMATCH'
    ),
    readyWithoutNewPointerBlocked: check(
      vaaQaG6FState_('NEGATIVE_OLD_POINTER', ready, {
        pointerState: 'ORIGINAL', dataStoreMatchesPlanned: true
      }), 'HALT_READY_STATE_INCONSISTENT'
    ),
    readyWithoutDataStoreProofBlocked: check(
      vaaQaG6FState_('NEGATIVE_DATASTORE', ready, {
        pointerState: 'NEW', pointerOwnedByCandidate: true
      }), 'HALT_READY_STATE_INCONSISTENT'
    ),
    readyWithForeignLeaseBlocked: check(
      vaaQaG6FState_('NEGATIVE_FOREIGN_LEASE', ready, {
        pointerState: 'NEW', pointerOwnedByCandidate: true,
        rawTargetLease: otherLease, dataStoreMatchesPlanned: true
      }), 'HALT_OTHER_REQUEST_OWNS_LEASE'
    ),
    casWithWrongOwnerBlocked: check(
      vaaQaG6FState_('NEGATIVE_CAS_OWNER', processing, {
        pointerState: 'NEW'
      }), 'HALT_UNVERIFIED_CAS_OWNER'
    ),
    processingWithExpiredLeaseBlocked: check(
      vaaQaG6FState_('NEGATIVE_EXPIRED_LEASE', processing, {
        pointerState: 'ORIGINAL'
      }), 'HALT_EXPIRED_OR_MISSING_REQUEST_LEASE'
    ),
    pointerWithoutReceiptBlocked: check({
      rawReceipt: '', pointerState: 'NEW',
      pointerOwnedByCandidate: true
    }, 'HALT_POINTER_WITHOUT_RECEIPT'),
    malformedTargetLeaseBlocked: check(
      vaaQaG6FState_('NEGATIVE_MALFORMED_LEASE', ready, {
        pointerState: 'NEW', pointerOwnedByCandidate: true,
        rawTargetLease: '{NOT_JSON', dataStoreMatchesPlanned: true
      }), 'HALT_UNVERIFIABLE_TARGET_LEASE'
    ),
    unknownPointerBlocked: check(
      vaaQaG6FState_('NEGATIVE_UNKNOWN_POINTER', ready, {
        pointerState: 'UNKNOWN', dataStoreMatchesPlanned: true
      }), 'HALT_READY_STATE_INCONSISTENT'
    )
  };
}

/**
 * Only public G6-F GAS function. Verifies four REAL TEST READY receipts and
 * untouched G6-D DataStore with G6-E's read-only gate. Then exercises ONLY
 * in-memory synthetic scenarios, and rechecks real state still unchanged.
 */
function vaaQaG6FSyntheticFaultReviewReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const beforeHistorical = vaaQaG6DHistorySnapshot_(props);
  const createdReceiptKey = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const beforeCreated = props.getProperty(createdReceiptKey);
  const preflight = vaaQaG6EUpdateFaultPreflightReadOnly();
  if (!preflight.readyForFaultInjectionDesignReview ||
      preflight.priorReadyReceipts !== 4 ||
      !preflight.pointerUnchangedDuringPreflight) {
    throw new Error('QA_G6F_INDEPENDENT_UPDATE_NOT_READY');
  }
  const createdReceipt = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  if (!createdReceipt || !createdReceipt.spreadsheetId ||
      createdReceipt.status !== 'READY') {
    throw new Error('QA_G6F_TEST_CREATE_RECEIPT_UNVERIFIED');
  }
  const targetId = createdReceipt.spreadsheetId;
  const payload = vaaQaG6EUpdatePayload_(targetId);
  const digest = vaaDigestUpdateRequest_(payload);
  if (!digest) throw new Error('QA_G6F_SYNTHETIC_DIGEST_UNAVAILABLE');
  const ss = SpreadsheetApp.openById(targetId);
  const beforePointerState = rptReadStateData_(ss).map;
  const beforePointer = String(beforePointerState.analysisDataStoreFileId || '');
  const beforePointerOwner =
    String(beforePointerState.analysisDataStoreRequestId || '');
  if (!beforePointer ||
      beforePointerOwner !== VAA_QA_G6C_CONFIG_.createRequestId) {
    throw new Error('QA_G6F_TEST_DATASTORE_POINTER_UNVERIFIED');
  }
  const scenarios = vaaQaG6FScenarios_(
    VAA_QA_G6E_UPDATE_REQUEST_ID_, targetId, digest, Date.now()
  );
  const decisions = scenarios.map(function(item) {
    const decision = vaaQaG6FClassifySynthetic_(
      item.state, VAA_QA_G6E_UPDATE_REQUEST_ID_, targetId, digest
    );
    return {
      point: item.state.point,
      expectedDecision: item.expected,
      actualDecision: decision,
      pass: decision === item.expected
    };
  });
  const negatives = vaaQaG6FNegativeGates_(
    VAA_QA_G6E_UPDATE_REQUEST_ID_, targetId, digest
  );
  const afterState = rptReadStateData_(ss).map;
  const unchangedPointer =
    String(afterState.analysisDataStoreFileId || '') === beforePointer &&
    String(afterState.analysisDataStoreRequestId || '') ===
      beforePointerOwner;
  const historicalReceiptsUnchanged = vaaQaG6DHistoryEqual_(
    beforeHistorical, vaaQaG6DHistorySnapshot_(props)
  );
  const createReceiptUnchanged =
    !!beforeCreated && beforeCreated === props.getProperty(createdReceiptKey);
  const candidateRequestIdUnused =
    !props.getProperty(API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6E_UPDATE_REQUEST_ID_);
  const targetLeaseNotCreated =
    !props.getProperty(vaaTargetUpdateLeaseKey_(targetId));
  const decisionsPass = decisions.length === 6 &&
    decisions.every(function(item) { return item.pass; });
  const negativePass = Object.keys(negatives).length === 12 &&
    Object.keys(negatives).every(function(key) { return negatives[key]; });
  const result = {
    phase: 'G6_SYNTHETIC_FAULT_RECOVERY_REVIEW_READ_ONLY',
    strictReadOnly: true,
    isolatedTestBaselinePass: preflight.readyForFaultInjectionDesignReview,
    actualReadyReceipts: preflight.priorReadyReceipts,
    candidateIndependentTestWorkbook:
      preflight.candidateTargetsIndependentTestWorkbook,
    candidatePayloadDigestPrepared: true,
    scenarioCount: decisions.length,
    scenarios: decisions,
    simulatedDecisionsPass: decisionsPass,
    negativeGates: negatives,
    negativeGatesPass: negativePass,
    historicalReceiptsUnchanged: historicalReceiptsUnchanged,
    createReceiptUnchanged: createReceiptUnchanged,
    dataStorePointerUnchanged: unchangedPointer,
    candidateRequestIdUnused: candidateRequestIdUnused,
    targetLeaseNotCreated: targetLeaseNotCreated,
    simulationOnly: true,
    actualFaultInjected: false,
    actualUpdatePerformed: false,
    actualResumeTested: false,
    automaticRetryAuthorized: false,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false
  };
  result.pass = !!(
    result.isolatedTestBaselinePass &&
    result.actualReadyReceipts === 4 &&
    result.candidateIndependentTestWorkbook &&
    decisionsPass && negativePass &&
    historicalReceiptsUnchanged && createReceiptUnchanged &&
    unchangedPointer && candidateRequestIdUnused && targetLeaseNotCreated
  );
  console.log('VAA_QA_G6_SYNTHETIC_FAULT_REVIEW ' +
    JSON.stringify(result));
  return result;
}
