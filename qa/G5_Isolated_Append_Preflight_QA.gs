/**
 * G5-A isolated TEST-only APPEND preflight (read-only).
 * Copy as NEW file to the isolated TEST Apps Script, alongside G4 QA file.
 * Never add to production central-api/*.gs. No CREATE / UPDATE here.
 *
 * Dependency: G4_Isolated_Create_Replay_QA.gs previously installed in TEST.
 */
const VAA_QA_G5_APPEND_REQUEST_ID_ = 'QA_G5_SYNTHETIC_APPEND_20261118_V1';

function vaaQaG5AppendPayload_(targetId) {
  const payload = vaaQaG4SyntheticPayload_();
  const base = payload.datasets.applicationData;
  const added = base.rows[0].slice();
  function setColumn_(name, value) {
    const index = base.headers.indexOf(name);
    if (index < 0) throw new Error('QA_G5_FIXTURE_COLUMN_MISSING');
    added[index] = value;
  }
  setColumn_('レコードID', 'APP000002');
  setColumn_('応募日時', '2026/11/19 12:00');
  setColumn_('応募日', '2026/11/19');
  setColumn_('応募曜日', '木');
  setColumn_('応募識別キー', 'I1:' + Array(65).join('b'));
  base.rows.push(added);
  payload.requestId = VAA_QA_G5_APPEND_REQUEST_ID_;
  payload.action = 'update';
  payload.operationMode = 'update';
  payload.targetSpreadsheetId = targetId;
  payload.updateStrategy = 'APPEND';
  payload.updateProtocol = 'IDENTITY_V1';
  return payload;
}

function vaaQaG5GetReadyG4Receipt_() {
  const props = vaaQaG4IsolatedConfig_();
  const raw = vaaQaG4ReceiptRaw_(props);
  if (!raw) throw new Error('QA_G5_MISSING_G4_RECEIPT');
  let receipt = null;
  try { receipt = JSON.parse(raw); } catch (_) {}
  if (!receipt ||
      receipt.requestId !== VAA_QA_G4_CONFIG_.requestId ||
      receipt.operationMode !== 'CREATE' ||
      receipt.status !== 'READY' ||
      receipt.stage !== 'READY' ||
      !receipt.spreadsheetId) {
    throw new Error('QA_G5_G4_NOT_READY');
  }
  // This is a TEST-only managed output file. No writes.
  validateUpdateTargetDriveFile_(
    receipt.spreadsheetId, VAA_QA_G4_CONFIG_.testOutputId
  );
  return {props: props, receipt: receipt};
}

/** Validate the prior DataStore belongs directly to this TEST root tree. */
function vaaQaG5ReadTestDataStore_(ss) {
  const targetCheck = validateUpdateTargetWorkbook_(ss);
  if (!targetCheck.ok || !targetCheck.stateData || !targetCheck.stateData.map) {
    throw new Error('QA_G5_TARGET_LAYOUT_INVALID');
  }
  const stateMap = targetCheck.stateData.map;
  const dataStoreFileId = String(stateMap.analysisDataStoreFileId || '');
  const props = PropertiesService.getScriptProperties();
  const dataStoreFolderId = String(props.getProperty(
    API_CONFIG.ANALYSIS_DATASTORE_FOLDER_PROPERTY
  ) || '');
  if (!dataStoreFileId || !dataStoreFolderId) {
    throw new Error('QA_G5_DATASTORE_POINTER_MISSING');
  }
  const folder = DriveApp.getFolderById(dataStoreFolderId);
  if (folder.getName() !== API_CONFIG.ANALYSIS_DATASTORE_FOLDER_NAME ||
      !folderIsDirectChildOf_(folder, VAA_QA_G4_CONFIG_.testRootId)) {
    throw new Error('QA_G5_DATASTORE_OUTSIDE_TEST_ROOT');
  }
  const file = DriveApp.getFileById(dataStoreFileId);
  if (!folderIsDirectChildOf_(file, dataStoreFolderId)) {
    throw new Error('QA_G5_DATASTORE_FILE_OUTSIDE_TEST_ROOT');
  }
  const read = readAnalysisDataStore_(ss, stateMap);
  if (!read.ok) throw new Error('QA_G5_DATASTORE_NOT_READABLE_' + read.status);
  return read.datasets;
}

