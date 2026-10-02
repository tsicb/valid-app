function finalizeDataStoreWorkbook_(
  ss,
  reason,
  options,
  stateContext
) {
  const startedAt =
    Date.now();

  const perf = {};

  const customStartedAt =
    Date.now();

  ensureCustomAnalysisSettings_(
    ss
  );

  perf.customAnalysisEnsureMs =
    perfMs_(
      customStartedAt
    );

  const displayStartedAt =
    Date.now();

  ensureViewerDisplaySettings_(
    ss
  );

  perf.displaySettingsEnsureMs =
    perfMs_(
      displayStartedAt
    );

  const auditStartedAt =
    Date.now();

  const auditSheet =
    ensureAuditSheet_(
      ss
    );

  perf.auditSheetEnsureMs =
    perfMs_(
      auditStartedAt
    );

  const stateReadStartedAt =
    Date.now();

  const stateData =
    rptReadStateData_(
      ss
    );

  perf.stateReadMs =
    perfMs_(
      stateReadStartedAt
    );

  const shareStatus =
    normalizeString_(
      stateData.map.viewerShareStatus
    ) ||
    'UNSHARED';

  const updates = {
    workbookType:
      'VALID_APPLICATION_ANALYSIS',
    schemaVersion:
      API_CONFIG.DEFAULT_SCHEMA_VERSION,
    viewerShareStatus:
      shareStatus,
    状態:
      'READY',
    最終分析レポート更新日時:
      new Date(),
    最終更新経路:
      normalizeString_(reason)
  };

  const opts =
    options &&
    typeof options === 'object'
      ? options
      : {};

  if (
    normalizeString_(
      opts.operationMode
    )
  ) {
    updates['最終データ更新モード'] =
      normalizeString_(
        opts.operationMode
      );

    updates['最終データ更新日時'] =
      new Date();
  }

  if (
    normalizeString_(
      opts.requestId
    )
  ) {
    updates['最終requestId'] =
      normalizeString_(
        opts.requestId
      );
  }

  if (
    normalizeString_(
      opts.storageLayout
    )
  ) {
    updates.storageLayout =
      normalizeString_(
        opts.storageLayout
      );
  }

  const stateWriteStartedAt =
    Date.now();

  const updatedStateData =
    stateContext
      ? setRequestStateValues_(
          ss,
          stateContext,
          updates
        )
      : rptSetStateValues_(
          ss,
          updates,
          stateData
        );

  perf.stateWriteMs =
    perfMs_(
      stateWriteStartedAt
    );

  perf.totalMs =
    perfMs_(
      startedAt
    );

  return {
    storageLayout:
      normalizeString_(
        updatedStateData.map.storageLayout
      ),
    stateData:
      updatedStateData,
    auditSheet,
    performance:
      perf
  };
}

function diagnosticItem_(
  id,
  group,
  label,
  status,
  detail,
  recommendation
) {
  return {
    id:
      normalizeString_(id),
    group:
      normalizeString_(group),
    label:
      normalizeString_(label),
    status:
      normalizeDiagnosticStatus_(
        status
      ),
    detail:
      normalizeString_(
        detail
      ),
    recommendation:
      normalizeString_(
        recommendation
      )
  };
}

function normalizeDiagnosticStatus_(
  value
) {
  const text =
    normalizeString_(
      value
    ).toUpperCase();

  if (
    text === 'ERROR' ||
    text === 'WARNING'
  ) {
    return text;
  }

  return 'OK';
}

function overallDiagnosticStatus_(
  checks
) {
  const list =
    Array.isArray(checks)
      ? checks
      : [];

  if (
    list.some(
      item =>
        item.status === 'ERROR'
    )
  ) {
    return 'ERROR';
  }

  if (
    list.some(
      item =>
        item.status ===
        'WARNING'
    )
  ) {
    return 'WARNING';
  }

  return 'OK';
}

