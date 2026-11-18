/**
 * Manual QA ONLY. Copy to NEW file in the ISOLATED TEST Apps Script editor.
 * This file is intentionally outside central-api/ and is NOT included in
 * automated GAS source sync, production GAS bundles or Web App releases.
 *
 * Order: vaaQaG4PreflightReadOnly -> vaaQaG4CreateOnce -> vaaQaG4ReplayReady.
 * NEVER rerun CreateOnce after any error or interruption. Inspect receipt and
 * Drive files first. No real applicant or enterprise data is used.
 */
const VAA_QA_G4_CONFIG_ = Object.freeze({
  testRootId: '1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU',
  testOutputId: '1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7',
  requestId: 'QA_G4_SYNTHETIC_CREATE_20261118_V1',
  company: 'QA_SYNTHETIC_ONLY_G4'
});

function vaaQaG4IsolatedConfig_() {
  const expected = VAA_QA_G4_CONFIG_;
  if (
    API_CONFIG.ROOT_FOLDER_ID !== expected.testRootId ||
    API_CONFIG.SHEET_OUTPUT_FOLDER_ID !== expected.testOutputId
  ) {
    throw new Error('QA_ISOLATION_FAILED: TEST folder IDs do not match');
  }
  const props = PropertiesService.getScriptProperties();
  if (
    props.getProperty('SCHEMA_VERSION') !== '3.0' ||
    !props.getProperty('ACCESS_KEY')
  ) {
    throw new Error('QA_SETUP_REQUIRED: TEST authentication is incomplete');
  }
  return props;
}

function vaaQaG4SyntheticPayload_() {
  const cfg = VAA_QA_G4_CONFIG_;
  const props = vaaQaG4IsolatedConfig_();
  const applicationHeaders = [
    'レコードID', '企業ID', '仕事番号', '求人参照ID',
    '求人データ突合フラグ', '応募日時', '応募年月',
    '応募日', '応募曜日', '応募時間帯', '応募数',
    '対応状況', '応募媒体', '年齢', '年代', '性別',
    '氏名文字種区分', 'メールドメイン', '居住都道府県',
    '勤務地・居住都道府県一致', '応募識別キー', '応募識別方式'
  ];
  return {
    action: 'create',
    requestId: cfg.requestId,
    schemaVersion: '3.0',
    accessKey: props.getProperty('ACCESS_KEY'),
    requestedAt: new Date().toISOString(),
    appVersion: API_CONFIG.DEFAULT_APP_VERSION,
    commonMasterVersion: API_CONFIG.EXPECTED_COMMON_MASTER_VERSION,
    outputFolderId: cfg.testOutputId,
    companyDisplayName: cfg.company,
    viewerBaseUrl: '',
    manageBaseUrl: '',
    updateProtocol: 'IDENTITY_V1',
    initialSettings: {
      analysisStartDate: '', analysisEndDate: '',
      targetAgeMin: '', targetAgeMax: '', jobNameKeywords: []
    },
    datasets: {
      applicationData: {
        headers: applicationHeaders,
        rows: [[
          'APP000001', 'QA0001', 'QA_JOB_1', 'QA_REF_1',
          1, '2026/11/18 12:00', '2026/11',
          '2026/11/18', '水', '12時台', 1,
          '未対応', 'Indeed', 30, '30代', '不明',
          '', '', '東京都', '',
          'I1:' + Array(65).join('a'), 'PERSON_NAME'
        ]]
      },
      jobAnalysisMaster: {
        // Same 28-column schema as Pages, using synthetic values only.
        headers: [
          '求人参照ID', '求人分析情報ソース', '企業ID', '仕事番号',
          '求人管理番号', '公開情報区分', '仕事名',
          'Indeed用求人タイトル', '職種', '雇用形態',
          '募集背景', '求人勤務地名称', '勤務地住所',
          '勤務地都道府県', '最寄駅', '求人備考',
          '給与区分コード', '給与金額MIN', '給与金額MAX',
          'メイン画像ファイル名', 'メイン画像あり',
          '求人画像枚数', '動画タイトル', '求人動画あり',
          '特徴コード', 'Indeed求人タグコード',
          'Indeed求人タグ数', '求人原稿文字数'
        ],
        rows: [[
          'QA_REF_1', 'JOB_CSV', 'QA0001', 'QA_JOB_1',
          'QA_MANAGEMENT_1', '公開', 'QA架空求人',
          'QA架空求人', '事務', '正社員',
          '', 'QA勤務地', '', '東京都', '', '',
          '03', 1200, 1500, '', 0, 0, '', 0,
          '', '', 0, 0
        ]]
      },
      processInfo: {
        headers: ['項目', '値'],
        rows: [['ETL実行日時', '2026-11-18T12:00:00Z']]
      },
      inputFiles: {
        headers: ['種別', 'ファイル名', '読込行数', '文字コード'],
        rows: [['応募CSV', 'QA_SYNTHETIC_ONLY.csv', 1, 'UTF-8']]
      },
      imageMasterInitial: {
        headers: [
          '画像ファイル名', '画像URL', '取得状態',
          '参照求人管理番号', '取得方法', '取得日時', 'メモ'
        ],
        rows: []
      }
    }
  };
}

