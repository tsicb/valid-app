function doGet() {
  const props = PropertiesService.getScriptProperties();
  return jsonOutput_({
    ok: true,
    service: 'valid-application-analysis-sheet-api',
    schemaVersion:
      props.getProperty('SCHEMA_VERSION') ||
      API_CONFIG.DEFAULT_SCHEMA_VERSION,
    appVersion:
      props.getProperty('APP_VERSION') ||
      API_CONFIG.DEFAULT_APP_VERSION,
    outputFolderId:
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
    sheetOutputFolderId:
      API_CONFIG.SHEET_OUTPUT_FOLDER_ID,
    rootFolderId:
      API_CONFIG.ROOT_FOLDER_ID,
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  const startedAt = Date.now();
  let requestId = '';
  let requestRecord = null;
  let lastCompletedStage = '';
  let currentPhase = 'VALIDATING';
  let operationMode = 'CREATE';
  let targetSpreadsheetId = '';
  let requestPerformance = null;
  const pipelineTrace = {
    transportMode:
      'PLAIN_JSON',
    transportBodyChars: 0,
    transportExpandedChars: 0,
    transportBase64DecodeMs: 0,
    transportUngzipMs: 0,
    transportInnerParseMs: 0
  };

  try {
    const bodyReadStartedAt =
      Date.now();

    const bodyText =
      e && e.postData && e.postData.contents
        ? String(e.postData.contents)
        : '';

    pipelineTrace.bodyReadMs =
      perfMs_(
        bodyReadStartedAt
      );

    pipelineTrace.transportBodyChars =
      bodyText.length;

    if (!bodyText) {
      return errorOutput_(
        'INVALID_PAYLOAD',
        'POST本文が空です.'
      );
    }

    if (
      bodyText.length >
      API_CONFIG.MAX_BODY_CHARS
    ) {
      return errorOutput_(
        'PAYLOAD_TOO_LARGE',
        `POST本文が大きすぎます (${bodyText.length.toLocaleString()} chars).`
      );
    }

    let payload;

    const jsonParseStartedAt =
      Date.now();

    try {
      payload = JSON.parse(bodyText);
    } catch (err) {
      return errorOutput_(
        'INVALID_JSON',
        'JSONを解析できませんでした.'
      );
    }

    pipelineTrace.jsonParseMs =
      perfMs_(
        jsonParseStartedAt
      );

    const transportEncoding =
      normalizeString_(
        payload &&
        payload.transportEncoding
      ).toUpperCase();

    if (
      transportEncoding ===
        'GZIP_BASE64_V1'
    ) {
      const payloadBase64 =
        normalizeString_(
          payload.payloadBase64
        );

      if (!payloadBase64) {
        return errorOutput_(
          'INVALID_COMPRESSED_PAYLOAD',
          '圧縮payload本体がありません.'
        );
      }

      let compressedBytes;

      const decodeStartedAt =
        Date.now();

      try {
        compressedBytes =
          Utilities.base64Decode(
            payloadBase64
          );
      } catch (err) {
        return errorOutput_(
          'INVALID_COMPRESSED_PAYLOAD',
          '圧縮payloadのBase64を解析できませんでした.'
        );
      }

      pipelineTrace
        .transportBase64DecodeMs =
        perfMs_(
          decodeStartedAt
        );

      const ungzipStartedAt =
        Date.now();

      let expandedText;

      try {
        expandedText =
          Utilities
            .ungzip(
              Utilities.newBlob(
                compressedBytes,
                'application/gzip',
                'payload.json.gz'
              )
            )
            .getDataAsString(
              'UTF-8'
            );
      } catch (err) {
        return errorOutput_(
          'INVALID_COMPRESSED_PAYLOAD',
          '圧縮payloadを展開できませんでした.'
        );
      }

      pipelineTrace
        .transportUngzipMs =
        perfMs_(
          ungzipStartedAt
        );

      pipelineTrace
        .transportExpandedChars =
        expandedText.length;

      if (
        expandedText.length >
        API_CONFIG.MAX_BODY_CHARS
      ) {
        return errorOutput_(
          'PAYLOAD_TOO_LARGE',
          `展開後payloadが大きすぎます (${expandedText.length.toLocaleString()} chars).`
        );
      }

      const innerParseStartedAt =
        Date.now();

      try {
        payload =
          JSON.parse(
            expandedText
          );
      } catch (err) {
        return errorOutput_(
          'INVALID_COMPRESSED_PAYLOAD',
          '展開後payloadをJSONとして解析できませんでした.'
        );
      }

      pipelineTrace
        .transportInnerParseMs =
        perfMs_(
          innerParseStartedAt
        );

      pipelineTrace.transportMode =
        'GZIP_BASE64_V1';

    } else {
      pipelineTrace
        .transportExpandedChars =
        bodyText.length;
    }

    // 企業向け閲覧Pagesは社内ACCESS_KEYではなく、
    // 読み取り専用viewerTokenで認証する。
    const actionName =
      normalizeString_(payload.action)
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase();

    if (
      actionName ===
      'VIEWERDATA'
    ) {
      return handleViewerData_(payload);
    }

    if (
      actionName ===
      'MANAGEAUTHCHECK'
    ) {
      return handleManageAuthCheck_(payload);
    }

    if (
      actionName ===
      'MANAGELISTOUTPUTFOLDERS'
    ) {
      return handleManageListOutputFolders_(payload);
    }

    if (
      actionName ===
      'MANAGEDIAGNOSTICS'
    ) {
      return handleManageDiagnostics_(payload);
    }

    if (
      actionName ===
      'MANAGELISTREPORTS'
    ) {
      return handleManageListReports_(payload);
    }

    if (
      actionName ===
      'MANAGEIDENTITY'
    ) {
      return handleManageIdentity_(payload);
    }

    if (
      actionName ===
      'MANAGESHARINGLOAD'
    ) {
      return handleManageSharingLoad_(payload);
    }

    if (
      actionName ===
      'MANAGELOAD'
    ) {
      return handleManageLoad_(payload);
    }

    if (
      actionName ===
      'MANAGESAVE'
    ) {
      return handleManageSave_(payload);
    }

    if (
      actionName ===
      'MANAGERETRYIMAGES'
    ) {
      return handleManageRetryImages_(payload);
    }

    if (
      actionName ===
      'MANAGEVIEWERSETENABLED'
    ) {
      return handleManageViewerSetEnabled_(payload);
    }

    if (
      actionName ===
      'MANAGEVIEWERROTATE'
    ) {
      return handleManageViewerRotate_(payload);
    }

    if (
      actionName ===
      'MANAGEVIEWERSETSHARESTATUS'
    ) {
      return handleManageViewerSetShareStatus_(payload);
    }

    requestId =
      normalizeString_(payload.requestId);

    targetSpreadsheetId =
      extractSpreadsheetId_(
        payload.targetSpreadsheetUrl ||
        payload.targetSpreadsheetId
      );

    operationMode =
      targetSpreadsheetId
        ? 'UPDATE'
        : 'CREATE';

    const payloadValidationStartedAt =
      Date.now();

    const validation =
      validateEnvelope_(payload);

    pipelineTrace.payloadValidationMs =
      perfMs_(
        payloadValidationStartedAt
      );

    if (!validation.ok) {
      return errorOutput_(
        validation.code,
        validation.message
      );
    }

    if (
      normalizeString_(
        payload.targetSpreadsheetUrl ||
        payload.targetSpreadsheetId
      ) &&
      !targetSpreadsheetId
    ) {
      return errorOutput_(
        'TARGET_INVALID',
        '更新先の個社管理シートURLを確認できませんでした.'
      );
    }

    const propertiesStartedAt =
      Date.now();

    const props =
      PropertiesService
        .getScriptProperties();

    pipelineTrace.scriptPropertiesMs =
      perfMs_(
        propertiesStartedAt
      );

    pipelineTrace.preflightMs =
      perfMs_(
        startedAt
      );

    const requestCoordinationStartedAt =
      Date.now();

    const lock =
      LockService
        .getScriptLock();

    const lockWaitStartedAt =
      Date.now();

    lock.waitLock(20000);

    const lockWaitMs =
      perfMs_(
        lockWaitStartedAt
      );

    try {
      requestRecord =
        getRequestRecord_(
          props,
          requestId
        );

      if (
        requestRecord &&
        !requestRecordFileExists_(
          requestRecord
        )
      ) {
        deleteRequestRecord_(
          props,
          requestId
        );

        requestRecord = null;
      }

      if (requestRecord) {
        const recordMode =
          normalizeString_(
            requestRecord.operationMode
          ) || 'CREATE';

        const recordTarget =
          normalizeString_(
            requestRecord.targetSpreadsheetId
          );

        if (
          recordMode !== operationMode ||
          (
            operationMode === 'UPDATE' &&
            recordTarget &&
            recordTarget !== targetSpreadsheetId
          )
        ) {
          return errorOutput_(
            'REQUEST_TARGET_MISMATCH',
            '同じrequestIdに別の処理対象が指定されています.'
          );
        }
      }

      if (
        requestRecord &&
        requestRecord.status === 'READY'
      ) {
        return jsonOutput_(
          buildReadyResponse_(
            requestRecord,
            requestId,
            true,
            startedAt
          )
        );
      }

      if (!requestRecord) {
        const nowIso =
          new Date().toISOString();

        if (operationMode === 'CREATE') {
          currentPhase =
            'CREATING_WORKBOOK';

          const createWorkbookStartedAt =
            Date.now();

          const outputFolder =
            resolveCreateOutputFolder_(
              payload
            );

          const outputFolderId =
            outputFolder.getId();

          const createdSpreadsheet =
            SpreadsheetApp.create(
              buildOutputFileName_(
                payload
              )
            );

          const spreadsheetId =
            createdSpreadsheet.getId();

          const createdFile =
            DriveApp.getFileById(
              spreadsheetId
            );

          createdFile.moveTo(
            outputFolder
          );

          requestRecord = {
            requestId,
            operationMode: 'CREATE',
            targetSpreadsheetId: '',
            status: 'CREATED',
            stage: 'CREATED',
            spreadsheetId,
            spreadsheetUrl:
              buildSpreadsheetUrl_(
                spreadsheetId
              ),
            fileName:
              createdFile.getName(),
            outputFolderId:
              outputFolderId,
            outputFolderName:
              outputFolder.getName(),
            createdAt: nowIso,
            updatedAt: nowIso,
            leaseUntil: '',
            processingStartedAt: '',
            lastErrorCode: '',
            lastErrorMessage: '',
            lastPhase:
              'CREATING_WORKBOOK',
            performance: {
              createWorkbookMs:
                perfMs_(
                  createWorkbookStartedAt
                ),
              lockWaitMs:
                lockWaitMs,
              settleWaitConfiguredMs:
                API_CONFIG
                  .COPY_SETTLE_MS,
              datasetWrites: {}
            }
          };

          requestPerformance =
            ensureRequestPerformance_(
              requestRecord
            );

          saveRequestRecord_(
            props,
            requestId,
            requestRecord
          );

          pruneRequestProperties_(props);

        } else {
          currentPhase =
            'VALIDATING_TARGET';

          const targetValidationStartedAt =
            Date.now();

          const outputFolderId =
            API_CONFIG.SHEET_OUTPUT_FOLDER_ID;

          const targetFile =
            validateUpdateTargetDriveFile_(
              targetSpreadsheetId,
              outputFolderId
            );

          requestRecord = {
            requestId,
            operationMode: 'UPDATE',
            targetSpreadsheetId:
              targetSpreadsheetId,
            status: 'TARGET_VALIDATED',
            stage: 'TARGET_VALIDATED',
            spreadsheetId:
              targetSpreadsheetId,
            spreadsheetUrl:
              buildSpreadsheetUrl_(
                targetSpreadsheetId
              ),
            fileName:
              targetFile.getName(),
            createdAt: nowIso,
            updatedAt: nowIso,
            leaseUntil: '',
            processingStartedAt: '',
            lastErrorCode: '',
            lastErrorMessage: '',
            lastPhase:
              'VALIDATING_TARGET',
            performance: {
              targetValidationMs:
                perfMs_(
                  targetValidationStartedAt
                ),
              datasetWrites: {}
            }
          };

          saveRequestRecord_(
            props,
            requestId,
            requestRecord
          );

          pruneRequestProperties_(props);
        }
      }

      requestPerformance =
        ensureRequestPerformance_(
          requestRecord
        );

      if (
        operationMode !== 'CREATE' ||
        normalizeString_(
          requestRecord.stage
        ) !== 'CREATED'
      ) {
        addPerfMs_(
          requestPerformance,
          'lockWaitMs',
          lockWaitMs
        );
      }

      operationMode =
        normalizeString_(
          requestRecord.operationMode
        ) || 'CREATE';

      targetSpreadsheetId =
        normalizeString_(
          requestRecord.targetSpreadsheetId
        );

      lastCompletedStage =
        normalizeString_(
          requestRecord.stage
        ) ||
        (
          operationMode === 'UPDATE'
            ? 'TARGET_VALIDATED'
            : 'CREATED'
        );

      if (
        requestRecord.status ===
          'PROCESSING' &&
        isLeaseActive_(
          requestRecord
        )
      ) {
        const leaseRemaining =
          Math.max(
            1000,
            Date.parse(
              requestRecord
                .leaseUntil
            ) -
            Date.now()
          );

        return jsonOutput_({
          ok: true,
          pending: true,
          reused: true,
          operationMode:
            operationMode,
          requestId,
          status:
            requestRecord.status,
          stage:
            requestRecord.stage,
          spreadsheetId:
            requestRecord
              .spreadsheetId,
          spreadsheetUrl:
            requestRecord
              .spreadsheetUrl,
          fileName:
            requestRecord
              .fileName || '',
          retryAfterMs:
            Math.min(
              API_CONFIG
                .PENDING_RETRY_MS,
              leaseRemaining
            ),
          message:
            '同じrequestIdの処理がGoogle側で継続中です.',
          elapsedMs:
            Date.now() -
            startedAt,
          performance:
            requestRecord
              .performance ||
            {}
        });
      }

      const now =
        Date.now();

      requestRecord.status =
        'PROCESSING';

      requestRecord
        .processingStartedAt =
        new Date(now)
          .toISOString();

      requestRecord.leaseUntil =
        new Date(
          now +
          API_CONFIG
            .PROCESS_LEASE_MS
        ).toISOString();

      requestRecord.updatedAt =
        new Date(now)
          .toISOString();

      requestRecord
        .lastErrorCode = '';

      requestRecord
        .lastErrorMessage = '';

      saveRequestRecord_(
        props,
        requestId,
        requestRecord
      );

    } finally {
      lock.releaseLock();
    }

    pipelineTrace.requestCoordinationMs =
      perfMs_(
        requestCoordinationStartedAt
      );

    if (requestPerformance) {
      Object.assign(
        requestPerformance,
        pipelineTrace
      );
    }

    currentPhase =
      'OPENING_SPREADSHEET';

    const driveRevalidationStartedAt =
      Date.now();

    // UPDATEは再試行時も毎回、出力フォルダ直下のGoogle Sheetsか再確認する。
    if (
      operationMode === 'UPDATE'
    ) {
      validateUpdateTargetDriveFile_(
        requestRecord.spreadsheetId,
        API_CONFIG.SHEET_OUTPUT_FOLDER_ID
      );
    }

    if (
      operationMode === 'UPDATE'
    ) {
      addPerfMs_(
        requestPerformance,
        'driveRevalidationMs',
        perfMs_(
          driveRevalidationStartedAt
        )
      );
    }

    const openSpreadsheetStartedAt =
      Date.now();

    const ss =
      SpreadsheetApp.openById(
        requestRecord
          .spreadsheetId
      );

    addPerfMs_(
      requestPerformance,
      'openSpreadsheetMs',
      perfMs_(
        openSpreadsheetStartedAt
      )
    );

    const requestStateContext =
      createRequestStateContext_();

    if (
      operationMode === 'UPDATE'
    ) {
      currentPhase =
        'VALIDATING_WORKBOOK';

      const validateWorkbookStartedAt =
        Date.now();

      const validationStateData =
        getRequestStateData_(
          ss,
          requestStateContext
        );

      validateUpdateTargetWorkbook_(
        ss,
        validationStateData
      );

      addPerfMs_(
        requestPerformance,
        'validateWorkbookMs',
        perfMs_(
          validateWorkbookStartedAt
        )
      );
    }

    requestRecord.stage =
      'OPENED';

    requestRecord.status =
      'PROCESSING';

    requestRecord.updatedAt =
      new Date()
        .toISOString();

    requestRecord.lastPhase =
      currentPhase;

    const openedStateSaveStartedAt =
      Date.now();

    saveRequestRecord_(
      props,
      requestId,
      requestRecord
    );

    requestPerformance
      .openedStateSaveMs =
      perfMs_(
        openedStateSaveStartedAt
      );

    let writeSummary = {};

    if (
      stageRank_(
        lastCompletedStage
      ) <
      stageRank_(
        'DATA_WRITTEN'
      )
    ) {
      currentPhase =
        operationMode === 'UPDATE'
          ? 'UPDATING_DATA'
          : 'WRITING_DATA';

      const dataWriteStartedAt =
        Date.now();

      if (
        operationMode === 'UPDATE'
      ) {
        const updateDatasetKeys = [
          'jobAnalysisMaster',
          'processInfo',
          'inputFiles'
        ];

        updateDatasetKeys
          .forEach(
            datasetKey => {
              const dataset =
                payload
                  .datasets[
                    datasetKey
                  ];

              const sheetInfo =
                DATASET_SHEETS[
                  datasetKey
                ];

              writeSummary[
                datasetKey
              ] =
                writeDataset_(
                  ss,
                  sheetInfo.name,
                  dataset,
                  sheetInfo.hidden
                );
            }
          );

        const imageMergeStartedAt =
          Date.now();

        writeSummary
          .imageMasterInitial =
          mergeImageMasterForUpdate_(
            ss,
            payload
              .datasets
              .imageMasterInitial,
            requestStateContext
          );

        addPerfMs_(
          requestPerformance,
          'imageMasterMergeMs',
          perfMs_(
            imageMergeStartedAt
          )
        );

        const imageMergePerf =
          (
            writeSummary
              .imageMasterInitial &&
            writeSummary
              .imageMasterInitial
              .performance
          ) ||
          {};

        requestPerformance
          .imageMasterMergeMode =
          normalizeString_(
            imageMergePerf.mode
          );

        requestPerformance
          .imageMasterSignatureComputeMs =
          Number(
            imageMergePerf
              .signatureComputeMs || 0
          );

        requestPerformance
          .imageMasterSignatureStateReadMs =
          Number(
            imageMergePerf
              .signatureStateReadMs || 0
          );

        requestPerformance
          .imageMasterSignatureStateWriteMs =
          Number(
            imageMergePerf
              .signatureStateWriteMs || 0
          );

        requestPerformance
          .imageMasterSignatureMatched =
          !!imageMergePerf
            .signatureMatched;

        requestPerformance
          .imageMasterEnsureSheetMs =
          Number(
            imageMergePerf
              .ensureSheetMs || 0
          );

        requestPerformance
          .imageMasterReadMs =
          Number(
            imageMergePerf
              .readMs || 0
          );

        requestPerformance
          .imageMasterComputeMs =
          Number(
            imageMergePerf
              .computeMs || 0
          );

        requestPerformance
          .imageMasterChangedRowsWriteMs =
          Number(
            imageMergePerf
              .changedRowsWriteMs || 0
          );

        requestPerformance
          .imageMasterAppendRowsWriteMs =
          Number(
            imageMergePerf
              .appendRowsWriteMs || 0
          );

        requestPerformance
          .imageMasterFullRewriteMs =
          Number(
            imageMergePerf
              .fullRewriteMs || 0
          );

        requestPerformance
          .imageMasterChangedRows =
          Number(
            imageMergePerf
              .changedRows || 0
          );

        requestPerformance
          .imageMasterAppendedRows =
          Number(
            imageMergePerf
              .appendedRows || 0
          );

        const enterpriseMergeStartedAt =
          Date.now();

        const enterpriseMergeInfo =
          mergeEnterpriseMasterForUpdate_(
            ss,
            payload
              .datasets
              .applicationData,
            requestStateContext
          );

        addPerfMs_(
          requestPerformance,
          'enterpriseMergeMs',
          perfMs_(
            enterpriseMergeStartedAt
          )
        );

        const enterpriseMergePerf =
          (
            enterpriseMergeInfo &&
            enterpriseMergeInfo
              .performance
          ) ||
          {};

        requestPerformance
          .enterpriseMergeMode =
          normalizeString_(
            enterpriseMergePerf.mode
          );

        requestPerformance
          .enterpriseSignatureComputeMs =
          Number(
            enterpriseMergePerf
              .signatureComputeMs || 0
          );

        requestPerformance
          .enterpriseSignatureStateReadMs =
          Number(
            enterpriseMergePerf
              .signatureStateReadMs || 0
          );

        requestPerformance
          .enterpriseSignatureStateWriteMs =
          Number(
            enterpriseMergePerf
              .signatureStateWriteMs || 0
          );

        requestPerformance
          .enterpriseEnsureSheetMs =
          Number(
            enterpriseMergePerf
              .ensureSheetMs || 0
          );

        requestPerformance
          .enterpriseReadMs =
          Number(
            enterpriseMergePerf
              .readMs || 0
          );

        requestPerformance
          .enterpriseComputeMs =
          Number(
            enterpriseMergePerf
              .computeMs || 0
          );

        requestPerformance
          .enterpriseWriteMs =
          Number(
            enterpriseMergePerf
              .writeMs || 0
          );

        requestPerformance
          .enterpriseIncomingIds =
          Number(
            enterpriseMergePerf
              .incomingIds || 0
          );

        requestPerformance
          .enterpriseExistingIds =
          Number(
            enterpriseMergePerf
              .existingIds || 0
          );

        requestPerformance
          .enterpriseAppendedIds =
          Number(
            enterpriseMergePerf
              .appendedIds || 0
          );

      } else {
        Object.keys(
          DATASET_SHEETS
        ).forEach(
          datasetKey => {
            const dataset =
              payload
                .datasets[
                  datasetKey
                ];

            const sheetInfo =
              DATASET_SHEETS[
                datasetKey
              ];

            writeSummary[
              datasetKey
            ] =
              writeDataset_(
                ss,
                sheetInfo.name,
                dataset,
                sheetInfo.hidden
              );
          }
        );

        writeInitialSettings_(
          ss,
          payload
            .initialSettings ||
            {}
        );

        initializeKeywordMaster_(
          ss,
          payload
            .initialSettings ||
            {}
        );

        initializeEnterpriseMaster_(
          ss,
          payload
            .datasets
            .applicationData,
          payload
            .companyDisplayName
        );

      }

      cleanupDefaultBlankSheet_(
        ss
      );

      Object.keys(
        writeSummary
      ).forEach(
        key => {
          const item =
            writeSummary[key];

          if (
            item &&
            item.performance
          ) {
            requestPerformance
              .datasetWrites[key] =
              item.performance;
          }
        }
      );

      const writeFlushStartedAt =
        Date.now();

      SpreadsheetApp.flush();

      addPerfMs_(
        requestPerformance,
        'writeFlushMs',
        perfMs_(
          writeFlushStartedAt
        )
      );

      addPerfMs_(
        requestPerformance,
        'dataWriteMs',
        perfMs_(
          dataWriteStartedAt
        )
      );


const analysisDataStoreWriteStartedAt =
  Date.now();

const analysisDataStoreInfo =
  writeAnalysisDataStore_(
    ss,
    payload,
    requestId,
    requestStateContext
  );

requestPerformance
  .analysisDataStoreWriteMs =
  perfMs_(
    analysisDataStoreWriteStartedAt
  );

requestPerformance
  .analysisDataStoreBuildObjectMs =
  Number(
    analysisDataStoreInfo
      .buildObjectMs || 0
  );

requestPerformance
  .analysisDataStoreSerializeMs =
  Number(
    analysisDataStoreInfo
      .serializeMs || 0
  );

requestPerformance
  .analysisDataStoreFolderMs =
  Number(
    analysisDataStoreInfo
      .folderMs || 0
  );

requestPerformance
  .analysisDataStoreCreateMs =
  Number(
    analysisDataStoreInfo
      .createMs || 0
  );

requestPerformance
  .analysisDataStoreVerifyReadMs =
  Number(
    analysisDataStoreInfo
      .verifyReadMs || 0
  );

requestPerformance
  .analysisDataStoreVerifyParseMs =
  Number(
    analysisDataStoreInfo
      .verifyParseMs || 0
  );

requestPerformance
  .analysisDataStoreValidationMs =
  Number(
    analysisDataStoreInfo
      .validationMs || 0
  );

requestPerformance
  .analysisDataStoreStateReadMs =
  Number(
    analysisDataStoreInfo
      .stateReadMs || 0
  );

requestPerformance
  .analysisDataStoreFileIdMs =
  Number(
    analysisDataStoreInfo
      .newFileIdMs || 0
  );

requestPerformance
  .analysisDataStoreCommitMs =
  Number(
    analysisDataStoreInfo
      .commitMs || 0
  );

requestPerformance
  .analysisDataStoreCleanupMs =
  Number(
    analysisDataStoreInfo
      .cleanupMs || 0
  );

requestPerformance
  .analysisDataStoreCleanupFiles =
  Number(
    analysisDataStoreInfo
      .cleanupFiles || 0
  );

requestPerformance
  .analysisDataStoreChars =
  Number(
    analysisDataStoreInfo
      .chars || 0
  );

requestPerformance
  .analysisDataStoreMode =
  normalizeString_(
    analysisDataStoreInfo
      .mode
  );

      requestRecord.stage =
        'DATA_WRITTEN';

      requestRecord.updatedAt =
        new Date()
          .toISOString();

      requestRecord.lastPhase =
        currentPhase;

      const dataWrittenStateSaveStartedAt =
        Date.now();

      saveRequestRecord_(
        props,
        requestId,
        requestRecord
      );

      requestPerformance
        .dataWrittenStateSaveMs =
        perfMs_(
          dataWrittenStateSaveStartedAt
        );

      lastCompletedStage =
        'DATA_WRITTEN';
    }

    if (
      stageRank_(
        lastCompletedStage
      ) <
      stageRank_(
        'REPORT_DONE'
      )
    ) {
      currentPhase =
        'FINALIZING_VIEWER';

      const viewerFinalizeStartedAt =
        Date.now();

      const finalizeThinStartedAt =
        Date.now();

      const finalizeInfo =
        finalizeDataStoreWorkbook_(
          ss,
          operationMode === 'CREATE'
            ? 'CREATE'
            : 'CSV_UPDATE',
          {
            operationMode,
            requestId,
            storageLayout:
              API_CONFIG
                .CURRENT_STORAGE_LAYOUT
          },
          requestStateContext
        );

      addPerfMs_(
        requestPerformance,
        'finalizeThinWorkbookMs',
        perfMs_(
          finalizeThinStartedAt
        )
      );

      const finalizePerf =
        finalizeInfo.performance ||
        {};

      requestPerformance
        .finalizeCustomAnalysisEnsureMs =
        Number(
          finalizePerf
            .customAnalysisEnsureMs ||
          0
        );

      requestPerformance
        .finalizeDisplaySettingsEnsureMs =
        Number(
          finalizePerf
            .displaySettingsEnsureMs ||
          0
        );

      requestPerformance
        .finalizeAuditSheetEnsureMs =
        Number(
          finalizePerf
            .auditSheetEnsureMs ||
          0
        );

      requestPerformance
        .finalizeStateReadMs =
        Number(
          finalizePerf
            .stateReadMs ||
          0
        );

      requestPerformance
        .finalizeStateWriteMs =
        Number(
          finalizePerf
            .stateWriteMs ||
          0
        );

      const ensureViewerAccessStartedAt =
        Date.now();

      const viewerInfo =
        ensureViewerAccess_(
          ss,
          props,
          payload.viewerBaseUrl,
          payload.manageBaseUrl,
          true,
          finalizeInfo.stateData,
          requestStateContext
        );

      addPerfMs_(
        requestPerformance,
        'ensureViewerAccessMs',
        perfMs_(
          ensureViewerAccessStartedAt
        )
      );

      const viewerAccessPerf =
        viewerInfo.performance ||
        {};

      requestPerformance
        .viewerAccessStateReadMs =
        Number(
          viewerAccessPerf
            .stateReadMs ||
          0
        );

      requestPerformance
        .viewerAccessStateWriteMs =
        Number(
          viewerAccessPerf
            .stateWriteMs ||
          0
        );

      requestPerformance
        .viewerAccessMappingReadMs =
        Number(
          viewerAccessPerf
            .mappingReadMs ||
          0
        );

      requestPerformance
        .viewerAccessMappingWriteMs =
        Number(
          viewerAccessPerf
            .mappingWriteMs ||
          0
        );

      requestPerformance
        .viewerAccessPortalWriteMs =
        Number(
          viewerAccessPerf
            .portalWriteMs ||
          0
        );

      requestPerformance
        .viewerAccessChangedKeys =
        Array.isArray(
          viewerInfo.changedKeys
        )
          ? viewerInfo.changedKeys
          : [];

      const auditEventStartedAt =
        Date.now();

      appendAuditEvent_(
        ss,
        operationMode === 'CREATE'
          ? 'DATA_CREATE'
          : 'DATA_UPDATE',
        'SUCCESS',
        'PAGES_ETL',
        '応募 ' +
          Number(
            payload.datasets
              .applicationData
              .rows.length || 0
          ) +
          '件 / 求人分析 ' +
          Number(
            payload.datasets
              .jobAnalysisMaster
              .rows.length || 0
          ) +
          '件',
        requestId,
        finalizeInfo.auditSheet
      );

      requestPerformance
        .auditEventMs =
        perfMs_(
          auditEventStartedAt
        );

      const registryStartedAt =
        Date.now();

      const registryInfo =
        upsertReportRegistryFast_(
          ss,
          {
            stateData:
              viewerInfo.stateData ||
              finalizeInfo.stateData,
            viewerInfo,
            applicationCount:
              Number(
                payload.datasets
                  .applicationData
                  .rows.length || 0
              ),
            jobAnalysisCount:
              Number(
                payload.datasets
                  .jobAnalysisMaster
                  .rows.length || 0
              )
          }
        );

      requestPerformance
        .reportRegistryMs =
        perfMs_(
          registryStartedAt
        );

      const registryPerf =
        registryInfo.performance ||
        {};

      requestPerformance
        .reportRegistryEnterpriseLabelMs =
        Number(
          registryPerf
            .enterpriseLabelMs ||
          0
        );

      requestPerformance
        .reportRegistryPropertyWriteMs =
        Number(
          registryPerf
            .propertyWriteMs ||
          0
        );

      requestPerformance
        .metadataAuditRegistryMs =
        Number(
          requestPerformance
            .auditEventMs || 0
        ) +
        Number(
          requestPerformance
            .reportRegistryMs || 0
        );

      requestRecord.viewerUrl =
        viewerInfo.viewerUrl || '';

      requestRecord.manageUrl =
        viewerInfo.manageUrl || '';

      requestRecord.viewerEnabled =
        viewerInfo.viewerEnabled;

      requestRecord.storageLayout =
        API_CONFIG.CURRENT_STORAGE_LAYOUT;

      const finalizeFlushStartedAt =
        Date.now();

      SpreadsheetApp.flush();

      addPerfMs_(
        requestPerformance,
        'finalizeFlushMs',
        perfMs_(
          finalizeFlushStartedAt
        )
      );

      addPerfMs_(
        requestPerformance,
        'finalizeViewerMs',
        perfMs_(
          viewerFinalizeStartedAt
        )
      );

      requestRecord.stage =
        'REPORT_DONE';

      requestRecord.updatedAt =
        new Date()
          .toISOString();

      requestRecord.lastPhase =
        currentPhase;

      const reportDoneStateSaveStartedAt =
        Date.now();

      saveRequestRecord_(
        props,
        requestId,
        requestRecord
      );

      requestPerformance
        .reportDoneStateSaveMs =
        perfMs_(
          reportDoneStateSaveStartedAt
        );

      lastCompletedStage =
        'REPORT_DONE';
    }

    currentPhase =
      'FINALIZING';

    const readyFinalizeStartedAt =
      Date.now();

    requestRecord.status =
      'READY';

    requestRecord.stage =
      'READY';

    requestRecord
      .spreadsheetUrl =
      ss.getUrl();

    requestRecord.fileName =
      DriveApp
        .getFileById(
          requestRecord
            .spreadsheetId
        )
        .getName();

    requestRecord.updatedAt =
      new Date()
        .toISOString();

    requestRecord.leaseUntil =
      '';

    requestRecord
      .lastErrorCode = '';

    requestRecord
      .lastErrorMessage = '';

    requestRecord.lastPhase =
      currentPhase;

    addPerfMs_(
      requestPerformance,
      'readyFinalizeMs',
      perfMs_(
        readyFinalizeStartedAt
      )
    );

    const readyStateSaveStartedAt =
      Date.now();

    saveRequestRecord_(
      props,
      requestId,
      requestRecord
    );

    requestPerformance
      .readyStateSaveMs =
      perfMs_(
        readyStateSaveStartedAt
      );

    requestPerformance
      .requestStateSheetReadCount =
      Number(
        requestStateContext
          .sheetReadCount || 0
      );

    requestPerformance
      .requestStateCacheReuseCount =
      Number(
        requestStateContext
          .cacheReuseCount || 0
      );

    requestPerformance
      .requestStateSheetWriteCount =
      Number(
        requestStateContext
          .sheetWriteCount || 0
      );

    requestPerformance
      .requestStateSheetReadMs =
      Number(
        requestStateContext
          .sheetReadMs || 0
      );

    requestPerformance
      .requestStateSheetWriteMs =
      Number(
        requestStateContext
          .sheetWriteMs || 0
      );

    requestPerformance
      .lastApiCallMs =
      Date.now() -
      startedAt;

    const pipelineAccountedKeys = [
      'preflightMs',
      'requestCoordinationMs',
      'driveRevalidationMs',
      'openSpreadsheetMs',
      'validateWorkbookMs',
      'openedStateSaveMs',
      'dataWriteMs',
      'analysisDataStoreWriteMs',
      'dataWrittenStateSaveMs',
      'finalizeViewerMs',
      'reportDoneStateSaveMs',
      'readyFinalizeMs',
      'readyStateSaveMs'
    ];

    requestPerformance
      .pipelineAccountedMs =
      pipelineAccountedKeys
        .reduce(
          (sum, key) =>
            sum +
            Number(
              requestPerformance[key] ||
              0
            ),
          0
        );

    requestPerformance
      .pipelineUnclassifiedMs =
      Math.max(
        0,
        Number(
          requestPerformance
            .lastApiCallMs ||
          0
        ) -
        Number(
          requestPerformance
            .pipelineAccountedMs ||
          0
        )
      );

    return jsonOutput_(
      Object.assign(
        buildReadyResponse_(
          requestRecord,
          requestId,
          false,
          startedAt
        ),
        {
          operationMode:
            operationMode,
          writeSummary
        }
      )
    );

  } catch (err) {
    console.error(
      err && err.stack
        ? err.stack
        : err
    );

    try {
      if (
        requestId &&
        requestRecord &&
        requestRecord
          .spreadsheetId
      ) {
        const props =
          PropertiesService
            .getScriptProperties();

        const latest =
          getRequestRecord_(
            props,
            requestId
          ) ||
          requestRecord;

        latest.status =
          'ERROR';

        if (
          !latest.stage ||
          latest.stage ===
            'OPENED'
        ) {
          latest.stage =
            lastCompletedStage ||
            (
              operationMode ===
                'UPDATE'
                ? 'TARGET_VALIDATED'
                : 'CREATED'
            );
        }

        latest.updatedAt =
          new Date()
            .toISOString();

        latest.leaseUntil =
          '';

        latest
          .lastErrorCode =
          mapErrorCode_(err);

        latest
          .lastErrorMessage =
          safeErrorMessage_(err);

        latest.lastPhase =
          currentPhase;

        saveRequestRecord_(
          props,
          requestId,
          latest
        );

        requestRecord =
          latest;
      }
    } catch (
      stateErr
    ) {
      console.error(
        'request state update failed: ' +
        safeErrorMessage_(
          stateErr
        )
      );
    }

    auditWorkbookErrorByIdSafe_(
      requestRecord &&
      requestRecord.spreadsheetId
        ? requestRecord.spreadsheetId
        : targetSpreadsheetId,
      operationMode === 'CREATE'
        ? 'DATA_CREATE'
        : 'DATA_UPDATE',
      'PAGES_ETL',
      err,
      requestId
    );

    return errorOutput_(
      mapErrorCode_(err),
      safeErrorMessage_(err),
      {
        requestId,
        operationMode,
        performance:
          requestRecord &&
          requestRecord.performance
            ? requestRecord.performance
            : {},
        retryable:
          !!(
            requestRecord &&
            requestRecord
              .spreadsheetId
          ),
        status:
          requestRecord
            ? requestRecord.status
            : '',
        stage:
          requestRecord
            ? requestRecord.stage
            : '',
        phase:
          currentPhase,
        spreadsheetId:
          requestRecord
            ? requestRecord
                .spreadsheetId
            : '',
        spreadsheetUrl:
          requestRecord
            ? requestRecord
                .spreadsheetUrl
            : '',
        elapsedMs:
          Date.now() -
          startedAt
      }
    );
  }
}


// ============================================================
// Validation
// ============================================================

function validateEnvelope_(payload) {
  if (!payload || typeof payload !== 'object') {
    return invalid_('INVALID_PAYLOAD', 'payloadがオブジェクトではありません.');
  }

  const props = PropertiesService.getScriptProperties();
  const expectedSchema =
    props.getProperty('SCHEMA_VERSION') ||
    API_CONFIG.DEFAULT_SCHEMA_VERSION;

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

  const expectedAccessKey = requireProperty_(props, 'ACCESS_KEY');
  if (normalizeString_(payload.accessKey) !== expectedAccessKey) {
    return invalid_('AUTH_INVALID', 'アクセスキーが正しくありません.');
  }

  const requestId = normalizeString_(payload.requestId);
  if (!requestId || requestId.length > 120) {
    return invalid_('INVALID_REQUEST_ID', 'requestIdが不正です.');
  }

  if (
    normalizeString_(
      payload.commonMasterVersion
    ) !==
      API_CONFIG
        .EXPECTED_COMMON_MASTER_VERSION
  ) {
    return invalid_(
      'COMMON_MASTER_MISMATCH',
      '共通マスタのバージョンが一致しません. expected=' +
        API_CONFIG.EXPECTED_COMMON_MASTER_VERSION +
        ', actual=' +
        normalizeString_(payload.commonMasterVersion)
    );
  }

  if (!payload.datasets || typeof payload.datasets !== 'object') {
    return invalid_('INVALID_PAYLOAD', 'datasetsがありません.');
  }

  const required = [
    'applicationData',
    'jobAnalysisMaster',
    'processInfo',
    'inputFiles',
    'imageMasterInitial'
  ];

  for (const key of required) {
    if (!(key in payload.datasets)) {
      return invalid_(
        'INVALID_PAYLOAD',
        `必須データセット ${key} がありません.`
      );
    }

    const datasetValidation = validateDataset_(
      key,
      payload.datasets[key]
    );

    if (!datasetValidation.ok) return datasetValidation;
  }

  if (!payload.datasets.applicationData.rows.length) {
    return invalid_(
      'NO_APPLICATION_DATA',
      '応募データが0件です.'
    );
  }

  return { ok: true };
}

function validateDataset_(key, dataset) {
  if (!dataset || typeof dataset !== 'object') {
    return invalid_(
      'INVALID_DATASET',
      `${key} がオブジェクトではありません.`
    );
  }

  if (!Array.isArray(dataset.headers) || !Array.isArray(dataset.rows)) {
    return invalid_(
      'INVALID_DATASET',
      `${key} のheaders/rowsが配列ではありません.`
    );
  }

  if (dataset.headers.length > API_CONFIG.MAX_DATASET_COLS) {
    return invalid_(
      'INVALID_DATASET',
      `${key} の列数が上限を超えています.`
    );
  }

  if (dataset.rows.length > API_CONFIG.MAX_DATASET_ROWS) {
    return invalid_(
      'INVALID_DATASET',
      `${key} の行数が上限を超えています.`
    );
  }

  for (let i = 0; i < dataset.rows.length; i++) {
    const row = dataset.rows[i];
    if (!Array.isArray(row) || row.length !== dataset.headers.length) {
      return invalid_(
        'INVALID_DATASET',
        `${key} の ${i + 1} 行目の列数がheadersと一致しません.`
      );
    }
  }

  return { ok: true };
}

function invalid_(code, message) {
  return { ok: false, code, message };
}


// ============================================================
// Spreadsheet write
// ============================================================

