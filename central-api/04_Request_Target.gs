function getRequestPropertyKey_(requestId) {
  return (
    API_CONFIG.REQUEST_PROPERTY_PREFIX +
    requestId
  );
}

function getRequestRecord_(props, requestId) {
  const raw =
    props.getProperty(
      getRequestPropertyKey_(requestId)
    );

  if (!raw) return null;

  try {
    const parsed =
      JSON.parse(raw);

    if (!parsed.spreadsheetId) {
      return null;
    }

    if (!parsed.spreadsheetUrl) {
      parsed.spreadsheetUrl =
        buildSpreadsheetUrl_(
          parsed.spreadsheetId
        );
    }

    return parsed;

  } catch (_) {
    return null;
  }
}

function saveRequestRecord_(
  props,
  requestId,
  record
) {
  props.setProperty(
    getRequestPropertyKey_(requestId),
    JSON.stringify(record)
  );
}

function deleteRequestRecord_(
  props,
  requestId
) {
  props.deleteProperty(
    getRequestPropertyKey_(requestId)
  );
}

function requestRecordFileExists_(record) {
  if (
    !record ||
    !record.spreadsheetId
  ) {
    return false;
  }

  try {
    DriveApp
      .getFileById(
        record.spreadsheetId
      )
      .getName();

    return true;
  } catch (_) {
    return false;
  }
}

function isLeaseActive_(record) {
  const leaseUntilMs =
    Date.parse(
      record.leaseUntil || ''
    );

  return (
    isFinite(leaseUntilMs) &&
    leaseUntilMs > Date.now()
  );
}

function stageRank_(stage) {
  const rank = {
    CREATED: 10,
    TARGET_VALIDATED: 15,
    OPENED: 20,
    DATA_WRITTEN: 30,
    REPORT_DONE: 40,
    READY: 50
  };

  return (
    rank[
      normalizeString_(stage)
    ] || 0
  );
}

function buildSpreadsheetUrl_(
  spreadsheetId
) {
  return (
    'https://docs.google.com/spreadsheets/d/' +
    spreadsheetId +
    '/edit'
  );
}

function buildReadyResponse_(
  record,
  requestId,
  reused,
  startedAt
) {
  return {
    ok: true,
    pending: false,
    reused: !!reused,
    operationMode:
      normalizeString_(record.operationMode) || 'CREATE',
    requestId,
    status: 'READY',
    stage: 'READY',
    spreadsheetId:
      record.spreadsheetId,
    spreadsheetUrl:
      record.spreadsheetUrl ||
      buildSpreadsheetUrl_(
        record.spreadsheetId
      ),
    fileName:
      record.fileName || '',
    viewerUrl:
      record.viewerUrl || '',
    manageUrl:
      record.manageUrl || '',
    viewerEnabled:
      record.viewerEnabled !== false,
    storageLayout:
      record.storageLayout ||
      API_CONFIG.CURRENT_STORAGE_LAYOUT,
    elapsedMs:
      Date.now() - startedAt,
    performance:
      record.performance ||
      {}
  };
}

function pruneRequestProperties_(props) {
  const all =
    props.getProperties();

  const entries =
    Object.entries(all)
      .filter(([key]) =>
        key.startsWith(
          API_CONFIG.REQUEST_PROPERTY_PREFIX
        )
      )
      .map(([key, value]) => {
        let createdAt = '';

        try {
          createdAt =
            JSON.parse(value)
              .createdAt || '';
        } catch (_) {}

        return {
          key,
          createdAt
        };
      });

  if (
    entries.length <=
    API_CONFIG.MAX_REQUEST_PROPERTIES
  ) {
    return;
  }

  entries
    .sort((a, b) =>
      String(a.createdAt)
        .localeCompare(
          String(b.createdAt)
        )
    )
    .slice(
      0,
      entries.length -
      API_CONFIG.MAX_REQUEST_PROPERTIES
    )
    .forEach(item =>
      props.deleteProperty(
        item.key
      )
    );
}

// ============================================================
// Create / Update target helpers
// ============================================================

function extractSpreadsheetId_(value) {
  const text =
    normalizeString_(value);

  if (!text) return '';

  const match =
    text.match(
      /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/
    );

  if (match) {
    return match[1];
  }

  if (
    /^[A-Za-z0-9_-]{20,}$/.test(
      text
    )
  ) {
    return text;
  }

  return '';
}

function folderIsDirectChildOf_(
  folder,
  parentFolderId
) {
  if (!folder || !parentFolderId) {
    return false;
  }

  const parents =
    folder.getParents();

  while (parents.hasNext()) {
    if (
      parents.next().getId() ===
      parentFolderId
    ) {
      return true;
    }
  }

  return false;
}

function fileIsInManagedOutputTree_(
  file,
  outputFolderId
) {
  if (!file || !outputFolderId) {
    return false;
  }

  const parents =
    file.getParents();

  while (parents.hasNext()) {
    const parent =
      parents.next();

    if (
      parent.getId() ===
      outputFolderId
    ) {
      return true;
    }

    if (
      folderIsDirectChildOf_(
        parent,
        outputFolderId
      )
    ) {
      return true;
    }
  }

  return false;
}

function normalizeOutputFolderName_(value) {
  const name =
    normalizeString_(value)
      .replace(/\s+/g, ' ')
      .trim();

  if (!name) return '';

  if (name.length > 80) {
    const e =
      new Error(
        '保存先フォルダ名は80文字以内で入力してください.'
      );
    e.code =
      'OUTPUT_FOLDER_INVALID';
    throw e;
  }

  if (/[\\/]/.test(name)) {
    const e =
      new Error(
        '保存先フォルダ名に / または \\ は使用できません.'
      );
    e.code =
      'OUTPUT_FOLDER_INVALID';
    throw e;
  }

  return name;
}

