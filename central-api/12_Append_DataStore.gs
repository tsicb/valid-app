/**
 * Incremental DataStore staging/commit helpers.
 *
 * IMPORTANT: No existing entrypoint invokes these functions yet.
 * Activation must be gated by a fully compatible Pages + GAS protocol.
 * Source-of-truth: docs/APPEND_UPDATE_IMPLEMENTATION_PLAN_V1.md
 */

function vaaAppendStoreError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Pure planning wrapper. Keeps every existing row and record ID in APPEND,
 * and never changes the existing job-master attributes.
 */
function vaaBuildAppendStorePlan_(payload, existingData, strategy) {
  const mode = String(strategy || '').trim().toUpperCase();
  if (mode !== 'APPEND' && mode !== 'REPLACE') {
    throw vaaAppendStoreError_(
      'INVALID_UPDATE_STRATEGY',
      '更新方法が指定されていません。'
    );
  }
  if (!payload || !payload.datasets) {
    throw vaaAppendStoreError_(
      'INVALID_PAYLOAD',
      '更新するデータセットがありません。'
    );
  }

  // Stored DataStore JSON wraps analysis data under `datasets`.
  // The pure merge core deliberately accepts only the two normalized
  // datasets directly; translate at this boundary rather than duplicating
  // storage concerns in the merge algorithm.
  const existing = existingData
    ? {
        applicationIdentityVersion:
          existingData.applicationIdentityVersion,
        applicationData:
          existingData.datasets && existingData.datasets.applicationData,
        jobAnalysisMaster:
          existingData.datasets && existingData.datasets.jobAnalysisMaster
      }
    : null;

  const merge = VAAAppendMergeCore.merge({
    mode: mode,
    existing: existing,
    incoming: payload.datasets,
    maxRows: API_CONFIG.MAX_DATASET_ROWS
  });

  const datasets = Object.assign({}, payload.datasets, {
    applicationData: merge.applicationData,
    jobAnalysisMaster: merge.jobAnalysisMaster
  });

  return {
    strategy: mode,
    applicationIdentityVersion: merge.applicationIdentityVersion,
    datasets: datasets,
    stats: merge.stats,
    // The source payload is never mutated: callers can compare its input rows.
    payload: Object.assign({}, payload, {
      datasets: datasets
    })
  };
}

/** Read the actual linked source, including the identity-version marker. */
function vaaReadAppendStoreSource_(ss) {
  const state = rptReadStateData_(ss);
  const sourceId = normalizeString_(
    state.map.analysisDataStoreFileId
  );
  if (!sourceId) {
    return {
      fileId: '',
      dataObject: null
    };
  }
  const file = DriveApp.getFileById(sourceId);
  const dataObject = JSON.parse(
    file.getBlob().getDataAsString('UTF-8')
  );
  const validation = validateAnalysisDataStoreObject_(
    dataObject,
    ss.getId(),
    normalizeString_(state.map.analysisDataStoreRequestId)
  );
  if (!validation.ok) {
    throw vaaAppendStoreError_(
      'DATASTORE_UNAVAILABLE',
      '更新元の保存データの検証に失敗しました: ' +
        validation.reason
    );
  }
  return {
    fileId: sourceId,
    dataObject: dataObject
  };
}

/**
 * Create and verify a file WITHOUT changing the linked workbook.
 * Caller must retain expectedSourceFileId for the compare-and-swap commit.
 */
function vaaStageAppendDataStore_(ss, plan, requestId, expectedSourceFileId) {
  if (!plan || !plan.payload ||
      String(plan.applicationIdentityVersion) !== VAAAppendMergeCore.VERSION) {
    throw vaaAppendStoreError_(
      'INVALID_APPEND_PLAN',
      '差分統合結果が不正です。'
    );
  }
  const rid = normalizeString_(requestId);
  if (!rid) {
    throw vaaAppendStoreError_('INVALID_REQUEST_ID', 'requestIdがありません。');
  }

  const dataObject = buildAnalysisDataStoreObject_(
    ss, plan.payload, rid
  );
  dataObject.applicationIdentityVersion =
    plan.applicationIdentityVersion;
  dataObject.updateStrategy = plan.strategy;

  const contents = JSON.stringify(dataObject);
  const folder = getOrCreateAnalysisDataStoreFolder_();
  const safeId = rid
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 48) || 'req';
  let newFile = null;

  try {
    newFile = folder.createFile(
      'analysis_data_' + ss.getId() + '_' + safeId + '.json',
      contents,
      MimeType.PLAIN_TEXT
    );
    const verified = JSON.parse(
      newFile.getBlob().getDataAsString('UTF-8')
    );
    const validation = validateAnalysisDataStoreObject_(
      verified, ss.getId(), rid
    );
    if (!validation.ok ||
        String(verified.applicationIdentityVersion) !==
          VAAAppendMergeCore.VERSION ||
        String(verified.updateStrategy) !== plan.strategy ||
        verified.datasets.applicationData.rows.length !==
          plan.stats.finalApplications ||
        verified.datasets.jobAnalysisMaster.rows.length !==
          plan.stats.finalJobs) {
      throw vaaAppendStoreError_(
        'DATASTORE_VERIFY_ERROR',
        '新しい保存データの検証に失敗しました。'
      );
    }

    return {
      fileId: newFile.getId(),
      spreadsheetId: ss.getId(),
      requestId: rid,
      expectedSourceFileId: normalizeString_(expectedSourceFileId),
      chars: contents.length,
      strategy: plan.strategy,
      stats: plan.stats,
      dataStoreVersion: API_CONFIG.ANALYSIS_DATASTORE_VERSION,
      applicationIdentityVersion: VAAAppendMergeCore.VERSION
    };
  } catch (error) {
    if (newFile) {
      try { newFile.setTrashed(true); } catch (_) {}
    }
    throw error;
  }
}

