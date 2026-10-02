function handleViewerData_(payload) {
  const startedAt =
    Date.now();

  const perf = {
    datasets: {},
    dataStoreStatus: ''
  };

  const viewerToken =
    normalizeString_(
      payload.viewerToken
    );

  if (
    !viewerToken ||
    viewerToken.length < 40
  ) {
    return errorOutput_(
      'VIEWER_TOKEN_INVALID',
      '閲覧トークンが正しくありません.'
    );
  }

  const mappingStartedAt =
    Date.now();

  const props =
    PropertiesService
      .getScriptProperties();

  const mappingRaw =
    props.getProperty(
      viewerPropertyKey_(
        viewerToken
      )
    );

  if (!mappingRaw) {
    return errorOutput_(
      'VIEWER_NOT_FOUND',
      '閲覧レポートが見つかりません.'
    );
  }

  let mapping;

  try {
    mapping =
      JSON.parse(
        mappingRaw
      );
  } catch (err) {
    return errorOutput_(
      'VIEWER_NOT_FOUND',
      '閲覧レポートの登録情報を確認できません.'
    );
  }

  perf.mappingMs =
    perfMs_(
      mappingStartedAt
    );

  const spreadsheetId =
    normalizeString_(
      mapping.spreadsheetId
    );

  if (!spreadsheetId) {
    return errorOutput_(
      'VIEWER_NOT_FOUND',
      '閲覧レポートの保存先が見つかりません.'
    );
  }

  try {
    const driveValidationStartedAt =
      Date.now();

    validateUpdateTargetDriveFile_(
      spreadsheetId,
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID
    );

    perf.driveValidationMs =
      perfMs_(
        driveValidationStartedAt
      );

    const openSpreadsheetStartedAt =
      Date.now();

    const ss =
      SpreadsheetApp
        .openById(
          spreadsheetId
        );

    perf.openSpreadsheetMs =
      perfMs_(
        openSpreadsheetStartedAt
      );

    const workbookValidationStartedAt =
      Date.now();

    const workbookValidation =
      validateUpdateTargetWorkbook_(
        ss
      );

    perf.workbookValidationMs =
      perfMs_(
        workbookValidationStartedAt
      );

    const stateAuthStartedAt =
      Date.now();

    const stateData =
      workbookValidation
        .stateData;

    const stateMap =
      stateData.map;

    const storedToken =
      normalizeString_(
        stateMap.viewerToken
      );

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

    if (!viewerEnabled) {
      return errorOutput_(
        'VIEWER_DISABLED',
        'この閲覧レポートは現在停止されています.'
      );
    }

    if (
      !storedToken ||
      storedToken !== viewerToken
    ) {
      return errorOutput_(
        'VIEWER_TOKEN_INVALID',
        '閲覧トークンが一致しません.'
      );
    }

    perf.stateAuthMs =
      perfMs_(
        stateAuthStartedAt
      );

    const metadataStartedAt =
      Date.now();

    const file =
      DriveApp
        .getFileById(
          spreadsheetId
        );

    const viewerTimeZone =
      ss.getSpreadsheetTimeZone() ||
      Session.getScriptTimeZone();

    const storageLayout =
      API_CONFIG
        .CURRENT_STORAGE_LAYOUT;

    const metadata = {
      reportTitle:
        file.getName(),
      workbookType:
        normalizeString_(
          stateMap.workbookType
        ),
      schemaVersion:
        API_CONFIG
          .DEFAULT_SCHEMA_VERSION,
      lastDataUpdateAt:
        viewerJsonCell_(
          stateMap[
            '最終データ更新日時'
          ],
          viewerTimeZone
        ),
      lastDataUpdateMode:
        normalizeString_(
          stateMap[
            '最終データ更新モード'
          ]
        ),
      lastFullRefreshAt:
        viewerJsonCell_(
          stateMap[
            '最終全集計日時'
          ],
          viewerTimeZone
        ),
      viewerEnabled: true,
      storageLayout,
      commonMasterVersion:
        normalizeString_(stateMap.commonMasterVersion) ||
        API_CONFIG.EXPECTED_COMMON_MASTER_VERSION
    };

    perf.metadataMs =
      perfMs_(
        metadataStartedAt
      );

    const datasets = {};

    const dataStore =
      readAnalysisDataStore_(
        ss,
        stateMap
      );

    perf.dataStoreStatus =
      dataStore.status;

    perf.dataStoreReadMs =
      Number(
        dataStore.readMs || 0
      );

    perf.dataStoreParseMs =
      Number(
        dataStore.parseMs || 0
      );

    perf.dataStoreTotalMs =
      Number(
        dataStore.totalMs || 0
      );

    perf.dataStoreChars =
      Number(
        dataStore.chars || 0
      );

    if (!dataStore.ok) {
      return errorOutput_(
        'ANALYSIS_DATASTORE_UNAVAILABLE',
        '分析データストアを読み込めませんでした。CSVデータ更新をもう一度実行してください.',
        {
          elapsedMs:
            Date.now() -
            startedAt,
          performance:
            perf
        }
      );
    }

    analysisDataStoreDatasetKeys_()
      .forEach(
        key => {
          datasets[key] =
            dataStore
              .datasets[key];
        }
      );

    const liveSpecs = [
      [
        'keywordMaster',
        '40_仕事名KWマスタ'
      ],
      [
        'imageMaster',
        '41_画像マスタ'
      ],
      [
        'enterpriseMaster',
        '42_企業IDマスタ'
      ]
    ];

    liveSpecs.forEach(
      spec => {
        const result =
          readViewerDatasetMeasured_(
            ss,
            spec[1]
          );

        datasets[
          spec[0]
        ] =
          result.dataset;

        perf.datasets[
          spec[0]
        ] =
          result.elapsedMs;
      }
    );

    const settingsStartedAt =
      Date.now();

    const settings =
      readViewerSettings_(
        ss,
        viewerTimeZone
      );

    perf.settingsMs =
      perfMs_(
        settingsStartedAt
      );

    const customStartedAt =
      Date.now();

    const customAnalysis =
      readViewerCustomAnalysis_(
        ss
      );

    perf.customAnalysisMs =
      perfMs_(
        customStartedAt
      );

    const displayStartedAt =
      Date.now();

    const displaySettings =
      readViewerDisplaySettings_(
        ss
      );

    perf.displaySettingsMs =
      perfMs_(
        displayStartedAt
      );

    const telemetryStartedAt =
      Date.now();

    touchViewerAccess_(
      props,
      viewerToken,
      mapping
    );

    perf.telemetryMs =
      perfMs_(
        telemetryStartedAt
      );

    perf.totalMs =
      Date.now() -
      startedAt;

    return viewerSuccessOutput_(
      {
        ok: true,
        action:
          'VIEWER_DATA',
        viewerSchemaVersion:
          '1.1',
        metadata,
        settings,
        customAnalysis,
        displaySettings,
        datasets,
        performance:
          perf,
        elapsedMs:
          perf.totalMs
      },
      payload,
      startedAt
    );

  } catch (err) {
    perf.totalMs =
      Date.now() -
      startedAt;

    return errorOutput_(
      err && err.code
        ? String(err.code)
        : 'VIEWER_READ_ERROR',
      safeErrorMessage_(err),
      {
        elapsedMs:
          perf.totalMs,
        performance:
          perf
      }
    );
  }
}


