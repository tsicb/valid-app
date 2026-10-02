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

function customAnalysisAxisRules_() {
  return [
    ['対応状況', 'status'],
    ['応募年月', 'month'],
    ['応募媒体', 'media'],
    ['氏名文字種区分', 'name-script'],
    ['居住都道府県', 'residence'],
    ['企業ID', 'enterprise'],
    ['職種', 'job-category'],
    ['雇用形態', 'employment'],
    ['求人勤務地名称', 'job-location-name'],
    ['勤務地都道府県', 'job-prefecture'],
    ['勤務地・居住都道府県一致', 'prefecture-match'],
    ['募集背景', 'recruit-background'],
    ['月内応募日', 'month-day'],
    ['応募曜日', 'weekday'],
    ['応募時間帯', 'hour'],
    ['時給下限', 'hourly-salary'],
    ['日給下限', 'daily-salary'],
    ['月給下限', 'monthly-salary'],
    ['年収下限', 'annual-salary'],
    ['求人原稿文字数', 'text-length'],
    ['メイン画像有無', 'main-image'],
    ['求人画像枚数', 'image-count'],
    ['TOP画像ファイル名', 'top-image-detail'],
    ['求人動画有無', 'job-video'],
    ['Indeed求人タグ数', 'indeed-tag-count'],
    ['求人備考1行目', 'note-detail']
  ];
}

function customAnalysisHasKeywords_(ss) {
  const sheet =
    ss.getSheetByName(
      REPORT_SHEETS.KEYWORD_MASTER
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return false;
  }

  return sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      1
    )
    .getValues()
    .some(
      row =>
        !!normalizeString_(
          row[0]
        )
    );
}

function customAnalysisAllowedAxes_(ss) {
  const visibility = {};

  readViewerDisplaySettings_(
    ss
  ).forEach(
    item => {
      visibility[item.id] =
        item.visible !== false;
    }
  );

  const enabled =
    id =>
      !Object.prototype
        .hasOwnProperty.call(
          visibility,
          id
        ) ||
      visibility[id] !== false;

  const axes =
    customAnalysisAxisRules_()
      .filter(
        row =>
          enabled(
            row[1]
          )
      )
      .map(
        row =>
          row[0]
      );

  const salaryIds = [
    'hourly-salary',
    'daily-salary',
    'monthly-salary',
    'annual-salary'
  ];

  if (
    salaryIds.some(
      enabled
    )
  ) {
    const salaryIndexes =
      [
        '時給下限',
        '日給下限',
        '月給下限',
        '年収下限'
      ]
        .map(
          axis =>
            axes.indexOf(
              axis
            )
        )
        .filter(
          index =>
            index >= 0
        )
        .sort(
          (a, b) =>
            a - b
        );

    if (
      salaryIndexes.length
    ) {
      axes.splice(
        salaryIndexes[0],
        0,
        '給与区分'
      );
    }
  }

  if (
    customAnalysisHasKeywords_(
      ss
    )
  ) {
    const keywordAxes = [];

    if (
      enabled(
        'job-keyword'
      )
    ) {
      keywordAxes.push(
        '仕事名KW'
      );
    }

    if (
      enabled(
        'job-full-keyword'
      )
    ) {
      keywordAxes.push(
        '仕事名フルKW'
      );
    }

    if (
      keywordAxes.length
    ) {
      const recruitIndex =
        axes.indexOf(
          '募集背景'
        );

      axes.splice(
        recruitIndex >= 0
          ? recruitIndex
          : axes.length,
        0,
        ...keywordAxes
      );
    }
  }

  return axes;
}

