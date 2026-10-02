function handleManageAuthCheck_(payload) {
  const validation =
    validateManageAuth_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const pagesVersion =
    normalizeString_(
      payload.pagesVersion
    );

  if (
    pagesVersion !==
      API_CONFIG.EXPECTED_PAGES_VERSION
  ) {
    return errorOutput_(
      'PAGES_VERSION_MISMATCH',
      'ETL Pagesと中央APIのバージョンが一致しません.'
    );
  }

  return jsonOutput_({
    ok: true,
    action:
      'MANAGE_AUTH_CHECK',
    schemaVersion:
      API_CONFIG.DEFAULT_SCHEMA_VERSION,
    apiVersion:
      API_CONFIG.DEFAULT_APP_VERSION,
    pagesVersion:
      API_CONFIG.EXPECTED_PAGES_VERSION,
    outputFolderId:
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
    timestamp:
      new Date()
        .toISOString()
  });
}

function handleManageListOutputFolders_(payload) {
  const validation =
    validateManageAuth_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const pagesVersion =
    normalizeString_(
      payload.pagesVersion
    );

  if (
    pagesVersion !==
      API_CONFIG.EXPECTED_PAGES_VERSION
  ) {
    return errorOutput_(
      'PAGES_VERSION_MISMATCH',
      'ETL Pagesと中央APIのバージョンが一致しません.'
    );
  }

  const startedAt = Date.now();

  try {
    return jsonOutput_({
      ok: true,
      action:
        'MANAGE_LIST_OUTPUT_FOLDERS',
      outputFolderId:
        API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
      outputFolders:
        listManagedOutputFolders_(),
      apiVersion:
        API_CONFIG.DEFAULT_APP_VERSION,
      elapsedMs:
        Date.now() - startedAt,
      timestamp:
        new Date().toISOString()
    });
  } catch (err) {
    return errorOutput_(
      'OUTPUT_FOLDER_LIST_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() - startedAt
      }
    );
  }
}

function handleManageDiagnostics_(payload) {
  const startedAt =
    Date.now();

  const validation =
    validateManageAuth_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  try {
    const result =
      runSystemDiagnostics_(
        payload
      );

    return jsonOutput_({
      ok: true,
      action:
        'MANAGE_DIAGNOSTICS',
      diagnostics:
        result,
      apiVersion:
        API_CONFIG.DEFAULT_APP_VERSION,
      elapsedMs:
        Date.now() -
        startedAt
    });

  } catch (err) {
    return errorOutput_(
      'MANAGE_DIAGNOSTICS_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() -
          startedAt
      }
    );
  }
}

function handleManageListReports_(payload) {
  const startedAt =
    Date.now();

  const validation =
    validateManageAuth_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  try {
    const reports =
      listRegisteredReports_();

    return jsonOutput_({
      ok: true,
      action:
        'MANAGE_LIST_REPORTS',
      reports,
      count:
        reports.length,
      summary:
        summarizeRegisteredReports_(
          reports,
          30
        ),
      outputFolderId:
        API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
      outputFolderUrl:
        'https://drive.google.com/drive/folders/' +
        API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
      apiVersion:
        API_CONFIG.DEFAULT_APP_VERSION,
      elapsedMs:
        Date.now() -
        startedAt
    });

  } catch (err) {
    return errorOutput_(
      'MANAGE_LIST_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() -
          startedAt
      }
    );
  }
}

function handleManageIdentity_(payload) {
  const startedAt = Date.now();

  const validation =
    validateManageEnvelope_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  try {
    const ss =
      openManagedWorkbook_(
        payload
      );

    return jsonOutput_({
      ok: true,
      action: 'MANAGE_IDENTITY',
      metadata: {
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
        fileName: ss.getName(),
        enterpriseLabel:
          reportEnterpriseLabel_(ss)
      },
      elapsedMs:
        Date.now() - startedAt
    });

  } catch (err) {
    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'MANAGE_IDENTITY_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() - startedAt
      }
    );
  }
}

function createManageLoadTimingTrace_(enabled) {
  return enabled
    ? {
        steps: []
      }
    : null;
}

function recordManageLoadTiming_(trace, name, startedAt) {
  if (!trace) return;

  trace.steps.push({
    name:
      normalizeString_(name),
    ms:
      Math.max(
        0,
        Date.now() -
        Number(startedAt || Date.now())
      )
  });
}

function runManageLoadTimingStep_(trace, name, fn) {
  if (!trace) {
    return fn();
  }

  const stepStartedAt =
    Date.now();

  try {
    return fn();
  } finally {
    recordManageLoadTiming_(
      trace,
      name,
      stepStartedAt
    );
  }
}

function finalizeManageLoadTiming_(trace, totalMs) {
  if (!trace) return null;

  const steps =
    Array.isArray(trace.steps)
      ? trace.steps.slice()
      : [];

  const measuredMs =
    steps.reduce(
      (sum, step) =>
        sum +
        Number(step && step.ms || 0),
      0
    );

  return {
    totalMs:
      Math.max(
        0,
        Number(totalMs || 0)
      ),
    measuredMs,
    unclassifiedMs:
      Math.max(
        0,
        Number(totalMs || 0) -
        measuredMs
      ),
    steps
  };
}

function handleManageSharingLoad_(payload) {
  const startedAt = Date.now();
  const debugTimingEnabled =
    !!(
      payload &&
      (
        payload.debugTiming === true ||
        String(payload.debugTiming || '') === '1'
      )
    );
  const timingTrace =
    createManageLoadTimingTrace_(
      debugTimingEnabled
    );

  const validationStartedAt =
    Date.now();
  const validation =
    validateManageEnvelope_(
      payload
    );
  recordManageLoadTiming_(
    timingTrace,
    'validateEnvelope',
    validationStartedAt
  );

  if (!validation.ok) {
    const elapsedMs =
      Date.now() - startedAt;
    const extra = {
      elapsedMs
    };

    if (timingTrace) {
      extra.debugTiming =
        finalizeManageLoadTiming_(
          timingTrace,
          elapsedMs
        );
    }

    return errorOutput_(
      validation.code,
      validation.message,
      extra
    );
  }

  try {
    const openContext = {};
    const ss =
      openManagedWorkbook_(
        payload,
        timingTrace,
        openContext
      );

    const state =
      buildManagedSharingState_(
        ss,
        openContext.stateData,
        timingTrace
      );

    const elapsedMs =
      Date.now() - startedAt;
    const response =
      Object.assign(
        {
          ok: true,
          action: 'MANAGE_SHARING_LOAD',
          elapsedMs
        },
        state
      );

    if (timingTrace) {
      response.debugTiming =
        finalizeManageLoadTiming_(
          timingTrace,
          elapsedMs
        );
    }

    return jsonOutput_(
      response
    );

  } catch (err) {
    const elapsedMs =
      Date.now() - startedAt;
    const extra = {
      elapsedMs
    };

    if (timingTrace) {
      extra.debugTiming =
        finalizeManageLoadTiming_(
          timingTrace,
          elapsedMs
        );
    }

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'MANAGE_SHARING_LOAD_ERROR',
      safeErrorMessage_(err),
      extra
    );
  }
}

