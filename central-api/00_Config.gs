/**
 * 有効応募分析 - Google Sheets生成 API
 * Integration v2.45 canonical image URL fix / schemaVersion 3.0
 *
 * Script Properties（プロジェクト設定から登録）
 * - ACCESS_KEY
 * - SCHEMA_VERSION  = 3.0
 * - APP_VERSION     = 任意（例: 2026.08.29-api-v1）
 *
 * Web App:
 * - Execute as: Me
 * - Who has access: 運用方針に合わせて設定
 */

const API_CONFIG = Object.freeze({
  DEFAULT_SCHEMA_VERSION: '3.0',
  DEFAULT_APP_VERSION: '2026.09.18-api-v2.45-canonical-image-url',
  ROOT_FOLDER_ID: '1pczMllofAeCpPsMKmaU0fDDUUXgkXy8f',
  SHEET_OUTPUT_FOLDER_ID: '1izieBYn1U40y0sMkK2H5WzoILA1blYNb',
  EXPECTED_PAGES_VERSION: '2026.09.03-etl-v2.22-prerelease-clean',
  EXPECTED_COMMON_MASTER_VERSION: '2026.09.03-common-v1',
  MAX_BODY_CHARS: 25000000,
  MAX_DATASET_ROWS: 100000,
  MAX_DATASET_COLS: 120,
  MAX_CELL_CHARS: 49000,
  REQUEST_PROPERTY_PREFIX: 'REQ_',
  REPORT_REGISTRY_PREFIX: 'RPTREG_',
  MAX_REQUEST_PROPERTIES: 500,
  COPY_SETTLE_MS: 0,
  PROCESS_LEASE_MS: 390000,
  PENDING_RETRY_MS: 8000,
  ANALYSIS_DATASTORE_VERSION: '1.0',
  ANALYSIS_DATASTORE_FOLDER_PROPERTY: 'SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID',
  ANALYSIS_DATASTORE_FOLDER_NAME: '_valid_application_analysis_datastore',
  CURRENT_STORAGE_LAYOUT: 'DATASTORE_V1'
});

const DATASET_SHEETS = Object.freeze({
  jobAnalysisMaster: {
    name: '91_求人分析マスタ',
    hidden: true
  },
  processInfo: {
    name: '93_処理情報',
    hidden: true
  },
  inputFiles: {
    name: '94_入力ファイル情報',
    hidden: true
  },
  imageMasterInitial: {
    name: '41_画像マスタ',
    hidden: false
  }
});



const REPORT_SHEETS = Object.freeze({
  PORTAL: '00_このレポートについて',
  INTEGRATION_REPORT: '01_データ連携情報',
  INITIAL_SETTINGS: '30_分析レポート初期設定',
  DISPLAY_SETTINGS: '31_分析レポート表示項目',
  KEYWORD_MASTER: '40_仕事名KWマスタ',
  IMAGE_MASTER: '41_画像マスタ',
  ENTERPRISE_MASTER: '42_企業IDマスタ',
  CUSTOM_ANALYSIS: '34_カスタム分析設定',
  JOB_ANALYSIS_MASTER: '91_求人分析マスタ',
  PROCESS_INFO: '93_処理情報',
  INPUT_FILES: '94_入力ファイル情報',
  AUDIT_LOG: '98_運用ログ',
  INTERNAL_STATE: '99_内部状態'
});

const PRODUCT_THEME_ = Object.freeze({
  brandBlue: '#148ECC',
  brandBlueDark: '#0D6795',
  brandBlueSoft: '#EAF6FC',
  brandYellow: '#EEFF16',
  brandYellowSoft: '#FBFFD8',
  textPrimary: '#123047',
  textSecondary: '#64748B',
  border: '#CFE4EE',
  surfaceSoft: '#F7FBFD',
  white: '#FFFFFF',
  warningText: '#92400E',
  warningSoft: '#FFFBEB'
});

const VIEWER_DISPLAY_DEFINITIONS_ =
  Object.freeze([
    ['month-progress', '月間応募進捗', '概要', '月間の応募ペース・前月/前年同月比較・着地予測', true],
    ['age', '年代構成', '概要', '年代別の応募構成', true],
    ['status', '対応状況別', '基本分析', '対応状況ごとの応募傾向', true],
    ['month', '応募月別', '基本分析', '応募月ごとの推移', true],
    ['media', '応募媒体別', '基本分析', '応募媒体ごとの応募傾向', true],
    ['enterprise', '企業ID別', '基本分析', '企業IDが複数ある場合の比較', false],
    ['name-script', '氏名文字種区分別', '基本分析', '氏名文字種区分ごとの応募傾向', true],
    ['residence', '居住都道府県別', '基本分析', '応募者居住都道府県ごとの応募傾向', true],
    ['job-category', '職種別', '基本分析', '求人職種ごとの応募傾向', true],
    ['employment', '雇用形態別', '基本分析', '雇用形態ごとの応募傾向', true],
    ['job-location-name', '求人勤務地名称別', '基本分析', '求人勤務地名称ごとの応募傾向', true],
    ['job-prefecture', '勤務地都道府県別', '基本分析', '求人勤務地都道府県ごとの応募傾向', true],
    ['prefecture-match', '勤務地・居住都道府県一致別', '基本分析', '勤務地と居住都道府県の一致状況', true],
    ['job-keyword', '仕事名KW別', '基本分析', '仕事名キーワードごとの応募傾向', true],
    ['job-full-keyword', '仕事名フルKW別', '基本分析', '複合仕事名キーワードごとの応募傾向', true],
    ['recruit-background', '募集背景別', '基本分析', '募集背景ごとの応募傾向', true],
    ['month-day', '月内応募日別', '基本分析', '月内応募日バケットごとの応募傾向', true],
    ['weekday', '応募曜日別', '基本分析', '応募曜日ごとの応募傾向', true],
    ['hour', '応募時間帯別', '基本分析', '応募時間帯バケットごとの応募傾向', true],
    ['hourly-salary', '時給下限別', '基本分析', '時給下限バケットごとの応募傾向', true],
    ['daily-salary', '日給下限別', '基本分析', '日給下限バケットごとの応募傾向', true],
    ['monthly-salary', '月給下限別', '基本分析', '月給下限バケットごとの応募傾向', true],
    ['annual-salary', '年収下限別', '基本分析', '年収下限バケットごとの応募傾向', true],
    ['text-length', '求人原稿文字数別', '基本分析', '求人原稿文字数バケットごとの応募傾向', true],
    ['main-image', 'メイン画像有無別', '基本分析', 'メイン画像有無ごとの応募傾向', true],
    ['image-count', '求人画像枚数別', '基本分析', '求人画像枚数ごとの応募傾向', true],
    ['job-video', '求人動画有無別', '基本分析', '求人動画有無ごとの応募傾向', true],
    ['indeed-tag-count', 'Indeed求人タグ数別', '基本分析', 'Indeed求人タグ数バケットごとの応募傾向', true],
    ['note-detail', '求人備考1行目別応募傾向', '詳細分析', '求人備考の先頭行ごとの分析', true],
    ['indeed-tag-detail', 'Indeed求人タグ別応募傾向', '詳細分析', '求人タグごとの詳細分析', true],
    ['top-image-detail', 'TOP画像別応募傾向', '詳細分析', 'TOP画像ごとの詳細分析', true],
    ['custom-analysis', 'カスタム分析', '自由分析', '分析レポート上で行軸・列軸を自由選択。選べる軸は他の分析レポート表示項目に連動', true]
  ]);