function diagnosticHttpReachability_(
  id,
  group,
  label,
  url
) {
  const target =
    normalizeString_(
      url
    );

  if (!target) {
    return diagnosticItem_(
      id,
      group,
      label,
      'WARNING',
      '確認先URLが未設定です.',
      'Pagesを差し替え後、もう一度診断してください.'
    );
  }

  const startedAt =
    Date.now();

  try {
    const response =
      UrlFetchApp.fetch(
        target,
        {
          method: 'get',
          followRedirects: true,
          muteHttpExceptions: true
        }
      );

    const code =
      response
        .getResponseCode();

    const elapsed =
      Date.now() -
      startedAt;

    if (
      code >= 200 &&
      code < 400
    ) {
      return diagnosticItem_(
        id,
        group,
        label,
        'OK',
        'HTTP ' +
          code +
          ' / ' +
          elapsed +
          'ms',
        ''
      );
    }

    return diagnosticItem_(
      id,
      group,
      label,
      code < 500
        ? 'WARNING'
        : 'ERROR',
      'HTTP ' +
        code +
        ' / ' +
        elapsed +
        'ms',
      '公開URL・デプロイ状態を確認してください.'
    );

  } catch (err) {
    return diagnosticItem_(
      id,
      group,
      label,
      'ERROR',
      safeErrorMessage_(err),
      'URL・ネットワーク到達性を確認してください.'
    );
  }
}

function diagnosticSiblingUrl_(
  baseUrl,
  fileName
) {
  const base =
    normalizeString_(
      baseUrl
    )
      .split('#')[0]
      .split('?')[0];

  const file =
    normalizeString_(
      fileName
    );

  if (
    !base ||
    !file
  ) {
    return '';
  }

  const slash =
    base.lastIndexOf('/');

  if (
    slash < 0
  ) {
    return '';
  }

  return (
    base.slice(
      0,
      slash + 1
    ) +
    file
  );
}

function diagnosticWorkbookStructure_(
  ss
) {
  if (!ss) {
    return {
      status: 'WARNING',
      detail:
        '診断対象の個社レポートがありません.'
    };
  }

  try {
    const validation =
      validateUpdateTargetWorkbook_(
        ss
      );

    const stateData =
      rptReadStateData_(
        ss
      );

    const storageLayout =
      normalizeString_(
        stateData
          .map
          .storageLayout
      );

    const requiredSheets = [
      REPORT_SHEETS.INITIAL_SETTINGS,
      REPORT_SHEETS.KEYWORD_MASTER,
      REPORT_SHEETS.IMAGE_MASTER,
      REPORT_SHEETS.ENTERPRISE_MASTER,
      REPORT_SHEETS.CUSTOM_ANALYSIS,
      REPORT_SHEETS.DISPLAY_SETTINGS,
      REPORT_SHEETS.JOB_ANALYSIS_MASTER,
      REPORT_SHEETS.AUDIT_LOG,
      REPORT_SHEETS.INTERNAL_STATE
    ];

    const missing =
      requiredSheets
        .filter(
          name =>
            !ss.getSheetByName(
              name
            )
        );

    if (missing.length) {
      return {
        status: 'ERROR',
        detail:
          '不足タブ: ' +
          missing.join(', ')
      };
    }

    if (
      storageLayout !==
        API_CONFIG
          .CURRENT_STORAGE_LAYOUT
    ) {
      return {
        status: 'ERROR',
        detail:
          '保存構成が現行仕様ではありません: ' +
          storageLayout
      };
    }

    const dataStore =
      readAnalysisDataStore_(
        ss,
        stateData.map
      );

    if (!dataStore.ok) {
      return {
        status: 'ERROR',
        detail:
          'DATASTORE_V1 / 分析データストア=' +
          dataStore.status
      };
    }

    return {
      status: 'OK',
      detail:
        'DATASTORE_V1 / 応募 ' +
        analysisDataStoreRowCount_(
          stateData.map,
          'applicationData'
        ) +
        '件 / 求人分析 ' +
        analysisDataStoreRowCount_(
          stateData.map,
          'jobAnalysisMaster'
        ) +
        '件'
    };

  } catch (err) {
    return {
      status: 'ERROR',
      detail:
        safeErrorMessage_(err)
    };
  }
}

