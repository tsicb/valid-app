function cleanupDefaultBlankSheet_(ss) {
  const sheets = ss.getSheets();

  sheets.forEach(sheet => {
    const name = sheet.getName();

    if (
      (name === 'Sheet1' || name === 'シート1') &&
      isSheetEffectivelyBlank_(sheet) &&
      ss.getSheets().length > 1
    ) {
      try { ss.deleteSheet(sheet); } catch (_) {}
    }
  });
}


function isSheetEffectivelyBlank_(sheet) {
  if (!sheet) return true;

  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if (
    lastRow <= 0 ||
    lastColumn <= 0
  ) {
    return true;
  }

  if (
    lastRow === 1 &&
    lastColumn === 1
  ) {
    return !normalizeString_(
      sheet.getRange(1, 1)
        .getValue()
    );
  }

  return false;
}

function writeDataset_(ss, sheetName, dataset, hidden) {
  const totalStartedAt = Date.now();
  const ensureSheetStartedAt = Date.now();
  const sheet = ensureSheet_(ss, sheetName, hidden);
  const ensureSheetMs = perfMs_(ensureSheetStartedAt);

  const clearStartedAt = Date.now();
  sheet.clearContents();
  if (!hidden) sheet.clearFormats();
  const clearMs = perfMs_(clearStartedAt);

  const headers = dataset.headers || [];
  const rows = dataset.rows || [];

  if (!headers.length) {
    sheet.getRange('A1').setValue('データなし');
    return {
      rows: 0, cols: 0,
      performance: {
        totalMs: perfMs_(totalStartedAt), ensureSheetMs, clearMs,
        sanitizeMs: 0, setValuesMs: 0, formatMs: 0, chunkCount: 0,
        hiddenStorageFastPath: !!hidden
      }
    };
  }

  const sanitizeStartedAt = Date.now();
  const safeHeaders = headers.map(sanitizeCell_);
  const safeRows = rows.map(row => row.map(sanitizeCell_));
  const sanitizeMs = perfMs_(sanitizeStartedAt);

  const totalRows = safeRows.length + 1;
  const totalCols = safeHeaders.length;
  const valuesStartedAt = Date.now();
  ensureSheetSize_(sheet, totalRows, totalCols);
  sheet.getRange(1,1,1,totalCols).setValues([safeHeaders]);

  let chunkCount = 0;
  if (safeRows.length) {
    const CHUNK_SIZE = 10000;
    for (let start=0; start<safeRows.length; start+=CHUNK_SIZE) {
      const chunk=safeRows.slice(start,start+CHUNK_SIZE);
      sheet.getRange(start+2,1,chunk.length,totalCols).setValues(chunk);
      chunkCount++;
    }
  }
  const setValuesMs=perfMs_(valuesStartedAt);

  let formatMs=0;
  if (!hidden) {
    const formatStartedAt=Date.now();
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,totalCols)
      .setFontWeight('bold')
      .setFontColor(PRODUCT_THEME_.white)
      .setBackground(PRODUCT_THEME_.brandBlue);
    sheet.getDataRange().setVerticalAlignment('top');
    try { sheet.setTabColor(PRODUCT_THEME_.brandBlue); } catch (_) {}
    if (rows.length<=2500 && totalCols<=35) {
      try { sheet.autoResizeColumns(1,totalCols); } catch (_) {}
    }
    formatMs=perfMs_(formatStartedAt);
  }

  return {
    rows: rows.length, cols: headers.length,
    performance: {
      totalMs: perfMs_(totalStartedAt), ensureSheetMs, clearMs, sanitizeMs,
      setValuesMs, formatMs, chunkCount, hiddenStorageFastPath: !!hidden
    }
  };
}


function ensureSheet_(ss, name, hidden) {
  let sheet=ss.getSheetByName(name);
  if (!sheet) sheet=ss.insertSheet(name);
  try {
    const isHidden=sheet.isSheetHidden();
    if (hidden && !isHidden) sheet.hideSheet();
    else if (!hidden && isHidden) sheet.showSheet();
  } catch (_) {}
  return sheet;
}

function arrangeReportSheetTabs_(ss) {
  const visibleOrder = [
    REPORT_SHEETS.PORTAL,
    REPORT_SHEETS.INITIAL_SETTINGS,
    REPORT_SHEETS.DISPLAY_SETTINGS,
    REPORT_SHEETS.KEYWORD_MASTER,
    REPORT_SHEETS.IMAGE_MASTER,
    REPORT_SHEETS.ENTERPRISE_MASTER
  ];

  let position = 1;

  visibleOrder.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;

    try {
      if (sheet.isSheetHidden()) sheet.showSheet();
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(position);
      position += 1;
    } catch (_) {}
  });

  const integrationSheet =
    ss.getSheetByName(REPORT_SHEETS.INTEGRATION_REPORT);

  if (integrationSheet) {
    try { integrationSheet.hideSheet(); } catch (_) {}
  }

  const portal = ss.getSheetByName(REPORT_SHEETS.PORTAL);
  if (portal) {
    try { ss.setActiveSheet(portal); } catch (_) {}
  }
}


