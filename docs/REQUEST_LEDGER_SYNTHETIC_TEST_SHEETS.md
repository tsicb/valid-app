# READY履歴台帳：実Google Sheets・隔離TEST試験（新規合成READY 1件）

更新：2026-11-19。対象は新規の非公開TEST台帳のみ。**既存の4 READY履歴は変更しない。**

## この工程の成果物

- 専用TESTルート`valid-app_差分更新テスト`配下に、新しいネイティブGoogle Sheetを作成済み。
- ファイル名は`valid-app｜READY履歴台帳｜隔離TEST（空台帳）`、タブは`receipts`。
- A1:G1に`requestKey, recordJson, recordDigest, revision, updatedAt, schemaVersion, recordStatus`。
- 配置時点でデータ行なし、所有者以外への共有なし。
- URL/IDは**GitHub文書に記載しない**。TEST Apps ScriptのScript Propertiesにだけ格納する。

## 対象・意図

PR #36で追加した中央APIの`20_Request_Ready_Ledger_Foundation.gs`を、隔離TESTの本物のGoogle Sheetsと結びつける。

歴史的なG4/G5/G6-Dの4つのREADY履歴を移管するのではなく、新しい架空のREADYレシートを**メモリ内だけに構築**する。元DataStoreが存在することを証明するため、既に隔離TESTで検証済みのG6-Dワークブックを参照するが、ワークブック・DataStore・既存REQプロパティは一切変更しない。

新規TEST requestIdは`QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1`。実Script Propertiesには書き込まず、専用の読み取り用フェイクPropertiesでのみ構築する。

TEST台帳への**1行だけの実書込み**と、保存後の読戻し検証が今回の目的。一般的なCREATE/UPDATE動作や`doPost`再送経路への接続は次工程である。

## TEST Apps Scriptにセットアップ

これまでの「隔離TEST Apps Script」を使用すること。本番GASで実行してはいけない。

1. 既存のG4/G5/G6-D QAと中央APIコードを維持したまま、新規ファイル`20_Request_Ready_Ledger_Foundation`を追加し、[正規ソース](../central-api/20_Request_Ready_Ledger_Foundation.gs)全文をコピー。
2. 新規ファイル`Ledger_Ready_Synthetic_Sheets_Test_QA`を追加し、[QAソース](../qa/Ledger_Ready_Synthetic_Sheets_Test_QA.gs)全文をコピー。既存のコードを編集しない。
3. TEST GASの「プロジェクトの設定」→「スクリプト プロパティ」で、キー`VAA_REQUEST_LEDGER_SPREADSHEET_ID`に、新規作成済みTEST台帳の**スプレッドシートID**を設定する。URL全体ではなく`/d/`と`/edit`の間のIDだけを保存。GitHubや公開ログへ書き込まない。
4. `vaaQaLedgerReadySyntheticPreflightReadOnly`を実行。ログ`VAA_QA_LEDGER_READY_PREFLIGHT`を確認。
5. **`pass:true`の場合のみ**、`vaaQaLedgerReadySyntheticCopyOnce`を**1回だけ**実行。ログ`VAA_QA_LEDGER_READY_COPY`を確認。
6. コピーが成功したら、`vaaQaLedgerReadySyntheticInspectReadOnly`を実行し、`VAA_QA_LEDGER_READY_INSPECT`を共有する。

## 期待値

### 書込み前

`VAA_QA_LEDGER_READY_PREFLIGHT`：
- `phase:"LEDGER_READY_SYNTHETIC_PREFLIGHT_READ_ONLY"`、`strictReadOnly:true`。
- `ledgerIsPrivateInIsolatedTestRoot:true`、`exactSevenColumnSchema:true`。
- `historicReadyReceipts:4`。
- `syntheticReceiptUsesInMemoryProperties:true`。
- `existingSyntheticArchiveRow:false`、`ledgerHasHeaderOnly:true`。
- `scriptPropertiesUnchanged:true`、`actualWritePerformed:false`、`pass:true`。

### 書込み1回後

`VAA_QA_LEDGER_READY_COPY`：
- `phase:"LEDGER_READY_SYNTHETIC_COPY_ONCE"`、`syntheticReadyArchived:true`。
- `syntheticArchiveRowCount:1`、`historicReadyReceipts:4`。
- `originalRequestPropertiesUnchanged:true`。
- `actualUpdatePerformed:false`、`actualCasPerformed:false`、`actualRequestReceiptCreated:false`。
- `ledgerRowsCreatedExpected:1`、`cleanupAuthorized:false`、`automaticRetryAuthorized:false`、`pass:true`。

`VAA_QA_LEDGER_READY_INSPECT`：
- `phase:"LEDGER_READY_SYNTHETIC_INSPECT_READ_ONLY"`、`independentReadPasses:2`。
- `archiveRowCount:1`、`exactLedgerMatchesSyntheticRecord:true`。
- `replayResponseFromLedgerVerified:true`、`historicReadyReceipts:4`。
- `originalRequestPropertiesUnchanged:true`。
- `syntheticRequestIdNeverWrittenToRealProperties:true`、`actualWritePerformed:false`、`pass:true`。

## 障害時の停止

**`vaaQaLedgerReadySyntheticCopyOnce`を再実行しない。** 保存が成功しても、Google Apps Scriptへの応答だけが失われることがあるため。

結果不明・例外・タイムアウトの場合は`vaaQaLedgerReadySyntheticInspectReadOnly`のみ実行し、データ行が0か1か、行が正常か、元REQが不変かを確認する。重複行、破損、不明なシート、設定違い、権限違いがあれば停止し、ログを共有する。

## 未実装事項と次の優先順位

この試験は新規の合成READYを外部保存できることを示すだけ。**既存REQ_が無くなった場合に現行doPostが台帳から再送判定する仕組みはまだ存在しない**。

次に実施するのは、台帳を権威ある履歴情報として利用するための読み取り経路と、既存READYの安全な移行。特に`NOT_FOUND`を安易に新規処理開始と解釈しないための状態管理が必要。

本番Apps Script、従来のTEST READY4件、DataStore、未接続Stage、Script Propertiesの削除は対象外。
