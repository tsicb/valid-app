/**
 * G6-D: CREATE one separate synthetic fault-domain workbook in isolated TEST.
 *
 * This QA-only script must be manually installed as a NEW file in the
 * isolated TEST Apps Script. Never copy into production central-api/*.gs.
 *
 * Dependencies: G4/G5 QA, G6-B and G6-C QA, canonical central-api.
 *
 * vaaQaG6DCreateFaultDomainOnce() WRITES exactly one TEST CREATE request
 * when G6-C's read-only preflight passes. NEVER rerun after an error,
 * interruption, timeout, or pass:false.
 *
 * vaaQaG6DInspectFaultDomainReadOnly() makes NO POST and is safe to run
 * when the outcome of CREATE is unclear; it never attempts recovery.
 */

/** Only the three completed historical TEST receipt keys, never their IDs. */
function vaaQaG6DHistorySnapshot_(props) {
  const ids = [
    VAA_QA_G4_CONFIG_.requestId,
    VAA_QA_G5_APPEND_REQUEST_ID_,
    VAA_QA_G5_REPLACE_REQUEST_ID_
  ];
  return ids.map(function(id) {
    return props.getProperty(API_CONFIG.REQUEST_PROPERTY_PREFIX + id);
  });
}

function vaaQaG6DHistoryEqual_(before, after) {
  return before.length === after.length &&
    before.every(function(value, index) {
      return !!value && value === after[index];
    });
}

/** No write: verify the G6 workbook and its DataStore are both TEST only. */
function vaaQaG6DVerifyWorkbookReadOnly_(candidateId, originalId, originalPointer) {
  if (!candidateId || candidateId === originalId) {
    throw new Error('QA_G6D_NOT_AN_INDEPENDENT_WORKBOOK');
  }
  validateUpdateTargetDriveFile_(
    candidateId, VAA_QA_G4_CONFIG_.testOutputId
  );
  const ss = SpreadsheetApp.openById(candidateId);
  const stateData = rptReadStateData_(ss);
  const pointer = String(
    stateData && stateData.map &&
    stateData.map.analysisDataStoreFileId || ''
  );
  if (!pointer || pointer === originalPointer) {
    throw new Error('QA_G6D_DATASTORE_NOT_INDEPENDENT');
  }
  // Includes actual file parent and DataStore folder checks beneath TEST root.
  const stored = vaaQaG5ReadTestDataStore_(ss);
  const expected = VAAAppendMergeCore.merge({
    mode: 'REPLACE',
    incoming: vaaQaG6CFaultDomainPayload_().datasets,
    maxRows: API_CONFIG.MAX_DATASET_ROWS
  });
  return {
    differentWorkbookFromG4G5: true,
    differentDataStorePointer: true,
    targetInTestOutput: true,
    dataStoreInTestRoot: true,
    dataStoreMatchesSynthetic:
      JSON.stringify(stored.applicationData) ===
        JSON.stringify(expected.applicationData) &&
      JSON.stringify(stored.jobAnalysisMaster) ===
        JSON.stringify(expected.jobAnalysisMaster),
    actualApplications: stored.applicationData.rows.length,
    actualJobs: stored.jobAnalysisMaster.rows.length
  };
}

/**
 * READ_ONLY forensic inspector. It is intentionally independent of the
 * G6-C gate requiring exactly 3 READY records, because after CREATE there
 * should normally be 4. It does not claim any incomplete CREATE can be
 * resumed safely or authorize retries.
 */