function ensureSheetSize_(sheet, requiredRows, requiredCols) {
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      requiredRows - sheet.getMaxRows()
    );
  }

  if (sheet.getMaxColumns() < requiredCols) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredCols - sheet.getMaxColumns()
    );
  }
}

function writeInitialSettings_(ss, settings) {
  const sheet = ensureSheet_(ss, REPORT_SHEETS.INITIAL_SETTINGS, false);
  sheet.clearContents();
  sheet.clearFormats();

  const rows = [
    ['設定項目', '設定値', '説明'],
    ['ターゲット年齢下限', settings.targetAgeMin ?? '', '分析レポートを開いたときのターゲット年齢下限。空欄の場合は下限なし'],
    ['ターゲット年齢上限', settings.targetAgeMax ?? '', '分析レポートを開いたときのターゲット年齢上限。一の位が5の場合、年代列の区切りを自動調整'],
    ['月内応募日幅', 7, '月内応募日別のバケット幅'],
    ['応募時間帯幅', 6, '応募時間帯別のバケット幅'],
    ['求人原稿文字数幅', 300, '求人原稿文字数別のバケット幅'],
    ['Indeed求人タグ数幅', 5, 'Indeed求人タグ数別のバケット幅'],
    ['時給下限幅', 50, '時給下限別のバケット幅'],
    ['日給下限幅', 1000, '日給下限別のバケット幅'],
    ['月給下限幅', 50000, '月給下限別のバケット幅'],
    ['年収下限幅', 500000, '年収下限別のバケット幅'],
    ['Indeedタグ表示件数', 50, 'Indeedタグ分析に表示する上位件数（20 / 50 / 100 / すべて）'],
    ['TOP画像表示件数', 50, 'TOP画像分析に表示する上位件数（20 / 50 / 100 / すべて）']
  ];

  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 3)
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);

  if (rows.length > 1) {
    sheet.getRange(2, 2, rows.length - 1, 1)
      .setBackground(PRODUCT_THEME_.brandYellowSoft);
    sheet.getRange(2, 3, rows.length - 1, 1)
      .setFontColor(PRODUCT_THEME_.textSecondary);
  }

  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 520);
  try { sheet.setTabColor(PRODUCT_THEME_.brandBlue); } catch (_) {}
}

function ensureCustomAnalysisSettings_(ss) {
  const sheet =
    ensureSheet_(
      ss,
      REPORT_SHEETS.CUSTOM_ANALYSIS,
      true
    );

  const existing =
    readCustomAnalysisSettingsSheet_(
      sheet
    );

  if (existing) {
    return existing;
  }

  const initial = {
    rowAxis: '対応状況',
    colAxis: '応募媒体'
  };

  writeCustomAnalysisSettingsSheet_(
    sheet,
    initial
  );

  return initial;
}

function viewerDisplayBoolean_(value, fallback) {
  if (typeof value === 'boolean') return value;
  const text = normalizeString_(value).toUpperCase();
  if (!text) return !!fallback;
  if (['FALSE','0','NO','OFF'].indexOf(text) >= 0) return false;
  if (['TRUE','1','YES','ON'].indexOf(text) >= 0) return true;
  return !!fallback;
}

function defaultViewerDisplaySettings_() {
  return VIEWER_DISPLAY_DEFINITIONS_.map(row => ({
    id: row[0],
    label: row[1],
    visible: row[4] !== false,
    group: row[2],
    description: row[3]
  }));
}

function readViewerDisplaySettingsSheet_(sheet) {
  const defaults = defaultViewerDisplaySettings_();
  if (!sheet || sheet.getLastRow() < 2) return defaults;

  const values = sheet.getRange(
    2, 1, sheet.getLastRow() - 1,
    Math.min(5, Math.max(sheet.getLastColumn(), 3))
  ).getValues();

  const existing = {};
  values.forEach(row => {
    const id = normalizeString_(row[0]);
    if (!id) return;
    existing[id] = {
      visible: viewerDisplayBoolean_(row[2], true)
    };
  });

  return defaults.map(item => {
    const saved = existing[item.id];
    return saved
      ? Object.assign({}, item, {
          visible: saved.visible
        })
      : item;
  });
}