function buildManagedSharingState_(
  ss,
  existingStateData,
  timingTrace
) {
  const stateData =
    existingStateData ||
    runManageLoadTimingStep_(
      timingTrace,
      'sharingStateRead',
      () =>
        rptReadStateData_(
          ss
        )
    );

  const stateMap =
    stateData &&
    stateData.map
      ? stateData.map
      : {};

  const enterpriseLabel =
    runManageLoadTimingStep_(
      timingTrace,
      'enterpriseLabel',
      () =>
        reportEnterpriseLabel_(
          ss
        )
    );

  const fileName =
    runManageLoadTimingStep_(
      timingTrace,
      'sharingFileName',
      () =>
        ss.getName()
    );

  const metadata =
    runManageLoadTimingStep_(
      timingTrace,
      'sharingStateMetadata',
      () => {
        const enabledRaw =
          normalizeString_(
            stateMap.viewerEnabled
          ).toUpperCase();
        const viewerEnabled =
          !(
            enabledRaw === 'FALSE' ||
            enabledRaw === '0' ||
            enabledRaw === 'NO' ||
            enabledRaw === 'OFF'
          );
        const viewerBaseUrl =
          normalizeString_(
            stateMap.viewerBaseUrl
          );
        const viewerToken =
          normalizeString_(
            stateMap.viewerToken
          );
        const viewerUrl =
          viewerBaseUrl && viewerToken
            ? (
                viewerBaseUrl +
                '#r=' +
                encodeURIComponent(
                  viewerToken
                )
              )
            : '';
        const tz =
          ss.getSpreadsheetTimeZone() ||
          Session.getScriptTimeZone();

        return {
          spreadsheetId:
            ss.getId(),
          spreadsheetUrl:
            ss.getUrl(),
          fileName,
          enterpriseLabel,
          viewerUrl,
          viewerEnabled,
          viewerShareStatus:
            normalizeViewerShareStatus_(
              stateMap.viewerShareStatus
            ),
          lastViewerStatusChangedAt:
            viewerJsonCell_(
              stateMap[
                '最終分析レポート状態変更日時'
              ],
              tz
            ),
          lastViewerUrlRotatedAt:
            viewerJsonCell_(
              stateMap[
                '最終分析レポートURL再発行日時'
              ],
              tz
            ),
          lastDataUpdateAt:
            viewerJsonCell_(
              stateMap[
                '最終データ更新日時'
              ],
              tz
            ),
          apiVersion:
            API_CONFIG.DEFAULT_APP_VERSION
        };
      }
    );

  return {
    metadata
  };
}

function handleManageLoad_(payload) {
  const startedAt = Date.now();
  const debugTimingEnabled =
    !!(
      payload &&
      (
        payload.debugTiming === true ||
        String(payload.debugTiming || '') === '1'
      )
    );
  const timingTrace =
    createManageLoadTimingTrace_(
      debugTimingEnabled
    );

  const validationStartedAt =
    Date.now();
  const validation =
    validateManageEnvelope_(
      payload
    );
  recordManageLoadTiming_(
    timingTrace,
    'validateEnvelope',
    validationStartedAt
  );

  if (!validation.ok) {
    const elapsedMs =
      Date.now() -
      startedAt;
    const extra = {
      elapsedMs
    };

    if (timingTrace) {
      extra.debugTiming =
        finalizeManageLoadTiming_(
          timingTrace,
          elapsedMs
        );
    }

    return errorOutput_(
      validation.code,
      validation.message,
      extra
    );
  }

  try {
    const ss =
      openManagedWorkbook_(
        payload,
        timingTrace
      );

    const state =
      buildManagedState_(
        ss,
        timingTrace
      );

    const elapsedMs =
      Date.now() -
      startedAt;
    const response =
      Object.assign(
        {
          ok: true,
          action: 'MANAGE_LOAD',
          elapsedMs
        },
        state
      );

    if (timingTrace) {
      response.debugTiming =
        finalizeManageLoadTiming_(
          timingTrace,
          elapsedMs
        );
    }

    return jsonOutput_(
      response
    );

  } catch (err) {
    const elapsedMs =
      Date.now() -
      startedAt;
    const extra = {
      elapsedMs
    };

    if (timingTrace) {
      extra.debugTiming =
        finalizeManageLoadTiming_(
          timingTrace,
          elapsedMs
        );
    }

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'MANAGE_LOAD_ERROR',
      safeErrorMessage_(err),
      extra
    );
  }
}