function vaaQaG4ReceiptRaw_(props) {
  return props.getProperty(
    API_CONFIG.REQUEST_PROPERTY_PREFIX + VAA_QA_G4_CONFIG_.requestId
  );
}

function vaaQaG4PreflightReadOnly() {
  const props = vaaQaG4IsolatedConfig_();
  const payload = vaaQaG4SyntheticPayload_();
  const validation = validateEnvelope_(payload);
  const capacity = vaaCheckNewRequestCapacityReadOnly_(props);
  const existing = !!vaaQaG4ReceiptRaw_(props);
  const output = {
    phase: 'G4_PREFLIGHT_READ_ONLY',
    safeToCreateOnce: validation.ok === true && capacity.allowed && !existing,
    payloadValidationCode: validation.ok ? 'OK' : validation.code,
    budgetAllowed: capacity.allowed,
    requestIdAlreadyExists: existing,
    testFoldersMatch: true,
    syntheticApplications: payload.datasets.applicationData.rows.length,
    syntheticJobs: payload.datasets.jobAnalysisMaster.rows.length,
    propertiesModified: 0,
    propertiesDeleted: 0
  };
  console.log('VAA_QA_G4_PREFLIGHT ' + JSON.stringify(output));
  return output;
}

function vaaQaG4Summary_(response, kind, props) {
  const raw = vaaQaG4ReceiptRaw_(props);
  let receipt = null;
  try { receipt = raw ? JSON.parse(raw) : null; } catch (_) {}
  return {
    phase: kind,
    ok: response.ok === true,
    status: String(response.status || ''),
    stage: String(response.stage || ''),
    code: String(response.code || ''),
    reused: response.reused === true,
    receiptExists: !!raw,
    receiptReady: !!receipt && receipt.status === 'READY',
    responseMatchesReceipt: !!receipt &&
      String(response.spreadsheetId || '') === String(receipt.spreadsheetId || ''),
    requestIdMatched: String(response.requestId || '') === VAA_QA_G4_CONFIG_.requestId,
    // Do not print URLs, tokens, Script IDs, access keys or workbook IDs.
    testOutputOnly: true
  };
}

function vaaQaG4Invoke_(payload) {
  return JSON.parse(
    doPost({postData: {contents: JSON.stringify(payload)}}).getContent()
  );
}

/**
 * SIDE EFFECT: intentionally creates ONE synthetic TEST-only workbook.
 * Call exactly once after green preflight. Never rerun after any exception.
 */
function vaaQaG4CreateOnce() {
  const props = vaaQaG4IsolatedConfig_();
  const preflight = vaaQaG4PreflightReadOnly();
  if (!preflight.safeToCreateOnce) {
    throw new Error('QA_G4_CREATE_NOT_PERMITTED: preflight is not green');
  }
  const response = vaaQaG4Invoke_(vaaQaG4SyntheticPayload_());
  const output = vaaQaG4Summary_(response, 'G4_CREATE_ONCE', props);
  console.log('VAA_QA_G4_CREATE ' + JSON.stringify(output));
  return output;
}

/**
 * Read the prior READY receipt FIRST. Refuse replay if CREATE did not reach
 * READY, or if the target is not in the TEST managed output folder.
 */
function vaaQaG4ReplayReady() {
  const props = vaaQaG4IsolatedConfig_();
  const raw = vaaQaG4ReceiptRaw_(props);
  if (!raw) throw new Error('QA_G4_REPLAY_BLOCKED: no saved request receipt');
  let receipt;
  try { receipt = JSON.parse(raw); } catch (_) {
    throw new Error('QA_G4_REPLAY_BLOCKED: unreadable receipt');
  }
  if (receipt.requestId !== VAA_QA_G4_CONFIG_.requestId ||
      receipt.status !== 'READY' || !receipt.spreadsheetId) {
    throw new Error('QA_G4_REPLAY_BLOCKED: receipt is not READY');
  }
  const file = DriveApp.getFileById(receipt.spreadsheetId);
  if (!fileIsInManagedOutputTree_(file, VAA_QA_G4_CONFIG_.testOutputId)) {
    throw new Error('QA_G4_REPLAY_BLOCKED: workbook is outside TEST output');
  }
  const beforeId = receipt.spreadsheetId;
  const response = vaaQaG4Invoke_(vaaQaG4SyntheticPayload_());
  const output = vaaQaG4Summary_(response, 'G4_REPLAY_READY', props);
  output.sameSpreadsheet = response.spreadsheetId === beforeId;
  output.pass = output.ok && output.reused &&
    output.receiptReady && output.responseMatchesReceipt &&
    output.sameSpreadsheet && output.requestIdMatched;
  console.log('VAA_QA_G4_REPLAY ' + JSON.stringify(output));
  return output;
}
