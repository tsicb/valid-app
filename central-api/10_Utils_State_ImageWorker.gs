function sheetDataRowCount_(
  ss,
  sheetName
) {
  const sheet =
    ss.getSheetByName(
      sheetName
    );

  if (!sheet) return 0;

  return Math.max(
    sheet.getLastRow() - 1,
    0
  );
}

// ============================================================
// Utilities
// ============================================================

function requireProperty_(props, key) {
  const value = normalizeString_(props.getProperty(key));
  if (!value) {
    const err = new Error(`Script Property ${key} が未設定です.`);
    err.code = 'CONFIG_ERROR';
    throw err;
  }
  return value;
}

function buildOutputFileName_(payload) {
  const requested =
    normalizeReportName_(
      payload &&
      payload.reportName,
      true
    );

  if (requested) {
    return requested;
  }

  const companyName =
    normalizeCompanyDisplayName_(
      payload &&
      payload.companyDisplayName
    );

  if (companyName) {
    return normalizeReportName_(
      companyName +
      '_有効応募分析',
      false
    );
  }

  const tz =
    Session.getScriptTimeZone() ||
    'Asia/Tokyo';

  const stamp =
    Utilities.formatDate(
      new Date(),
      tz,
      'yyyyMMdd_HHmmss'
    );

  return (
    '有効応募分析_' +
    stamp
  );
}