function handleManageRetryImages_(payload) {
  const startedAt =
    Date.now();

  const validation =
    validateManageEnvelope_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const lock =
    LockService
      .getScriptLock();

  try {
    lock.waitLock(20000);

    const ss =
      openManagedWorkbook_(
        payload
      );

    const result =
      rptRetryMissingImageUrls_(
        ss
      );

    appendAuditEvent_(
      ss,
      'IMAGE_RETRY',
      result.ok
        ? 'SUCCESS'
        : 'ERROR',
      'MANAGE_PAGES',
      result.message || '',
      ''
    );

    SpreadsheetApp.flush();

    return jsonOutput_(
      Object.assign(
        {
          ok:
            !!result.ok,
          action:
            'MANAGE_RETRY_IMAGES',
          imageRetry:
            result,
          message:
            result.message ||
            '画像URL再取得を完了しました。',
          elapsedMs:
            Date.now() -
            startedAt
        },
        buildManagedState_(ss)
      )
    );

  } catch (err) {
auditManageErrorSafe_(
  payload,
  'IMAGE_RETRY',
  err
);

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'IMAGE_RETRY_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() -
          startedAt
      }
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function managedViewerMutationMetadata_(ss, info, viewerEnabledOverride) {
  const metadata = {};

  try {
    metadata.spreadsheetId = ss.getId();
  } catch (e) {}

  try {
    metadata.spreadsheetUrl = ss.getUrl();
  } catch (e) {}

  try {
    metadata.fileName = ss.getName();
  } catch (e) {}

  try {
    metadata.enterpriseLabel =
      reportEnterpriseLabel_(ss);
  } catch (e) {}

  try {
    metadata.viewerUrl =
      buildManagedViewerUrl_(ss);
  } catch (e) {
    metadata.viewerUrl =
      normalizeString_(
        info && info.viewerUrl
      );
  }

  if (
    typeof viewerEnabledOverride ===
      'boolean'
  ) {
    metadata.viewerEnabled =
      viewerEnabledOverride;
  } else if (
    info &&
    typeof info.viewerEnabled ===
      'boolean'
  ) {
    metadata.viewerEnabled =
      info.viewerEnabled;
  } else {
    try {
      metadata.viewerEnabled =
        managedViewerEnabled_(ss);
    } catch (e) {
      metadata.viewerEnabled = true;
    }
  }

  return metadata;
}

function runManagePostCommitBestEffort_(ss, task, warnings, label) {
  try {
    task();
    return true;
  } catch (err) {
    if (Array.isArray(warnings)) {
      warnings.push(
        label + ': ' + safeErrorMessage_(err)
      );
    }
    return false;
  }
}

function handleManageViewerSetEnabled_(payload) {
  const startedAt = Date.now();

  const validation =
    validateManageEnvelope_(payload);

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const lock =
    LockService.getScriptLock();

  try {
    lock.waitLock(20000);

    const ss =
      openManagedWorkbook_(payload);

    const enabled =
      payload.viewerEnabled === true ||
      normalizeString_(
        payload.viewerEnabled
      ).toUpperCase() === 'TRUE';

    // 先に閲覧状態そのものを確定する。
    // 以降のPortal/Registry/Audit同期は付帯処理とし、
    // そこで失敗しても「変更済みなのにAPIエラー」にしない。
    rptSetStateValue_(
      ss,
      'viewerEnabled',
      enabled ? 'TRUE' : 'FALSE'
    );

    rptSetStateValue_(
      ss,
      '最終分析レポート状態変更日時',
      new Date()
    );

    SpreadsheetApp.flush();

    const warnings = [];
    const props =
      PropertiesService
        .getScriptProperties();
    let info = null;

    runManagePostCommitBestEffort_(
      ss,
      function() {
        info = ensureViewerAccess_(
          ss,
          props,
          payload.viewerBaseUrl,
          payload.manageBaseUrl
        );
      },
      warnings,
      'VIEWER_SYNC'
    );

    runManagePostCommitBestEffort_(
      ss,
      function() {
        appendAuditEvent_(
          ss,
          enabled
            ? 'VIEWER_RESUME'
            : 'VIEWER_STOP',
          'SUCCESS',
          'MANAGE_PAGES',
          enabled
            ? '分析レポート閲覧を再開'
            : '分析レポート閲覧を停止',
          ''
        );
      },
      warnings,
      'AUDIT'
    );

    runManagePostCommitBestEffort_(
      ss,
      function() {
        upsertReportRegistry_(ss);
      },
      warnings,
      'REGISTRY'
    );

    return jsonOutput_({
      ok: true,
      action:
        'MANAGE_VIEWER_SET_ENABLED',
      viewerEnabled: enabled,
      mutationCommitted: true,
      metadata:
        managedViewerMutationMetadata_(
          ss,
          info,
          enabled
        ),
      warnings,
      message:
        enabled
          ? '分析レポートの閲覧を再開しました。'
          : '分析レポートの閲覧を停止しました。',
      elapsedMs:
        Date.now() - startedAt
    });

  } catch (err) {
    auditManageErrorSafe_(
      payload,
      'VIEWER_ACCESS',
      err
    );

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'VIEWER_ACCESS_UPDATE_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() - startedAt
      }
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function handleManageViewerRotate_(payload) {
  const startedAt = Date.now();

  const validation =
    validateManageEnvelope_(payload);

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const lock =
    LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    const ss =
      openManagedWorkbook_(payload);

    const props =
      PropertiesService
        .getScriptProperties();

    const state =
      ss.getSheetByName(
        '99_内部状態'
      );

    const oldToken =
      normalizeString_(
        getStateValueForValidation_(
          state,
          'viewerToken'
        )
      );

    const newToken =
      generateViewerToken_();
    const newPropertyKey =
      viewerPropertyKey_(newToken);
    let info = null;

    // 新URLを先に有効化し、その成功後に旧URLを無効化する。
    // 途中失敗時は旧tokenへ戻し、旧URLを維持する。
    try {
      rptSetStateValue_(
        ss,
        'viewerToken',
        newToken
      );

      rptSetStateValue_(
        ss,
        '最終分析レポートURL再発行日時',
        new Date()
      );

      SpreadsheetApp.flush();

      info = ensureViewerAccess_(
        ss,
        props,
        payload.viewerBaseUrl,
        payload.manageBaseUrl
      );

      const reshareRequired =
        markViewerReshareRequired_(
          ss,
          '分析レポート共有URLを再発行したため'
        );

      SpreadsheetApp.flush();

      if (
        oldToken &&
        oldToken !== newToken
      ) {
        props.deleteProperty(
          viewerPropertyKey_(oldToken)
        );
      }

      if (reshareRequired) {
        try {
          appendAuditEvent_(
            ss,
            'VIEWER_RESHARE_REQUIRED',
            'SUCCESS',
            'MANAGE_PAGES',
            '分析レポート共有URL再発行のため再共有が必要',
            ''
          );
        } catch (e) {}
      }
    } catch (rotateError) {
      try {
        rptSetStateValue_(
          ss,
          'viewerToken',
          oldToken
        );
        props.deleteProperty(
          newPropertyKey
        );
        SpreadsheetApp.flush();

        if (oldToken) {
          try {
            ensureViewerAccess_(
              ss,
              props,
              payload.viewerBaseUrl,
              payload.manageBaseUrl
            );
          } catch (e) {}
        }
      } catch (rollbackError) {}

      throw rotateError;
    }

    // ここまで到達した時点で、新URLは有効・旧URLは無効。
    // 以降の監査/Registry更新失敗は成功結果を覆さない。
    const warnings = [];

    runManagePostCommitBestEffort_(
      ss,
      function() {
        appendAuditEvent_(
          ss,
          'VIEWER_ROTATE',
          'SUCCESS',
          'MANAGE_PAGES',
          '分析レポート共有URLを再発行',
          ''
        );
      },
      warnings,
      'AUDIT'
    );

    runManagePostCommitBestEffort_(
      ss,
      function() {
        upsertReportRegistry_(ss);
      },
      warnings,
      'REGISTRY'
    );

    const metadata =
      managedViewerMutationMetadata_(
        ss,
        info
      );

    return jsonOutput_({
      ok: true,
      action:
        'MANAGE_VIEWER_ROTATE',
      viewerEnabled:
        metadata.viewerEnabled,
      mutationCommitted: true,
      metadata,
      warnings,
      message:
        '分析レポートの共有URLを再発行しました。以前のURLは無効です。',
      elapsedMs:
        Date.now() - startedAt
    });

  } catch (err) {
    auditManageErrorSafe_(
      payload,
      'VIEWER_ROTATE',
      err
    );

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'VIEWER_ROTATE_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() - startedAt
      }
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function handleManageViewerSetShareStatus_(payload) {
  const startedAt =
    Date.now();

  const validation =
    validateManageEnvelope_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const lock =
    LockService
      .getScriptLock();

  try {
    lock.waitLock(20000);

    const ss =
      openManagedWorkbook_(
        payload
      );

    const requested =
      normalizeString_(
        payload.shareStatus
      ).toUpperCase();

    const status =
      requested === 'SHARED'
        ? 'SHARED'
        : 'UNSHARED';

    setViewerShareStatus_(
      ss,
      status
    );

    appendAuditEvent_(
      ss,
      status === 'SHARED'
        ? 'VIEWER_MARK_SHARED'
        : 'VIEWER_MARK_UNSHARED',
      'SUCCESS',
      'MANAGE_PAGES',
      status === 'SHARED'
        ? '分析レポートを共有済みとして記録'
        : '分析レポートを未共有へ戻す',
      ''
    );

    SpreadsheetApp.flush();

    return jsonOutput_(
      Object.assign(
        {
          ok: true,
          action:
            'MANAGE_VIEWER_SET_SHARE_STATUS',
          message:
            status === 'SHARED'
              ? '分析レポートを共有済みとして記録しました。'
              : '分析レポートを未共有へ戻しました。',
          elapsedMs:
            Date.now() -
            startedAt
        },
        buildManagedState_(ss)
      )
    );

  } catch (err) {
    auditManageErrorSafe_(
      payload,
      'VIEWER_SHARE_STATUS',
      err
    );

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'VIEWER_SHARE_STATUS_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() -
          startedAt
      }
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function handleManageSave_(payload) {
  const startedAt = Date.now();

  const validation =
    validateManageEnvelope_(
      payload
    );

  if (!validation.ok) {
    return errorOutput_(
      validation.code,
      validation.message
    );
  }

  const lock =
    LockService
      .getScriptLock();

  try {
    lock.waitLock(20000);

    const ss =
      openManagedWorkbook_(
        payload
      );

    applyManagedSettings_(
      ss,
      payload.settings
    );

    applyManagedKeywords_(
      ss,
      payload.keywordMaster
    );

    applyManagedEnterpriseNames_(
      ss,
      payload.enterpriseMaster
    );

    const renameResult =
      applyManagedReportName_(
        ss,
        payload.reportName
      );

    applyManagedImageOverrides_(
      ss,
      payload.imageMaster
    );

    applyManagedCustomAnalysis_(
      ss,
      payload.customAnalysis
    );

    const props =
      PropertiesService
        .getScriptProperties();

    finalizeDataStoreWorkbook_(
      ss,
      'MANAGE_SAVE'
    );

    ensureViewerAccess_(
      ss,
      props,
      payload.viewerBaseUrl,
      payload.manageBaseUrl
    );

    rptSetStateValue_(
      ss,
      '最終設定保存日時',
      new Date()
    );

    if (
      renameResult &&
      renameResult.changed
    ) {
      appendAuditEvent_(
        ss,
        'REPORT_RENAME',
        'SUCCESS',
        'MANAGE_PAGES',
        renameResult.oldName +
          ' → ' +
          renameResult.newName,
        ''
      );
    }

    appendAuditEvent_(
      ss,
      'SETTINGS_SAVE',
      'SUCCESS',
      'MANAGE_PAGES',
      '集計設定・マスタを保存',
      ''
    );

    SpreadsheetApp.flush();

    return jsonOutput_(
      Object.assign(
        {
          ok: true,
          action: 'MANAGE_SAVE',
          message:
            renameResult &&
            renameResult.changed
              ? 'レポート名を変更し、設定・マスタを保存しました。分析レポートの共有先名と個社一覧にも反映されています。'
              : '設定・マスタを保存しました。分析レポートへ次回読み込みから反映されます。',
          elapsedMs:
            Date.now() -
            startedAt
        },
        buildManagedState_(ss)
      )
    );

  } catch (err) {
auditManageErrorSafe_(
  payload,
  'SETTINGS_SAVE',
  err
);

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'MANAGE_SAVE_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          Date.now() -
          startedAt
      }
    );

  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function validateManageAuth_(payload) {
  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    return invalid_(
      'INVALID_PAYLOAD',
      'payloadがオブジェクトではありません.'
    );
  }

  const props =
    PropertiesService
      .getScriptProperties();

  const expectedSchema =
    props.getProperty(
      'SCHEMA_VERSION'
    ) ||
    API_CONFIG
      .DEFAULT_SCHEMA_VERSION;

  if (
    !schemaVersionsEqual_(
      payload.schemaVersion,
      expectedSchema
    )
  ) {
    return invalid_(
      'SCHEMA_MISMATCH',
      `schemaVersionが一致しません. expected=${expectedSchema}, actual=${normalizeString_(payload.schemaVersion)}`
    );
  }

  const expectedAccessKey =
    requireProperty_(
      props,
      'ACCESS_KEY'
    );

  if (
    normalizeString_(
      payload.accessKey
    ) !== expectedAccessKey
  ) {
    return invalid_(
      'AUTH_INVALID',
      'アクセスキーが正しくありません.'
    );
  }

  return {
    ok: true
  };
}

function validateManageEnvelope_(
  payload
) {
  const auth =
    validateManageAuth_(
      payload
    );

  if (!auth.ok) {
    return auth;
  }

  const spreadsheetId =
    extractSpreadsheetId_(
      payload.targetSpreadsheetUrl ||
      payload.targetSpreadsheetId
    );

  if (!spreadsheetId) {
    return invalid_(
      'TARGET_INVALID',
      '対象の個社管理シートURLを解析できませんでした.'
    );
  }

  return {
    ok: true
  };
}

function openManagedWorkbook_(
  payload,
  timingTrace,
  openContext
) {
  const props =
    PropertiesService
      .getScriptProperties();

  const spreadsheetId =
    extractSpreadsheetId_(
      payload.targetSpreadsheetUrl ||
      payload.targetSpreadsheetId
    );

  const outputFolderId =
    API_CONFIG.SHEET_OUTPUT_FOLDER_ID;

  runManageLoadTimingStep_(
    timingTrace,
    'validateTargetDriveFile',
    () =>
      validateUpdateTargetDriveFile_(
        spreadsheetId,
        outputFolderId
      )
  );

  const ss =
    runManageLoadTimingStep_(
      timingTrace,
      'spreadsheetOpen',
      () =>
        SpreadsheetApp.openById(
          spreadsheetId
        )
    );

  const workbookValidation =
    runManageLoadTimingStep_(
      timingTrace,
      'validateTargetWorkbook',
      () =>
        validateUpdateTargetWorkbook_(
          ss
        )
    );

  if (
    openContext &&
    typeof openContext === 'object'
  ) {
    openContext.stateData =
      workbookValidation &&
      workbookValidation.stateData
        ? workbookValidation.stateData
        : null;
    openContext.storageLayout =
      workbookValidation &&
      workbookValidation.storageLayout
        ? workbookValidation.storageLayout
        : '';
  }

  return ss;
}

function buildManagedState_(ss, timingTrace) {
  const file =
    runManageLoadTimingStep_(
      timingTrace,
      'driveFile',
      () =>
        DriveApp.getFileById(
          ss.getId()
        )
    );

  runManageLoadTimingStep_(
    timingTrace,
    'ensureAuditSheet',
    () =>
      ensureAuditSheet_(
        ss
      )
  );

  const state =
    ss.getSheetByName(
      '99_内部状態'
    );

  const tz =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  const viewerTelemetry =
    runManageLoadTimingStep_(
      timingTrace,
      'viewerTelemetry',
      () =>
        managedViewerTelemetry_(
          ss
        )
    );

  runManageLoadTimingStep_(
    timingTrace,
    'registryUpsert',
    () =>
      upsertReportRegistry_(
        ss
      )
  );

  const enterpriseLabel =
    runManageLoadTimingStep_(
      timingTrace,
      'enterpriseLabel',
      () =>
        reportEnterpriseLabel_(
          ss
        )
    );

  const viewerUrl =
    runManageLoadTimingStep_(
      timingTrace,
      'viewerUrl',
      () =>
        buildManagedViewerUrl_(
          ss
        )
    );

  const viewerStateMetadata =
    runManageLoadTimingStep_(
      timingTrace,
      'viewerStateMetadata',
      () => ({
        storageLayout:
          normalizeString_(
            getStateValueForValidation_(
              state,
              'storageLayout'
            )
          ) ||
          API_CONFIG.CURRENT_STORAGE_LAYOUT,
        viewerShareStatus:
          viewerShareStatus_(ss),
        viewerSharedAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              state,
              'viewerSharedAt'
            ),
            tz
          ),
        viewerSharedReportName:
          normalizeString_(
            getStateValueForValidation_(
              state,
              'viewerSharedReportName'
            )
          ),
        viewerReshareReason:
          normalizeString_(
            getStateValueForValidation_(
              state,
              'viewerReshareReason'
            )
          ),
        viewerReshareRequiredAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              state,
              'viewerReshareRequiredAt'
            ),
            tz
          ),
        viewerEnabled:
          managedViewerEnabled_(ss),
        lastViewerStatusChangedAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              ss.getSheetByName(
                '99_内部状態'
              ),
              '最終分析レポート状態変更日時'
            ),
            ss.getSpreadsheetTimeZone() ||
              Session.getScriptTimeZone()
          ),
        lastViewerUrlRotatedAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              state,
              '最終分析レポートURL再発行日時'
            ),
            tz
          ),
        lastDataUpdateAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              state,
              '最終データ更新日時'
            ),
            tz
          ),
        lastDataUpdateMode:
          normalizeString_(
            getStateValueForValidation_(
              state,
              '最終データ更新モード'
            )
          ),
        lastSettingsSaveAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              state,
              '最終設定保存日時'
            ),
            tz
          ),
        lastImageRetryAt:
          viewerJsonCell_(
            getStateValueForValidation_(
              state,
              '最終画像URL再取得日時'
            ),
            tz
          )
      })
    );

  const applicationCount =
    runManageLoadTimingStep_(
      timingTrace,
      'applicationCount',
      () =>
        analysisDataStoreRowCount_(
          rptReadStateData_(ss).map,
          'applicationData'
        )
    );

  const jobAnalysisCount =
    runManageLoadTimingStep_(
      timingTrace,
      'jobAnalysisCount',
      () =>
        sheetDataRowCount_(
          ss,
          '91_求人分析マスタ'
        )
    );

  const settings =
    runManageLoadTimingStep_(
      timingTrace,
      'settings',
      () =>
        readManagedSettings_(
          ss
        )
    );

  const keywordMaster =
    runManageLoadTimingStep_(
      timingTrace,
      'keywordMaster',
      () =>
        readManagedKeywords_(
          ss
        )
    );

  const enterpriseMaster =
    runManageLoadTimingStep_(
      timingTrace,
      'enterpriseMaster',
      () =>
        readManagedEnterpriseMaster_(
          ss
        )
    );

  const imageMaster =
    runManageLoadTimingStep_(
      timingTrace,
      'imageMaster',
      () =>
        readManagedImageMaster_(
          ss
        )
    );

  const customAnalysis =
    runManageLoadTimingStep_(
      timingTrace,
      'customAnalysis',
      () =>
        readViewerCustomAnalysis_(
          ss
        )
    );

  const displaySettings =
    runManageLoadTimingStep_(
      timingTrace,
      'displaySettings',
      () =>
        readViewerDisplaySettings_(
          ss
        )
    );

  const auditLog =
    runManageLoadTimingStep_(
      timingTrace,
      'auditLog',
      () =>
        readAuditLog_(
          ss,
          20
        )
    );

  return {
    metadata: {
      spreadsheetId:
        ss.getId(),
      spreadsheetUrl:
        ss.getUrl(),
      fileName:
        file.getName(),
      viewerUrl,
      workbookType:
        'VALID_APPLICATION_ANALYSIS',
      schemaVersion:
        API_CONFIG.DEFAULT_SCHEMA_VERSION,
      storageLayout:
        viewerStateMetadata.storageLayout,
      enterpriseLabel,
      viewerShareStatus:
        viewerStateMetadata.viewerShareStatus,
      viewerSharedAt:
        viewerStateMetadata.viewerSharedAt,
      viewerSharedReportName:
        viewerStateMetadata.viewerSharedReportName,
      viewerReshareReason:
        viewerStateMetadata.viewerReshareReason,
      viewerReshareRequiredAt:
        viewerStateMetadata.viewerReshareRequiredAt,
      viewerEnabled:
        viewerStateMetadata.viewerEnabled,
      lastViewerStatusChangedAt:
        viewerStateMetadata.lastViewerStatusChangedAt,
      lastViewerUrlRotatedAt:
        viewerStateMetadata.lastViewerUrlRotatedAt,
      lastViewerAccessAt:
        normalizeString_(
          viewerTelemetry.lastAccessAt
        ),
      viewerAccessCount:
        Number(
          viewerTelemetry.accessCount || 0
        ),
      lastDataUpdateAt:
        viewerStateMetadata.lastDataUpdateAt,
      lastDataUpdateMode:
        viewerStateMetadata.lastDataUpdateMode,
      lastSettingsSaveAt:
        viewerStateMetadata.lastSettingsSaveAt,
      lastImageRetryAt:
        viewerStateMetadata.lastImageRetryAt,
      applicationCount,
      jobAnalysisCount,
      apiVersion:
        API_CONFIG.DEFAULT_APP_VERSION
    },
    settings,
    keywordMaster,
    enterpriseMaster,
    imageMaster,
    customAnalysis,
    displaySettings,
    auditLog
  };
}