function vaaQaG5AppendPreflightReadOnly() {
  const base = vaaQaG5GetReadyG4Receipt_();
  const props = base.props;
  const targetId = base.receipt.spreadsheetId;
  const target = SpreadsheetApp.openById(targetId);
  const existing = vaaQaG5ReadTestDataStore_(target);
  const payload = vaaQaG5AppendPayload_(targetId);
  const validate = validateEnvelope_(payload);
  const protocol = vaaValidateUpdateProtocol_(payload);
  const capacity = vaaCheckNewRequestCapacityReadOnly_(props);
  const recordExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G5_APPEND_REQUEST_ID_
  );
  const leaseExists = !!props.getProperty(vaaTargetUpdateLeaseKey_(targetId));
  let planOk = false;
  let stats = null;
  let planCode = '';
  const original = vaaQaG4SyntheticPayload_().datasets;
  const initialRowsMatch = (
    existing.applicationData &&
    existing.jobAnalysisMaster &&
    existing.applicationData.rows.length === 1 &&
    existing.jobAnalysisMaster.rows.length === 1 &&
    JSON.stringify(existing.applicationData) ===
      JSON.stringify(VAAAppendMergeCore.merge({
        mode:'REPLACE',incoming:original,
        maxRows:API_CONFIG.MAX_DATASET_ROWS
      }).applicationData) &&
    JSON.stringify(existing.jobAnalysisMaster) ===
      JSON.stringify(VAAAppendMergeCore.merge({
        mode:'REPLACE',incoming:original,
        maxRows:API_CONFIG.MAX_DATASET_ROWS
      }).jobAnalysisMaster)
  );
  if (initialRowsMatch) {
    try {
      const plan = VAAAppendMergeCore.merge({
        mode: 'APPEND',
        incoming: payload.datasets,
        existing: {
          applicationIdentityVersion: VAAAppendMergeCore.VERSION,
          applicationData: existing.applicationData,
          jobAnalysisMaster: existing.jobAnalysisMaster
        },
        maxRows: API_CONFIG.MAX_DATASET_ROWS
      });
      stats = plan.stats;
      planOk = (
        stats.oldApplications === 1 &&
        stats.uploadedApplications === 2 &&
        stats.skippedAsExisting === 1 &&
        stats.addedApplications === 1 &&
        stats.finalApplications === 2 &&
        stats.oldJobs === 1 &&
        stats.finalJobs === 1
      );
    } catch (err) {
      planCode = String(err && err.code || 'MERGE_ERROR');
    }
  } else {
    planCode = 'BASELINE_MISMATCH';
  }
  const result = {
    phase: 'G5_APPEND_PREFLIGHT_READ_ONLY',
    safeToAppendOnce: !!(
      validate.ok && protocol.ok && capacity.allowed &&
      !recordExists && !leaseExists && initialRowsMatch && planOk
    ),
    payloadValidationCode: validate.ok ? 'OK' : validate.code,
    updateProtocolCode: protocol.ok ? 'OK' : protocol.code,
    budgetAllowed: capacity.allowed,
    requestIdAlreadyExists: recordExists,
    updateLeaseExists: leaseExists,
    targetInTestOutput: true,
    dataStoreInTestRoot: true,
    initialRowsMatch: initialRowsMatch,
    mergePlanCode: planCode || 'OK',
    expectedOldApplications: stats ? stats.oldApplications : null,
    expectedAddedApplications: stats ? stats.addedApplications : null,
    expectedFinalApplications: stats ? stats.finalApplications : null,
    expectedFinalJobs: stats ? stats.finalJobs : null,
    propertiesModified: 0,
    propertiesDeleted: 0,
    workbookModified: false
  };
  // IDs, URLs, keys and raw data are never logged.
  console.log('VAA_QA_G5_APPEND_PREFLIGHT ' + JSON.stringify(result));
  return result;
}
