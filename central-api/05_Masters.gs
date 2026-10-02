function buildImageMasterIncomingSignature_(
  incomingDataset
) {
  const headers =
    incomingDataset &&
    Array.isArray(
      incomingDataset.headers
    )
      ? incomingDataset.headers
      : [];

  const rows =
    incomingDataset &&
    Array.isArray(
      incomingDataset.rows
    )
      ? incomingDataset.rows
      : [];

  const stableFields = [
    '画像ファイル名',
    '画像URL',
    '取得状態',
    '参照求人管理番号',
    '取得方法',
    'メモ'
  ];

  const indexes =
    stableFields.map(
      field =>
        headers.indexOf(
          field
        )
    );

  const stableRows =
    rows
      .map(
        row =>
          indexes.map(
            (index, fieldIndex) => {
              if (index < 0) {
                return '';
              }

              const value =
                row[index];

              return stableFields[fieldIndex] ===
                '画像URL'
                ? normalizeTenichiImageUrl_(
                    value
                  )
                : normalizeString_(
                    value
                  );
            }
          )
      )
      .filter(
        row =>
          normalizeString_(
            row[0]
          )
      )
      .sort(
        (a, b) =>
          JSON.stringify(a)
            .localeCompare(
              JSON.stringify(b)
            )
      );

  const source =
    JSON.stringify({
      v: 2,
      fields:
        stableFields,
      rows:
        stableRows
    });

  const digest =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,
      source,
      Utilities.Charset.UTF_8
    );

  return (
    'v2:' +
    Utilities
      .base64EncodeWebSafe(
        digest
      )
      .replace(
        /=+$/g,
        ''
      )
  );
}

