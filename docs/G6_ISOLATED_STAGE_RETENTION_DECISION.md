# G6-M：未接続Stageの証跡保管方針と単一ファイル後片付け設計（READ ONLY）

2026-11-19。G6-Lの実TESTログで、対象はStage1件・親TESTフォルダ1件・現在及びバックアップの既知2ワークブックからの参照0・Script Propertiesからの参照0・READY4件・REQ/Leaseなし・前後不変と確認済み。

**本工程は削除・CAS・UPDATEを実行しない。**

## 今回の判断

現時点では、未接続Stageを**G6の実障害・復旧検証が完了するまで証跡として保持**する方針を採る。理由：

- Stage後・CAS前の現物状態を保ち、さらに時間を空けて参照整合や復旧条件を再点検できる。
- 現時点で保管物は合成応募2件・合成求人1件のStage JSONファイル1件である。正確な容量・費用・保存期限は算定・合意していないため、費用最小とは断言しない。
- 削除するとG6-J/K/Lで実証したStage現物が失われる。先に証跡保存方法、対象ファイルID、実TEST範囲、外部参照の扱いと操作承認を確認する必要がある。
- 既知の現行・バックアップ参照0件でも、外部参照の不存在を完全証明したものではない。これを自動削除の条件にしてはいけない。

### 選択肢の比較（設計）

| 方針 | 利点 | 留意点 | 今回 |
| --- | --- | --- | --- |
| Stageを保持 | 後日の実体監査・再検証が可能 | 保管容量・管理対象が残る | **採用** |
| 特定ファイルのみ手動後片付け | 不要なStageを整理し、保管を終了できる | 実行直前の再監査、保管期間・証跡・明示承認が必要 | 将来の審査候補 |
| TEST DataStoreフォルダ全体を一括削除 | なし（本検証の目的に不適合） | 既存DataStoreやREADY履歴を破壊し得る | **禁止** |
| StageをCAS確定 | 検証目的が変わる | 未使用REQ・リース・mirrorと不整合を起こし得る | **禁止** |

## G6-Mの追加READ_ONLY確認

`qa/G6_Isolated_Stage_Retention_Decision_QA.gs`

1. G6-Lの影響範囲監査を再実行。G6-K二巡監査も内部から行う。
2. G6-J READ_ONLY監査から、すでに検証済みの単一StageファイルIDを取得（**ログには出さない**）。
3. ファイル名・所属TEST親フォルダがただ1件であること・内部Stage本文が合成APPEND計画と一致することを再検証。
4. 同じStage JSONを2回読み、本文の変化・破損がないか確認。
5. 全Script Propertiesの監査前後の一致、Stage用と予約UPDATE用のREQが未使用、更新リースなしを確認。
6. 条件を満たしても`stagePreservationDecision:"KEEP_STAGE_FOR_EVIDENCE"`、`cleanupAuthorized:false`、`casAuthorized:false`を維持する。
7. 保存期間の確定、証跡の別保管確認、人による削除承認、外部参照調査は**未完**として明示する。

## TEST Apps Scriptでの手順

1. G4/G5およびG6-C〜Lが配置された、これまでの隔離TEST Apps Scriptを開く。
2. [`qa/G6_Isolated_Stage_Retention_Decision_QA.gs`](../qa/G6_Isolated_Stage_Retention_Decision_QA.gs)を新規ファイル`G6_Isolated_Stage_Retention_Decision_QA`に全文コピー。既存ファイルは編集しない。
3. **`vaaQaG6MStageRetentionDecisionReadOnly`だけ**を1回実行する。
4. ログ`VAA_QA_G6_STAGE_RETENTION_DECISION`を共有する。G6-L/K/J/Dの先行READ_ONLYログも出る。

## 期待するログ

- `phase:"G6_STAGE_RETENTION_DECISION_READ_ONLY"`, `strictReadOnly:true`
- `priorCleanupImpactPass:true`, `actualReadyReceipts:4`
- `singleStageIdentified:true`, `stageFileNameMatches:true`, `stageExactSingleTestParent:true`
- `stageByteContentStableAcrossReads:true`, `stageBodyStillMatchesSyntheticPlan:true`
- `originalPointerStillUnchanged:true`, `noKnownWorkbookOrPropertyStageReference:true`
- `scriptPropertiesStillStable:true`, `stageRequestReceiptUnused:true`, `reservedUpdateReceiptUnused:true`, `targetUpdateLeaseAbsent:true`
- `externalReferencesFullyAudited:false`, `retentionPeriodConfirmed:false`, `evidenceArchiveVerified:false`, `operatorCleanupApprovalRecorded:false`
- `evidenceRetentionPolicy:"PRESERVE_UNTIL_G6_RECOVERY_QA_COMPLETE"`
- `noFolderWideCleanup:true`, `exactFileIdOnlyForFutureReview:true`, `requireFreshAuditBeforeFutureCleanup:true`, `requireExplicitHumanApproval:true`
- `readyForRetentionAndCleanupPolicyReview:true`, `stagePreservationDecision:"KEEP_STAGE_FOR_EVIDENCE"`, `cleanupAuthorized:false`
- `casAuthorized:false`, `updateAuthorized:false`, `automaticRetryAuthorized:false`
- `actualCleanupPerformed:false`, `actualCasPerformed:false`, `actualUpdatePerformed:false`
- `propertiesModified:0`, `propertiesDeleted:0`, `workbookModified:false`, `driveModified:false`, `pass:true`

## 将来、後片付けする際の条件（G6-Mでは未実行）

- G6の失敗・復旧検証が完了し、Stageの再検証用途がなくなったことを確認。
- 保存期間・証跡保管方法・外部参照の残存可能性を記録し、対象TEST Stage単一ファイルの削除について操作者が明示承認。
- 実行直前の**新鮮なREAD_ONLY二巡監査**でファイルID/ファイル名/親フォルダ/JSON本文/既知ポインタ（active・backup）/Script Properties/REQ/Leaseを照合。
- 誤削除防止のため、保存先フォルダ単位の削除、検索結果の一括削除、同名ファイル全部の削除を禁止。最初に検証した**1個のファイルIDだけ**を候補にする。
- 後片付け実装は別PR・別QA関数・明示的な実行承認が必要。未確定・応答喪失時は再実行せず、読み取り専用で対象の状態を確認。
- 今回のG6-Mでは承認を受け取るUIや引数を設けないため、`cleanupAuthorized:false`から変わる経路は存在しない。

## 結果の意味と未解決事項

`pass:true`は「証跡として保持する判断の前提が整合している」ことを示すものであり、削除の安全性やGoogleの実際の部分障害復旧を実証しない。

フル`doPost`での障害注入、CAS後mirror不整合、実Googleクォータ障害の回復はなお未検証。**Stageを保存したまま、次の故障・復旧経路の検証方針を再検討する。**