function normalizeCustomAnalysisSettings_(
  value,
  allowedAxes
) {
  const axes =
    Array.isArray(
      allowedAxes
    )
      ? allowedAxes
          .map(
            normalizeString_
          )
          .filter(
            Boolean
          )
      : [];

  const allowed =
    new Set(
      axes
    );

  const rawRows =
    Array.isArray(
      value &&
      value.rowAxes
    )
      ? value.rowAxes
      : [
          value &&
            (
              value.rowAxis1 ||
              value.rowAxis
            ),
          value &&
            value.rowAxis2,
          value &&
            value.rowAxis3
        ];

  const rowAxes = [];

  rawRows
    .map(
      normalizeString_
    )
    .filter(
      Boolean
    )
    .forEach(
      axis => {
        if (
          rowAxes.length >= 3 ||
          rowAxes.indexOf(
            axis
          ) >= 0 ||
          (
            allowed.size &&
            !allowed.has(
              axis
            )
          )
        ) {
          return;
        }

        rowAxes.push(
          axis
        );
      }
    );

  if (
    !rowAxes.length &&
    axes.length
  ) {
    rowAxes.push(
      axes.indexOf(
        '対応状況'
      ) >= 0
        ? '対応状況'
        : axes[0]
    );
  }

  let colAxis =
    normalizeString_(
      value &&
      value.colAxis
    );

  if (
    !colAxis ||
    (
      allowed.size &&
      !allowed.has(
        colAxis
      )
    ) ||
    rowAxes.indexOf(
      colAxis
    ) >= 0
  ) {
    if (
      axes.indexOf(
        '応募媒体'
      ) >= 0 &&
      rowAxes.indexOf(
        '応募媒体'
      ) < 0
    ) {
      colAxis =
        '応募媒体';
    } else {
      colAxis =
        axes.find(
          axis =>
            rowAxes.indexOf(
              axis
            ) < 0
        ) ||
        '';
    }
  }

  return {
    rowAxes,
    rowAxis:
      rowAxes[0] ||
      '',
    rowAxis2:
      rowAxes[1] ||
      '',
    rowAxis3:
      rowAxes[2] ||
      '',
    colAxis
  };
}

function readInitialCustomAnalysisSettings_(ss) {
  const sheet =
    ss.getSheetByName(
      REPORT_SHEETS.INITIAL_SETTINGS
    );

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
      Math.min(
        2,
        Math.max(
          sheet.getLastColumn(),
          2
        )
      )
    ).getValues();

  const map = {};

  values.forEach(
    row => {
      const key =
        normalizeString_(
          row[0]
        );

      if (key) {
        map[key] =
          row[1];
      }
    }
  );

  const keys = [
    'カスタム分析 行軸1',
    'カスタム分析 行軸2',
    'カスタム分析 行軸3',
    'カスタム分析 列軸'
  ];

  if (
    !keys.some(
      key =>
        Object.prototype
          .hasOwnProperty.call(
            map,
            key
          )
    )
  ) {
    return null;
  }

  return {
    rowAxes: [
      map[
        'カスタム分析 行軸1'
      ],
      map[
        'カスタム分析 行軸2'
      ],
      map[
        'カスタム分析 行軸3'
      ]
    ],
    colAxis:
      map[
        'カスタム分析 列軸'
      ]
  };
}

function initialCustomAnalysisRows_(
  value
) {
  const normalized =
    value || {};

  return [
    [
      'カスタム分析 行軸1',
      normalizeString_(
        normalized.rowAxis ||
        (
          Array.isArray(
            normalized.rowAxes
          )
            ? normalized.rowAxes[0]
            : ''
        )
      ) ||
      '対応状況',
      'カスタム分析を開いたときの1段目の行軸'
    ],
    [
      'カスタム分析 行軸2',
      normalizeString_(
        normalized.rowAxis2 ||
        (
          Array.isArray(
            normalized.rowAxes
          )
            ? normalized.rowAxes[1]
            : ''
        )
      ),
      '任意。カスタム分析を開いたときの2段目の行軸'
    ],
    [
      'カスタム分析 行軸3',
      normalizeString_(
        normalized.rowAxis3 ||
        (
          Array.isArray(
            normalized.rowAxes
          )
            ? normalized.rowAxes[2]
            : ''
        )
      ),
      '任意。カスタム分析を開いたときの3段目の行軸'
    ],
    [
      'カスタム分析 列軸',
      normalizeString_(
        normalized.colAxis
      ) ||
      '応募媒体',
      'カスタム分析を開いたときの列軸。行軸との重複は自動調整'
    ]
  ];
}

