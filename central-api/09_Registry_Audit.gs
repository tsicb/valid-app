function reportRegistryKey_(spreadsheetId) {
  return (
    API_CONFIG.REPORT_REGISTRY_PREFIX +
    normalizeString_(spreadsheetId)
  );
}

function reportEnterpriseLabel_(ss) {
  const sheet =
    ss.getSheetByName(
      '42_企業IDマスタ'
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return '';
  }

  const values =
    sheet.getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      2
    ).getValues();

  const labels = [];
  const seen = {};

  values.forEach(row => {
    const enterpriseId =
      normalizeString_(row[0]);

    const displayName =
      normalizeString_(row[1]);

    const label =
      displayName ||
      enterpriseId;

    if (
      label &&
      !seen[label]
    ) {
      seen[label] = true;
      labels.push(label);
    }
  });

  if (!labels.length) {
    return '';
  }

  if (labels.length <= 3) {
    return labels.join(' / ');
  }

  return (
    labels.slice(0, 3).join(' / ') +
    ' 他' +
    (labels.length - 3) +
    '件'
  );
}

function viewerRegistryKeyForWorkbook_(ss) {
  const token =
    normalizeString_(
      getStateValueForValidation_(
        ss.getSheetByName(
          '99_内部状態'
        ),
        'viewerToken'
      )
    );

  return token
    ? viewerPropertyKey_(token)
    : '';
}

function upsertReportRegistryFast_(
  ss,
  context
) {
  const startedAt =
    Date.now();

  const perf = {
    enterpriseLabelMs: 0,
    propertyWriteMs: 0
  };

  const ctx =
    context &&
    typeof context === 'object'
      ? context
      : {};

  const stateData =
    ctx.stateData ||
    rptReadStateData_(
      ss
    );

  const stateMap =
    stateData.map;

  const viewerInfo =
    ctx.viewerInfo ||
    {};

  const enterpriseStartedAt =
    Date.now();

  const enterpriseLabel =
    reportEnterpriseLabel_(
      ss
    );

  perf.enterpriseLabelMs =
    perfMs_(
      enterpriseStartedAt
    );

  const tz =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  const viewerToken =
    normalizeString_(
      viewerInfo.viewerToken ||
      stateMap.viewerToken
    );

  const viewerEnabledValue =
    viewerInfo.viewerEnabled !==
      undefined
      ? viewerInfo.viewerEnabled
      : stateMap.viewerEnabled;

  const viewerEnabledRaw =
    normalizeString_(
      viewerEnabledValue
    ).toUpperCase();

  const viewerEnabled =
    !(
      viewerEnabledRaw ===
        'FALSE' ||
      viewerEnabledRaw ===
        '0' ||
      viewerEnabledRaw ===
        'NO' ||
      viewerEnabledRaw ===
        'OFF'
    );

  const viewerUrl =
    (
      normalizeString_(
        stateMap.viewerBaseUrl
      ) &&
      viewerToken
        ? normalizeString_(
            stateMap.viewerBaseUrl
          ) +
          '#r=' +
          encodeURIComponent(
            viewerToken
          )
        : ''
    ) ||
    normalizeString_(
      viewerInfo.viewerUrl
    );

  const record = {
    spreadsheetId:
      ss.getId(),
    spreadsheetUrl:
      ss.getUrl(),
    fileName:
      ss.getName(),
    enterpriseLabel,
    viewerUrl,
    viewerEnabled,
    viewerShareStatus:
      normalizeViewerShareStatus_(
        stateMap.viewerShareStatus
      ),
    viewerSharedAt:
      viewerJsonCell_(
        stateMap.viewerSharedAt,
        tz
      ),
    viewerReshareReason:
      normalizeString_(
        stateMap.viewerReshareReason
      ),
    viewerRegistryKey:
      viewerToken
        ? viewerPropertyKey_(
            viewerToken
          )
        : '',
    lastDataUpdateAt:
      viewerJsonCell_(
        stateMap[
          '最終データ更新日時'
        ],
        tz
      ),
    lastDataUpdateMode:
      normalizeString_(
        stateMap[
          '最終データ更新モード'
        ]
      ),
    lastSettingsSaveAt:
      viewerJsonCell_(
        stateMap[
          '最終設定保存日時'
        ],
        tz
      ),
    applicationCount:
      Number(
        ctx.applicationCount ||
        analysisDataStoreRowCount_(
          stateMap,
          'applicationData'
        ) ||
        0
      ),
    jobAnalysisCount:
      Number(
        ctx.jobAnalysisCount ||
        sheetDataRowCount_(
          ss,
          '91_求人分析マスタ'
        ) ||
        0
      ),
    updatedAt:
      new Date()
        .toISOString()
  };

  const propertyStartedAt =
    Date.now();

  PropertiesService
    .getScriptProperties()
    .setProperty(
      reportRegistryKey_(
        ss.getId()
      ),
      JSON.stringify(
        record
      )
    );

  perf.propertyWriteMs =
    perfMs_(
      propertyStartedAt
    );

  perf.totalMs =
    perfMs_(
      startedAt
    );

  return {
    record,
    performance:
      perf
  };
}