function ensureViewerAccess_(
  ss,
  props,
  viewerBaseUrl,
  manageBaseUrl,
  skipDisplayEnsure,
  existingStateData,
  stateContext
) {
  const startedAt =
    Date.now();

  const perf = {
    displayEnsureMs: 0,
    stateReadMs: 0,
    stateWriteMs: 0,
    mappingReadMs: 0,
    mappingWriteMs: 0,
    portalWriteMs: 0
  };

  if (!skipDisplayEnsure) {
    const displayStartedAt =
      Date.now();

    ensureViewerDisplaySettings_(
      ss
    );

    perf.displayEnsureMs =
      perfMs_(
        displayStartedAt
      );
  }

  let stateData =
    existingStateData;

  if (
    stateContext &&
    stateData
  ) {
    stateContext.stateData =
      stateData;
  }

  if (!stateData) {
    const stateReadStartedAt =
      Date.now();

    stateData =
      rptReadStateData_(
        ss
      );

    perf.stateReadMs =
      perfMs_(
        stateReadStartedAt
      );
  }

  const stateMap =
    stateData.map;

  let viewerToken =
    normalizeString_(
      stateMap.viewerToken
    );

  if (
    !viewerToken ||
    viewerToken.length < 40
  ) {
    viewerToken =
      generateViewerToken_();
  }

  let enabledRaw =
    normalizeString_(
      stateMap.viewerEnabled
    );

  if (!enabledRaw) {
    enabledRaw = 'TRUE';
  }

  const viewerEnabled =
    !(
      enabledRaw.toUpperCase() ===
        'FALSE' ||
      enabledRaw === '0'
    );

  const finalViewerBaseUrl =
    normalizeViewerBaseUrl_(
      viewerBaseUrl
    ) ||
    normalizeString_(
      stateMap.viewerBaseUrl
    );

  const finalManageBaseUrl =
    normalizeViewerBaseUrl_(
      manageBaseUrl
    ) ||
    normalizeString_(
      stateMap.manageBaseUrl
    );
  const reportName =
    ss.getName();

  const desiredState = {
    viewerToken,
    viewerEnabled:
      viewerEnabled
        ? 'TRUE'
        : 'FALSE',
    viewerBaseUrl:
      finalViewerBaseUrl,
    manageBaseUrl:
      finalManageBaseUrl,
    portalReportName:
      reportName,
    portalLayoutVersion:
      '4'
  };

  const changedKeys =
    Object.entries(
      desiredState
    )
      .filter(
        ([key, value]) => {
          const currentValue =
            stateMap[key];

          if (
            key ===
              'viewerEnabled'
          ) {
            const currentText =
              normalizeString_(
                currentValue
              );

            const desiredText =
              normalizeString_(
                value
              );

            if (
              !currentText ||
              !desiredText
            ) {
              return (
                currentText !==
                desiredText
              );
            }

            return (
              viewerDisplayBoolean_(
                currentValue,
                true
              ) !==
              viewerDisplayBoolean_(
                value,
                true
              )
            );
          }

          return (
            normalizeString_(
              currentValue
            ) !==
            normalizeString_(
              value
            )
          );
        }
      )
      .map(
        ([key]) => key
      );

  const stateChanged =
    changedKeys.length > 0;

  perf.changedKeys =
    changedKeys;

  const portalNeedsWrite =
    !ss.getSheetByName(
      '00_このレポートについて'
    ) ||
    stateChanged;

  if (stateChanged) {
    const stateWriteStartedAt =
      Date.now();

    stateData =
      stateContext
        ? setRequestStateValues_(
            ss,
            stateContext,
            desiredState
          )
        : rptSetStateValues_(
            ss,
            desiredState,
            stateData
          );

    perf.stateWriteMs =
      perfMs_(
        stateWriteStartedAt
      );
  }

  const viewerKey =
    viewerPropertyKey_(
      viewerToken
    );

  const mappingReadStartedAt =
    Date.now();

  const existingMapping =
    readViewerMapping_(
      props,
      viewerToken
    ) ||
    {};

  perf.mappingReadMs =
    perfMs_(
      mappingReadStartedAt
    );

  const mappingWriteStartedAt =
    Date.now();

  props.setProperty(
    viewerKey,
    JSON.stringify({
      spreadsheetId:
        ss.getId(),
      updatedAt:
        new Date()
          .toISOString(),
      lastAccessAt:
        normalizeString_(
          existingMapping.lastAccessAt
        ),
      accessCount:
        Number(
          existingMapping.accessCount ||
          0
        )
    })
  );

  perf.mappingWriteMs =
    perfMs_(
      mappingWriteStartedAt
    );

  const viewerUrl =
    finalViewerBaseUrl
      ? finalViewerBaseUrl +
        '#r=' +
        encodeURIComponent(
          viewerToken
        )
      : '';

  const manageUrl =
    finalManageBaseUrl
      ? finalManageBaseUrl +
        '#sheet=' +
        encodeURIComponent(
          ss.getId()
        )
      : '';
  const shareSettingsUrl =
    manageUrl
      ? manageUrl + '&panel=sharing'
      : '';

  if (portalNeedsWrite) {
    const portalStartedAt =
      Date.now();

    writeReportPortalSheet_(
      ss,
      viewerUrl,
      manageUrl,
      viewerEnabled,
      reportName
    );

    perf.portalWriteMs =
      perfMs_(
        portalStartedAt
      );
  }

  arrangeReportSheetTabs_(ss);

  perf.totalMs =
    perfMs_(
      startedAt
    );

  return {
    viewerToken,
    viewerEnabled,
    viewerUrl,
    manageUrl,
    shareSettingsUrl,
    reportName,
    portalRewritten:
      portalNeedsWrite,
    stateData,
    changedKeys,
    performance:
      perf
  };
}

