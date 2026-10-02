function perfMs_(startedAt) {
  return Math.max(
    0,
    Date.now() -
      Number(
        startedAt || Date.now()
      )
  );
}

function ensureRequestPerformance_(
  record
) {
  if (!record) {
    return {};
  }

  if (
    !record.performance ||
    typeof record.performance !==
      'object'
  ) {
    record.performance = {};
  }

  if (
    !record.performance
      .datasetWrites ||
    typeof record.performance
      .datasetWrites !==
      'object'
  ) {
    record.performance
      .datasetWrites = {};
  }

  return record.performance;
}

function addPerfMs_(
  performance,
  key,
  value
) {
  if (
    !performance ||
    !key
  ) {
    return;
  }

  const amount =
    Number(value || 0);

  performance[key] =
    Number(
      performance[key] || 0
    ) +
    (
      isFinite(amount)
        ? amount
        : 0
    );
}

function analysisDataStoreDatasetKeys_() {
  return [
    'applicationData',
    'jobAnalysisMaster'
  ];
}

function getOrCreateAnalysisDataStoreFolder_() {
  const props =
    PropertiesService
      .getScriptProperties();

  const propertyKey =
    API_CONFIG
      .ANALYSIS_DATASTORE_FOLDER_PROPERTY;

  const storedId =
    normalizeString_(
      props.getProperty(
        propertyKey
      )
    );

  if (storedId) {
    try {
      return DriveApp
        .getFolderById(
          storedId
        );
    } catch (_) {}
  }

  const outputFolder =
    DriveApp.getFolderById(
      API_CONFIG.ROOT_FOLDER_ID
    );

  const matches =
    outputFolder
      .getFoldersByName(
        API_CONFIG
          .ANALYSIS_DATASTORE_FOLDER_NAME
      );

  let folder;

  if (matches.hasNext()) {
    folder =
      matches.next();
  } else {
    folder =
      outputFolder.createFolder(
        API_CONFIG
          .ANALYSIS_DATASTORE_FOLDER_NAME
      );
  }

  props.setProperty(
    propertyKey,
    folder.getId()
  );

  return folder;
}

function buildAnalysisDataStoreObject_(
  ss,
  payload,
  requestId
) {
  const datasets = {};

  analysisDataStoreDatasetKeys_()
    .forEach(
      key => {
        const source =
          payload &&
          payload.datasets
            ? payload.datasets[key]
            : null;

        if (
          source &&
          Array.isArray(
            source.headers
          ) &&
          Array.isArray(
            source.rows
          )
        ) {
          datasets[key] = {
            headers:
              source.headers,
            rows:
              source.rows
          };
        }
      }
    );

  return {
    dataType:
      'VALID_APPLICATION_ANALYSIS_DATASTORE',
    dataStoreVersion:
      API_CONFIG
        .ANALYSIS_DATASTORE_VERSION,
    workbookType:
      'VALID_APPLICATION_ANALYSIS',
    schemaVersion:
      API_CONFIG
        .DEFAULT_SCHEMA_VERSION,
    commonMasterVersion:
      normalizeString_(
        payload &&
        payload.commonMasterVersion
      ) ||
      API_CONFIG
        .EXPECTED_COMMON_MASTER_VERSION,
    storageLayout:
      API_CONFIG
        .CURRENT_STORAGE_LAYOUT,
    spreadsheetId:
      ss.getId(),
    requestId:
      normalizeString_(
        requestId
      ),
    generatedAt:
      new Date()
        .toISOString(),
    datasets
  };
}

function validateAnalysisDataStoreObject_(
  parsed,
  spreadsheetId,
  requestId
) {
  if (
    !parsed ||
    typeof parsed !== 'object'
  ) {
    return {
      ok: false,
      reason: 'NOT_OBJECT'
    };
  }

  if (
    normalizeString_(
      parsed.dataType
    ) !==
      'VALID_APPLICATION_ANALYSIS_DATASTORE'
  ) {
    return {
      ok: false,
      reason: 'DATA_TYPE'
    };
  }

  if (
    !schemaVersionsEqual_(
      parsed.dataStoreVersion,
      API_CONFIG
        .ANALYSIS_DATASTORE_VERSION
    )
  ) {
    return {
      ok: false,
      reason: 'VERSION'
    };
  }

  if (
    normalizeString_(
      parsed.spreadsheetId
    ) !==
      normalizeString_(
        spreadsheetId
      )
  ) {
    return {
      ok: false,
      reason: 'SPREADSHEET_ID'
    };
  }

  if (
    normalizeString_(
      parsed.requestId
    ) !==
      normalizeString_(
        requestId
      )
  ) {
    return {
      ok: false,
      reason: 'REQUEST_ID'
    };
  }

  const datasets =
    parsed.datasets &&
    typeof parsed.datasets ===
      'object'
      ? parsed.datasets
      : {};

  const requiredKeys =
    analysisDataStoreDatasetKeys_();

  const complete =
    requiredKeys.every(
      key =>
        datasets[key] &&
        Array.isArray(
          datasets[key].headers
        ) &&
        Array.isArray(
          datasets[key].rows
        )
    );

  if (!complete) {
    return {
      ok: false,
      reason: 'DATASETS'
    };
  }

  if (
    !datasets
      .applicationData
      .rows.length
  ) {
    return {
      ok: false,
      reason: 'NO_APPLICATION_DATA'
    };
  }

  return {
    ok: true,
    datasets
  };
}

