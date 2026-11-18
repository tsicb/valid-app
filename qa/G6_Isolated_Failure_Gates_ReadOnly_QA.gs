/**
 * G6-B — isolated TEST-only, strictly READ_ONLY failure-stop readiness audit.
 *
 * Prerequisites: canonical central-api sources + G4/G5 QA files, including
 * G5_Isolated_Replace_Once_Replay_QA.gs (as manually installed in TEST).
 *
 * No POST, no actual request replay, no fault injection into real Properties.
 * No property/sheet/Drive writes or deletions. The failures below are
 * synthetic in-memory objects, checked using the canonical guard functions.
 */
function vaaQaG6BSyntheticReceiptProps_(value) {
  return {
    getProperty: function() { return value; }
  };
}

function vaaQaG6BSyntheticFailureGates_() {
  const fakeRequestId = 'QA_G6B_SYNTHETIC_ONLY';
  const readable = JSON.stringify({
    requestId: fakeRequestId,
    operationMode: 'UPDATE',
    updateStrategy: 'REPLACE',
    updatePayloadDigest: 'FAKE_DIGEST_ONLY',
    status: 'READY',
    stage: 'READY',
    spreadsheetId: 'QA_FAKE_TARGET_ONLY'
  });

  // For a raw receipt that exists but cannot be parsed/verified, doPost's
  // existing guard returns REQUEST_RECEIPT_UNVERIFIED, not a fresh request.
  const invalidJsonBlocked = getRequestRecord_(
    vaaQaG6BSyntheticReceiptProps_('{INVALID_JSON'),
    fakeRequestId
  ) === null;
  const targetMissingBlocked = getRequestRecord_(
    vaaQaG6BSyntheticReceiptProps_('{"status":"READY"}'),
    fakeRequestId
  ) === null;
  const validRecord = getRequestRecord_(
    vaaQaG6BSyntheticReceiptProps_(readable),
    fakeRequestId
  );
  const validReceiptAccepted =
    !!validRecord &&
    validRecord.requestId === fakeRequestId &&
    validRecord.spreadsheetId === 'QA_FAKE_TARGET_ONLY';

  const validMatchingDigest = vaaValidateUpdateRequestRecord_(
    validRecord, 'REPLACE', 'FAKE_DIGEST_ONLY'
  );
  const digestMismatch = vaaValidateUpdateRequestRecord_(
    validRecord, 'REPLACE', 'DIFFERENT_DIGEST_ONLY'
  );
  const strategyMismatch = vaaValidateUpdateRequestRecord_(
    validRecord, 'APPEND', 'FAKE_DIGEST_ONLY'
  );
  const now = Date.now();
  const liveLease = isLeaseActive_({
    leaseUntil: new Date(now + 60000).toISOString()
  });
  const expiredLease = isLeaseActive_({
    leaseUntil: new Date(now - 60000).toISOString()
  });

  // Non-mutating READY response builder must preserve reused=true.
  const syntheticReady = buildReadyResponse_(
    validRecord, fakeRequestId, true, now
  );
  return {
    unreadableStoredReceiptBlocked: invalidJsonBlocked,
    missingTargetInStoredReceiptBlocked: targetMissingBlocked,
    validStoredReceiptAccepted: validReceiptAccepted,
    matchingUpdateDigestAllowed: validMatchingDigest.ok === true,
    changedDigestRejected: digestMismatch.ok === false &&
      digestMismatch.code === 'REQUEST_PAYLOAD_MISMATCH',
    changedStrategyRejected: strategyMismatch.ok === false &&
      strategyMismatch.code === 'REQUEST_PAYLOAD_MISMATCH',
    activeLeaseRecognized: liveLease === true,
    expiredLeaseNotActive: expiredLease === false,
    readyResponseReused: syntheticReady.ok === true &&
      syntheticReady.status === 'READY' &&
      syntheticReady.reused === true &&
      syntheticReady.requestId === fakeRequestId
  };
}

/**
 * Check the actual three synthetic receipts and latest TEST DataStore.
 * All IDs, property values, tokens and raw synthetic/real data stay local.
 */