function normalizeIdentityText_(
  value,
  maxLength
) {
  let text =
    value === null ||
    value === undefined
      ? ''
      : String(value);

  text = text
    .replace(
      /[\u0000-\u001F\u007F]+/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();

  const limit =
    Math.max(
      1,
      Number(maxLength || 120)
    );

  if (
    text.length >
    limit
  ) {
    text =
      text.slice(
        0,
        limit
      ).trim();
  }

  return text;
}

function normalizeCompanyDisplayName_(
  value
) {
  const name =
    normalizeIdentityText_(
      value,
      100
    );

  if (!name) {
    return '';
  }

  if (
    /(様|御中)$/.test(
      name
    )
  ) {
    return name;
  }

  return (
    name +
    '様'
  );
}

function normalizeReportName_(
  value,
  allowEmpty
) {
  const name =
    normalizeIdentityText_(
      value,
      120
    );

  if (
    !name &&
    !allowEmpty
  ) {
    const e =
      new Error(
        'レポート名を入力してください.'
      );

    e.code =
      'REPORT_NAME_REQUIRED';

    throw e;
  }

  return name;
}

function applyManagedReportName_(
  ss,
  requestedName
) {
  const newName =
    normalizeReportName_(
      requestedName,
      false
    );

  const file =
    DriveApp.getFileById(
      ss.getId()
    );

  const oldName =
    file.getName();

  if (
    oldName === newName
  ) {
    return {
      changed: false,
      oldName,
      newName
    };
  }

  file.setName(
    newName
  );

  rptSetStateValue_(
    ss,
    '最終レポート名変更日時',
    new Date()
  );

  const reshareRequired =
    markViewerReshareRequired_(
      ss,
      '分析レポート名を変更したため'
    );

  if (reshareRequired) {
    appendAuditEvent_(
      ss,
      'VIEWER_RESHARE_REQUIRED',
      'SUCCESS',
      'MANAGE_PAGES',
      'レポート名変更のため再共有が必要',
      ''
    );
  }

  return {
    changed: true,
    oldName,
    newName
  };
}

function normalizeString_(value) {
  return value === null || value === undefined
    ? ''
    : String(value).trim();
}

function normalizeSchemaVersion_(
  value
) {
  const text =
    normalizeString_(
      value
    );

  if (!text) {
    return '';
  }

  // schemaVersionは数値的な版番号として比較する。
  // Google Sheetsが文字列 "3.0" を数値 3 として返すケースを許容する。
  if (
    !/^\d+(?:\.\d+)*$/.test(
      text
    )
  ) {
    return text;
  }

  const parts =
    text
      .split('.')
      .map(
        part =>
          String(
            Number(part)
          )
      );

  while (
    parts.length > 1 &&
    parts[
      parts.length - 1
    ] === '0'
  ) {
    parts.pop();
  }

  return parts.join('.');
}

function schemaVersionsEqual_(
  actual,
  expected
) {
  const a =
    normalizeSchemaVersion_(
      actual
    );

  const e =
    normalizeSchemaVersion_(
      expected
    );

  return (
    !!a &&
    !!e &&
    a === e
  );
}

function safeErrorMessage_(err) {
  if (!err) return '不明なエラーです.';
  return err.message ? String(err.message) : String(err);
}

function mapErrorCode_(err) {
  if (err && err.code) return String(err.code);

  const message = safeErrorMessage_(err);

  if (/ACCESS_KEY|Script Property/.test(message)) {
    return 'CONFIG_ERROR';
  }

  if (/Service invoked too many times|Exceeded maximum execution time/i.test(message)) {
    return 'BUSY';
  }

  if (/Spreadsheet|Range|setValues/i.test(message)) {
    return 'WRITE_ERROR';
  }

  return 'INTERNAL_ERROR';
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function viewerSuccessOutput_(
  obj,
  requestPayload,
  startedAt
) {
  const requestedTransport =
    normalizeString_(
      requestPayload &&
      requestPayload
        .responseTransport
    ).toUpperCase();

  const sourceText =
    JSON.stringify(
      obj
    );

  if (
    requestedTransport !==
      'GZIP_BASE64_V1' ||
    sourceText.length <
      100000
  ) {
    return ContentService
      .createTextOutput(
        sourceText
      )
      .setMimeType(
        ContentService
          .MimeType
          .JSON
      );
  }

  try {
    const gzipStartedAt =
      Date.now();

    const gzipBlob =
      Utilities.gzip(
        Utilities.newBlob(
          sourceText,
          'application/json',
          'viewer-response.json'
        )
      );

    const gzipBytes =
      gzipBlob.getBytes();

    const gzipMs =
      perfMs_(
        gzipStartedAt
      );

    const base64StartedAt =
      Date.now();

    const payloadBase64 =
      Utilities.base64Encode(
        gzipBytes
      );

    const base64Ms =
      perfMs_(
        base64StartedAt
      );

    const envelope = {
      transportEncoding:
        'GZIP_BASE64_V1',
      payloadBase64,
      transportPerformance: {
        sourceChars:
          sourceText.length,
        gzipBytes:
          gzipBytes.length,
        gzipMs,
        base64Ms,
        serverElapsedMs:
          Date.now() -
          Number(
            startedAt ||
            Date.now()
          )
      }
    };

    const envelopeText =
      JSON.stringify(
        envelope
      );

    // Base64化を含めても5%以上小さくなる場合だけ圧縮応答を使う。
    if (
      envelopeText.length <
      sourceText.length *
        0.95
    ) {
      return ContentService
        .createTextOutput(
          envelopeText
        )
        .setMimeType(
          ContentService
            .MimeType
            .JSON
        );
    }

  } catch (_) {
    // 圧縮失敗時は従来JSONへ安全にフォールバック。
  }

  return ContentService
    .createTextOutput(
      sourceText
    )
    .setMimeType(
      ContentService
        .MimeType
        .JSON
    );
}

function errorOutput_(code, message, extra) {
  return jsonOutput_(
    Object.assign(
      {
        ok: false,
        code,
        message
      },
      extra || {}
    )
  );
}

// ============================================================================
// Lean state + image helpers
// ============================================================================

const RPT_IMAGE_WORKER_URL_ =
  'https://tenichi-image-proxy-test.tkarasa.workers.dev/';

const RPT_TENICHI_IMAGE_BASE_URL_ =
  'https://ten.1049.cc/';

function normalizeTenichiImageUrl_(value) {
  const raw = normalizeString_(value);

  if (!raw) {
    return '';
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (/^\/\//.test(raw)) {
    return 'https:' + raw;
  }

  if (/^\//.test(raw)) {
    return (
      RPT_TENICHI_IMAGE_BASE_URL_
        .replace(/\/$/, '') +
      raw
    );
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return '';
  }

  return (
    RPT_TENICHI_IMAGE_BASE_URL_ +
    raw.replace(/^\.\//, '')
  );
}

function createRequestStateContext_() {
  return {
    stateData: null,
    sheetReadCount: 0,
    cacheReuseCount: 0,
    sheetWriteCount: 0,
    sheetReadMs: 0,
    sheetWriteMs: 0
  };
}

function getRequestStateData_(
  ss,
  context
) {
  if (
    context &&
    context.stateData
  ) {
    context.cacheReuseCount =
      Number(
        context.cacheReuseCount ||
        0
      ) + 1;

    return context.stateData;
  }

  const startedAt =
    Date.now();

  const stateData =
    rptReadStateData_(
      ss
    );

  if (context) {
    context.stateData =
      stateData;

    context.sheetReadCount =
      Number(
        context.sheetReadCount ||
        0
      ) + 1;

    context.sheetReadMs =
      Number(
        context.sheetReadMs ||
        0
      ) +
      perfMs_(
        startedAt
      );
  }

  return stateData;
}

function setRequestStateValues_(
  ss,
  context,
  updates
) {
  const stateData =
    getRequestStateData_(
      ss,
      context
    );

  const startedAt =
    Date.now();

  const updated =
    rptSetStateValues_(
      ss,
      updates,
      stateData
    );

  if (context) {
    context.stateData =
      updated;

    context.sheetWriteCount =
      Number(
        context.sheetWriteCount ||
        0
      ) + 1;

    context.sheetWriteMs =
      Number(
        context.sheetWriteMs ||
        0
      ) +
      perfMs_(
        startedAt
      );
  }

  return updated;
}

function rptReadStateData_(ss) {
  const sheet=ensureSheet_(ss,'99_内部状態',true);
  let rows=[];
  if (sheet.getLastRow()>0) rows=sheet.getRange(1,1,sheet.getLastRow(),2).getValues();
  if (!rows.length) rows=[['項目','値']];
  const map={};
  rows.forEach(row=>{
    const key=normalizeString_(row[0]);
    if (key && key!=='項目') map[key]=row[1];
  });
  return {sheet,rows,map};
}

function rptSetStateValues_(ss, updates, existingStateData) {
  const stateData =
    existingStateData ||
    rptReadStateData_(
      ss
    );

  const sheet =
    stateData.sheet;

  const rows =
    stateData.rows.map(
      row => [
        row[0],
        row[1]
      ]
    );

  if (
    !rows.length ||
    normalizeString_(
      rows[0][0]
    ) !== '項目'
  ) {
    rows.unshift([
      '項目',
      '値'
    ]);
  }

  const indexByKey = {};

  rows.forEach(
    (row, index) => {
      const key =
        normalizeString_(
          row[0]
        );

      if (key) {
        indexByKey[key] =
          index;
      }
    }
  );

  const textVersionKeys =
    new Set([
      'schemaVersion',
      'analysisDataStoreVersion'
    ]);

  Object.entries(
    updates || {}
  ).forEach(
    ([key, value]) => {
      const writeValue =
        textVersionKeys.has(key)
          ? normalizeString_(value)
          : value;

      if (
        Object.prototype
          .hasOwnProperty.call(
            indexByKey,
            key
          )
      ) {
        rows[
          indexByKey[key]
        ][1] =
          writeValue;
      } else {
        indexByKey[key] =
          rows.length;

        rows.push([
          key,
          writeValue
        ]);
      }
    }
  );

  ensureSheetSize_(
    sheet,
    rows.length,
    2
  );

  sheet
    .getRange(
      1,
      1,
      rows.length,
      2
    )
    .setValues(
      rows
    );

  const versionCells =
    Array.from(
      textVersionKeys
    )
      .filter(
        key =>
          Object.prototype
            .hasOwnProperty.call(
              indexByKey,
              key
            )
      )
      .map(
        key =>
          'B' +
          (
            indexByKey[key] +
            1
          )
      );

  if (versionCells.length) {
    sheet
      .getRangeList(
        versionCells
      )
      .setNumberFormat(
        '@'
      );
  }

  const map = {};

  rows.forEach(
    row => {
      const key =
        normalizeString_(
          row[0]
        );

      if (
        key &&
        key !== '項目'
      ) {
        map[key] =
          row[1];
      }
    }
  );

  return {
    sheet,
    rows,
    map
  };
}

function rptSetStateValue_(
  ss,
  key,
  value
) {
  const sheet =
    ensureSheet_(
      ss,
      '99_内部状態',
      true
    );

  if (
    sheet.getLastRow() === 0
  ) {
    sheet.getRange(
      1,
      1,
      1,
      2
    ).setValues([
      ['項目', '値']
    ]);
  }

  const lastRow =
    Math.max(
      sheet.getLastRow(),
      1
    );

  const values =
    sheet.getRange(
      1,
      1,
      lastRow,
      2
    ).getValues();

  const isTextVersion =
    key ===
      'schemaVersion' ||
    key ===
      'analysisDataStoreVersion';

  const writeValue =
    isTextVersion
      ? normalizeString_(
          value
        )
      : value;

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
      const target =
        sheet.getRange(
          i + 1,
          2
        );

      if (isTextVersion) {
        // "3.0" がSheet側で数値 3 に自動変換されないよう、
        // 書込み前にプレーンテキスト書式へ固定する。
        target.setNumberFormat(
          '@'
        );
      }

      target.setValue(
        writeValue
      );

      try {
        sheet.hideSheet();
      } catch (e) {}

      return;
    }
  }

  const targetRow =
    lastRow + 1;

  if (isSchemaVersion) {
    sheet.getRange(
      targetRow,
      2
    ).setNumberFormat(
      '@'
    );
  }

  sheet.getRange(
    targetRow,
    1,
    1,
    2
  ).setValues([
    [
      key,
      writeValue
    ]
  ]);

  try {
    sheet.hideSheet();
  } catch (e) {}
}

function rptRetryMissingImageUrls_(ss) {
  const startedAt =
    Date.now();

  const imageSheet =
    ss.getSheetByName(
      '41_画像マスタ'
    );

  const snapshotSheet =
    ss.getSheetByName(
      '91_求人分析マスタ'
    );

  if (
    !imageSheet ||
    !snapshotSheet
  ) {
    return {
      ok: false,
      targetCount: 0,
      successCount: 0,
      unresolvedCount: 0,
      message:
        '画像マスタまたは求人分析マスタがありません。'
    };
  }

  if (
    imageSheet.getLastRow() < 2 ||
    snapshotSheet.getLastRow() < 2
  ) {
    return {
      ok: true,
      targetCount: 0,
      successCount: 0,
      noCandidateCount: 0,
      unresolvedCount: 0,
      elapsedMs:
        Date.now() -
        startedAt,
      message:
        '再取得対象はありません。'
    };
  }

  const imageValues =
    imageSheet
      .getDataRange()
      .getValues();

  const imageHeaders =
    imageValues[0].map(
      normalizeString_
    );

  const iFile =
    imageHeaders.indexOf(
      '画像ファイル名'
    );

  const iUrl =
    imageHeaders.indexOf(
      '画像URL'
    );

  const iStatus =
    imageHeaders.indexOf(
      '取得状態'
    );

  const iJob =
    imageHeaders.indexOf(
      '参照求人管理番号'
    );

  const iMethod =
    imageHeaders.indexOf(
      '取得方法'
    );

  const iAt =
    imageHeaders.indexOf(
      '取得日時'
    );

  if (
    iFile < 0 ||
    iUrl < 0
  ) {
    return {
      ok: false,
      targetCount: 0,
      successCount: 0,
      unresolvedCount: 0,
      message:
        '画像マスタの必須列が見つかりません。'
    };
  }

  const snapshotValues =
    snapshotSheet
      .getDataRange()
      .getValues();

  const snapshotHeaders =
    snapshotValues[0].map(
      normalizeString_
    );

  const sFile =
    snapshotHeaders.indexOf(
      'メイン画像ファイル名'
    );

  const sPublic =
    snapshotHeaders.indexOf(
      '公開情報区分'
    );

  const sJob =
    snapshotHeaders.indexOf(
      '求人管理番号'
    );

  if (
    sFile < 0 ||
    sPublic < 0 ||
    sJob < 0
  ) {
    return {
      ok: false,
      targetCount: 0,
      successCount: 0,
      unresolvedCount: 0,
      message:
        '求人分析マスタの画像取得用列が不足しています。'
    };
  }

  const candidateMap = {};

  for (
    let s = 1;
    s < snapshotValues.length;
    s++
  ) {
    const row =
      snapshotValues[s];

    const fileName =
      normalizeString_(
        row[sFile]
      );

    const publicStatus =
      normalizeString_(
        row[sPublic]
      );

    const jobId =
      normalizeString_(
        row[sJob]
      );

    if (
      !fileName ||
      publicStatus !== '6' ||
      !/^\d{1,20}$/.test(
        jobId
      )
    ) {
      continue;
    }

    if (
      !candidateMap[fileName]
    ) {
      candidateMap[fileName] = [];
    }

    if (
      candidateMap[fileName]
        .indexOf(
          jobId
        ) < 0
    ) {
      candidateMap[fileName]
        .push(
          jobId
        );
    }
  }

  let pending = [];

  for (
    let r = 1;
    r < imageValues.length;
    r++
  ) {
    const fileName =
      normalizeString_(
        imageValues[r][iFile]
      );

    const imageUrl =
      normalizeString_(
        imageValues[r][iUrl]
      );

    const canonicalImageUrl =
      normalizeTenichiImageUrl_(
        imageUrl
      );

    if (
      imageUrl &&
      canonicalImageUrl &&
      canonicalImageUrl !== imageUrl
    ) {
      imageValues[r][iUrl] =
        canonicalImageUrl;
    }

    if (
      !fileName ||
      canonicalImageUrl
    ) {
      continue;
    }

    pending.push({
      rowIndex: r,
      fileName,
      candidateIndex: 0,
      candidates:
        candidateMap[fileName] ||
        []
    });
  }

  const targetCount =
    pending.length;

  let successCount = 0;
  let noCandidateCount = 0;

  pending.forEach(item => {
    if (
      !item.candidates.length
    ) {
      if (iStatus >= 0) {
        imageValues[
          item.rowIndex
        ][iStatus] =
          '候補なし';
      }

      noCandidateCount++;
    }
  });

  pending =
    pending.filter(
      item =>
        item.candidates.length >
        0
    );

  while (
    pending.length
  ) {
    const batch =
      pending.slice(
        0,
        20
      );

    const requests =
      batch.map(item => {
        const jobId =
          item.candidates[
            item.candidateIndex
          ];

        return {
          url:
            RPT_IMAGE_WORKER_URL_ +
            '?jobId=' +
            encodeURIComponent(
              jobId
            ),
          method:
            'get',
          muteHttpExceptions:
            true,
          followRedirects:
            true
        };
      });

    let responses = [];

    try {
      responses =
        UrlFetchApp.fetchAll(
          requests
        );
    } catch (e) {
      responses =
        batch.map(
          () => null
        );
    }

    const resolved = {};

    for (
      let i = 0;
      i < batch.length;
      i++
    ) {
      const item =
        batch[i];

      const response =
        responses[i];

      const currentJobId =
        item.candidates[
          item.candidateIndex
        ];

      let data = null;

      if (response) {
        try {
          data =
            JSON.parse(
              response
                .getContentText()
            );
        } catch (e) {}
      }

      const resolvedImageUrl =
        data &&
        data.ok &&
        data.imageUrl
          ? normalizeTenichiImageUrl_(
              data.imageUrl
            )
          : '';

      if (resolvedImageUrl) {
        imageValues[
          item.rowIndex
        ][iUrl] =
          resolvedImageUrl;

        if (iStatus >= 0) {
          imageValues[
            item.rowIndex
          ][iStatus] =
            '自動取得';
        }

        if (iJob >= 0) {
          imageValues[
            item.rowIndex
          ][iJob] =
            currentJobId;
        }

        if (iMethod >= 0) {
          imageValues[
            item.rowIndex
          ][iMethod] =
            normalizeString_(
              data.method
            ) ||
            'worker';
        }

        if (iAt >= 0) {
          imageValues[
            item.rowIndex
          ][iAt] =
            new Date();
        }

        successCount++;

        resolved[
          item.rowIndex +
          ':' +
          item.fileName
        ] = true;

      } else {
        item.candidateIndex++;

        if (
          item.candidateIndex >=
          item.candidates.length
        ) {
          if (iStatus >= 0) {
            imageValues[
              item.rowIndex
            ][iStatus] =
              '取得失敗';
          }

          resolved[
            item.rowIndex +
            ':' +
            item.fileName
          ] = true;
        }
      }
    }

    pending =
      pending.filter(item => {
        const key =
          item.rowIndex +
          ':' +
          item.fileName;

        return !resolved[key];
      });
  }

  if (
    imageValues.length > 1
  ) {
    imageSheet.getRange(
      2,
      1,
      imageValues.length - 1,
      imageHeaders.length
    ).setValues(
      imageValues.slice(1)
    );
  }

  rptSetStateValue_(
    ss,
    '最終画像URL再取得日時',
    new Date()
  );

  rptSetStateValue_(
    ss,
    '画像URL再取得結果',
    '対象' +
      targetCount +
      ' / 成功' +
      successCount +
      ' / 候補なし' +
      noCandidateCount
  );

  SpreadsheetApp.flush();

  return {
    ok: true,
    targetCount,
    successCount,
    noCandidateCount,
    unresolvedCount:
      targetCount -
      successCount,
    elapsedMs:
      Date.now() -
      startedAt,
    message:
      '対象 ' +
      targetCount +
      '種類 / 成功 ' +
      successCount +
      '種類 / 未取得 ' +
      (
        targetCount -
        successCount
      ) +
      '種類'
  };
}