function formatInitialSettingsSheet_(
  ss,
  sheet
) {
  if (!sheet) return;

  const lastRow =
    Math.max(
      sheet.getLastRow(),
      1
    );

  sheet.setFrozenRows(
    1
  );

  sheet
    .getRange(
      1,
      1,
      1,
      3
    )
    .setFontWeight(
      'bold'
    )
    .setFontColor(
      PRODUCT_THEME_.white
    )
    .setBackground(
      PRODUCT_THEME_.brandBlue
    );

  if (
    lastRow > 1
  ) {
    sheet
      .getRange(
        2,
        2,
        lastRow - 1,
        1
      )
      .setBackground(
        PRODUCT_THEME_.brandYellowSoft
      );

    sheet
      .getRange(
        2,
        3,
        lastRow - 1,
        1
      )
      .setFontColor(
        PRODUCT_THEME_.textSecondary
      );
  }

  const axes =
    customAnalysisAllowedAxes_(
      ss
    );

  const keyRows = {};

  if (
    lastRow > 1
  ) {
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1
      )
      .getValues()
      .forEach(
        (row, index) => {
          const key =
            normalizeString_(
              row[0]
            );

          if (key) {
            keyRows[key] =
              index + 2;
          }
        }
      );
  }

  const customKeys = [
    'カスタム分析 行軸1',
    'カスタム分析 行軸2',
    'カスタム分析 行軸3',
    'カスタム分析 列軸'
  ];

  customKeys.forEach(
    key => {
      const row =
        keyRows[key];

      if (!row) return;

      const cell =
        sheet.getRange(
          row,
          2
        );

      cell.clearDataValidations();

      if (
        axes.length
      ) {
        cell.setDataValidation(
          SpreadsheetApp
            .newDataValidation()
            .requireValueInList(
              axes,
              true
            )
            .setAllowInvalid(
              false
            )
            .setHelpText(
              '分析レポート表示項目でONになっている分析軸から選択してください。'
            )
            .build()
        );
      }
    }
  );

  sheet.setColumnWidth(
    1,
    210
  );
  sheet.setColumnWidth(
    2,
    170
  );
  sheet.setColumnWidth(
    3,
    520
  );

  try {
    sheet.setTabColor(
      PRODUCT_THEME_.brandBlue
    );
  } catch (_) {}
}

function writeInitialSettings_(ss, settings) {
  const sheet =
    ensureSheet_(
      ss,
      REPORT_SHEETS.INITIAL_SETTINGS,
      false
    );

  sheet.clearContents();
  sheet.clearFormats();

  const customDefaults =
    normalizeCustomAnalysisSettings_(
      {
        rowAxes: [
          '対応状況'
        ],
        colAxis:
          '応募媒体'
      },
      customAnalysisAllowedAxes_(
        ss
      )
    );

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
    ['TOP画像表示件数', 50, 'TOP画像分析に表示する上位件数（20 / 50 / 100 / すべて）'],
    ...initialCustomAnalysisRows_(
      customDefaults
    )
  ];

  sheet
    .getRange(
      1,
      1,
      rows.length,
      3
    )
    .setValues(
      rows
    );

  formatInitialSettingsSheet_(
    ss,
    sheet
  );
}