function diagnosticViewerMapping_(
  ss
) {
  if (!ss) {
    return {
      status: 'WARNING',
      detail:
        '診断対象の個社レポートがありません.'
    };
  }

  try {
    const state =
      ss.getSheetByName(
        REPORT_SHEETS.INTERNAL_STATE
      );

    const token =
      normalizeString_(
        getStateValueForValidation_(
          state,
          'viewerToken'
        )
      );

    if (!token) {
      return {
        status: 'ERROR',
        detail:
          'viewerTokenがありません.'
      };
    }

    const mapping =
      readViewerMapping_(
        PropertiesService
          .getScriptProperties(),
        token
      );

    if (!mapping) {
      return {
        status: 'ERROR',
        detail:
          'viewerTokenの中央API登録がありません.'
      };
    }

    if (
      normalizeString_(
        mapping.spreadsheetId
      ) !== ss.getId()
    ) {
      return {
        status: 'ERROR',
        detail:
          'viewerTokenの登録先Spreadsheetが一致しません.'
      };
    }

    return {
      status: 'OK',
      detail:
        managedViewerEnabled_(ss)
          ? '分析レポート認証情報一致 / 閲覧可'
          : '分析レポート認証情報一致 / 現在は閲覧停止中'
    };

  } catch (err) {
    return {
      status: 'ERROR',
      detail:
        safeErrorMessage_(err)
    };
  }
}

function diagnosticAuditLog_(
  ss
) {
  if (!ss) {
    return {
      status: 'WARNING',
      detail:
        '診断対象の個社レポートがありません.'
    };
  }

  const sheet =
    ss.getSheetByName(
      AUDIT_SHEET_NAME_
    );

  if (!sheet) {
    return {
      status: 'ERROR',
      detail:
        '98_運用ログがありません.'
    };
  }

  const expected = [
    '日時',
    '種別',
    '結果',
    '実行経路',
    '詳細',
    'requestId',
    'APIバージョン'
  ];

  if (
    sheet.getLastRow() < 1 ||
    sheet.getLastColumn() < 7
  ) {
    return {
      status: 'ERROR',
      detail:
        '98_運用ログのヘッダー構成が不足しています.'
    };
  }

  const actual =
    sheet.getRange(
      1,
      1,
      1,
      7
    ).getValues()[0]
      .map(
        normalizeString_
      );

  const valid =
    expected.every(
      (value, index) =>
        actual[index] === value
    );

  if (!valid) {
    return {
      status: 'ERROR',
      detail:
        '98_運用ログのヘッダーが想定と一致しません.'
    };
  }

  return {
    status: 'OK',
    detail:
      '運用ログ ' +
      Math.max(
        sheet.getLastRow() - 1,
        0
      ) +
      '件'
  };
}

function diagnosticImageWorker_() {
  const startedAt =
    Date.now();

  try {
    const response =
      UrlFetchApp.fetch(
        RPT_IMAGE_WORKER_URL_,
        {
          method: 'get',
          followRedirects: true,
          muteHttpExceptions: true
        }
      );

    const code =
      response
        .getResponseCode();

    const elapsed =
      Date.now() -
      startedAt;

    if (
      code >= 200 &&
      code < 500
    ) {
      return {
        status: 'OK',
        detail:
          'Worker到達可 / HTTP ' +
          code +
          ' / ' +
          elapsed +
          'ms'
      };
    }

    return {
      status: 'ERROR',
      detail:
        'Worker HTTP ' +
        code +
        ' / ' +
        elapsed +
        'ms'
    };

  } catch (err) {
    return {
      status: 'ERROR',
      detail:
        safeErrorMessage_(err)
    };
  }
}

