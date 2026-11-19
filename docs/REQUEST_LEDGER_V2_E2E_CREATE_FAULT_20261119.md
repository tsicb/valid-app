# V2実CREATE中断の記録（2026-11-19、隔離TEST）

## 実行結果（ユーザーが共有したGASログ）

- `VAA_QA_LEDGER_V2_E2E_CREATE_PREFLIGHT`: `pass:true`（事前はREADY履歴4件、V1台帳READY1行、V2台帳はヘッダーのみ、Script Properties正常）。
- `vaaQaLedgerE2ECreateOnce`を**1回だけ**実行した。17:16:55にGoogle Sheetsサービス接続エラー。
- スタックトレース：`03_Workbook:100` `writeDataset_` → `02_EntryPoint:1267` → `doPost`。該当箇所は非非表示シートの `setFontWeight('bold')` によるヘッダー書式設定。これは接続エラーの発生位置であり、全データの完全保存を意味しない。
- 17:17と17:19の独立READ_ONLY監査は一致：
  - `journalState:"RESERVED"`、`journalRevision:1`、`journalReady:false`
  - `newReceiptExists:true`、`newReceiptReady:false`
  - `verifiedTargetInIsolatedTestOutput:true`、`syntheticWorkbookDataMatchesExpected:false`
  - `historicReadyCount:4`、`historicReadyUnchangedAcrossInspection:true`
  - `scriptPropertiesUnchangedDuringInspection:true`、`automaticRetryAuthorized:false`、`pass:false`
- 終了レスポンス：`responseCode:"INTERNAL_ERROR"`、`responseOk:false`、`journalRevision:1`、`pass:false`。

## 外部からの追加READ_ONLY確認

Google Drive・Sheetsメタデータを用いた独立確認で、TEST出力フォルダ直下に途中作成された合成ワークブック1件が存在。内部タブは当時6件。少なくとも`91_求人分析マスタ`、`93_処理情報`、`94_入力ファイル情報`にデータ行があり、`41_画像マスタ`はヘッダー行のみ。標準`シート1`は空。

TEST非公開台帳`journal_v2`には当該requestIdの`RESERVED rev1`が1件、READY行は0件。従来の`receipts`タブの既存合成READY1行も保全。**メタデータと限定範囲のセル読取であり、作成済みワークブック全体の完全性監査ではない。**

## 判断

- この状態は**途中で副作用が起こったV2試験**であり、`retryable`は**false**でなければならない。
- `RESERVED`で新規再送を停止できている点は防御設計どおり。一方、CREATEの正常終了を実証する試験としては**不合格**。
- 不明な部分書込みに対し、自動再送・同じrequestIdの`doPost`再送・`REQ_`編集・`journal_v2`へのREADY偽造・部分ワークブック削除を**禁止**。
- 今回のPRは`doPost`例外応答について、V2予約済み処理が失敗したときに`retryable:false`と`journalRecoveryDisposition:"INSPECT_ONLY_NO_RETRY"`を返すよう修正。既存のV2予約ガードやLEGACYの再開条件は変更しない。
- 既に発生したエラー応答やレシート・ワークブック・台帳への書込みは本PRでは一切行わない。

## 次の工程（整理してから進む）

1. TESTモード`VAA_JOURNAL_DOP_MODE`は作業終了後`OFF`に戻し、旧合成requestIdは**永久に再利用しない**。OFFでもそのE2E合成IDを新規として受理しないガードは実装済み。
2. 既存4 READY、V1 1 READY、V2 RESERVED1件、途中作成ワークブックの状態を証跡として記録し、操作せず保存。
3. 次のCREATE/UPDATE正常系を試す際は**新規の合成requestId、厳密なTEST範囲、事前READ_ONLY確認、実行は1回のみ**とする。過去の失敗IDを再利用して復旧完了と主張しない。
4. 元々の目標はScript Properties履歴を安全に外部台帳へ移し、容量増加を抑えること。今回の例外時の挙動はその移行に必要な安全要件として再利用する。細かいG6系の試験を無制限に増やさない。

**本番GASと本番レシートへの変更はない。既存の途中作成TEST資産は削除しない。**
