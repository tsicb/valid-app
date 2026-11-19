# G6-I：Google TESTのStage後／CAS前停止を安全に検証するためのREAD_ONLYゲート

更新：2026-11-19。**G6-I自体はStageファイルを作成せず、障害注入もしない。**

## G6-Hの実ログによる前提

`VAA_QA_G6_CAS_FAULT_ATTESTATION` は `pass:true`、7つの正規実装ソース照合がすべて合格。

- READYレシート4件、G4/G5とG6-Dの2つのTEST DataStoreは不変。
- G6-EのUPDATE requestIdは未使用、対象更新リースなし。
- GitHub CIでは、正規`vaaStageAppendDataStore_`／`vaaCommitStagedAppendDataStore_`をメモリ上のFake Drive/Sheet/Lockにつなぎ、CAS前後での例外とバックアップ保持を模擬検証済み。
- **Google Apps Scriptの実サービス上の途中停止・復旧は未確認。**

## G6-Iの目的：最初の実故障を最小限に限定する

将来のG6-Jでは、G6-Dで作成済みの「独立した架空TESTシート」に対し、**APPENDのDataStore Stageファイルを1件だけ生成する**ことを検討する。

「Stageを作成したあと、CASの直前で意図的に停止」する最小ケースである。まだ許可・実行しない。

- G6-Eの未使用APPEND requestId `QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1` は保留・未使用のまま維持する。
- Stage専用に、別の架空ID `QA_G6I_STAGE_ONLY_PRECAS_20261119_V1` を採用する。
- このStage専用IDでREQ履歴を新規作成したり、更新リースを取得したり、`doPost`を呼んだりしない。
- Stageを仮に作っても、中央APIのCAS関数を呼ばず、ワークブックのDataStoreポインタを一切切り替えない。
- Stageファイルを同名で既に作っていないか、実フォルダを読み取り専用でチェックする。
- 未接続のStageが1件残るケースを安全に観測し、ファイルの帰属と内容を確認する前には削除しない。
- Stage単体試験はフルUPDATE途中停止と同一ではなく、REQ/Lease／Mirror等の実障害復旧能力までは証明しない。

## G6-Iで行う検証

`qa/G6_Isolated_PreCas_Stage_Preflight_QA.gs` は以下を実行する。

1. G6-HのREAD_ONLY関数を再実行し、正規Stage/CAS関数が期待した実装であることを確認。
2. G4/G5の既存READY3件とG6-D CREATE READY1件、従来の2DataStoreの不変を確認。
3. G6-Dの新しいTESTシートとDataStoreのみを対象とし、Stage専用IDが未使用、G6-EのUPDATE IDも未使用、リースなし、容量余裕ありと確認。
4. 正規`vaaReadAppendStoreSource_`で現状DataStoreを読み、**正規`vaaBuildAppendStorePlan_`でメモリ内APPENDマージ計画を作成**。旧応募1件・新規1件・重複1件・最終2件、求人1件を確認。
5. **DataStore格納先フォルダをget-or-create関数で取得しない**。既存のフォルダIDをプロパティから読み、TESTルート配下か検証。
6. そのフォルダでStage用ファイル名が既に存在しないか`getFilesByName`で読み取り専用検索。
7. 実TESTのDataStoreポインタ・REQ履歴・リースが変わっていないことを再確認。

## 操作

1. これまで使用してきた隔離TEST Apps Scriptを開き、G4/G5/G6-A〜HのQAファイルと中央API関数が存在することを確認。
2. [G6-I QAソース](../qa/G6_Isolated_PreCas_Stage_Preflight_QA.gs)の全文を、新しい`G6_Isolated_PreCas_Stage_Preflight_QA`というファイルにコピーし保存。
3. `vaaQaG6IStagePreflightReadOnly`だけを一回実行。
4. `VAA_QA_G6_PRECAS_STAGE_PREFLIGHT`のJSONを共有する。先行READ_ONLY関数のログも出るが正常。

## 期待ログ

- `phase:"G6_PRECAS_STAGE_PREFLIGHT_READ_ONLY"`, `strictReadOnly:true`
- `priorCasAttestationPass:true`, `actualReadyReceipts:4`
- `independentTestWorkbook:true`, `independentDataStorePointer:true`
- `candidateRequestIndependent:true`、`candidateStageReceiptExists:false`、`reservedUpdateReceiptExists:false`
- `targetLeaseExists:false`、`newCapacityAllowed:true`、`mergePlanCode:"OK"`
- `expectedAddedApplications:1`、`expectedSkippedApplications:1`、`expectedFinalApplications:2`、`expectedFinalJobs:1`
- `stageFileAlreadyPresent:false`、`existingStageFolderInTestRoot:true`
- `historicalReceiptsUnchanged:true`、`createReceiptUnchanged:true`、`originalDataStoreUnchanged:true`、`pointerUnchangedDuringPreflight:true`
- `candidateRequestStillUnused:true`、`reservedUpdateRequestStillUnused:true`、`targetLeaseStillAbsent:true`
- `readyForStageOnlyDesignReview:true`
- `stageOnlyExecutionAuthorized:false`、`actualStageFileCreated:false`、`actualFaultInjected:false`、`actualUpdatePerformed:false`、`automaticRetryAuthorized:false`
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`

## 停止条件

- どれかの条件が不一致なら、Stage生成を実施しない。原因確認は読取専用で行う。
- `readyForStageOnlyDesignReview:true`は**次段階の設計レビューに進める**ことを示し、Stage生成・障害注入を自動許可するものではない。
- G6-DのCREATE関数、G6-EのUPDATE、G6-F/G/Hの検証用関数以外の書込み機能、CAS、手動REQ削除・修正を実行しない。
- 本番（PROD）Apps Script・Drive・実応募データには一切触れない。