function normalizeViewerShareStatus_(value) {
  const text =
    normalizeString_(
      value
    ).toUpperCase();

  if (
    text === 'SHARED' ||
    text === 'RESHARE_REQUIRED'
  ) {
    return text;
  }

  return 'UNSHARED';
}

function viewerShareStatus_(ss) {
  return normalizeViewerShareStatus_(
    getStateValueForValidation_(
      ss.getSheetByName(
        '99_内部状態'
      ),
      'viewerShareStatus'
    )
  );
}

function setViewerShareStatus_(
  ss,
  status
) {
  const normalized =
    normalizeViewerShareStatus_(
      status
    );

  rptSetStateValue_(
    ss,
    'viewerShareStatus',
    normalized
  );

  if (
    normalized === 'SHARED'
  ) {
    rptSetStateValue_(
      ss,
      'viewerSharedAt',
      new Date()
    );

    rptSetStateValue_(
      ss,
      'viewerSharedReportName',
      ss.getName()
    );

    rptSetStateValue_(
      ss,
      'viewerReshareReason',
      ''
    );

    rptSetStateValue_(
      ss,
      'viewerReshareRequiredAt',
      ''
    );

  } else if (
    normalized === 'UNSHARED'
  ) {
    rptSetStateValue_(
      ss,
      'viewerSharedAt',
      ''
    );

    rptSetStateValue_(
      ss,
      'viewerSharedReportName',
      ''
    );

    rptSetStateValue_(
      ss,
      'viewerReshareReason',
      ''
    );

    rptSetStateValue_(
      ss,
      'viewerReshareRequiredAt',
      ''
    );
  }

  rptSetStateValue_(
    ss,
    '最終分析レポート共有状態変更日時',
    new Date()
  );

  return normalized;
}

