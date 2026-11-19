# V2 requestId台帳：実Google Apps ScriptのCREATE統合試験（隔離TEST・1回限定）

2026-11-19。直前のREAD_ONLY結果：
`VAA_QA_LEDGER_V2_DOP_PREFLIGHT` `pass:true`、
READY履歴4件、V1 READY台帳1行、V2 journalはヘッダーのみ、既存Script Properties不変、TESTモードOFF。

## 今回の目的

PR #40で統合した中央API`02_EntryPoint.gs` + `23_Request_Ledger_V2_DoPost_Bridge.gs`を、**実Google TEST環境**で1回だけ動かす。既存のG4/G5/G6-D各READY履歴4件をそのまま残し、新しい架空の応募1件・求人1件だけを対象に、次を一連で検証する：

1. `RESERVED rev1`が実TEST Sheets `journal_v2`に保存・再読込される。
2. その後に独立したTEST workbookがCREATEされ、元の4つのREADY履歴は変更されない。
3. 完成した`REQ_` READYと`READY rev2`が相互に一致し、重複作成せずに再送できる状態になる。
4. 応答喪失や途中失敗は**再実行しない**。READ_ONLY inspectorで`RESERVED`/READY・REQの状態を確認して停止。

注意：この一回限りのCREATE成功後、TEST Script PropertiesのREADY数は**4→5**となる。既存の`readyCount===4`を前提とするG6系の監査は、そのまま再実行してPASSを期待しない。既存4件の生JSONを保存前後で完全一致確認し、新しい1件とは独立して検証する。

**本工程で本番に対するデプロイ/変更やREQ削除をしてはいけない。**

## 準備するソース（隔離TEST Apps Scriptのみ）

すでにTEST GASに追加済みの`20_`、`21_`、`22_`、`23_`とG4/G5/G6のQAコードを維持する。追加・更新対象：

- `central-api/02_EntryPoint.gs`：**TEST GASに限って**GitHub `main`の最新版へ置換。PR #40で実装したV2統合版（本番側の`02_`は変更禁止）。事前にTEST内既存`02_`のバックアップを保持すること。
- 新規 `qa/Ledger_V2_E2E_Create_Once_QA.gs`：正規ソース全文を追加する。既存QAコードは変更しない。

**確認事項**：このTEST用の`API_CONFIG.ROOT_FOLDER_ID`・`SHEET_OUTPUT_FOLDER_ID`が`VAA_QA_G4_CONFIG_`の隔離TESTルート/出力IDと完全一致していること。`ACCESS_KEY`はTEST用で、実企業・実応募のデータを使わないこと。

## 切替のために追加するTEST Script Properties

以下はすべて**隔離TEST GAS**のScript Propertiesにだけ設定（PRODへ設定しない）。

| キー | TEST値 |
|---|---|
| `VAA_JOURNAL_DOP_MODE` | `TEST_ONE_SYNTHETIC_REQUEST_V1` |
| `VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID` | `QA_JOURNAL_E2E_CREATE_20261119_V1` |
| `VAA_REQUEST_JOURNAL_MODE` | `TEST_RESERVATION_V1` |
| `VAA_JOURNAL_TEST_ROOT_ID` | `1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU` |
| `VAA_JOURNAL_TEST_OUTPUT_ID` | `1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7` |

既存の`VAA_REQUEST_LEDGER_SPREADSHEET_ID`は変更しない。
`VAA_REQUEST_LEDGER_REPLAY_MODE`は**未設定または`OFF`**のまま。

TESTモード有効期間中、許可された1件以外の通常requestIdを`doPost`へ投げると安全のためHALTする。実企業のPOSTなどをこのTESTエンドポイントへ送信しない。

## 実行順序

**この準備を行うだけでCREATEは実行されない。**