function ensureInitialSettings_(ss) {
  const sheet =
    ensureSheet_(
      ss,
      REPORT_SHEETS.INITIAL_SETTINGS,
      false
    );

  if (
    sheet.getLastRow() < 2
  ) {
    writeInitialSettings_(
      ss,
      {}
    );
  }

  const current =
    readInitialCustomAnalysisSettings_(
      ss
    );

  const legacy =
    readCustomAnalysisSettingsSheet_(
      ss.getSheetByName(
        REPORT_SHEETS.CUSTOM_ANALYSIS
      )
    );

  const normalized =
    normalizeCustomAnalysisSettings_(
      current ||
      legacy ||
      {
        rowAxes: [
          '対応状況'
        ],
        colAxis:
          '応募媒体'
      },
      customAnalysisAllowedAxes_(
        ss
      )
    );

  const lastRow =
    sheet.getLastRow();

  const values =
    sheet
      .getRange(
        2,
        1,
        Math.max(
          lastRow - 1,
          1
        ),
        1
      )
      .getValues();

  const keyRows = {};

  values.forEach(
    (row, index) => {
      const key =
        normalizeString_(
          row[0]
        );

      if (key) {
        keyRows[key] =
          index + 2;
      }
    }
  );

  const customRows =
    initialCustomAnalysisRows_(
      normalized
    );

  customRows.forEach(
    row => {
      const key =
        row[0];

      const existingRow =
        keyRows[key];

      if (
        existingRow
      ) {
        sheet
          .getRange(
            existingRow,
            2,
            1,
            2
          )
          .setValues([
            [
              row[1],
              row[2]
            ]
          ]);
      } else {
        sheet.appendRow(
          row
        );

        keyRows[key] =
          sheet.getLastRow();
      }
    }
  );

  formatInitialSettingsSheet_(
    ss,
    sheet
  );

  writeCustomAnalysisSettingsSheet_(
    ensureSheet_(
      ss,
      REPORT_SHEETS.CUSTOM_ANALYSIS,
      true
    ),
    normalized
  );

  return normalized;
}

function writeInitialCustomAnalysisSettings_(
  ss,
  value
) {
  ensureInitialSettings_(
    ss
  );

  const sheet =
    ss.getSheetByName(
      REPORT_SHEETS.INITIAL_SETTINGS
    );

  if (!sheet) return null;

  const normalized =
    normalizeCustomAnalysisSettings_(
      value,
      customAnalysisAllowedAxes_(
        ss
      )
    );

  const keyValues = {
    'カスタム分析 行軸1':
      normalized.rowAxis,
    'カスタム分析 行軸2':
      normalized.rowAxis2,
    'カスタム分析 行軸3':
      normalized.rowAxis3,
    'カスタム分析 列軸':
      normalized.colAxis
  };

  const count =
    Math.max(
      sheet.getLastRow() - 1,
      0
    );

  if (
    count
  ) {
    const keys =
      sheet
        .getRange(
          2,
          1,
          count,
          1
        )
        .getValues();

    keys.forEach(
      (row, index) => {
        const key =
          normalizeString_(
            row[0]
          );

        if (
          Object.prototype
            .hasOwnProperty.call(
              keyValues,
              key
            )
        ) {
          sheet
            .getRange(
              index + 2,
              2
            )
            .setValue(
              keyValues[key]
            );
        }
      }
    );
  }

  formatInitialSettingsSheet_(
    ss,
    sheet
  );

  return normalized;
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

  const rowAxes = [
    map.rowAxis1 ||
      map.rowAxis,
    map.rowAxis2,
    map.rowAxis3
  ]
    .map(
      normalizeString_
    )
    .filter(
      Boolean
    )
    .slice(
      0,
      3
    );

  if (
    !rowAxes.length
  ) {
    return null;
  }

  return {
    rowAxes,
    rowAxis:
      rowAxes[0],
    rowAxis2:
      rowAxes[1] ||
      '',
    rowAxis3:
      rowAxes[2] ||
      '',
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

  const rowAxes =
    Array.isArray(
      value &&
      value.rowAxes
    )
      ? value.rowAxes
          .map(
            normalizeString_
          )
          .filter(
            Boolean
          )
          .slice(
            0,
            3
          )
      : [
          normalizeString_(
            value &&
            (
              value.rowAxis1 ||
              value.rowAxis
            )
          ),
          normalizeString_(
            value &&
            value.rowAxis2
          ),
          normalizeString_(
            value &&
            value.rowAxis3
          )
        ]
          .filter(
            Boolean
          )
          .slice(
            0,
            3
          );

  const rows = [
    ['設定項目', '設定値'],
    ['rowAxis', rowAxes[0] || '対応状況'],
    ['rowAxis2', rowAxes[1] || ''],
    ['rowAxis3', rowAxes[2] || ''],
    ['colAxis', normalizeString_(value && value.colAxis) || '応募媒体']
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