function markViewerReshareRequired_(
  ss,
  reason
) {
  const current =
    viewerShareStatus_(
      ss
    );

  if (
    current === 'UNSHARED'
  ) {
    return false;
  }

  rptSetStateValue_(
    ss,
    'viewerShareStatus',
    'RESHARE_REQUIRED'
  );

  rptSetStateValue_(
    ss,
    'viewerReshareReason',
    normalizeString_(
      reason
    )
  );

  rptSetStateValue_(
    ss,
    'viewerReshareRequiredAt',
    new Date()
  );

  rptSetStateValue_(
    ss,
    '最終分析レポート共有状態変更日時',
    new Date()
  );

  return true;
}

function managedViewerEnabled_(ss) {
  const raw =
    normalizeString_(
      getStateValueForValidation_(
        ss.getSheetByName(
          '99_内部状態'
        ),
        'viewerEnabled'
      )
    ).toUpperCase();

  return !(
    raw === 'FALSE' ||
    raw === '0' ||
    raw === 'NO' ||
    raw === 'OFF'
  );
}

function buildManagedViewerUrl_(ss) {
  const state =
    ss.getSheetByName(
      '99_内部状態'
    );

  const baseUrl =
    normalizeString_(
      getStateValueForValidation_(
        state,
        'viewerBaseUrl'
      )
    );

  const token =
    normalizeString_(
      getStateValueForValidation_(
        state,
        'viewerToken'
      )
    );

  if (
    !baseUrl ||
    !token
  ) {
    return '';
  }

  return (
    baseUrl +
    '#r=' +
    encodeURIComponent(
      token
    )
  );
}

