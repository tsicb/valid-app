# READY履歴 外部台帳コピー第1件（隔離TEST限定）

更新：2026-11-20。前工程`VAA_QA_READY_TARGET_ARCHIVE_PREFLIGHT`実ログ：`pass:true`、`historicalCandidateCount:4`、`targetFilesVerified:4`、V1 READY未登録4、V2競合0、既存5イベント・REQ7件保全、プロパティ2巡完全一致。

## 目的と境界

最初の実移管は旧4件を一括処理せず、**G4の合成CREATE READY履歴1件だけ**を、既存`central-api/20_Request_Ready_Ledger_Foundation.gs`の`vaaLedgerReadyCopyOneUnderLock_`でPRIVATE TEST `receipts`へコピーする。

- 一切削除しない。元`REQ_`の生レシート、他のREADY3件、旧失敗CREATE V1、V2 CREATE/UPDATE、V2ジャーナル5イベント、既存V1合成READYを保全する。
- 1件の「COPY+読戻し」は試験対象。成功時のみV1 `receipts`がヘッダー＋既存合成1件＋今回1件＝3行となる。V2 `journal_v2`はヘッダー込み6行のまま。
- 複製はREADY_ARCHIVE_V1に対してだけ。V2ジャーナルへの履歴再作成や再送機能のON化はしない。
- 予想外の戻り値、エラー、タイムアウト、通信応答喪失時には`vaaQaReadyCopyFirstOnce`を**再実行しない**。`vaaQaReadyCopyFirstInspectReadOnly`のみを実行する。
- 既存V1台帳が保護されたTESTルート直下のPRIVATE Google Sheetsであることを、前工程で再度確認する。本番GASやWeb Appには設置しない。

## 今回のQA

GitHub `qa/Ready_Ledger_Migration_Copy_One_Once_QA.gs`（`central-api/`の自動同期対象外）。

| 関数 | 性質 | 実行順 |
|---|---|---|
| `vaaQaReadyCopyOneOffPreflightReadOnly` | 読み取り専用、モードOFF。前監査を再実行し、最初のG4 CREATE READY未登録・7件・既存台帳を照合 | 1 |
| `vaaQaReadyCopyOneArmedPreflightReadOnly` | 読み取り専用。明示的な専用モードを確認する | 2 |
| `vaaQaReadyCopyFirstOnce` | **実書込み**、ScriptLock取得、既存の本番基盤`vaaLedgerReadyCopyOneUnderLock_`をTEST1件にだけ呼ぶ | 3、別途GOの後 |
| `vaaQaReadyCopyFirstInspectReadOnly` | 独立監査。2巡アーカイブ照合、元REQ・他の3件・旧失敗・V2既存履歴不変、3行/6行 | 4、結果不明でも必須 |

専用のTEST Script Property：
`VAA_QA_READY_COPY_ONE_MODE`。デフォルトは未設定／`OFF`。armedでは`TEST_ONE_LEGACY_READY_COPY_V1`。

`VAA_JOURNAL_DOP_MODE`、`VAA_REQUEST_JOURNAL_MODE`、`VAA_REQUEST_LEDGER_REPLAY_MODE`は常に`OFF`または未設定のまま。V1台帳ID、G4 TESTルートID/出力ID、旧REQの各値も維持。

### STEP 1（今回指示するのはここまで）：OFF状態プリフライト

1. 隔離TEST GASの`VAA_QA_READY_COPY_ONE_MODE`を`OFF`（または未設定）とする。他の3モードも引き続きOFF。
2. `qa/Ready_Ledger_Migration_Copy_One_Once_QA.gs`を隔離TEST GASに新規`.gs`ファイルとして貼り付ける。既存の`qa/Ready_Ledger_Migration_Target_Archive_ReadOnly_QA.gs`等のQAファイルを消さない。
3. **`vaaQaReadyCopyOneOffPreflightReadOnly`を1回実行**。ログ`VAA_QA_READY_COPY_ONE_PREFLIGHT`を共有する。
4. 期待するログの主要項目：`phase:READY_COPY_ONE_OFF_PREFLIGHT_READ_ONLY`、`strictReadOnly:true`、`isolatedTestVerified:true`、`previousTargetArchivePreflightPassed:true`、`knownOneG4CreateTarget:true`、`existingV1OnlyOriginalSynthetic:true`、`selectedLegacyReadyAbsentFromV1:true`、`selectedLegacyReadyAbsentFromV2:true`、`copyModeOff:true`、`expectedModeSelected:true`、`propertySnapshotsStable:true`、`copyAttempted:false`、`pass:true`。

この段階では`vaaQaReadyCopyFirstOnce`を実行しない。どの段階でも生REQ値、台帳のレコードJSONやURL、Script Properties一覧はチャットや公開GitHubへ貼らない。

### STEP 2（前項の合格後に別途指示）

- `VAA_QA_READY_COPY_ONE_MODE=TEST_ONE_LEGACY_READY_COPY_V1`に変更。
- `vaaQaReadyCopyOneArmedPreflightReadOnly`を実行し、`correctlyArmed:true`、`pass:true`を確認する。
- コピー実行の合意を確認した後、`vaaQaReadyCopyFirstOnce`を**1回だけ**実行。
- 成否を問わず`vaaQaReadyCopyFirstInspectReadOnly`を1回実行。
- 独立監査で`archiveRowsExactlyThree:true`、`archivedState:FOUND`、`independentArchiveReadsMatch:true`、`archivedReceiptExactlyMatchesProperty:true`、`otherThreeV1Absent:true`、`otherThreeV2Absent:true`、`journalRowsStillSix:true`、`propertySnapshotsStable:true`、`pass:true`を確認。
- `VAA_QA_READY_COPY_ONE_MODE`を`OFF`へ戻す。元REQ・V1/V2履歴の削除・更新はしない。

### このテストが証明しないこと

TEST1件をV1へコピーできても、本番全件の移管許可やREQ削除の許可にはならない。本番履歴の監査はまだ実施していない。生REQが存在しない場合に新旧V1/V2を参照する本番安全ゲートも未導入。保存元のREQを残した状態ではScript Propertiesの容量は減らない。

V2 UPDATE APIレスポンスの別ログは取得できれば過去の実行記録を参照し、UPDATEリトライによって再取得しない。
