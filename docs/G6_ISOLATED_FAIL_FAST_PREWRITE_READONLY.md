# G6-G：実装済み中央APIの書込み前ガードをTESTで検証（読み取り専用）

更新：2026-11-19。**既存READY 4件、G4/G5のTESTシート、G6-D専用TESTシートをすべて保護する。**

## G6-F完了確認

実ログ `VAA_QA_G6_SYNTHETIC_FAULT_REVIEW`：
- `pass:true`、故障点6つすべて期待どおり、異常条件12項目すべて期待どおり。
- READY履歴4件、G4/G5とG6-DのDataStoreポインタ・履歴を不変に維持。
- G6-E用の架空APPEND requestIdは未使用、更新リースなし。
- `actualFaultInjected:false`、`actualUpdatePerformed:false`、`automaticRetryAuthorized:false`。

## 今回検証するもの

G6-Fは架空のREQ履歴・状態を組み立てて分類する検証だった。G6-Gではさらに一段進み、中央APIにある**実際の関数**の「不正入力なら書込み前に停止する」という分岐を直接試す。ただし、**正常な入力で更新処理を呼び出すことはない**。

1. 純粋マージの不正更新方式・入力欠落が拒否されること。
2. `vaaStageAppendDataStore_`のPlan欠落・identity version不正・requestId欠落を、**Driveファイル作成の前**に拒否すること。
3. `vaaCommitStagedAppendDataStore_`のStage欠落・対象ワークブック不一致・Stage fileId欠落を、**ScriptLock取得とCAS確定の前**に拒否すること。
4. `vaaValidateUpdateProtocol_`が不正protocol・応募識別キー欠落を拒否すること。
5. `saveRequestRecord_`が単一value超過・REQ新規書込容量超過を拒否すること。ここで使うPropertiesはメモリ内の偽物だけで、set/deleteがもし呼ばれたらトラップとして記録する。**実Script Propertiesは渡さない**。
6. 開始前後の既存READY3件・G6-DのCREATEレシート、元のDataStore、G6-DのDataStoreポインタ、G6-EのrequestId未使用・リースなしを確認。

## 不正入力の実行安全性

GAS内の実`vaaStageAppendDataStore_`と`vaaCommitStagedAppendDataStore_`を呼ぶが、ここでは**必ず事前バリデーションで例外が出る引数**しか渡さない。また、実行する前に関数ソースの構造と順番を調べ、ガードがDrive作成・Lock取得・CAS更新よりも前に存在することを確認する。

ソースが変更されて確認できなければ`QA_G6G_PREWRITE_SOURCE_FENCE_UNVERIFIED`として停止。危険な呼び出しはしない。

ただしソース形状と入力に基づくガード確認であり、Google側クォータ不足の実エラー・データ書込み途中の中断・CAS後の復旧は検証しない。

## TEST GASでの実施手順

1. これまでの隔離TEST Apps Scriptを開く。G4/G5/G6-A/D/E/FのQAファイルと中央APIコードが揃っていることを確認。
2. [`qa/G6_Isolated_Fail_Fast_Prewrite_QA.gs`](../qa/G6_Isolated_Fail_Fast_Prewrite_QA.gs)全文を、新規ファイル`G6_Isolated_Fail_Fast_Prewrite_QA`へ手動コピーして保存する。既存のQAファイル・中央APIコードを編集しない。
3. `vaaQaG6GFailFastPrewriteReadOnly`だけを1回実行。
4. `VAA_QA_G6_FAIL_FAST_PREWRITE`のJSONを共有。G6-F/E/DのREAD_ONLYログが先に出る場合がある。

## 期待する結果

- `phase:"G6_FAIL_FAST_PREWRITE_READ_ONLY"`、`strictReadOnly:true`。
- `priorSyntheticReviewPass:true`、`actualReadyReceipts:4`。
- `sourceGuardBeforeWritesVerified:true`、`syntheticNewRequestAdmissionRejected:true`。
- `probeCount:12`、`allPrewriteProbesPass:true`、12個の`probes[].pass:true`。
- `fakePropertySetAttempts:0`、`fakePropertyDeleteAttempts:0`。
- `historicalReceiptsUnchanged:true`、`createReceiptUnchanged:true`。
- `originalDataStoreUnchanged:true`、`candidateDataStorePointerUnchanged:true`。
- `candidateRequestStillUnused:true`、`targetLeaseStillAbsent:true`。
- `actualFaultInjected:false`、`actualUpdatePerformed:false`、`actualResumeTested:false`、`automaticRetryAuthorized:false`。
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`、`pass:true`。

## 次の段階について

G6-Gは正常な更新を意図的に中断する**本当の障害注入ではない**。実障害まで検証するには、現行の共用中央APIに安易にフックや上書きを挿入しないことを前提として、独立したテストコードでの影響範囲・実行権限・記録と復旧方法をさらに区別する必要がある。

特に、DataStoreをCAS確定した後の部分障害は書込み済みの可能性があるため、**再試行操作を自動化しない**。不明な状態では読み取り専用の現状監査へ戻す。

PRODへの同期、実データの利用、REQ削除・手動補正、既存G6-D CREATEの再実行は行わない。