function vaaQaG6DInspectFaultDomainReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const before = vaaQaG6DHistorySnapshot_(props);
  const baseline = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalId = baseline.targetId;
  const originalPointer = baseline.pointer;
  const key = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const raw = props.getProperty(key);
  let rec = null;
  if (raw) {
    try { rec = JSON.parse(raw); } catch (_) {}
  }
  const audit = vaaScriptPropertyCapacitySummary_(
    props.getProperties(), Date.now()
  );
  const receiptReady = !!rec &&
    rec.requestId === VAA_QA_G6C_CONFIG_.createRequestId &&
    rec.operationMode === 'CREATE' &&
    rec.status === 'READY' && rec.stage === 'READY' &&
    !!rec.spreadsheetId &&
    rec.spreadsheetId !== originalId &&
    rec.outputFolderId === VAA_QA_G4_CONFIG_.testOutputId;
  let workbook = null;
  let verificationCode = 'RECEIPT_NOT_READY';
  if (receiptReady) {
    try {
      workbook = vaaQaG6DVerifyWorkbookReadOnly_(
        rec.spreadsheetId, originalId, originalPointer
      );
      verificationCode = 'OK';
    } catch (err) {
      verificationCode = String(err && err.code ||
        'WORKBOOK_OR_DATASTORE_UNVERIFIED');
    }
  }

  const after = vaaQaG6DHistorySnapshot_(props);
  const postBaseline = vaaQaG5ReplaceReadyGateReadOnly_();
  const historicalReceiptsStable =
    vaaQaG6DHistoryEqual_(before, after);
  const originalDataStoreStable =
    postBaseline.targetId === originalId &&
    postBaseline.pointer === originalPointer;

  const categories = {};
  audit.groups.forEach(function(g) {
    categories[g.category] = g.count;
  });
  const out = {
    phase: 'G6_FAULT_DOMAIN_INSPECT_READ_ONLY',
    strictReadOnly: true,
    candidateReceiptExists: !!raw,
    candidateReceiptReady: receiptReady,
    candidateStatusCategory: !rec ? (raw ? 'UNREADABLE' : 'ABSENT') :
      (rec.status === 'READY' ? 'READY' :
        rec.status === 'ERROR' ? 'ERROR' : 'OTHER'),
    receiptCount: categories.REQUEST_RECORDS || 0,
    readyCount: audit.requestLifecycle.ready,
    malformedCount: audit.requestLifecycle.malformed,
    activeLeaseCount: audit.requestLifecycle.activeLease,
    differentWorkbookFromG4G5:
      !!workbook && workbook.differentWorkbookFromG4G5,
    differentDataStorePointer:
      !!workbook && workbook.differentDataStorePointer,
    targetInTestOutput: !!workbook && workbook.targetInTestOutput,
    dataStoreInTestRoot: !!workbook && workbook.dataStoreInTestRoot,
    dataStoreMatchesSynthetic:
      !!workbook && workbook.dataStoreMatchesSynthetic,
    actualApplications: workbook ? workbook.actualApplications : null,
    actualJobs: workbook ? workbook.actualJobs : null,
    verificationCode: verificationCode,
    historicalReceiptsStable: historicalReceiptsStable,
    originalDataStoreStable: originalDataStoreStable,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false,
    driveModified: false,
    failureInjected: false
  };
  out.pass = !!(
    out.candidateReceiptReady &&
    out.receiptCount === 4 && out.readyCount === 4 &&
    out.malformedCount === 0 && out.activeLeaseCount === 0 &&
    out.differentWorkbookFromG4G5 &&
    out.differentDataStorePointer && out.targetInTestOutput &&
    out.dataStoreInTestRoot && out.dataStoreMatchesSynthetic &&
    out.actualApplications === 1 && out.actualJobs === 1 &&
    historicalReceiptsStable && originalDataStoreStable
  );
  console.log('VAA_QA_G6_FAULT_DOMAIN_INSPECT ' + JSON.stringify(out));
  return out;
}

/**
 * The ONLY G6-D write entry point. Run manually ONCE after a green G6-C.
 * Never auto-retry, even on an unparseable response.
 */