function readViewerMapping_(
  props,
  viewerToken
) {
  if (
    !props ||
    !viewerToken
  ) {
    return null;
  }

  const raw =
    props.getProperty(
      viewerPropertyKey_(
        viewerToken
      )
    );

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function touchViewerAccess_(
  props,
  viewerToken,
  mapping
) {
  try {
    const current =
      mapping &&
      typeof mapping === 'object'
        ? mapping
        : (
            readViewerMapping_(
              props,
              viewerToken
            ) ||
            {}
          );

    current.lastAccessAt =
      new Date()
        .toISOString();

    current.accessCount =
      Number(
        current.accessCount || 0
      ) + 1;

    current.updatedAt =
      normalizeString_(
        current.updatedAt
      ) ||
      current.lastAccessAt;

    props.setProperty(
      viewerPropertyKey_(
        viewerToken
      ),
      JSON.stringify(
        current
      )
    );
  } catch (e) {
    // 監視情報の書込み失敗でViewer表示自体を止めない。
  }
}

function managedViewerTelemetry_(ss) {
  try {
    const state =
      ss.getSheetByName(
        '99_内部状態'
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
        lastAccessAt: '',
        accessCount: 0
      };
    }

    const mapping =
      readViewerMapping_(
        PropertiesService
          .getScriptProperties(),
        token
      ) ||
      {};

    return {
      lastAccessAt:
        normalizeString_(
          mapping.lastAccessAt
        ),
      accessCount:
        Number(
          mapping.accessCount || 0
        )
    };
  } catch (e) {
    return {
      lastAccessAt: '',
      accessCount: 0
    };
  }
}