function vaaQaG6BFailureGatesReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const snapshot = props.getProperties();
  const audit = vaaScriptPropertyCapacitySummary_(snapshot, Date.now());
  const expectedG4 = VAA_QA_G4_CONFIG_.requestId;
  const g4Raw = props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + expectedG4
  );
  const g4 = getRequestRecord_(props, expectedG4);
  const g4Ready = !!g4Raw && !!g4 &&
    g4.requestId === expectedG4 &&
    g4.operationMode === 'CREATE' &&
    g4.status === 'READY' && g4.stage === 'READY' &&
    !!g4.spreadsheetId;
  if (!g4Ready) {
    throw new Error('QA_G6B_G4_READY_RECEIPT_UNVERIFIED');
  }
  // Reads only, and only the TEST workbook that G4's own guard checked.
  const base = vaaQaG5GetReadyG4Receipt_();
  const targetId = base.receipt.spreadsheetId;
  if (g4.spreadsheetId !== targetId ||
      !requestRecordFileExists_(g4)) {
    throw new Error('QA_G6B_G4_TARGET_UNVERIFIED');
  }

  const append = vaaQaG5StoredAppendReceipt_(props);
  const replace = vaaQaG5ReplaceStoredReceipt_(props);
  const appendReady = !!append &&
    append.requestId === VAA_QA_G5_APPEND_REQUEST_ID_ &&
    append.operationMode === 'UPDATE' &&
    append.updateStrategy === 'APPEND' &&
    append.status === 'READY' && append.stage === 'READY' &&
    append.spreadsheetId === targetId &&
    append.targetSpreadsheetId === targetId &&
    requestRecordFileExists_(append);
  const replaceReady = !!replace &&
    replace.requestId === VAA_QA_G5_REPLACE_REQUEST_ID_ &&
    replace.operationMode === 'UPDATE' &&
    replace.updateStrategy === 'REPLACE' &&
    replace.status === 'READY' && replace.stage === 'READY' &&
    replace.spreadsheetId === targetId &&
    replace.targetSpreadsheetId === targetId &&
    requestRecordFileExists_(replace);

  const appendDigest = appendReady &&
    vaaValidateUpdateRequestRecord_(
      append, 'APPEND',
      vaaDigestUpdateRequest_(vaaQaG5AppendPayload_(targetId))
    ).ok === true;
  const replaceDigest = replaceReady &&
    vaaValidateUpdateRequestRecord_(
      replace, 'REPLACE',
      vaaDigestUpdateRequest_(vaaQaG5ReplacePayload_(targetId))
    ).ok === true;

  // This gate reads the current TEST DataStore and requires exact equality
  // to the G5-E REPLACE result. It makes no POST.
  const finalGate = vaaQaG5ReplaceReadyGateReadOnly_();
  const finalDataStoreMatches = finalGate.targetId === targetId &&
    finalGate.receipt.requestId === VAA_QA_G5_REPLACE_REQUEST_ID_;
  const categories = {};
  audit.groups.forEach(function(group) {
    categories[group.category] = group.count;
  });
  const actualStatePass = (
    audit.strictReadOnly === true &&
    audit.requestLifecycle.ready === 3 &&
    audit.requestLifecycle.error === 0 &&
    audit.requestLifecycle.inProgressOrOther === 0 &&
    audit.requestLifecycle.malformed === 0 &&
    audit.requestLifecycle.activeLease === 0 &&
    categories.REQUEST_RECORDS === 3 &&
    categories.REPORT_REGISTRY === 1 &&
    categories.VIEWER_MAPPINGS === 1 &&
    categories.UPDATE_LEASES === 0
  );
  const synthetic = vaaQaG6BSyntheticFailureGates_();
  const syntheticPass = Object.keys(synthetic).every(function(key) {
    return synthetic[key] === true;
  });
  const result = {
    phase: 'G6_FAILURE_GATES_READ_ONLY',
    strictReadOnly: true,
    testEnvironmentMatched: true,
    actualStatePass: actualStatePass,
    actualReadyReceipts: audit.requestLifecycle.ready,
    actualEstimatedBytes: audit.estimatedTotalBytes,
    actualMalformedReceipts: audit.requestLifecycle.malformed,
    actualActiveLeases: audit.requestLifecycle.activeLease,
    g4CreateReceiptReady: g4Ready,
    g5AppendReceiptReady: appendReady,
    g5ReplaceReceiptReady: replaceReady,
    g5AppendDigestMatches: appendDigest,
    g5ReplaceDigestMatches: replaceDigest,
    finalTestDataStoreMatches: finalDataStoreMatches,
    syntheticGates: synthetic,
    syntheticFailureGatesPass: syntheticPass,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false,
    actualFailureInjected: false
  };
  result.pass = actualStatePass && g4Ready && appendReady &&
    replaceReady && appendDigest && replaceDigest &&
    finalDataStoreMatches && syntheticPass;
  // Safety: no keys, property values, IDs, URLs, tokens or payloads in log.
  console.log('VAA_QA_G6_FAILURE_GATES ' + JSON.stringify(result));
  return result;
}