1. TEST Script PropertiesとTEST `02_EntryPoint.gs`を上記のとおり設定。実際のPRODの`02_`は更新しない。
2. `vaaQaLedgerE2ECreatePreflightReadOnly`を実行。ログ`VAA_QA_LEDGER_V2_E2E_CREATE_PREFLIGHT`の`pass:true`を確認。確認できない場合は先に進まない。
3. 合格時に限り、`vaaQaLedgerE2ECreateOnce`を**1回のみ**実行。これがTEST個社シートをCREATEし、TEST Script Propertiesに新規REQを1件保存し、TEST台帳に2イベント記録する。
4. `vaaQaLedgerE2ECreateInspectReadOnly`を実行。ログ`VAA_QA_LEDGER_V2_E2E_CREATE_INSPECT`を確認。

**一度でも`vaaQaLedgerE2ECreateOnce`を実行したら、結果に関係なく再実行禁止**。失敗・例外・タイムアウト・応答喪失はInspectorだけ実行し、手動調査する。

## 期待値

事前確認 `VAA_QA_LEDGER_V2_E2E_CREATE_PREFLIGHT`：
- `phase:"LEDGER_V2_E2E_CREATE_PREFLIGHT_READ_ONLY"`、`strictReadOnly:true`
- `existingHistoricReadyCount:4`、`existingHistoricReadyUnchanged:true`
- `v1OriginalSyntheticRowVerified:true`、`v1NewRequestAbsent:true`
- `v2JournalHeaderOnly:true`、`v2NewRequestAbsent:true`、`newRequestPropertyAbsent:true`
- `testModeEnabled:true`、`exactSingleRequestScopeApproved:true`、`oldReadyOnlyReplayModeOff:true`
- `capacityAllowed:true`、`scriptPropertiesUnchanged:true`、`pass:true`

1回のみの実行 `VAA_QA_LEDGER_V2_E2E_CREATE`：
- `responseOk:true`、`responseReady:true`、`responseReused:false`
- `responseMatchesVerifiedTestReceipt:true`、`journalReadyAfterPost:true`、`journalRevision:2`
- `historicReadyUnchanged:true`、`automaticRetryAuthorized:false`、`pass:true`

実行後監査 `VAA_QA_LEDGER_V2_E2E_CREATE_INSPECT`：
- `journalState:"READY"`、`journalRevision:2`、`journalReady:true`
- `syntheticWorkbookDataMatchesExpected:true`（新規TEST DataStoreの架空応募1件・架空求人1件が期待データと完全一致）
- `journalStableAcrossReads:true`、`newReceiptReady:true`、`readyJournalMatchesReceipt:true`
- `historicReadyCount:4`、`historicReadyUnchangedAcrossInspection:true`
- `v1PreviousSyntheticRowPreserved:true`、`newRequestNotDuplicatedInV1:true`
- `pass:true`

## 次のUPDATE試験への引継ぎとフラグ

CREATEが成功したら、同じTEST workbookに**別の新規合成UPDATE requestId**を用いて、同じRESERVED→UPDATE→READYの経路を1回検証する。ただし、その実装・事前検証を開始するまで、TESTの`VAA_JOURNAL_DOP_MODE`は`OFF`に戻しておく。後でUPDATEの許可範囲を改めて1件だけ設定する。CREATEが不明・失敗した場合も、Inspectorの結果を保全したうえで`VAA_JOURNAL_DOP_MODE`を`OFF`にし、自動再開しない。**モードOFFでもE2E用合成requestIdはブリッジが新規受付を遮断する。**

TEST用の新しいREADY履歴を作成した時点では容量は減らない。最終的な容量対策は、READY履歴を外部台帳へ移し、履歴を削減しても同じrequestIdの再実行が起こらないことを独立検証してから本番切替すること。

## 誤操作防止

- PRマージはApps Scriptへ自動デプロイされない。
- 本番GASの最新`02_EntryPoint.gs`置換やV2フラグ設定は禁止。
- G4/G5/G6の過去の一度きりのCREATE/UPDATE関数を再実行しない。
- `VAA_QA_LEDGER_READY_SYNTHETIC_COPY_ONCE`やStage作成を再実行しない。
- Script Propertiesにある既存の`REQ_`4件を削除・軽量化しない。
- `journal_v2`タブの手動編集や既存V1`receipts`行への編集をしない。