function vaaQaG6DCreateFaultDomainOnce() {
  vaaQaG4IsolatedConfig_();
  const preflight = vaaQaG6CFaultDomainPreflightReadOnly();
  if (preflight.readyForSeparateProvisioningPlan !== true ||
      preflight.faultDomainProvisioned !== false ||
      preflight.candidateRequestIdAlreadyExists !== false) {
    throw new Error('QA_G6D_CREATE_BLOCKED_BY_PREFLIGHT');
  }
  const props = PropertiesService.getScriptProperties();
  const beforeHistory = vaaQaG6DHistorySnapshot_(props);
  const beforeBaseline = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalId = beforeBaseline.targetId;
  const originalPointer = beforeBaseline.pointer;
  const payload = vaaQaG6CFaultDomainPayload_();
  const response = vaaQaG4Invoke_(payload);
  const key = API_CONFIG.REQUEST_PROPERTY_PREFIX +
    VAA_QA_G6C_CONFIG_.createRequestId;
  const raw = props.getProperty(key);
  let rec = null;
  if (raw) {
    try { rec = JSON.parse(raw); } catch (_) {}
  }
  const receiptReady = !!rec &&
    rec.requestId === VAA_QA_G6C_CONFIG_.createRequestId &&
    rec.operationMode === 'CREATE' &&
    rec.status === 'READY' && rec.stage === 'READY' &&
    !!rec.spreadsheetId &&
    rec.outputFolderId === VAA_QA_G4_CONFIG_.testOutputId;
  const responseMatchesReceipt = !!response && !!rec &&
    response.spreadsheetId === rec.spreadsheetId &&
    response.requestId === rec.requestId;
  let verified = null;
  let verificationCode = receiptReady ? 'WORKBOOK_OR_DATASTORE_UNVERIFIED' :
    'RECEIPT_NOT_READY';
  if (response && response.ok && response.status === 'READY' &&
      receiptReady && responseMatchesReceipt) {
    try {
      verified = vaaQaG6DVerifyWorkbookReadOnly_(
        rec.spreadsheetId, originalId, originalPointer
      );
      verificationCode = 'OK';
    } catch (err) {
      verificationCode = String(err && err.code ||
        'WORKBOOK_OR_DATASTORE_UNVERIFIED');
    }
  }

  const unchangedHistory = vaaQaG6DHistoryEqual_(
    beforeHistory, vaaQaG6DHistorySnapshot_(props)
  );
  const finalBaseline = vaaQaG5ReplaceReadyGateReadOnly_();
  const originalDataStoreStable = finalBaseline.targetId === originalId &&
    finalBaseline.pointer === originalPointer;
  const out = {
    phase: 'G6_FAULT_DOMAIN_CREATE_ONCE',
    ok: !!response && response.ok === true,
    status: String(response && response.status || ''),
    stage: String(response && response.stage || ''),
    code: String(response && response.code || ''),
    reused: !!response && response.reused === true,
    requestIdMatched: !!response &&
      response.requestId === VAA_QA_G6C_CONFIG_.createRequestId,
    receiptReady: receiptReady,
    responseMatchesReceipt: responseMatchesReceipt,
    sameTestOutput: !!verified && verified.targetInTestOutput,
    differentWorkbookFromG4G5:
      !!verified && verified.differentWorkbookFromG4G5,
    differentDataStorePointer:
      !!verified && verified.differentDataStorePointer,
    dataStoreInTestRoot: !!verified && verified.dataStoreInTestRoot,
    dataStoreMatchesSynthetic:
      !!verified && verified.dataStoreMatchesSynthetic,
    actualApplications: verified ? verified.actualApplications : null,
    actualJobs: verified ? verified.actualJobs : null,
    verificationCode: verificationCode,
    historicalReceiptsUnchanged: unchangedHistory,
    originalDataStoreStable: originalDataStoreStable,
    testOutputOnly: true,
    actualFailureInjected: false
  };
  out.pass = !!(
    out.ok && out.status === 'READY' && out.stage === 'READY' &&
    !out.reused && out.requestIdMatched &&
    out.receiptReady && out.responseMatchesReceipt &&
    out.sameTestOutput && out.differentWorkbookFromG4G5 &&
    out.differentDataStorePointer &&
    out.dataStoreInTestRoot && out.dataStoreMatchesSynthetic &&
    out.actualApplications === 1 && out.actualJobs === 1 &&
    out.historicalReceiptsUnchanged && out.originalDataStoreStable
  );
  console.log('VAA_QA_G6_FAULT_DOMAIN_CREATE ' + JSON.stringify(out));
  return out;
}
