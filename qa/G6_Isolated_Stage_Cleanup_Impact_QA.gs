/**
 * G6-L — retained orphan Stage: TEST-only cleanup impact review (READ ONLY).
 *
 * Execute manually ONLY in the existing isolated TEST Apps Script, AFTER
 * G6-K PASS. This function will NOT trash or move the Stage file, call CAS,
 * write Script Properties/Sheets, create blobs, trigger doPost, or retry.
 *
 * Its reference check is intentionally LIMITED to:
 *   - the two known TEST workbooks' current + backup DataStore pointers;
 *   - all current TEST Script Properties keys/values.
 * Unknown external consumers are NOT scanned or certified absent.
 *
 * The retained Stage must remain intact for a separately reviewed cleanup.
 */
function vaaQaG6LSamePropertySnapshot_(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length &&
    ak.every(function(key, i) {
      return key === bk[i] && a[key] === b[key];
    });
}

function vaaQaG6LCountPropertyReferences_(snapshot, fileId) {
  return Object.keys(snapshot).reduce(function(total, key) {
    return total +
      (key.indexOf(fileId) >= 0 ? 1 : 0) +
      (String(snapshot[key]).indexOf(fileId) >= 0 ? 1 : 0);
  }, 0);
}

function vaaQaG6LReadPointers_(spreadsheetId) {
  const values = rptReadStateData_(
    SpreadsheetApp.openById(spreadsheetId)
  ).map;
  return {
    active: String(values.analysisDataStoreFileId || ''),
    backup: String(values.analysisDataStoreBackupFileId || ''),
    owner: String(values.analysisDataStoreRequestId || '')
  };
}

function vaaQaG6LSamePointers_(a, b) {
  return a.active === b.active &&
    a.backup === b.backup && a.owner === b.owner;
}