function listManagedOutputFolders_() {
  const root =
    DriveApp.getFolderById(
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID
    );

  const folders = [];
  const iterator =
    root.getFolders();

  while (iterator.hasNext()) {
    const folder =
      iterator.next();

    if (
      typeof folder.isTrashed === 'function' &&
      folder.isTrashed()
    ) {
      continue;
    }

    folders.push({
      id: folder.getId(),
      name: folder.getName()
    });
  }

  folders.sort((a, b) =>
    String(a.name || '')
      .localeCompare(
        String(b.name || ''),
        'ja'
      )
  );

  return folders;
}

function resolveCreateOutputFolder_(payload) {
  const rootId =
    API_CONFIG.SHEET_OUTPUT_FOLDER_ID;

  const root =
    DriveApp.getFolderById(
      rootId
    );

  const requestedId =
    normalizeString_(
      payload &&
      payload.outputFolderId
    );

  if (requestedId) {
    if (requestedId === rootId) {
      return root;
    }

    let folder;

    try {
      folder =
        DriveApp.getFolderById(
          requestedId
        );
    } catch (err) {
      const e =
        new Error(
          '指定した保存先フォルダを開けませんでした.'
        );
      e.code =
        'OUTPUT_FOLDER_INVALID';
      throw e;
    }

    if (
      !folderIsDirectChildOf_(
        folder,
        rootId
      )
    ) {
      const e =
        new Error(
          '保存先は共通フォルダ直下の1階層まで指定できます.'
        );
      e.code =
        'OUTPUT_FOLDER_INVALID';
      throw e;
    }

    return folder;
  }

  const requestedName =
    normalizeOutputFolderName_(
      payload &&
      payload.outputFolderName
    );

  if (!requestedName) {
    return root;
  }

  const matches =
    root.getFoldersByName(
      requestedName
    );

  if (matches.hasNext()) {
    return matches.next();
  }

  return root.createFolder(
    requestedName
  );
}

function validateUpdateTargetDriveFile_(
  spreadsheetId,
  outputFolderId
) {
  let file;

  try {
    file =
      DriveApp.getFileById(
        spreadsheetId
      );
  } catch (err) {
    const e =
      new Error(
        '更新先の個社管理シートを開けませんでした.'
      );
    e.code = 'TARGET_INVALID';
    throw e;
  }

  if (
    file.getMimeType() !==
    MimeType.GOOGLE_SHEETS
  ) {
    const e =
      new Error(
        '更新先はGoogleスプレッドシートではありません.'
      );
    e.code = 'TARGET_INVALID';
    throw e;
  }

  const inOutputFolder =
    fileIsInManagedOutputTree_(
      file,
      outputFolderId
    );

  if (!inOutputFolder) {
    const e =
      new Error(
        '更新先は個社管理シートの管理フォルダ内にありません.'
      );
    e.code =
      'TARGET_OUTSIDE_OUTPUT_FOLDER';
    throw e;
  }

  return file;
}

function validateUpdateTargetWorkbook_(
  ss,
  existingStateData
) {
  const stateData =
    existingStateData ||
    rptReadStateData_(
      ss
    );

  const state =
    stateData.sheet;

  const commonRequiredSheets = [
    REPORT_SHEETS.INITIAL_SETTINGS,
    REPORT_SHEETS.KEYWORD_MASTER,
    REPORT_SHEETS.IMAGE_MASTER,
    REPORT_SHEETS.ENTERPRISE_MASTER,
    REPORT_SHEETS.CUSTOM_ANALYSIS,
    REPORT_SHEETS.DISPLAY_SETTINGS,
    REPORT_SHEETS.JOB_ANALYSIS_MASTER,
    REPORT_SHEETS.PROCESS_INFO,
    REPORT_SHEETS.INPUT_FILES,
    REPORT_SHEETS.INTERNAL_STATE
  ];

  const hasCommonSheets =
    commonRequiredSheets.every(
      name =>
        !!ss.getSheetByName(
          name
        )
    );

  if (
    !state ||
    !hasCommonSheets
  ) {
    const e =
      new Error(
        'この個社管理シートは現在対応している分析構成ではありません。現行版から作成した個社管理シートを指定してください.'
      );

    e.code =
      'TARGET_STORAGE_LAYOUT_UNSUPPORTED';

    throw e;
  }

  const stateMap =
    stateData.map ||
    {};

  const workbookType =
    normalizeString_(
      stateMap.workbookType
    );

  const schemaVersion =
    normalizeString_(
      stateMap.schemaVersion
    );

  const storageLayout =
    normalizeString_(
      stateMap.storageLayout
    );

  if (
    workbookType !==
      'VALID_APPLICATION_ANALYSIS' ||
    !schemaVersionsEqual_(
      schemaVersion,
      API_CONFIG.DEFAULT_SCHEMA_VERSION
    ) ||
    storageLayout !==
      API_CONFIG
        .CURRENT_STORAGE_LAYOUT
  ) {
    const e =
      new Error(
        'この個社管理シートは現在のリリース候補構成ではありません。現行版から作成した個社管理シートを指定してください.'
      );

    e.code =
      'TARGET_STORAGE_LAYOUT_UNSUPPORTED';

    throw e;
  }

  return {
    ok: true,
    storageLayout,
    stateData
  };
}

function getStateValueForValidation_(
  sheet,
  key
) {
  if (
    !sheet ||
    sheet.getLastRow() < 1
  ) {
    return '';
  }

  const values =
    sheet.getRange(
      1,
      1,
      sheet.getLastRow(),
      2
    ).getValues();

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    if (
      normalizeString_(
        values[i][0]
      ) === key
    ) {
      return values[i][1];
    }
  }

  return '';
}