function mergeImageMasterForUpdate_(
  ss,
  incomingDataset,
  stateContext
) {
  const totalStartedAt =
    Date.now();

  const perf = {
    ensureSheetMs: 0,
    signatureComputeMs: 0,
    signatureStateReadMs: 0,
    signatureStateWriteMs: 0,
    signatureMatched: false,
    readMs: 0,
    computeMs: 0,
    changedRowsWriteMs: 0,
    appendRowsWriteMs: 0,
    fullRewriteMs: 0,
    totalMs: 0,
    mode: '',
    changedRows: 0,
    appendedRows: 0
  };

  const signatureComputeStartedAt =
    Date.now();

  const incomingSignature =
    buildImageMasterIncomingSignature_(
      incomingDataset
    );

  perf.signatureComputeMs =
    perfMs_(
      signatureComputeStartedAt
    );

  let signatureStateData =
    null;

  const signatureStateReadStartedAt =
    Date.now();

  signatureStateData =
    getRequestStateData_(
      ss,
      stateContext
    );

  perf.signatureStateReadMs =
    perfMs_(
      signatureStateReadStartedAt
    );

  const previousSignature =
    normalizeString_(
      signatureStateData
        .map
        .imageMasterIncomingSignature
    );

  if (
    previousSignature &&
    previousSignature ===
      incomingSignature
  ) {
    perf.signatureMatched =
      true;

    perf.mode =
      'SIGNATURE_SKIP';

    perf.totalMs =
      perfMs_(
        totalStartedAt
      );

    return {
      rows:
        incomingDataset &&
        Array.isArray(
          incomingDataset.rows
        )
          ? incomingDataset
              .rows
              .length
          : 0,
      cols:
        incomingDataset &&
        Array.isArray(
          incomingDataset.headers
        )
          ? incomingDataset
              .headers
              .length
          : 0,
      merged: true,
      changed: false,
      performance:
        perf
    };
  }

  const ensureStartedAt =
    Date.now();

  const sheet =
    ensureSheet_(
      ss,
      '41_画像マスタ',
      false
    );

  perf.ensureSheetMs =
    perfMs_(
      ensureStartedAt
    );

  const headers =
    incomingDataset.headers ||
    [
      '画像ファイル名',
      '画像URL',
      '取得状態',
      '参照求人管理番号',
      '取得方法',
      '取得日時',
      'メモ'
    ];

  const incomingRows =
    incomingDataset.rows || [];

  const readStartedAt =
    Date.now();

  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  const existingValues =
    lastRow > 0 &&
    lastColumn > 0
      ? sheet.getRange(
          1,
          1,
          lastRow,
          lastColumn
        ).getValues()
      : [];

  perf.readMs =
    perfMs_(
      readStartedAt
    );

  const computeStartedAt =
    Date.now();

  const finalHeaders =
    headers.slice();

  const fileIdx =
    finalHeaders.indexOf(
      '画像ファイル名'
    );

  const urlIdx =
    finalHeaders.indexOf(
      '画像URL'
    );

  const statusIdx =
    finalHeaders.indexOf(
      '取得状態'
    );

  const jobIdx =
    finalHeaders.indexOf(
      '参照求人管理番号'
    );

  const methodIdx =
    finalHeaders.indexOf(
      '取得方法'
    );

  const atIdx =
    finalHeaders.indexOf(
      '取得日時'
    );

  const memoIdx =
    finalHeaders.indexOf(
      'メモ'
    );

  const existingHeaders =
    existingValues.length
      ? existingValues[0]
          .map(
            normalizeString_
          )
      : [];

  const canonicalHeaders =
    existingHeaders.length ===
      finalHeaders.length &&
    finalHeaders.every(
      (header, index) =>
        normalizeString_(
          existingHeaders[index]
        ) ===
        normalizeString_(
          header
        )
    );

  if (
    canonicalHeaders &&
    fileIdx >= 0
  ) {
    const entriesByFile =
      new Map();

    for (
      let r = 1;
      r <
      existingValues.length;
      r++
    ) {
      const row =
        existingValues[r];

      const fileName =
        normalizeString_(
          row[fileIdx]
        );

      if (!fileName) continue;

      entriesByFile.set(
        fileName,
        {
          kind: 'existing',
          dataIndex: r,
          row
        }
      );
    }

    const changedDataIndexes =
      new Set();

    // v2.45: 既存画像マスタに残っている /images/... 等の相対URLも、
    // incomingの有無に関係なく次回同期時に絶対URLへ修復する。
    if (urlIdx >= 0) {
      for (
        let r = 1;
        r < existingValues.length;
        r++
      ) {
        const existingUrl =
          normalizeString_(
            existingValues[r][urlIdx]
          );

        const canonicalUrl =
          normalizeTenichiImageUrl_(
            existingUrl
          );

        if (
          existingUrl &&
          canonicalUrl &&
          canonicalUrl !== existingUrl
        ) {
          existingValues[r][urlIdx] =
            canonicalUrl;
          changedDataIndexes.add(r);
        }
      }
    }

    const appendRows = [];

    incomingRows.forEach(
      incoming => {
        const safeIncoming =
          finalHeaders.map(
            (_, idx) =>
              incoming[idx] ??
              ''
          );

        if (urlIdx >= 0) {
          safeIncoming[urlIdx] =
            normalizeTenichiImageUrl_(
              safeIncoming[urlIdx]
            );
        }

        const fileName =
          normalizeString_(
            safeIncoming[
              fileIdx
            ]
          );

        if (!fileName) return;

        if (
          !entriesByFile.has(
            fileName
          )
        ) {
          const appendIndex =
            appendRows.length;

          appendRows.push(
            safeIncoming
          );

          entriesByFile.set(
            fileName,
            {
              kind: 'append',
              appendIndex,
              row:
                appendRows[
                  appendIndex
                ]
            }
          );

          return;
        }

        const entry =
          entriesByFile.get(
            fileName
          );

        const existing =
          entry.row;

        let changed = false;

        const existingUrl =
          normalizeString_(
            existing[urlIdx]
          );

        const canonicalExistingUrl =
          normalizeTenichiImageUrl_(
            existingUrl
          );

        const incomingUrl =
          normalizeTenichiImageUrl_(
            safeIncoming[
              urlIdx
            ]
          );

        if (
          canonicalExistingUrl &&
          canonicalExistingUrl !== existingUrl
        ) {
          existing[urlIdx] =
            canonicalExistingUrl;
          changed = true;
        }

        if (
          !canonicalExistingUrl &&
          incomingUrl
        ) {
          existing[urlIdx] =
            safeIncoming[urlIdx];

          if (statusIdx >= 0) {
            existing[statusIdx] =
              safeIncoming[
                statusIdx
              ];
          }

          if (jobIdx >= 0) {
            existing[jobIdx] =
              safeIncoming[
                jobIdx
              ];
          }

          if (methodIdx >= 0) {
            existing[methodIdx] =
              safeIncoming[
                methodIdx
              ];
          }

          if (atIdx >= 0) {
            existing[atIdx] =
              safeIncoming[
                atIdx
              ];
          }

          changed = true;
        }

        if (
          memoIdx >= 0 &&
          !normalizeString_(
            existing[memoIdx]
          ) &&
          normalizeString_(
            safeIncoming[
              memoIdx
            ]
          )
        ) {
          existing[memoIdx] =
            safeIncoming[
              memoIdx
            ];

          changed = true;
        }

        if (
          changed &&
          entry.kind ===
            'existing'
        ) {
          changedDataIndexes.add(
            entry.dataIndex
          );
        }
      }
    );

    perf.computeMs =
      perfMs_(
        computeStartedAt
      );

    const changedIndexes =
      Array.from(
        changedDataIndexes
      ).sort(
        (a, b) => a - b
      );

    perf.changedRows =
      changedIndexes.length;

    perf.appendedRows =
      appendRows.length;

    if (
      !changedIndexes.length &&
      !appendRows.length
    ) {
    const signatureStateWriteStartedAt =
      Date.now();

    signatureStateData =
      stateContext
        ? setRequestStateValues_(
            ss,
            stateContext,
            {
              imageMasterIncomingSignature:
                incomingSignature
            }
          )
        : rptSetStateValues_(
            ss,
            {
              imageMasterIncomingSignature:
                incomingSignature
            },
            signatureStateData ||
            rptReadStateData_(
              ss
            )
          );

    perf.signatureStateWriteMs =
      perfMs_(
        signatureStateWriteStartedAt
      );

      perf.mode =
        'DELTA_NO_CHANGE';

      perf.totalMs =
        perfMs_(
          totalStartedAt
        );

      return {
        rows:
          Math.max(
            existingValues.length - 1,
            0
          ),
        cols:
          finalHeaders.length,
        merged: true,
        changed: false,
        performance:
          perf
      };
    }

    if (changedIndexes.length) {
      const changedWriteStartedAt =
        Date.now();

      let groupStart =
        changedIndexes[0];

      let groupEnd =
        groupStart;

      const flushGroup =
        () => {
          const count =
            groupEnd -
            groupStart +
            1;

          const values = [];

          for (
            let idx =
              groupStart;
            idx <=
              groupEnd;
            idx++
          ) {
            values.push(
              existingValues[idx]
                .slice(
                  0,
                  finalHeaders.length
                )
                .map(
                  sanitizeCell_
                )
            );
          }

          sheet.getRange(
            groupStart + 1,
            1,
            count,
            finalHeaders.length
          ).setValues(
            values
          );
        };

      for (
        let i = 1;
        i <
        changedIndexes.length;
        i++
      ) {
        const current =
          changedIndexes[i];

        if (
          current ===
            groupEnd + 1
        ) {
          groupEnd =
            current;
          continue;
        }

        flushGroup();

        groupStart =
          current;

        groupEnd =
          current;
      }

      flushGroup();

      perf.changedRowsWriteMs =
        perfMs_(
          changedWriteStartedAt
        );
    }

    if (appendRows.length) {
      const appendStartedAt =
        Date.now();

      ensureSheetSize_(
        sheet,
        existingValues.length +
          appendRows.length,
        finalHeaders.length
      );

      sheet.getRange(
        existingValues.length + 1,
        1,
        appendRows.length,
        finalHeaders.length
      ).setValues(
        appendRows.map(
          row =>
            row.map(
              sanitizeCell_
            )
        )
      );

      perf.appendRowsWriteMs =
        perfMs_(
          appendStartedAt
        );
    }

    const signatureStateWriteStartedAt =
      Date.now();

    signatureStateData =
      stateContext
        ? setRequestStateValues_(
            ss,
            stateContext,
            {
              imageMasterIncomingSignature:
                incomingSignature
            }
          )
        : rptSetStateValues_(
            ss,
            {
              imageMasterIncomingSignature:
                incomingSignature
            },
            signatureStateData ||
            rptReadStateData_(
              ss
            )
          );

    perf.signatureStateWriteMs =
      perfMs_(
        signatureStateWriteStartedAt
      );

    perf.mode =
      'DELTA_UPDATE';

    perf.totalMs =
      perfMs_(
        totalStartedAt
      );

    return {
      rows:
        Math.max(
          existingValues.length - 1,
          0
        ) +
        appendRows.length,
      cols:
        finalHeaders.length,
      merged: true,
      changed: true,
      performance:
        perf
    };
  }

  // 非canonical / 初回は従来互換の全体mergeへフォールバック。
  const existingIndexByHeader =
    {};

  existingHeaders.forEach(
    (h, i) => {
      existingIndexByHeader[h] =
        i;
    }
  );

  const outputRows = [];

  if (
    existingValues.length > 1
  ) {
    for (
      let r = 1;
      r <
      existingValues.length;
      r++
    ) {
      const source =
        existingValues[r];

      const normalized =
        finalHeaders.map(
          header => {
            const idx =
              existingIndexByHeader[
                normalizeString_(
                  header
                )
              ];

            return idx ===
              undefined
              ? ''
              : source[idx];
          }
        );

      const fileName =
        normalizeString_(
          normalized[fileIdx]
        );

      if (!fileName) continue;

      outputRows.push(
        normalized
      );
    }
  }

  const outputIndex =
    new Map();

  outputRows.forEach(
    (row, index) => {
      outputIndex.set(
        normalizeString_(
          row[fileIdx]
        ),
        index
      );
    }
  );

  incomingRows.forEach(
    incoming => {
      const safeIncoming =
        finalHeaders.map(
          (_, idx) =>
            incoming[idx] ??
            ''
        );

      const fileName =
        normalizeString_(
          safeIncoming[
            fileIdx
          ]
        );

      if (!fileName) return;

      if (
        !outputIndex.has(
          fileName
        )
      ) {
        outputIndex.set(
          fileName,
          outputRows.length
        );

        outputRows.push(
          safeIncoming
        );

        return;
      }

      const idx =
        outputIndex.get(
          fileName
        );

      const existing =
        outputRows[idx];

      const existingUrl =
        normalizeString_(
          existing[urlIdx]
        );

      const incomingUrl =
        normalizeString_(
          safeIncoming[urlIdx]
        );

      if (
        !existingUrl &&
        incomingUrl
      ) {
        existing[urlIdx] =
          safeIncoming[urlIdx];

        if (statusIdx >= 0) {
          existing[statusIdx] =
            safeIncoming[
              statusIdx
            ];
        }

        if (jobIdx >= 0) {
          existing[jobIdx] =
            safeIncoming[
              jobIdx
            ];
        }

        if (methodIdx >= 0) {
          existing[methodIdx] =
            safeIncoming[
              methodIdx
            ];
        }

        if (atIdx >= 0) {
          existing[atIdx] =
            safeIncoming[
              atIdx
            ];
        }
      }

      if (
        memoIdx >= 0 &&
        !normalizeString_(
          existing[memoIdx]
        ) &&
        normalizeString_(
          safeIncoming[memoIdx]
        )
      ) {
        existing[memoIdx] =
          safeIncoming[memoIdx];
      }
    }
  );

  perf.computeMs =
    perfMs_(
      computeStartedAt
    );

  const rewriteStartedAt =
    Date.now();

  sheet.clearContents();

  ensureSheetSize_(
    sheet,
    Math.max(
      outputRows.length + 1,
      2
    ),
    finalHeaders.length
  );

  sheet.getRange(
    1,
    1,
    1,
    finalHeaders.length
  ).setValues([
    finalHeaders.map(
      sanitizeCell_
    )
  ]);

  if (outputRows.length) {
    sheet.getRange(
      2,
      1,
      outputRows.length,
      finalHeaders.length
    ).setValues(
      outputRows.map(
        row =>
          row.map(
            sanitizeCell_
          )
      )
    );
  }

  sheet.setFrozenRows(1);

  perf.fullRewriteMs =
    perfMs_(
      rewriteStartedAt
    );

    const signatureStateWriteStartedAt =
      Date.now();

    signatureStateData =
      stateContext
        ? setRequestStateValues_(
            ss,
            stateContext,
            {
              imageMasterIncomingSignature:
                incomingSignature
            }
          )
        : rptSetStateValues_(
            ss,
            {
              imageMasterIncomingSignature:
                incomingSignature
            },
            signatureStateData ||
            rptReadStateData_(
              ss
            )
          );

    perf.signatureStateWriteMs =
      perfMs_(
        signatureStateWriteStartedAt
      );

  perf.mode =
    'FULL_REWRITE';

  perf.totalMs =
    perfMs_(
      totalStartedAt
    );

  return {
    rows:
      outputRows.length,
    cols:
      finalHeaders.length,
    merged: true,
    changed: true,
    performance:
      perf
  };
}