function readManagedSettings_(ss) {
  const sheet =
    ss.getSheetByName(
      REPORT_SHEETS.INITIAL_SETTINGS
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return [];
  }

  const timeZone =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  const cols =
    Math.min(
      Math.max(
        sheet.getLastColumn(),
        2
      ),
      3
    );

  const values =
    sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      cols
    ).getValues();

  return values
    .map(row => ({
      key:
        normalizeString_(
          row[0]
        ),
      value:
        viewerJsonCell_(
          row[1],
          timeZone
        ),
      description:
        row.length >= 3
          ? normalizeString_(
              row[2]
            )
          : ''
    }))
    .filter(
      row => !!row.key
    );
}

function readManagedKeywords_(ss) {
  const sheet =
    ss.getSheetByName(
      '40_仕事名KWマスタ'
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return [];
  }

  const values =
    sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      1
    ).getValues();

  const result = [];
  const seen = {};

  values.forEach(row => {
    const value =
      normalizeString_(
        row[0]
      );

    if (
      value &&
      !seen[value]
    ) {
      seen[value] = true;
      result.push(value);
    }
  });

  return result;
}

function readManagedEnterpriseMaster_(ss) {
  const sheet =
    ss.getSheetByName(
      '42_企業IDマスタ'
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return [];
  }

  return sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      2
    )
    .getValues()
    .map(row => ({
      enterpriseId:
        normalizeString_(
          row[0]
        ),
      displayName:
        normalizeString_(
          row[1]
        )
    }))
    .filter(
      row =>
        !!row.enterpriseId
    );
}