function writeAnalysisDataStore_(
  ss,
  payload,
  requestId,
  stateContext
) {
  const startedAt =
    Date.now();

  const buildObjectStartedAt =
    Date.now();

  const dataObject =
    buildAnalysisDataStoreObject_(
      ss,
      payload,
      requestId
    );

  const buildObjectMs =
    perfMs_(
      buildObjectStartedAt
    );

  const serializeStartedAt =
    Date.now();

  const content =
    JSON.stringify(
      dataObject
    );

  const serializeMs =
    perfMs_(
      serializeStartedAt
    );

  const folderStartedAt =
    Date.now();

  const folder =
    getOrCreateAnalysisDataStoreFolder_();

  const folderMs =
    perfMs_(
      folderStartedAt
    );

  const safeRequestId =
    normalizeString_(
      requestId
    )
      .replace(
        /[^A-Za-z0-9_-]/g,
        ''
      )
      .slice(
        0,
        48
      ) ||
    String(
      Date.now()
    );

  const newFileName =
    'analysis_data_' +
    ss.getId() +
    '_' +
    safeRequestId +
    '.json';

  let newFile = null;

  try {
    const createStartedAt =
      Date.now();

    newFile =
      folder.createFile(
        newFileName,
        content,
        MimeType.PLAIN_TEXT
      );

    const createMs =
      perfMs_(
        createStartedAt
      );

    const verifyReadStartedAt =
      Date.now();

    const verifyContent =
      newFile
        .getBlob()
        .getDataAsString(
          'UTF-8'
        );

    const verifyReadMs =
      perfMs_(
        verifyReadStartedAt
      );

    const verifyParseStartedAt =
      Date.now();

    const verifyParsed =
      JSON.parse(
        verifyContent
      );

    const verifyParseMs =
      perfMs_(
        verifyParseStartedAt
      );

    const validationStartedAt =
      Date.now();

    const validation =
      validateAnalysisDataStoreObject_(
        verifyParsed,
        ss.getId(),
        requestId
      );

    const validationMs =
      perfMs_(
        validationStartedAt
      );

    if (!validation.ok) {
      const e =
        new Error(
          '分析データストアの書込後検証に失敗しました: ' +
          validation.reason
        );

      e.code =
        'ANALYSIS_DATASTORE_VERIFY_ERROR';

      throw e;
    }

    const stateReadStartedAt =
      Date.now();

    const stateData =
      getRequestStateData_(
        ss,
        stateContext
      );

    const stateReadMs =
      perfMs_(
        stateReadStartedAt
      );

    const previousFileId =
      normalizeString_(
        stateData
          .map
          .analysisDataStoreFileId
      );

    const newFileIdStartedAt =
      Date.now();

    const newFileId =
      newFile.getId();

    const newFileIdMs =
      perfMs_(
        newFileIdStartedAt
      );

    const commitStartedAt =
      Date.now();

    const committedStateData =
      stateContext
        ? setRequestStateValues_(
            ss,
            stateContext,
            {
              analysisDataStoreFileId:
                newFileId,
        analysisDataStoreVersion:
          API_CONFIG
            .ANALYSIS_DATASTORE_VERSION,
        analysisDataStoreRequestId:
          normalizeString_(
            requestId
          ),
        analysisDataStoreUpdatedAt:
          new Date(),
        analysisDataStoreChars:
          content.length,
        analysisDataStoreApplicationRows:
          dataObject
            .datasets
            .applicationData
            .rows
            .length,
        analysisDataStoreJobRows:
          dataObject
            .datasets
            .jobAnalysisMaster
            .rows
            .length,
        commonMasterVersion:
          dataObject
            .commonMasterVersion,
            }
          )
        : rptSetStateValues_(
            ss,
            {
              analysisDataStoreFileId:
                newFileId,
              analysisDataStoreVersion:
                API_CONFIG
                  .ANALYSIS_DATASTORE_VERSION,
              analysisDataStoreRequestId:
                normalizeString_(
                  requestId
                ),
              analysisDataStoreUpdatedAt:
                new Date(),
              analysisDataStoreChars:
                content.length,
              analysisDataStoreApplicationRows:
                dataObject
                  .datasets
                  .applicationData
                  .rows
                  .length,
              analysisDataStoreJobRows:
                dataObject
                  .datasets
                  .jobAnalysisMaster
                  .rows
                  .length,
              commonMasterVersion:
                dataObject
                  .commonMasterVersion,
            },
            stateData
          );

    const commitMs =
      perfMs_(
        commitStartedAt
      );

    const cleanupStartedAt =
      Date.now();

    let cleanupFiles = 0;

    [
      previousFileId
    ]
      .filter(
        fileId =>
          fileId &&
          fileId !==
            newFileId
      )
      .forEach(
        fileId => {
          try {
            DriveApp
              .getFileById(
                fileId
              )
              .setTrashed(
                true
              );

            cleanupFiles++;
          } catch (_) {}
        }
      );

    const cleanupMs =
      perfMs_(
        cleanupStartedAt
      );

    return {
      fileId:
        newFileId,
      mode:
        previousFileId
          ? 'REPLACE'
          : 'CREATE',
      chars:
        content.length,
      buildObjectMs,
      serializeMs,
      folderMs,
      createMs,
      verifyReadMs,
      verifyParseMs,
      validationMs,
      stateReadMs,
      newFileIdMs,
      commitMs,
      cleanupMs,
      cleanupFiles,
      stateData:
        committedStateData,
      totalMs:
        perfMs_(
          startedAt
        )
    };

  } catch (err) {
    if (newFile) {
      try {
        newFile.setTrashed(
          true
        );
      } catch (_) {}
    }

    throw err;
  }
}