function runSystemDiagnostics_(
  payload
) {
  const checks = [];

  const props =
    PropertiesService
      .getScriptProperties();

  checks.push(
    diagnosticItem_(
      'api_runtime',
      'API',
      '中央API実行',
      'OK',
      API_CONFIG.DEFAULT_APP_VERSION +
        ' / schema ' +
        API_CONFIG.DEFAULT_SCHEMA_VERSION,
      ''
    )
  );

  checks.push(
    diagnosticItem_(
      'auth',
      'API',
      '社内アクセスキー認証',
      'OK',
      'MANAGE_DIAGNOSTICSの認証に成功しました.',
      ''
    )
  );

  const schemaProperty =
    normalizeString_(
      props.getProperty(
        'SCHEMA_VERSION'
      )
    );

  checks.push(
    diagnosticItem_(
      'schema_property',
      'API',
      'SCHEMA_VERSION',
      (
        !schemaProperty ||
        schemaVersionsEqual_(
          schemaProperty,
          API_CONFIG.DEFAULT_SCHEMA_VERSION
        )
      )
        ? 'OK'
        : 'ERROR',
      schemaProperty
        ? (
            'Script Property=' +
            schemaProperty +
            ' / code=' +
            API_CONFIG.DEFAULT_SCHEMA_VERSION
          )
        : (
            'Script Property未設定 / code既定値=' +
            API_CONFIG.DEFAULT_SCHEMA_VERSION
          ),
      (
        schemaProperty &&
        !schemaVersionsEqual_(
          schemaProperty,
          API_CONFIG.DEFAULT_SCHEMA_VERSION
        )
      )
        ? 'Script Propertyを現行schemaVersionへ合わせてください.'
        : ''
    )
  );

  const pagesVersion =
    normalizeString_(
      payload.pagesVersion
    );

  checks.push(
    diagnosticItem_(
      'pages_version',
      'Pages',
      '管理Pagesバージョン',
      pagesVersion ===
        API_CONFIG.EXPECTED_PAGES_VERSION
          ? 'OK'
          : 'ERROR',
      'actual=' +
        (
          pagesVersion ||
          '未送信'
        ) +
        ' / expected=' +
        API_CONFIG.EXPECTED_PAGES_VERSION,
      pagesVersion ===
        API_CONFIG.EXPECTED_PAGES_VERSION
          ? ''
          : 'GitHub Pagesのindex.htmlを現行版へ差し替えてください.'
    )
  );

  let rootFolder = null;

  try {
    rootFolder =
      DriveApp.getFolderById(
        API_CONFIG.ROOT_FOLDER_ID
      );

    checks.push(
      diagnosticItem_(
        'root_folder',
        'Drive',
        'システム管理ルート',
        'OK',
        rootFolder.getName() +
          ' / ' +
          API_CONFIG.ROOT_FOLDER_ID,
        ''
      )
    );

  } catch (err) {
    checks.push(
      diagnosticItem_(
        'root_folder',
        'Drive',
        'システム管理ルート',
        'ERROR',
        safeErrorMessage_(err),
        '中央APIのROOT_FOLDER_IDと実行ユーザーのDrive権限を確認してください.'
      )
    );
  }

  let folder = null;

  try {
    folder =
      DriveApp.getFolderById(
        API_CONFIG.SHEET_OUTPUT_FOLDER_ID
      );

    checks.push(
      diagnosticItem_(
        'output_folder',
        'Drive',
        '個社管理シートフォルダ',
        'OK',
        folder.getName() +
          ' / ' +
          API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
        ''
      )
    );

  } catch (err) {
    checks.push(
      diagnosticItem_(
        'output_folder',
        'Drive',
        '個社管理シートフォルダ',
        'ERROR',
        safeErrorMessage_(err),
        '中央APIのフォルダIDと実行ユーザーのDrive権限を確認してください.'
      )
    );
  }

  let reports = [];

  try {
    reports =
      listRegisteredReports_();

    checks.push(
      diagnosticItem_(
        'report_registry',
        'Registry',
        '個社レポートレジストリ',
        reports.length
          ? 'OK'
          : 'WARNING',
        reports.length +
          '件の分析レポートを確認しました.',
        reports.length
          ? ''
          : '新規CREATE後に再診断すると個社レポート系チェックも実行できます.'
      )
    );

  } catch (err) {
    checks.push(
      diagnosticItem_(
        'report_registry',
        'Registry',
        '個社レポートレジストリ',
        'ERROR',
        safeErrorMessage_(err),
        '出力フォルダとSpreadsheetアクセス権を確認してください.'
      )
    );
  }

  let sampleReport = null;
  let sampleSs = null;

  if (
    reports.length
  ) {
    sampleReport =
      reports[0];

    try {
      sampleSs =
        SpreadsheetApp.openById(
          sampleReport.spreadsheetId
        );
    } catch (err) {
      checks.push(
        diagnosticItem_(
          'sample_open',
          'Workbook',
          '代表レポートを開く',
          'ERROR',
          safeErrorMessage_(err),
          '一覧先頭のSpreadsheet権限・存在状態を確認してください.'
        )
      );
    }
  }

  if (sampleSs) {
    checks.push(
      diagnosticItem_(
        'sample_open',
        'Workbook',
        '代表レポートを開く',
        'OK',
        sampleSs.getName(),
        ''
      )
    );
  } else if (!reports.length) {
    checks.push(
      diagnosticItem_(
        'sample_open',
        'Workbook',
        '代表レポートを開く',
        'WARNING',
        '個社レポートがまだありません.',
        '新規CREATE後に再診断してください.'
      )
    );
  }

  const structure =
    diagnosticWorkbookStructure_(
      sampleSs
    );

  checks.push(
    diagnosticItem_(
      'thin_structure',
      'Workbook',
      '保存構成',
      structure.status,
      structure.detail,
      structure.status === 'ERROR'
        ? '現行版から作成・更新したレポートを使用してください.'
        : ''
    )
  );

  const viewer =
    diagnosticViewerMapping_(
      sampleSs
    );

  checks.push(
    diagnosticItem_(
      'viewer_mapping',
      '分析レポート',
      '分析レポート認証情報',
      viewer.status,
      viewer.detail,
      viewer.status === 'ERROR'
        ? '管理画面で対象レポートを読み込み、分析レポートURLの再発行も検討してください.'
        : ''
    )
  );

  const audit =
    diagnosticAuditLog_(
      sampleSs
    );
  checks.push(
    diagnosticItem_(
      'audit_log',
      'Audit',
      REPORT_SHEETS.AUDIT_LOG,
      audit.status,
      audit.detail,
      audit.status === 'ERROR'
        ? '個社レポートを現行版で作り直すか、構成を確認してください.'
        : ''
    )
  );

  const worker =
    diagnosticImageWorker_();

  checks.push(
    diagnosticItem_(
      'image_worker',
      'External',
      '画像取得Worker',
      worker.status,
      worker.detail,
      worker.status === 'ERROR'
        ? 'Cloudflare Workerの公開状態を確認してください.'
        : ''
    )
  );

  const manageBaseUrl =
    normalizeViewerBaseUrl_(
      payload.manageBaseUrl
    );

  const viewerBaseUrl =
    normalizeViewerBaseUrl_(
      payload.viewerBaseUrl
    );

  checks.push(
    diagnosticHttpReachability_(
      'pages_index',
      'Pages',
      'index.html公開',
      manageBaseUrl
    )
  );

  checks.push(
    diagnosticHttpReachability_(
      'pages_report',
      'Pages',
      'report.html公開',
      viewerBaseUrl
    )
  );

  checks.push(
    diagnosticHttpReachability_(
      'pages_core',
      'Pages',
      'analysis-core.js公開',
      diagnosticSiblingUrl_(
        viewerBaseUrl,
        'analysis-core.js'
      )
    )
  );

  const overall =
    overallDiagnosticStatus_(
      checks
    );

  const counts = {
    ok:
      checks.filter(
        item =>
          item.status === 'OK'
      ).length,
    warning:
      checks.filter(
        item =>
          item.status ===
          'WARNING'
      ).length,
    error:
      checks.filter(
        item =>
          item.status ===
          'ERROR'
      ).length
  };

  return {
    overallStatus:
      overall,
    generatedAt:
      new Date()
        .toISOString(),
    counts,
    apiVersion:
      API_CONFIG.DEFAULT_APP_VERSION,
    expectedPagesVersion:
      API_CONFIG.EXPECTED_PAGES_VERSION,
    outputFolderId:
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
    outputFolderName:
      folder
        ? folder.getName()
        : '',
    rootFolderId:
      API_CONFIG.ROOT_FOLDER_ID,
    rootFolderName:
      rootFolder
        ? rootFolder.getName()
        : '',
    reportCount:
      reports.length,
    sampleReport:
      sampleReport
        ? {
            spreadsheetId:
              sampleReport
                .spreadsheetId,
            fileName:
              sampleReport
                .fileName
          }
        : null,
    checks
  };
}

// ============================================================
// Report registry
// ============================================================