function ensureViewerDisplaySettings_(ss) {
  const existingSheet =
    ss.getSheetByName(
      REPORT_SHEETS.DISPLAY_SETTINGS
    );

  const sheet =
    ensureSheet_(
      ss,
      REPORT_SHEETS.DISPLAY_SETTINGS,
      false
    );

  const expectedCount =
    VIEWER_DISPLAY_DEFINITIONS_.length;

  if (
    existingSheet &&
    sheet.getLastRow() >=
      expectedCount + 1
  ) {
    const values =
      sheet.getRange(
        2,
        1,
        expectedCount,
        5
      ).getValues();

    const canonical =
      VIEWER_DISPLAY_DEFINITIONS_
        .every(
          (definition, index) =>
            normalizeString_(
              values[index][0]
            ) ===
            definition[0]
        );

    if (canonical) {
      return VIEWER_DISPLAY_DEFINITIONS_
        .map(
          (definition, index) => ({
            id: definition[0],
            label: definition[1],
            visible:
              viewerDisplayBoolean_(
                values[index][2],
                definition[4] !== false
              ),
            group: definition[2],
            description: definition[3]
          })
        );
    }
  }

  const settings =
    existingSheet
      ? readViewerDisplaySettingsSheet_(
          sheet
        )
      : defaultViewerDisplaySettings_();

  sheet.clearContents();
  sheet.clearFormats();

  const rows = [[
    '分析ID',
    '分析名',
    '分析レポート表示',
    '種別',
    '説明'
  ]];

  settings.forEach(
    item =>
      rows.push([
        item.id,
        item.label,
        !!item.visible,
        item.group,
        item.description
      ])
  );

  sheet
    .getRange(
      1,
      1,
      rows.length,
      5
    )
    .setValues(
      rows
    );

  if (settings.length) {
    const range =
      sheet.getRange(
        2,
        3,
        settings.length,
        1
      );

    range.insertCheckboxes();

    range.setValues(
      settings.map(
        item => [
          !!item.visible
        ]
      )
    );
  }

  sheet.setFrozenRows(1);

  sheet
    .getRange(
      1,
      1,
      1,
      5
    )
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);

  sheet.setColumnWidth(1,180);
  sheet.setColumnWidth(2,260);
  sheet.setColumnWidth(3,110);
  sheet.setColumnWidth(4,120);
  sheet.setColumnWidth(5,420);

  try { sheet.hideColumns(1); } catch (_) {}

  if (settings.length) {
    sheet.getRange(2, 3, settings.length, 1)
      .setBackground(PRODUCT_THEME_.brandYellowSoft);
    sheet.getRange(2, 5, settings.length, 1)
      .setFontColor(PRODUCT_THEME_.textSecondary);
  }

  try {
    sheet.setTabColor(
      PRODUCT_THEME_.brandYellow
    );
  } catch (_) {}

  return settings;
}

function readViewerDisplaySettings_(ss) {
  return readViewerDisplaySettingsSheet_(
    ss.getSheetByName(REPORT_SHEETS.DISPLAY_SETTINGS)
  );
}

function readCustomAnalysisSettingsSheet_(
  sheet
) {
  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return null;
  }

  const values =
    sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      2
    ).getValues();

  const map = {};

  values.forEach(row => {
    const key =
      normalizeString_(
        row[0]
      );

    if (key) {
      map[key] = row[1];
    }
  });

  if (
    !normalizeString_(
      map.rowAxis
    )
  ) {
    return null;
  }

  return {
    rowAxis:
      normalizeString_(
        map.rowAxis
      ),
    colAxis:
      normalizeString_(
        map.colAxis
      ) ||
      '応募媒体'
  };
}

function writeCustomAnalysisSettingsSheet_(
  sheet,
  value
) {
  if (!sheet) return;

  sheet.clearContents();
  sheet.clearFormats();

  const rows = [
    ['設定項目', '設定値'],
    ['rowAxis', normalizeString_(value.rowAxis) || '対応状況'],
    ['colAxis', normalizeString_(value.colAxis) || '応募媒体']
  ];

  sheet.getRange(
    1,
    1,
    rows.length,
    2
  ).setValues(rows);

  sheet.getRange(
    1,
    1,
    1,
    2
  )
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);

  try {
    sheet.hideSheet();
  } catch (e) {}
}