function upsertReportRegistry_(ss) {
  if (!ss) return null;

  const props =
    PropertiesService
      .getScriptProperties();

  const file =
    DriveApp.getFileById(
      ss.getId()
    );

  const state =
    ss.getSheetByName(
      '99_内部状態'
    );

  const tz =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  const record = {
    spreadsheetId:
      ss.getId(),
    spreadsheetUrl:
      ss.getUrl(),
    fileName:
      file.getName(),
    enterpriseLabel:
      reportEnterpriseLabel_(ss),
    viewerUrl:
      buildManagedViewerUrl_(ss),
    viewerEnabled:
      managedViewerEnabled_(ss),
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
    viewerReshareReason:
      normalizeString_(
        getStateValueForValidation_(
          state,
          'viewerReshareReason'
        )
      ),
    viewerRegistryKey:
      viewerRegistryKeyForWorkbook_(ss),
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
    applicationCount:
      analysisDataStoreRowCount_(
        rptReadStateData_(ss).map,
        'applicationData'
      ),
    jobAnalysisCount:
      sheetDataRowCount_(
        ss,
        '91_求人分析マスタ'
      ),
    updatedAt:
      new Date().toISOString()
  };

  props.setProperty(
    reportRegistryKey_(
      ss.getId()
    ),
    JSON.stringify(record)
  );

  return record;
}

function readReportRegistryMap_() {
  const props =
    PropertiesService
      .getScriptProperties();

  const all =
    props.getProperties();

  const map = {};

  Object.keys(all)
    .forEach(key => {
      if (
        key.indexOf(
          API_CONFIG.REPORT_REGISTRY_PREFIX
        ) !== 0
      ) {
        return;
      }

      try {
        const record =
          JSON.parse(all[key]);

        const id =
          normalizeString_(
            record &&
            record.spreadsheetId
          );

        if (id) {
          map[id] = {
            key,
            record
          };
        }
      } catch (e) {}
    });

  return map;
}

function fileIsInOutputFolder_(file) {
  return fileIsInManagedOutputTree_(
    file,
    API_CONFIG.SHEET_OUTPUT_FOLDER_ID
  );
}

function syncReportRegistryFromFolder_() {
  const props =
    PropertiesService
      .getScriptProperties();

  const registry =
    readReportRegistryMap_();

  const seen = {};

  const rootFolder =
    DriveApp.getFolderById(
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID
    );

  const folders = [rootFolder];
  const childFolders =
    rootFolder.getFolders();

  while (childFolders.hasNext()) {
    folders.push(
      childFolders.next()
    );
  }

  let checked = 0;

  for (
    let folderIndex = 0;
    folderIndex < folders.length &&
    checked < 500;
    folderIndex++
  ) {
    const files =
      folders[folderIndex]
        .getFilesByType(
          MimeType.GOOGLE_SHEETS
        );

    while (
      files.hasNext() &&
      checked < 500
    ) {
      const file =
        files.next();

      checked++;

    const id =
      file.getId();

    seen[id] = true;

    if (registry[id]) {
      const record =
        registry[id].record;

      let changed = false;

      if (
        normalizeString_(
          record.fileName
        ) !==
        file.getName()
      ) {
        record.fileName =
          file.getName();

        changed = true;
      }

      const url =
        'https://docs.google.com/spreadsheets/d/' +
        id +
        '/edit';

      if (
        normalizeString_(
          record.spreadsheetUrl
        ) !== url
      ) {
        record.spreadsheetUrl =
          url;

        changed = true;
      }

      if (changed) {
        props.setProperty(
          registry[id].key,
          JSON.stringify(record)
        );
      }

      continue;
    }

    try {
      const ss =
        SpreadsheetApp.openById(id);

      validateUpdateTargetWorkbook_(ss);

      upsertReportRegistry_(ss);

      } catch (e) {
        // 出力フォルダ内の別用途Sheetは一覧に載せない。
      }
    }
  }

  Object.keys(registry)
    .forEach(id => {
      if (!seen[id]) {
        props.deleteProperty(
          registry[id].key
        );
      }
    });
}