/** Public G6-L entry point: no authorization for deletion on PASS. */
function vaaQaG6LStageRetentionImpactReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const propertiesBefore = props.getProperties();
  // G6-K performs TWO independent, complete READ_ONLY Stage audits.
  const prior = vaaQaG6KVerifyUnlinkedStageReadOnly();
  if (!prior.pass || !prior.readyForCleanupDesignReview ||
      prior.stageFileCount !== 1 || prior.actualReadyReceipts !== 4 ||
      prior.stagePreservationDecision !== 'PRESERVE_FOR_NEXT_REVIEW') {
    throw new Error('QA_G6L_G6K_BASELINE_NOT_READY');
  }

  const create = getRequestRecord_(
    props, VAA_QA_G6C_CONFIG_.createRequestId
  );
  const historical = vaaQaG5ReplaceReadyGateReadOnly_();
  if (!create || create.status !== 'READY' ||
      create.operationMode !== 'CREATE' ||
      create.outputFolderId !== VAA_QA_G4_CONFIG_.testOutputId ||
      !create.spreadsheetId ||
      create.spreadsheetId === historical.targetId) {
    throw new Error('QA_G6L_TEST_WORKBOOKS_NOT_INDEPENDENT');
  }
  validateUpdateTargetDriveFile_(
    create.spreadsheetId, VAA_QA_G4_CONFIG_.testOutputId
  );

  const folderId = String(props.getProperty(
    API_CONFIG.ANALYSIS_DATASTORE_FOLDER_PROPERTY
  ) || '');
  if (!folderId) throw new Error('QA_G6L_STAGE_FOLDER_NOT_REGISTERED');
  const folder = DriveApp.getFolderById(folderId);
  if (folder.getName() !== API_CONFIG.ANALYSIS_DATASTORE_FOLDER_NAME ||
      !folderIsDirectChildOf_(folder, VAA_QA_G4_CONFIG_.testRootId)) {
    throw new Error('QA_G6L_STAGE_FOLDER_NOT_ISOLATED');
  }
  const expectedName = vaaQaG6IStageCandidateFileName_(
    create.spreadsheetId
  );
  const iterator = folder.getFilesByName(expectedName);
  let count = 0;
  let file = null;
  while (iterator.hasNext() && count < 2) {
    file = iterator.next();
    count++;
  }
  if (count !== 1 || !file) {
    throw new Error('QA_G6L_STAGE_NOT_UNIQUE');
  }
  const stageId = file.getId();
  if (!stageId) throw new Error('QA_G6L_STAGE_ID_MISSING');

  // Check exact parent cardinality. G6-K already verified TEST membership,
  // but this checks there is no additional parent visible in DriveApp.
  const parents = file.getParents();
  let parentCount = 0;
  let parentsAllMatchTest = true;
  while (parents.hasNext() && parentCount < 2) {
    const parent = parents.next();
    parentCount++;
    if (parent.getId() !== folderId) parentsAllMatchTest = false;
  }
  const exactSingleTestParent =
    parentCount === 1 && parentsAllMatchTest &&
    folderIsDirectChildOf_(file, folderId);
  const stageNonempty = Number(file.getSize()) > 0;
  const stageFileNameMatched = file.getName() === expectedName;

  // No file modifications: reread only TWO known protected TEST workbooks.
  const oldBefore = vaaQaG6LReadPointers_(historical.targetId);
  const isolatedBefore = vaaQaG6LReadPointers_(
    create.spreadsheetId
  );
  const stageReferencedByKnownPointers = [
    oldBefore.active, oldBefore.backup,
    isolatedBefore.active, isolatedBefore.backup
  ].some(function(id) { return id === stageId; });
  const activeOwnersAsExpected =
    oldBefore.active === historical.pointer &&
    isolatedBefore.owner === VAA_QA_G6C_CONFIG_.createRequestId &&
    isolatedBefore.active &&
    isolatedBefore.active !== oldBefore.active &&
    isolatedBefore.active !== stageId;

  // Includes all current TEST Script Properties keys/values; the output
  // contains only counts, not IDs, keys, values or stored request records.
  const propertyStageReferenceCount = vaaQaG6LCountPropertyReferences_(
    propertiesBefore, stageId
  );
  const currentLeaseExists = !!props.getProperty(
    vaaTargetUpdateLeaseKey_(create.spreadsheetId)
  );
  const reservedUpdateReceiptExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6E_UPDATE_REQUEST_ID_
  );
  const stageReceiptExists = !!props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
      VAA_QA_G6I_STAGE_ONLY_REQUEST_ID_
  );
  const oldAfter = vaaQaG6LReadPointers_(historical.targetId);
  const isolatedAfter = vaaQaG6LReadPointers_(
    create.spreadsheetId
  );
  const knownPointersStable = vaaQaG6LSamePointers_(
    oldBefore, oldAfter
  ) && vaaQaG6LSamePointers_(isolatedBefore, isolatedAfter);
  const propertiesAfter = props.getProperties();
  const propertiesStable = vaaQaG6LSamePropertySnapshot_(
    propertiesBefore, propertiesAfter
  );

  const out = {
    phase: 'G6_STAGE_CLEANUP_IMPACT_READ_ONLY',
    strictReadOnly: true,
    priorStageForensicsPass: prior.pass === true,
    actualReadyReceipts: prior.actualReadyReceipts,
    exactlyOneStageFile: count === 1,
    stageNameMatched: stageFileNameMatched,
    exactSingleTestParent: exactSingleTestParent,
    stageFileNonempty: stageNonempty,
    stageUnlinkedInPriorAudit: prior.stageIsUnlinked === true,
    stageReferencedByKnownWorkbookPointers:
      stageReferencedByKnownPointers,
    propertyStageReferenceCount: propertyStageReferenceCount,
    knownWorkbookActivePointersExpected: !!activeOwnersAsExpected,
    knownWorkbookPointersStable: knownPointersStable,
    scriptPropertiesStable: propertiesStable,
    stageRequestReceiptExists: stageReceiptExists,
    reservedUpdateReceiptExists: reservedUpdateReceiptExists,
    targetUpdateLeaseExists: currentLeaseExists,
    externalReferenceScopeFullyAudited: false,
    retentionDecision: 'PRESERVE_PENDING_FINAL_CLEANUP_REVIEW',
    readyForSingleFileCleanupDesignReview: false,
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
  out.readyForSingleFileCleanupDesignReview = !!(
    out.priorStageForensicsPass &&
    out.actualReadyReceipts === 4 &&
    out.exactlyOneStageFile && out.stageNameMatched &&
    out.exactSingleTestParent && out.stageFileNonempty &&
    out.stageUnlinkedInPriorAudit &&
    !stageReferencedByKnownPointers &&
    propertyStageReferenceCount === 0 &&
    out.knownWorkbookActivePointersExpected &&
    knownPointersStable && propertiesStable &&
    !stageReceiptExists && !reservedUpdateReceiptExists &&
    !currentLeaseExists
  );
  out.pass = out.readyForSingleFileCleanupDesignReview;
  // Never emit the Stage ID, filenames, folder, property keys or values.
  console.log('VAA_QA_G6_STAGE_CLEANUP_IMPACT ' + JSON.stringify(out));
  return out;
}