function readManagedImageMaster_(ss) {
  const sheet =
    ss.getSheetByName(
      '41_画像マスタ'
    );

  if (
    !sheet ||
    sheet.getLastRow() < 1
  ) {
    return [];
  }

  const values =
    sheet.getDataRange()
      .getValues();

  if (!values.length) {
    return [];
  }

  const headers =
    values[0].map(
      normalizeString_
    );

  const index = {};

  headers.forEach(
    (header, i) => {
      index[header] = i;
    }
  );

  function cell(
    row,
    header
  ) {
    const i =
      index[header];

    return i === undefined
      ? ''
      : row[i];
  }

  const timeZone =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  return values
    .slice(1)
    .map(row => ({
      fileName:
        normalizeString_(
          cell(
            row,
            '画像ファイル名'
          )
        ),
      imageUrl:
        normalizeTenichiImageUrl_(
          cell(
            row,
            '画像URL'
          )
        ),
      status:
        normalizeString_(
          cell(
            row,
            '取得状態'
          )
        ),
      referenceJobNumber:
        normalizeString_(
          cell(
            row,
            '参照求人管理番号'
          )
        ),
      method:
        normalizeString_(
          cell(
            row,
            '取得方法'
          )
        ),
      acquiredAt:
        viewerJsonCell_(
          cell(
            row,
            '取得日時'
          ),
          timeZone
        ),
      memo:
        normalizeString_(
          cell(
            row,
            'メモ'
          )
        )
    }))
    .filter(
      row =>
        !!row.fileName
    );
}

function applyManagedSettings_(
  ss,
  incoming
) {
  if (
    !incoming ||
    typeof incoming !== 'object' ||
    Array.isArray(incoming)
  ) {
    return;
  }

  const sheet =
    ss.getSheetByName(
      REPORT_SHEETS.INITIAL_SETTINGS
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return;
  }

  const count =
    sheet.getLastRow() - 1;

  const keys =
    sheet.getRange(
      2,
      1,
      count,
      1
    ).getValues();

  const values =
    sheet.getRange(
      2,
      2,
      count,
      1
    ).getValues();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const key =
      normalizeString_(
        keys[i][0]
      );

    if (
      !key ||
      !Object.prototype
        .hasOwnProperty.call(
          incoming,
          key
        )
    ) {
      continue;
    }

    values[i][0] =
      normalizeManagedSettingValue_(
        key,
        incoming[key]
      );
  }

  sheet.getRange(
    2,
    2,
    count,
    1
  ).setValues(values);
}

function normalizeManagedSettingValue_(
  key,
  value
) {
  if (
    key === '集計開始日' ||
    key === '集計終了日'
  ) {
    return normalizeString_(
      value
    );
  }

  if (
    key ===
      'Indeedタグ表示件数' ||
    key ===
      'TOP画像表示件数'
  ) {
    const text =
      normalizeString_(
        value
      );

    if (
      text === 'すべて' ||
      text.toLowerCase() ===
        'all'
    ) {
      return 'すべて';
    }

    const num =
      Number(text);

    return (
      Number.isFinite(num) &&
      num > 0
    )
      ? Math.floor(num)
      : 50;
  }

  if (
    key.indexOf(
      'ターゲット年齢'
    ) === 0 ||
    /幅$/.test(
      key
    )
  ) {
    if (
      value === '' ||
      value === null ||
      value === undefined
    ) {
      return '';
    }

    const num =
      Number(value);

    return Number.isFinite(num)
      ? num
      : '';
  }

  return sanitizeCell_(
    value
  );
}

function applyManagedKeywords_(
  ss,
  incoming
) {
  if (!Array.isArray(incoming)) {
    return;
  }

  const sheet =
    ss.getSheetByName(
      '40_仕事名KWマスタ'
    );

  if (!sheet) return;

  const result = [];
  const seen = {};

  incoming.forEach(value => {
    const keyword =
      normalizeString_(
        value
      );

    if (
      keyword &&
      !seen[keyword]
    ) {
      seen[keyword] = true;
      result.push(
        sanitizeCell_(
          keyword
        )
      );
    }
  });

  const oldCount =
    Math.max(
      sheet.getLastRow() - 1,
      0
    );

  if (oldCount > 0) {
    sheet.getRange(
      2,
      1,
      oldCount,
      1
    ).clearContent();
  }

  if (result.length) {
    sheet.getRange(
      2,
      1,
      result.length,
      1
    ).setValues(
      result.map(
        value => [value]
      )
    );
  }
}