function readAnalysisDataStore_(
  ss,
  stateMap
) {
  const startedAt =
    Date.now();

  const result = {
    ok: false,
    status: '',
    datasets: {},
    readMs: 0,
    parseMs: 0,
    totalMs: 0,
    chars: 0,
    fileId: ''
  };

  const fileId =
    normalizeString_(
      stateMap &&
      stateMap
        .analysisDataStoreFileId
    );

  const stateVersion =
    normalizeString_(
      stateMap &&
      stateMap
        .analysisDataStoreVersion
    );

  const stateRequestId =
    normalizeString_(
      stateMap &&
      stateMap
        .analysisDataStoreRequestId
    );

  if (!fileId) {
    result.status =
      'MISS_NO_DATASTORE';

    result.totalMs =
      perfMs_(
        startedAt
      );

    return result;
  }

  if (
    !schemaVersionsEqual_(
      stateVersion,
      API_CONFIG
        .ANALYSIS_DATASTORE_VERSION
    )
  ) {
    result.status =
      'MISS_DATASTORE_VERSION';

    result.totalMs =
      perfMs_(
        startedAt
      );

    return result;
  }

  result.fileId =
    fileId;

  try {
    const readStartedAt =
      Date.now();

    const file =
      DriveApp.getFileById(
        fileId
      );

    const content =
      file
        .getBlob()
        .getDataAsString(
          'UTF-8'
        );

    result.readMs =
      perfMs_(
        readStartedAt
      );

    result.chars =
      content.length;

    const parseStartedAt =
      Date.now();

    const parsed =
      JSON.parse(
        content
      );

    result.parseMs =
      perfMs_(
        parseStartedAt
      );

    const validation =
      validateAnalysisDataStoreObject_(
        parsed,
        ss.getId(),
        stateRequestId
      );

    if (!validation.ok) {
      result.status =
        'MISS_DATASTORE_INVALID_' +
        validation.reason;

      result.totalMs =
        perfMs_(
          startedAt
        );

      return result;
    }

    result.ok = true;
    result.status = 'HIT';
    result.datasets =
      validation.datasets;
    result.totalMs =
      perfMs_(
        startedAt
      );

    return result;

  } catch (err) {
    result.status =
      'MISS_DATASTORE_READ_ERROR';

    result.error =
      safeErrorMessage_(
        err
      );

    result.totalMs =
      perfMs_(
        startedAt
      );

    return result;
  }
}

function analysisDataStoreRowCount_(
  stateMap,
  datasetKey
) {
  const keyMap = {
    applicationData:
      'analysisDataStoreApplicationRows',
    jobAnalysisMaster:
      'analysisDataStoreJobRows'
  };

  const stateKey =
    keyMap[
      datasetKey
    ];

  if (!stateKey) {
    return 0;
  }

  const value =
    Number(
      stateMap &&
      stateMap[
        stateKey
      ]
    );

  return (
    isFinite(value) &&
    value >= 0
      ? value
      : 0
  );
}

function readViewerDatasetMeasured_(
  ss,
  sheetName
) {
  const startedAt =
    Date.now();

  const dataset =
    readViewerDataset_(
      ss,
      sheetName
    );

  return {
    dataset,
    elapsedMs:
      perfMs_(startedAt)
  };
}
