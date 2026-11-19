# G6-J：独立TEST DataStore Stageを1回作成してCAS前で意図的停止

更新日：2026-11-19。

G6-I `VAA_QA_G6_PRECAS_STAGE_PREFLIGHT` の実測：`readyForStageOnlyDesignReview:true`。G6-D専用TESTシートは架空応募1件・求人1件、READY履歴4件、独立DataStore、更新リース0。Stage専用requestId未使用、同名Stageファイルなし。G6-E用の予約APPEND IDも未使用。すべてREAD_ONLYで不変。

## G6-Jで何を確認するか

G6-Jは、Googleの**隔離TEST**内で正規 `vaaStageAppendDataStore_` を使い、架空データのDataStore JSONファイルをStageとして1件だけ作成・検証する。

- 対象はG6-Dの独立TESTシートのみ。G4/G5の既存シート・元DataStoreは更新しない。
- Stage専用の `QA_G6I_STAGE_ONLY_PRECAS_20261119_V1` をファイルの生成IDとして使うが、**REQレシートの登録・更新リース取得はしない**。
- G6-Eの未使用APPEND requestId `QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1` は引き続き未使用で保持する。
- Stage作成後、**CAS関数・doPost・シートのstate更新・mirror更新は実行しない**。
- 元DataStoreポインタはG6-D CREATEのまま、実際のDatasetは応募1件・求人1件を維持する。一方、未接続StageにはAPPEND予定結果（応募2件・求人1件）が保存される。
- 完了後の読み取り専用監査は、ファイル名・TESTフォルダ所属・Stage JSON内の対象／requestId・identity version・APPEND方式・行数・正規マージ結果との完全一致を検証する。
- Stageファイルを作ったことによるDrive上の変更は意図的。削除・巻き戻し・二重作成は禁止し、次工程で監査する。

**これは「Stage後にCASを実行しない」制御停止の試験であり、フルdoPostの途中で障害を発生させた再現とは異なる。** したがって、REQがPROCESSINGになった場合やCAS後の障害からの自動復旧を実証するものではない。

## 初回実行手順：TEST GASのみ

1. これまでのTEST Apps Script（PRODではない）を開く。G4/G5およびG6-C/D/E/F/G/H/IのQAファイルと正規中央APIが入っていることを確認。
2. [`qa/G6_Isolated_PreCas_Stage_Once_QA.gs`](../qa/G6_Isolated_PreCas_Stage_Once_QA.gs)の全文を新規GSファイル `G6_Isolated_PreCas_Stage_Once_QA` へコピーして保存。中央APIや既存のQAファイルを編集しない。
3. `vaaQaG6JStageOnlyOnce` を**1回だけ**実行する。この関数は最初にG6-IのREAD_ONLYプリフライトを再実行してからStageを1回作成する。
4. `VAA_QA_G6_STAGE_ONLY_CREATE` のログを共有。前提のG6-D/E/F/G/H/IのREAD_ONLYログが併せて出ることは想定どおり。

### 合格時の期待ログ

- `phase:"G6_STAGE_ONLY_ONCE"`、`stageCreated:true`、`stageFileCount:1`、`stageValidationCode:"OK"`、`stageResultMatchesInspection:true`、`pass:true`。
- `stageInTestFolder:true`、`stageDataStoreMatchesExpected:true`、`expectedFinalApplications:2`、`expectedFinalJobs:1`。
- `targetPointerUnchanged:true`、`stageUnlinkedFromWorkbook:true`。
- `historicalReceiptsUnchanged:true`、`createReceiptUnchanged:true`、`originalDataStoreUnchanged:true`。
- `stageReceiptUnused:true`、`reservedUpdateRequestUnused:true`、`updateLeaseAbsent:true`。
- `casPerformed:false`、`actualUpdatePerformed:false`、`fullDoPostFaultInjected:false`、`automaticRetryAuthorized:false`。
- `propertyWrites:0`、`workbookModified:false`、`driveFilesCreatedExpected:1`、`driveFileDeletionAttempted:false`。

## 応答不明・タイムアウト・異常終了時

**`vaaQaG6JStageOnlyOnce`を再実行してはいけない。** ファイル作成自体が成功したのに応答だけ途絶えた可能性がある。書き込みに失敗した場合でも自動リトライを実施しない。

代わりに、同じファイル内の読み取り専用 `vaaQaG6JInspectStageReadOnly` を実行する。

監査ログ：`VAA_QA_G6_STAGE_ONLY_INSPECT`。期待値：

- `phase:"G6_STAGE_ONLY_INSPECT_READ_ONLY"`、`strictReadOnly:true`
- `actualReadyReceipts:4`、`stageFileCount:1`、`validationCode:"OK"`、`pass:true`
- `stageInTestFolder:true`、`stageBodyMatchesExpected:true`、`stageCountsMatchExpected:true`
- `stageDataStoreApplications:2`、`stageDataStoreJobs:1`。
- `stageIsUnlinked:true`、`originalPointerUnchanged:true`、`stagePointerNotFlipped:true`。
- `stageReceiptUnused:true`、`reservedUpdateRequestUnused:true`、`updateLeaseAbsent:true`。
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`。

Stageファイルが0件、2件以上、JSON不正、TESTフォルダ外、DataStoreとの比較不一致、REQ履歴異常、DataStoreポインタ切替を検出したら `pass:false` または例外となる。**そのときは削除・CAS・再送を行わず停止**し、ログだけ共有する。

## 安全上の注意

- Stageだけを作る試験のため、Driveにファイルが残ることが正常であり、勝手にごみ箱へ移さない。
- `vaaQaG6IStagePreflightReadOnly` はStage存在後に `readyForStageOnlyDesignReview:false` になる。G6-Iの過去の合格を取り消す意味ではなく、二重Stageを作らないための保護。
- G6-DのCREATE、G6-EのAPPEND、G6-H/Gの検証関数を新しい故障処理の代わりに実行しない。
- この作業はQA専用スクリプトを手動コピーした場合に限る。PRのマージだけでTEST環境へ書込みは発生しない。
- 実際のGoogleクォータに伴う障害、CAS後の不確実な処理状態、REQ ERROR/PROCESSINGからの復旧は引き続き未検証。G6-Kで次の監査・停止判断を設計する。