function applyManagedEnterpriseNames_(
  ss,
  incoming
) {
  if (!Array.isArray(incoming)) {
    return;
  }

  const sheet =
    ss.getSheetByName(
      '42_企業IDマスタ'
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return;
  }

  const byId = {};

  incoming.forEach(row => {
    if (
      !row ||
      typeof row !== 'object'
    ) {
      return;
    }

    const id =
      normalizeString_(
        row.enterpriseId
      );

    if (!id) return;

    byId[id] =
      sanitizeCell_(
        normalizeCompanyDisplayName_(
          row.displayName
        )
      );
  });

  const count =
    sheet.getLastRow() - 1;

  const ids =
    sheet.getRange(
      2,
      1,
      count,
      1
    ).getValues();

  const names =
    sheet.getRange(
      2,
      2,
      count,
      1
    ).getValues();

  for (
    let i = 0;
    i < ids.length;
    i++
  ) {
    const id =
      normalizeString_(
        ids[i][0]
      );

    if (
      id &&
      Object.prototype
        .hasOwnProperty.call(
          byId,
          id
        )
    ) {
      names[i][0] =
        byId[id];
    }
  }

  sheet.getRange(
    2,
    2,
    count,
    1
  ).setValues(names);
}

function applyManagedImageOverrides_(
  ss,
  incoming
) {
  if (!Array.isArray(incoming)) {
    return;
  }

  const sheet =
    ss.getSheetByName(
      '41_画像マスタ'
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return;
  }

  const values =
    sheet.getDataRange()
      .getValues();

  const headers =
    values[0].map(
      normalizeString_
    );

  const index = {};

  headers.forEach(
    (header, i) => {
      index[header] = i;
    }
  );

  const fileIdx =
    index['画像ファイル名'];

  const urlIdx =
    index['画像URL'];

  const statusIdx =
    index['取得状態'];

  const methodIdx =
    index['取得方法'];

  const atIdx =
    index['取得日時'];

  const memoIdx =
    index['メモ'];

  if (
    fileIdx === undefined ||
    urlIdx === undefined
  ) {
    return;
  }

  const byFile = {};

  incoming.forEach(row => {
    if (
      !row ||
      typeof row !== 'object'
    ) {
      return;
    }

    const fileName =
      normalizeString_(
        row.fileName
      );

    if (!fileName) return;

    byFile[fileName] = {
      imageUrl:
        normalizeTenichiImageUrl_(
          row.imageUrl
        ),
      memo:
        normalizeString_(
          row.memo
        )
    };
  });

  for (
    let r = 1;
    r < values.length;
    r++
  ) {
    const fileName =
      normalizeString_(
        values[r][fileIdx]
      );

    const override =
      byFile[fileName];

    if (!override) {
      continue;
    }

    const oldUrl =
      normalizeString_(
        values[r][urlIdx]
      );

    const newUrl =
      override.imageUrl;

    values[r][urlIdx] =
      sanitizeCell_(
        newUrl
      );

    if (
      memoIdx !== undefined
    ) {
      values[r][memoIdx] =
        sanitizeCell_(
          override.memo
        );
    }

    if (oldUrl !== newUrl) {
      if (newUrl) {
        if (
          statusIdx !== undefined
        ) {
          values[r][statusIdx] =
            '手動入力';
        }

        if (
          methodIdx !== undefined
        ) {
          values[r][methodIdx] =
            'manual';
        }

        if (
          atIdx !== undefined
        ) {
          values[r][atIdx] =
            new Date();
        }

      } else {
        if (
          statusIdx !== undefined
        ) {
          values[r][statusIdx] =
            '未取得';
        }

        if (
          methodIdx !== undefined
        ) {
          values[r][methodIdx] =
            '';
        }

        if (
          atIdx !== undefined
        ) {
          values[r][atIdx] =
            '';
        }
      }
    }
  }

  const rowCount =
    values.length - 1;

  function writeColumn_(
    columnIndex
  ) {
    if (
      columnIndex === undefined ||
      rowCount <= 0
    ) {
      return;
    }

    sheet.getRange(
      2,
      columnIndex + 1,
      rowCount,
      1
    ).setValues(
      values
        .slice(1)
        .map(
          row => [
            row[
              columnIndex
            ]
          ]
        )
    );
  }

  writeColumn_(urlIdx);
  writeColumn_(statusIdx);
  writeColumn_(methodIdx);
  writeColumn_(atIdx);
  writeColumn_(memoIdx);
}

function applyManagedCustomAnalysis_(
  ss,
  incoming
) {
  if (
    !incoming ||
    typeof incoming !== 'object'
  ) {
    return;
  }

  const axes =
    managedCustomAxes_(
      ss
    );

  let rowAxis =
    normalizeString_(
      incoming.rowAxis
    );

  let colAxis =
    normalizeString_(
      incoming.colAxis
    );

  if (
    axes.indexOf(
      rowAxis
    ) < 0
  ) {
    rowAxis =
      '対応状況';
  }

  if (
    axes.indexOf(
      colAxis
    ) < 0
  ) {
    colAxis =
      '応募媒体';
  }

  writeCustomAnalysisSettingsSheet_(
    ensureSheet_(
      ss,
      REPORT_SHEETS.CUSTOM_ANALYSIS,
      true
    ),
    {
      rowAxis,
      colAxis
    }
  );
}

function managedCustomAxes_(ss) {
  const axes = [
    '対応状況',
    '応募年月',
    '応募媒体',
    '氏名文字種区分',
    '居住都道府県',
    '企業ID',
    '職種',
    '雇用形態',
    '求人勤務地名称',
    '勤務地都道府県',
    '勤務地・居住都道府県一致',
    '募集背景',
    '月内応募日',
    '応募曜日',
    '応募時間帯',
    '給与区分',
    '時給下限',
    '日給下限',
    '月給下限',
    '年収下限',
    '求人原稿文字数',
    'メイン画像有無',
    '求人画像枚数',
    'TOP画像ファイル名',
    '求人動画有無',
    'Indeed求人タグ数',
    '求人備考1行目'
  ];

  if (
    readManagedKeywords_(
      ss
    ).length
  ) {
    axes.splice(
      11,
      0,
      '仕事名KW',
      '仕事名フルKW'
    );
  }

  return axes;
}
// ============================================================
// DATASTORE_V1 workbook finalization
// ============================================================
