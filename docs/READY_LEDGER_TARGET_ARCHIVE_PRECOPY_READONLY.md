# READY履歴・移管前監査 第2段階：4件の保存先／台帳照合（隔離TEST、READ ONLY）

更新：2026-11-20。直前の`VAA_QA_READY_MIGRATION_INVENTORY`で7件のREQ_を集計し、構造上の候補4件（CREATE2、UPDATE2）、除外3件（旧失敗1・V2試験2）、スナップショット2回一致、`pass:true`を確認した。

## 今回の目的

候補4件について、削除の可否ではなく以下の事実を確認する。

- 保存先がGoogle Sheetsであり、隔離TEST管理出力フォルダ配下にあること（既存`validateUpdateTargetDriveFile_`を利用）
- 既存非公開TEST READY台帳（`receipts`）の1行は保全されていること
- 候補4件のV1台帳行が未登録またはREQ_と完全一致していること。別内容は競合で停止
- 候補4件がV2 `journal_v2`に想定外の履歴を持たないこと（この時点では未登録が期待）
- 旧失敗CREATE V1の`RESERVED rev1`、CREATE V2の`READY rev2`、UPDATE V1の`READY rev2`の存在、V2 journalの全5イベント、正常CREATE/UPDATEとREQの一致
- Script Properties全件スナップショットを前後2回読み取り、値の変化がないこと

用途は**隔離TEST専用の保存先と台帳照合**。既存4件をコピーしない。TestのREQ・台帳・Web App・本番のScript Propertiesは一切変更しない。

## 新規QAの構成

- `qa/Ready_Ledger_Migration_Target_Archive_ReadOnly_QA.gs`
- 関数`vaaQaReadyMigrationTargetArchiveReadOnly`
- 安全なログ接頭辞`VAA_QA_READY_TARGET_ARCHIVE_PREFLIGHT`
- 回帰テスト`tests/qa-ready-ledger-target-archive-precopy-readonly.test.cjs`

依存するTEST GASファイル：
`qa/G4_Isolated_Create_Replay_QA.gs`、
`qa/Ledger_V2_E2E_Create_Once_QA.gs`、
`qa/Ledger_V2_E2E_Create_Fresh_Id_QA.gs`、
`qa/Ledger_V2_E2E_Update_Append_Once_QA.gs`、
`qa/Ledger_Ready_Synthetic_Sheets_Test_QA.gs`、
`qa/Ready_Ledger_Migration_Inventory_ReadOnly_QA.gs`。
中央API `04_`（更新対象検証）、`15_`（容量計算）、`20_`（V1 READY台帳照合）、`22_`（V2 journal照合）も利用する。

## 実行手順

1. **隔離TEST GAS**の3設定`VAA_JOURNAL_DOP_MODE`、`VAA_REQUEST_JOURNAL_MODE`、`VAA_REQUEST_LEDGER_REPLAY_MODE`が`OFF`または未設定になっているか確認する。
2. 本QAファイルだけを隔離TEST GASエディタの**新規スクリプト**として追加。中央APIや既存QAの上書き、通常のGAS同期やWebアプリ再デプロイは不要。
3. GASの関数選択で`vaaQaReadyMigrationTargetArchiveReadOnly`を選択して1回実行。
4. `VAA_QA_READY_TARGET_ARCHIVE_PREFLIGHT`のJSON（件数、真偽値、固定ステージ名のみ）を共有する。

期待値：

- `phase:READY_LEDGER_TARGET_ARCHIVE_PRECOPY_READ_ONLY`、`strictReadOnly:true`
- `modesOff:true`、`expectedSevenReceipts:true`、`fourHistoricCandidatesVerified:true`
- `historicalCandidateCount:4`、`targetFilesVerified:4`
- `targetValidationFailed:0`
- `v1ArchiveMissingCount:4`、`v1ArchiveExactMatchCount:0`、`v1ArchiveConflictCount:0`
- `v2LegacyAbsentCount:4`、`v2LegacyCollisionCount:0`
- `v1SyntheticOriginalPreserved:true`、`v1ArchiveExpectedRowCount:true`
- `v2PreviousFiveEventsPreserved:true`、`v2ReadyReceiptsMatchProperties:true`、`failedCreateV1Preserved:true`
- `propertiesStableAcrossReads:true`、`propertySnapshotReads:2`
- `archiveWrites:0`、`propertyWrites:0`、`journalWrites:0`
- `migrationAuthorized:false`、`deletionAuthorized:false`、`replaySwitchAuthorized:false`
- `failureStage:NONE`、`pass:true`

`pass:false`の場合は、レシートを削除・修正・移動せず、`failureStage`を含むログだけを共有する。`failureStage`は機密情報を含まない固定ラベル。現時点でのファイル／台帳の整合性に問題があれば、処理を停止して原因を調査する。

## 判定の意味と制限

合格しても、「TESTで旧4件が現存し、台帳に競合がない」ことの検証にとどまる。**移管完了、READYの一括網羅性、本番の転送可能性、再送経路の切替、REQ削除許可ではない。**

次の候補工程：
1. TEST 4件のコピー順序・不整合時停止・バックアップ方法を設計し、実COPYは独立承認とする。
2. 本番の`REQ_`は最新の基準では137件・そのうちREADY133件（2026-11-18監査）。ただし本QAの`expectedSevenReceipts`はTEST固有であり、そのまま本番に適用できない。本番用の集計・Drive・台帳権限監査は別途設計する。
3. V2予約ゲート`23_`は合成TEST requestIdにしか許可されない。既存REQを削除する前に、一般本番用の先行予約・READY再送をfail-closedで扱う設計と実統合試験が必要。

なおUPDATE APIレスポンス`VAA_QA_LEDGER_V2_UPDATE`のログが未共有でも、独立監査でV2 READY rev2とDataStore 2+2は確認されている。ログ取得のためにUPDATEを再実行しないこと。