/**
 * Compare-and-swap at the last possible moment, while holding the script
 * lock. The caller can safely retry when an earlier request committed.
 *
 * NOTE: Existing legacy writeAnalysisDataStore_ is not lock-coordinated.
 * Thus this module remains non-operational until the entrypoint gates legacy
 * UPDATE traffic and serializes new update requests as specified in the plan.
 */
function vaaCommitStagedAppendDataStore_(ss, stage) {
  if (!stage ||
      normalizeString_(stage.spreadsheetId) !== ss.getId() ||
      !normalizeString_(stage.fileId) ||
      !normalizeString_(stage.requestId)) {
    throw vaaAppendStoreError_(
      'INVALID_APPEND_STAGE',
      '保存準備データの参照先が不正です。'
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let formerBackupId = '';
  let previousId = '';
  let alreadyCommitted = false;
  try {
    // Fresh read: never reuse the request-local 99-sheet state cache here.
    const state = rptReadStateData_(ss);
    const currentId = normalizeString_(
      state.map.analysisDataStoreFileId
    );
    const currentRequestId = normalizeString_(
      state.map.analysisDataStoreRequestId
    );
    if (currentId === stage.fileId &&
        currentRequestId === stage.requestId) {
      alreadyCommitted = true;
    } else if (currentId !==
               normalizeString_(stage.expectedSourceFileId)) {
      throw vaaAppendStoreError_(
        'DATASTORE_CONFLICT',
        '確認後に別の更新が保存されました。更新画面から再実行してください。'
      );
    } else {
      // The staged blob is already validated. Re-check before the pointer flip.
      const file = DriveApp.getFileById(stage.fileId);
      const body = JSON.parse(
        file.getBlob().getDataAsString('UTF-8')
      );
      const validation = validateAnalysisDataStoreObject_(
        body, ss.getId(), stage.requestId
      );
      if (!validation.ok ||
          String(body.applicationIdentityVersion) !==
            VAAAppendMergeCore.VERSION ||
          String(body.updateStrategy) !== stage.strategy ||
          body.datasets.applicationData.rows.length !==
            stage.stats.finalApplications ||
          body.datasets.jobAnalysisMaster.rows.length !==
            stage.stats.finalJobs) {
        throw vaaAppendStoreError_(
          'DATASTORE_VERIFY_ERROR',
          '確定直前の保存データ検証に失敗しました。'
        );
      }

      previousId = currentId;
      formerBackupId = normalizeString_(
        state.map.analysisDataStoreBackupFileId
      );
      rptSetStateValues_(ss, {
        analysisDataStoreFileId: stage.fileId,
        analysisDataStoreRequestId: stage.requestId,
        analysisDataStoreVersion: stage.dataStoreVersion,
        applicationIdentityVersion: stage.applicationIdentityVersion,
        analysisDataStoreBackupFileId: currentId,
        analysisDataStoreUpdatedAt: new Date(),
        analysisDataStoreChars: stage.chars,
        analysisDataStoreApplicationRows: stage.stats.finalApplications,
        analysisDataStoreJobRows: stage.stats.finalJobs
      }, state);
      SpreadsheetApp.flush();

      const proof = rptReadStateData_(ss);
      if (normalizeString_(proof.map.analysisDataStoreFileId) !==
            stage.fileId ||
          normalizeString_(proof.map.analysisDataStoreRequestId) !==
            stage.requestId) {
        throw vaaAppendStoreError_(
          'DATASTORE_COMMIT_UNCERTAIN',
          '切り替え結果を確認できませんでした。再実行前に保存先を確認してください。'
        );
      }
    }
  } finally {
    lock.releaseLock();
  }

  // No old blob is trashed before a verified pointer change. Keep the
  // immediate predecessor as a one-generation recovery point.
  if (formerBackupId &&
      formerBackupId !== previousId &&
      formerBackupId !== stage.fileId) {
    try {
      DriveApp.getFileById(formerBackupId).setTrashed(true);
    } catch (_) {}
  }

  return {
    ok: true,
    reused: alreadyCommitted,
    fileId: stage.fileId,
    backupFileId: previousId,
    stats: stage.stats
  };
}

/**
 * High-level staged operation. Deliberately NOT called by existing doPost.
 * The future entrypoint must use a separate request-state lifecycle and
 * update job-mirror / audit / Registry from result.plan.datasets/stats.
 */
function vaaExecuteAppendDataStoreUpdate_(ss, payload, requestId, strategy) {
  const source = vaaReadAppendStoreSource_(ss);
  const plan = vaaBuildAppendStorePlan_(
    payload,
    source.dataObject,
    strategy
  );
  const stage = vaaStageAppendDataStore_(
    ss, plan, requestId, source.fileId
  );

  let commit;
  try {
    commit = vaaCommitStagedAppendDataStore_(ss, stage);
  } catch (error) {
    // Never trash an ambiguous, possibly-committed stage.
    if (error.code === 'DATASTORE_CONFLICT') {
      try {
        DriveApp.getFileById(stage.fileId).setTrashed(true);
      } catch (_) {}
    }
    throw error;
  }

  return {
    plan: plan,
    stage: stage,
    commit: commit
  };
}