function reportViewerTelemetryByKey_(
  props,
  viewerRegistryKey
) {
  const key =
    normalizeString_(
      viewerRegistryKey
    );

  if (!key) {
    return {
      lastAccessAt: '',
      accessCount: 0
    };
  }

  const raw =
    props.getProperty(key);

  if (!raw) {
    return {
      lastAccessAt: '',
      accessCount: 0
    };
  }

  try {
    const mapping =
      JSON.parse(raw);

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

function summarizeRegisteredReports_(
  reports,
  staleDays
) {
  const list =
    Array.isArray(reports)
      ? reports
      : [];

  const threshold =
    Math.max(
      1,
      Number(staleDays || 30)
    );

  const now =
    Date.now();

  const summary = {
    total:
      list.length,
    unshared: 0,
    reshareRequired: 0,
    viewerStopped: 0,
    stale:
      0,
    staleDays:
      threshold,
    noViewerAccess: 0
  };

  list.forEach(report => {
    const shareStatus =
      normalizeViewerShareStatus_(
        report &&
        report.viewerShareStatus
      );

    if (
      shareStatus ===
      'UNSHARED'
    ) {
      summary.unshared++;
    }

    if (
      shareStatus ===
      'RESHARE_REQUIRED'
    ) {
      summary.reshareRequired++;
    }

    if (
      report &&
      report.viewerEnabled ===
        false
    ) {
      summary.viewerStopped++;
    }

    if (
      !normalizeString_(
        report &&
        report.lastViewerAccessAt
      )
    ) {
      summary.noViewerAccess++;
    }

    const rawDate =
      normalizeString_(
        report &&
        report.lastDataUpdateAt
      );

    const time =
      rawDate
        ? Date.parse(rawDate)
        : NaN;

    if (
      !Number.isFinite(time) ||
      (
        now - time
      ) >=
        threshold *
        86400000
    ) {
      summary.stale++;
    }
  });

  return summary;
}

function listRegisteredReports_() {
  const props =
    PropertiesService
      .getScriptProperties();

  let registry =
    readReportRegistryMap_();

  // 通常運用はregistryを正本とする。
  // 新規環境などregistryが空のときだけ、管理フォルダ直下＋1階層を再走査して復旧する。
  if (!Object.keys(registry).length) {
    syncReportRegistryFromFolder_();
    registry =
      readReportRegistryMap_();
  }

  const reports = [];

  Object.keys(registry)
    .forEach(id => {
      const source =
        registry[id].record ||
        {};

      try {
        const file =
          DriveApp.getFileById(id);

        if (
          file.isTrashed() ||
          !fileIsInOutputFolder_(file)
        ) {
          props.deleteProperty(
            registry[id].key
          );

          return;
        }

        const liveFileName =
          file.getName();

        if (
          normalizeString_(
            source.fileName
          ) !== liveFileName
        ) {
          source.fileName =
            liveFileName;

          props.setProperty(
            registry[id].key,
            JSON.stringify(source)
          );
        }
      } catch (e) {
        props.deleteProperty(
          registry[id].key
        );

        return;
      }

      const telemetry =
        reportViewerTelemetryByKey_(
          props,
          source.viewerRegistryKey
        );

      reports.push({
        spreadsheetId:
          normalizeString_(
            source.spreadsheetId
          ),
        spreadsheetUrl:
          normalizeString_(
            source.spreadsheetUrl
          ),
        fileName:
          normalizeString_(
            source.fileName
          ),
        enterpriseLabel:
          normalizeString_(
            source.enterpriseLabel
          ),
        viewerUrl:
          normalizeString_(
            source.viewerUrl
          ),
        viewerEnabled:
          source.viewerEnabled !== false,
        viewerShareStatus:
          normalizeViewerShareStatus_(
            source.viewerShareStatus
          ),
        viewerSharedAt:
          normalizeString_(
            source.viewerSharedAt
          ),
        viewerReshareReason:
          normalizeString_(
            source.viewerReshareReason
          ),
        lastDataUpdateAt:
          normalizeString_(
            source.lastDataUpdateAt
          ),
        lastDataUpdateMode:
          normalizeString_(
            source.lastDataUpdateMode
          ),
        lastSettingsSaveAt:
          normalizeString_(
            source.lastSettingsSaveAt
          ),
        lastViewerAccessAt:
          telemetry.lastAccessAt,
        viewerAccessCount:
          telemetry.accessCount,
        applicationCount:
          Number(
            source.applicationCount || 0
          ),
        jobAnalysisCount:
          Number(
            source.jobAnalysisCount || 0
          )
      });
    });

  reports.sort(
    (a, b) => {
      const aTime =
        Date.parse(
          a.lastDataUpdateAt ||
          a.lastSettingsSaveAt ||
          ''
        ) || 0;

      const bTime =
        Date.parse(
          b.lastDataUpdateAt ||
          b.lastSettingsSaveAt ||
          ''
        ) || 0;

      if (aTime !== bTime) {
        return bTime - aTime;
      }

      return normalizeString_(
        a.fileName
      ).localeCompare(
        normalizeString_(
          b.fileName
        ),
        'ja'
      );
    }
  );

  return reports;
}

// ============================================================
// Operations audit
// ============================================================

const AUDIT_SHEET_NAME_ =
  '98_運用ログ';

function ensureAuditSheet_(ss) {
  const sheet =
    ensureSheet_(
      ss,
      AUDIT_SHEET_NAME_,
      true
    );

  if (
    sheet.getLastRow() < 1
  ) {
    sheet.getRange(
      1,
      1,
      1,
      7
    ).setValues([[
      '日時',
      '種別',
      '結果',
      '実行経路',
      '詳細',
      'requestId',
      'APIバージョン'
    ]]);

    sheet.getRange(
      1,
      1,
      1,
      7
    )
      .setFontWeight('bold')
      .setBackground('#E2E8F0');
  }

  return sheet;
}

function auditText_(value) {
  const text =
    normalizeString_(
      value
    );

  return text.length > 1200
    ? text.slice(0, 1200)
    : text;
}

function appendAuditEvent_(
  ss,
  eventType,
  result,
  source,
  detail,
  requestId,
  existingAuditSheet
) {
  try {
    const sheet =
      existingAuditSheet ||
      ensureAuditSheet_(
        ss
      );

    const normalizedRequestId =
      normalizeString_(
        requestId
      );

    const lastRow =
      sheet.getLastRow();

    if (
      normalizedRequestId &&
      lastRow > 1
    ) {
      const startRow =
        Math.max(
          2,
          lastRow - 29
        );

      const recent =
        sheet.getRange(
          startRow,
          1,
          lastRow -
            startRow + 1,
          6
        ).getValues();

      const duplicate =
        recent.some(
          row =>
            normalizeString_(
              row[1]
            ) ===
              normalizeString_(
                eventType
              ) &&
            normalizeString_(
              row[5]
            ) ===
              normalizedRequestId &&
            normalizeString_(
              row[2]
            ) ===
              normalizeString_(
                result
              )
        );

      if (duplicate) {
        return;
      }
    }

    sheet.appendRow([
      new Date(),
      auditText_(eventType),
      auditText_(result),
      auditText_(source),
      auditText_(detail),
      normalizedRequestId,
      API_CONFIG.DEFAULT_APP_VERSION
    ]);

    const newLastRow =
      lastRow + 1;

    if (
      newLastRow > 1001
    ) {
      const deleteCount =
        Math.min(
          100,
          newLastRow - 1001
        );

      if (deleteCount > 0) {
        sheet.deleteRows(
          2,
          deleteCount
        );
      }
    }

  } catch (e) {
    // 監査ログ失敗で本処理を止めない。
  }
}

function appendAuditError_(
  ss,
  eventType,
  source,
  err,
  requestId
) {
  appendAuditEvent_(
    ss,
    eventType,
    'ERROR',
    source,
    mapErrorCode_(err) +
      ': ' +
      safeErrorMessage_(err),
    requestId
  );
}

function auditWorkbookErrorByIdSafe_(
  spreadsheetId,
  eventType,
  source,
  err,
  requestId
) {
  const id =
    normalizeString_(
      spreadsheetId
    );

  if (!id) return;

  try {
    const ss =
      SpreadsheetApp.openById(
        id
      );

    appendAuditError_(
      ss,
      eventType,
      source,
      err,
      requestId
    );
  } catch (e) {}
}

function auditManageErrorSafe_(
  payload,
  eventType,
  err
) {
  const id =
    extractSpreadsheetId_(
      payload &&
      (
        payload.targetSpreadsheetUrl ||
        payload.targetSpreadsheetId
      )
    );

  auditWorkbookErrorByIdSafe_(
    id,
    eventType,
    'MANAGE_PAGES',
    err,
    ''
  );
}

function readAuditLog_(
  ss,
  limit
) {
  const sheet =
    ss.getSheetByName(
      AUDIT_SHEET_NAME_
    );

  if (
    !sheet ||
    sheet.getLastRow() < 2
  ) {
    return [];
  }

  const maxCount =
    Math.max(
      1,
      Math.min(
        Number(limit || 20),
        100
      )
    );

  const count =
    Math.min(
      sheet.getLastRow() - 1,
      maxCount
    );

  const startRow =
    sheet.getLastRow() -
      count + 1;

  const tz =
    ss.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone();

  return sheet.getRange(
    startRow,
    1,
    count,
    7
  ).getValues()
    .reverse()
    .map(row => ({
      at:
        viewerJsonCell_(
          row[0],
          tz
        ),
      eventType:
        normalizeString_(
          row[1]
        ),
      result:
        normalizeString_(
          row[2]
        ),
      source:
        normalizeString_(
          row[3]
        ),
      detail:
        normalizeString_(
          row[4]
        ),
      requestId:
        normalizeString_(
          row[5]
        ),
      apiVersion:
        normalizeString_(
          row[6]
        )
    }));
}