function viewerPropertyKey_(viewerToken) {
  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm
        .SHA_256,
      viewerToken,
      Utilities.Charset.UTF_8
    );

  const hash =
    Utilities
      .base64EncodeWebSafe(
        digest
      )
      .replace(/=+$/g, '');

  return 'VIEWER_' + hash;
}

function generateViewerToken_() {
  const raw =
    Utilities.getUuid()
      .replace(/-/g, '') +
    Utilities.getUuid()
      .replace(/-/g, '') +
    Utilities.getUuid()
      .replace(/-/g, '');

  return 'rpt_' + raw;
}

function normalizeViewerBaseUrl_(value) {
  const url =
    normalizeString_(value);

  if (!url) return '';

  if (
    !/^https?:\/\//i.test(url)
  ) {
    return '';
  }

  return url
    .split('#')[0]
    .split('?')[0];
}

function readViewerSettings_(ss, timeZone) {
  const sheet =
    ss.getSheetByName(
      REPORT_SHEETS.INITIAL_SETTINGS
    );

  const result = {};

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return result;
  }

  const values =
    sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      Math.min(
        3,
        sheet.getLastColumn()
      )
    ).getValues();

  values.forEach(row => {
    const key =
      normalizeString_(
        row[0]
      );

    if (!key) return;

    result[key] =
      viewerJsonCell_(
        row[1]
      );
  });

  return result;
}

function readViewerCustomAnalysis_(ss) {
  return (
    readCustomAnalysisSettingsSheet_(
      ss.getSheetByName(
        REPORT_SHEETS.CUSTOM_ANALYSIS
      )
    ) ||
    {
      rowAxis: '対応状況',
      colAxis: '応募媒体'
    }
  );
}

function readViewerDataset_(ss, sheetName) {
  const timeZone =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  const sheet =
    ss.getSheetByName(
      sheetName
    );

  if (
    !sheet ||
    sheet.getLastRow() < 1 ||
    sheet.getLastColumn() < 1
  ) {
    return {
      headers: [],
      rows: []
    };
  }

  const values =
    sheet.getRange(
      1,
      1,
      sheet.getLastRow(),
      sheet.getLastColumn()
    ).getValues();

  return {
    headers:
      values[0].map(
        value =>
          normalizeString_(value)
      ),
    rows:
      values
        .slice(1)
        .map(
          row =>
            row.map(
              value =>
                viewerJsonCell_(
                  value,
                  timeZone
                )
            )
        )
  };
}