function initializeKeywordMaster_(ss, settings) {
  const sheet = ensureSheet_(ss, REPORT_SHEETS.KEYWORD_MASTER, false);
  sheet.clearContents();
  sheet.clearFormats();

  const keywords = Array.isArray(settings.jobNameKeywords)
    ? settings.jobNameKeywords
        .map(normalizeString_)
        .filter(Boolean)
    : [];

  sheet.getRange('A1').setValue('仕事名KW');
  sheet.getRange('A1')
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);

  if (keywords.length) {
    sheet
      .getRange(2, 1, keywords.length, 1)
      .setValues(keywords.map(v => [sanitizeCell_(v)]));
  }

  sheet.getRange('C1').setValue(
    '上の行ほど優先。仕事名KWは最初に一致した1件を採用。仕事名フルKWは一致したKWの組合せを1カテゴリとして扱います。'
  ).setBackground(PRODUCT_THEME_.brandBlueSoft)
   .setFontColor(PRODUCT_THEME_.textSecondary);
  try { sheet.setTabColor(PRODUCT_THEME_.brandBlue); } catch (_) {}
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(3, 520);
}

function initializeEnterpriseMaster_(
  ss,
  applicationDataset,
  defaultDisplayName
) {
  const sheet = ensureSheet_(ss, REPORT_SHEETS.ENTERPRISE_MASTER, false);
  sheet.clearContents();
  sheet.clearFormats();

  const headers = applicationDataset.headers || [];
  const rows = applicationDataset.rows || [];
  const enterpriseIndex = headers.indexOf('企業ID');

  const ids = new Set();

  if (enterpriseIndex >= 0) {
    rows.forEach(row => {
      const id = normalizeString_(row[enterpriseIndex]);
      if (id) ids.add(id);
    });
  }

  const displayName =
    normalizeCompanyDisplayName_(
      defaultDisplayName
    );

  const values = Array.from(ids)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .map(id => [
      id,
      displayName
        ? sanitizeCell_(
            displayName
          )
        : ''
    ]);

  sheet.getRange(1, 1, 1, 2)
    .setValues([['企業ID', '表示名']])
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);

  if (values.length) {
    sheet.getRange(2, 1, values.length, 2).setValues(values);
  }

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 260);
  try { sheet.setTabColor(PRODUCT_THEME_.brandBlue); } catch (_) {}
}

function writeIntegrationReport_(ss, payload, writeSummary, startedAt) {
  const sheet = ensureSheet_(ss, REPORT_SHEETS.INTEGRATION_REPORT, true);
  sheet.clearContents();
  sheet.clearFormats();

  const appRows =
    payload &&
    payload.datasets &&
    payload.datasets.applicationData &&
    Array.isArray(
      payload.datasets.applicationData.rows
    )
      ? payload.datasets.applicationData.rows.length
      : 0;

  const jobRows =
    writeSummary.jobAnalysisMaster &&
    writeSummary.jobAnalysisMaster.rows
      ? writeSummary.jobAnalysisMaster.rows
      : 0;

  const imageRows =
    writeSummary.imageMasterInitial &&
    writeSummary.imageMasterInitial.rows
      ? writeSummary.imageMasterInitial.rows
      : 0;

  // setValues() は、指定Rangeの列数と全行の配列長が完全一致する必要がある。
  // A:B の2列へ書くため、見出し行・空行を含め全行を必ず2要素にそろえる。
  const rows = [
    ['有効応募分析', 'データ連携情報'],
    ['通常操作', '不要（データ更新時に自動更新されます）'],
    ['', ''],
    ['状態', 'データ投入完了'],
    ['schemaVersion', normalizeString_(payload.schemaVersion)],
    ['requestId', normalizeString_(payload.requestId)],
    ['生成日時', new Date()],
    ['API処理時間(ms)', Date.now() - startedAt],
    ['', ''],
    ['応募データ', appRows],
    ['求人分析マスタ', jobRows],
    ['画像マスタ初期値', imageRows],
    ['', ''],
    ['用途', 'データ連携状態や件数を確認するための情報シートです。']
  ];

  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange('A1:B1')
    .setFontSize(18)
    .setFontWeight('bold')
    .setFontColor(PRODUCT_THEME_.white)
    .setBackground(PRODUCT_THEME_.brandBlue);
  sheet.getRange('A2:B2')
    .setFontWeight('bold')
    .setBackground(PRODUCT_THEME_.brandBlueSoft);
  sheet.getRange('A4:A15').setFontWeight('bold');
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 520);
  try { sheet.setTabColor(PRODUCT_THEME_.brandBlue); } catch (_) {}
  try { sheet.hideSheet(); } catch (_) {}
}

function sanitizeCell_(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) return value;

  let s = String(value);

  if (s.length > API_CONFIG.MAX_CELL_CHARS) {
    s = s.slice(0, API_CONFIG.MAX_CELL_CHARS);
  }

  // CSV由来文字列を数式として実行しない。
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s;
  }

  return s;
}


// ============================================================
// Idempotency / resumable request state
// ============================================================