function buildEnterpriseIncomingSignature_(
  applicationDataset
) {
  const headers =
    applicationDataset &&
    Array.isArray(
      applicationDataset.headers
    )
      ? applicationDataset.headers
      : [];

  const rows =
    applicationDataset &&
    Array.isArray(
      applicationDataset.rows
    )
      ? applicationDataset.rows
      : [];

  const enterpriseIndex =
    headers.indexOf(
      '企業ID'
    );

  const ids =
    enterpriseIndex >= 0
      ? Array.from(
          new Set(
            rows
              .map(
                row =>
                  normalizeString_(
                    row[
                      enterpriseIndex
                    ]
                  )
              )
              .filter(Boolean)
          )
        ).sort(
          (a, b) =>
            String(a)
              .localeCompare(
                String(b),
                'ja'
              )
        )
      : [];

  const source =
    JSON.stringify({
      v: 1,
      ids
    });

  const digest =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,
      source,
      Utilities.Charset.UTF_8
    );

  return {
    signature:
      'v1:' +
      Utilities
        .base64EncodeWebSafe(
          digest
        )
        .replace(
          /=+$/g,
          ''
        ),
    ids
  };
}

function mergeEnterpriseMasterForUpdate_(
  ss,
  applicationDataset,
  stateContext
) {
  const startedAt =
    Date.now();

  const perf = {
    signatureComputeMs: 0,
    signatureStateReadMs: 0,
    signatureStateWriteMs: 0,
    ensureSheetMs: 0,
    readMs: 0,
    computeMs: 0,
    writeMs: 0,
    mode: '',
    incomingIds: 0,
    existingIds: 0,
    appendedIds: 0,
    totalMs: 0
  };

  const signatureStartedAt =
    Date.now();

  const incoming =
    buildEnterpriseIncomingSignature_(
      applicationDataset
    );

  perf.signatureComputeMs =
    perfMs_(
      signatureStartedAt
    );

  perf.incomingIds =
    incoming.ids.length;

  const stateReadStartedAt =
    Date.now();

  let stateData =
    getRequestStateData_(
      ss,
      stateContext
    );

  perf.signatureStateReadMs =
    perfMs_(
      stateReadStartedAt
    );

  const previousSignature =
    normalizeString_(
      stateData
        .map
        .enterpriseMasterIncomingSignature
    );

  if (
    previousSignature &&
    previousSignature ===
      incoming.signature
  ) {
    perf.mode =
      'ENTERPRISE_SIGNATURE_SKIP';

    perf.totalMs =
      perfMs_(
        startedAt
      );

    return {
      changed: false,
      rows:
        incoming.ids.length,
      performance:
        perf
    };
  }

  const ensureStartedAt =
    Date.now();

  const sheet =
    ensureSheet_(
      ss,
      '42_企業IDマスタ',
      false
    );

  perf.ensureSheetMs =
    perfMs_(
      ensureStartedAt
    );

  const readStartedAt =
    Date.now();

  const lastRow =
    sheet.getLastRow();

  const existing =
    lastRow >= 2
      ? sheet.getRange(
          2,
          1,
          lastRow - 1,
          2
        ).getValues()
      : [];

  perf.readMs =
    perfMs_(
      readStartedAt
    );

  const computeStartedAt =
    Date.now();

  const byId =
    new Map();

  existing.forEach(
    row => {
      const id =
        normalizeString_(
          row[0]
        );

      if (id) {
        byId.set(
          id,
          [
            id,
            row[1] ?? ''
          ]
        );
      }
    }
  );

  perf.existingIds =
    byId.size;

  let appendedIds = 0;

  incoming.ids.forEach(
    id => {
      if (
        id &&
        !byId.has(
          id
        )
      ) {
        byId.set(
          id,
          [
            id,
            ''
          ]
        );

        appendedIds++;
      }
    }
  );

  perf.appendedIds =
    appendedIds;

  const rows =
    Array.from(
      byId.values()
    ).sort(
      (a, b) =>
        String(a[0])
          .localeCompare(
            String(b[0]),
            'ja'
          )
    );

  perf.computeMs =
    perfMs_(
      computeStartedAt
    );

  const writeStartedAt =
    Date.now();

  sheet.clearContents();

  sheet.getRange(
    1,
    1,
    1,
    2
  ).setValues([
    [
      '企業ID',
      '表示名'
    ]
  ]);

  if (rows.length) {
    sheet.getRange(
      2,
      1,
      rows.length,
      2
    ).setValues(
      rows
    );
  }

  sheet.setColumnWidth(
    1,
    180
  );

  sheet.setColumnWidth(
    2,
    260
  );

  perf.writeMs =
    perfMs_(
      writeStartedAt
    );

  const signatureWriteStartedAt =
    Date.now();

  stateData =
    stateContext
      ? setRequestStateValues_(
          ss,
          stateContext,
          {
            enterpriseMasterIncomingSignature:
              incoming.signature
          }
        )
      : rptSetStateValues_(
          ss,
          {
            enterpriseMasterIncomingSignature:
              incoming.signature
          },
          stateData
        );

  perf.signatureStateWriteMs =
    perfMs_(
      signatureWriteStartedAt
    );

  perf.mode =
    'ENTERPRISE_FULL_MERGE';

  perf.totalMs =
    perfMs_(
      startedAt
    );

  return {
    changed: true,
    rows:
      rows.length,
    performance:
      perf
  };
}

function markWorkbookMetadata_(ss, operationMode, requestId) {
  rptSetStateValues_(ss, {
    workbookType: 'VALID_APPLICATION_ANALYSIS',
    schemaVersion: API_CONFIG.DEFAULT_SCHEMA_VERSION,
    最終データ更新モード: operationMode,
    最終データ更新日時: new Date(),
    最終requestId: requestId,
    storageLayout: API_CONFIG.CURRENT_STORAGE_LAYOUT
  });
}

// ============================================================
// Viewer access / read-only API
// ============================================================