function viewerJsonCell_(
  value,
  timeZone
) {
  if (
    value instanceof Date &&
    !isNaN(
      value.getTime()
    )
  ) {
    return Utilities.formatDate(
      value,
      timeZone ||
        Session.getScriptTimeZone(),
      "yyyy-MM-dd'T'HH:mm:ss"
    );
  }

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value);
}

function reportSheetTabUrl_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return '';
  return ss.getUrl().split('#')[0] + '#gid=' + sheet.getSheetId();
}

function writeReportPortalSheet_(
  ss,
  viewerUrl,
  etlUrl,
  viewerEnabled,
  reportName
) {
  let sheet = ss.getSheetByName(REPORT_SHEETS.PORTAL);

  if (!sheet) {
    sheet = ss.insertSheet(REPORT_SHEETS.PORTAL, 0);
  }

  try {
    sheet.getRange('A1:D24').breakApart();
  } catch (e) {}

  sheet.clearContents();
  sheet.clearFormats();

  const createUrl = normalizeString_(etlUrl).split('#')[0];

  sheet.getRange('A1:D1').merge();
  sheet.getRange('A1')
    .setValue('有効応募分析')
    .setFontSize(18)
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);

  sheet.getRange('A2:D2').merge();
  sheet.getRange('A2')
    .setValue('このシートが企業ごとの「ホーム」です。普段は共有フォルダや手元のショートカットから対象企業のシートを開き、ここから分析確認やデータ更新へ進みます。')
    .setWrap(true)
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.brandBlueSoft);

  sheet.getRange('A3')
    .setValue('企業 / 分析レポート名')
    .setFontWeight('bold')
    .setBackground(PRODUCT_THEME_.brandYellowSoft);

  sheet.getRange('B3:D3').merge();
  sheet.getRange('B3')
    .setValue(reportName || ss.getName())
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.textPrimary)
    .setBackground(PRODUCT_THEME_.brandYellowSoft);

  sheet.getRange('A5:D5').merge();
  sheet.getRange('A5')
    .setValue('この企業でやりたいこと')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlueDark);

  sheet.getRange('A6:D6')
    .setValues([['やりたいこと', '内容', '開く・操作', '共有']])
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.surfaceSoft)
    .setHorizontalAlignment('center');

  sheet.getRange('A7')
    .setValue('分析を見る')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.textPrimary)
    .setBackground(PRODUCT_THEME_.surfaceSoft);

  sheet.getRange('B7')
    .setValue('分析結果を確認します。企業へ共有する場合も、この分析レポートのURLを使います。')
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.white);

  if (viewerUrl) {
    sheet.getRange('C7').setFormula(
      '=HYPERLINK("' + viewerFormulaEscape_(viewerUrl) +
      '","分析レポートを開く")'
    )
      .setFontWeight('bold')
      .setFontColor(PRODUCT_THEME_.brandBlueDark)
      .setBackground(PRODUCT_THEME_.white);
  } else {
    sheet.getRange('C7')
      .setValue('分析レポートURL未設定')
      .setFontColor(PRODUCT_THEME_.textSecondary);
  }

  sheet.getRange('D7')
    .setValue(
      viewerEnabled
        ? '企業共有OK\n現在：閲覧可'
        : '企業共有OK\n現在：閲覧停止'
    )
    .setFontWeight('bold')
    .setFontColor(viewerEnabled ? '#047857' : PRODUCT_THEME_.warningText)
    .setBackground(viewerEnabled ? '#ECFDF5' : PRODUCT_THEME_.warningSoft)
    .setHorizontalAlignment('center')
    .setWrap(true);

  sheet.getRange('A8')
    .setValue('データを更新する')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.textPrimary)
    .setBackground(PRODUCT_THEME_.surfaceSoft);

  sheet.getRange('B8')
    .setValue('最新CSVへ更新し、分析レポートへ反映します。共有URLの停止・再開・再発行も更新ページから行います。')
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.white);

  if (etlUrl) {
    sheet.getRange('C8').setFormula(
      '=HYPERLINK("' + viewerFormulaEscape_(etlUrl) +
      '","データ更新ページを開く")'
    )
      .setFontWeight('bold')
      .setFontColor(PRODUCT_THEME_.brandBlueDark)
      .setBackground(PRODUCT_THEME_.white);
  } else {
    sheet.getRange('C8')
      .setValue('データ更新URL未設定')
      .setFontColor(PRODUCT_THEME_.textSecondary);
  }

  sheet.getRange('D8')
    .setValue('社内作業')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.surfaceSoft)
    .setHorizontalAlignment('center');

  sheet.getRange('A9:D9').merge();
  sheet.getRange('A9')
    .setValue('設定を変更したい場合は、下の「シート内の設定・マスタ」から直接編集できます。')
    .setWrap(true)
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.white);

  sheet.getRange('A11:D11').merge();
  sheet.getRange('A11')
    .setValue('シート内の設定・マスタ')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlueDark);

  const settingsLinks = [
    ['分析レポート初期設定', REPORT_SHEETS.INITIAL_SETTINGS, 'ターゲット年齢・バケット幅・表示件数などの初期値'],
    ['分析レポート表示項目', REPORT_SHEETS.DISPLAY_SETTINGS, '企業へ見せる分析表をチェックボックスで選択'],
    ['仕事名キーワード', REPORT_SHEETS.KEYWORD_MASTER, '上の行ほど優先'],
    ['画像URL・メモ', REPORT_SHEETS.IMAGE_MASTER, 'TOP画像URL・メモ'],
    ['企業表示名', REPORT_SHEETS.ENTERPRISE_MASTER, '分析レポート上の企業名表示']
  ];

  settingsLinks.forEach((item,index) => {
    const row = 12 + index;
    sheet.getRange(row,1)
      .setValue(item[0])
      .setFontWeight('bold')
      .setBackground(PRODUCT_THEME_.surfaceSoft);

    const url = reportSheetTabUrl_(ss,item[1]);
    if (url) {
      sheet.getRange(row,2).setFormula(
        '=HYPERLINK("' + viewerFormulaEscape_(url) +
        '","→ ' + viewerFormulaEscape_(item[1]) + '")'
      )
        .setFontColor(PRODUCT_THEME_.textSecondary)
        .setFontWeight('normal');
    }

    sheet.getRange(row,3,1,2).merge();
    sheet.getRange(row,3)
      .setValue(item[2])
      .setFontColor(PRODUCT_THEME_.textSecondary);
  });

  sheet.getRange('A18:D18').merge();
  sheet.getRange('A18')
    .setValue('設定値は個社管理シートで直接編集できます。分析レポートを再読み込みすると現在の設定が反映されます。期間だけは分析レポートを開いたとき「応募データの全期間」が初期値です。')
    .setWrap(true)
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.surfaceSoft);

  sheet.getRange('A20:D20').merge();
  sheet.getRange('A20')
    .setValue('別の企業を新しく登録する場合')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.textPrimary)
    .setBackground(PRODUCT_THEME_.brandYellowSoft);

  sheet.getRange('A21:C21').merge();
  sheet.getRange('A21')
    .setValue('既存の個社管理シートをコピーして作成せず、新規作成ページから登録してください。')
    .setWrap(true)
    .setFontColor(PRODUCT_THEME_.textSecondary)
    .setBackground(PRODUCT_THEME_.white);

  if (createUrl) {
    sheet.getRange('D21').setFormula(
      '=HYPERLINK("' + viewerFormulaEscape_(createUrl) +
      '","新しい企業を登録する")'
    )
      .setFontWeight('bold')
      .setFontColor(PRODUCT_THEME_.brandBlueDark)
      .setBackground(PRODUCT_THEME_.white)
      .setHorizontalAlignment('center');
  } else {
    sheet.getRange('D21')
      .setValue('新規作成URL未設定')
      .setFontColor(PRODUCT_THEME_.textSecondary)
      .setHorizontalAlignment('center');
  }

  sheet.getRange('A1:D21').setVerticalAlignment('middle');
  sheet.getRange('B3:D21').setWrap(true);
  sheet.getRange('A6:D9').setWrap(true);

  sheet.setFrozenRows(2);
  sheet.setColumnWidth(1,170);
  sheet.setColumnWidth(2,410);
  sheet.setColumnWidth(3,230);
  sheet.setColumnWidth(4,190);

  try { sheet.setTabColor(PRODUCT_THEME_.brandBlue); } catch (e) {}
}

function viewerFormulaEscape_(value) {
  return String(value)
    .replace(/"/g, '""');
}

// ============================================================
// Management Pages - settings / masters read-write API
// ============================================================


