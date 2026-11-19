# G6-L：保管中Stageの後片付け影響範囲のREAD_ONLY点検

更新：2026-11-19。**本工程でStageファイルを削除・ごみ箱へ移動・CAS確定しない。**

## 前提：G6-K実TEST結果

`VAA_QA_G6_UNLINKED_STAGE_FORENSIC` は `pass:true`。

- Stageは隔離TESTの既存DataStoreフォルダに1件。
- 2回の独立した読み取りでファイル・JSON本文・対象ワークブック・ポインタの整合を確認。
- Stageの内容は架空応募2件・架空求人1件。実際に紐づく元DataStoreは架空応募1件・求人1件で不変。
- CASを行わずStageは未接続、READY履歴4件は正常。Stage専用requestIdおよびG6-EのUPDATE requestIdは未使用、リース0。
- `stagePreservationDecision:"PRESERVE_FOR_NEXT_REVIEW"`、`cleanupAuthorized:false`。

## この工程で新たに確認する事項

G6-Kが証明したのは「対象のTEST個社シートでStageが使用されていないこと」。G6-Lでは、**後片付け前にさらに確認しておきたい参照範囲**を整理する。

1. G6-Kの2巡監査を再実行して、Stage1件・正常なREADY履歴4件・未接続のままか再検証。
2. G6-D専用TESTワークブックとG4/G5の既存TESTワークブックの**両方**について、現在のDataStoreファイルポインタに加え、バックアップポインタも読む。
3. 4つのポインタのどれもStageファイルを参照していないこと、処理中に変化していないことを確認。
4. TEST Script Propertiesの**全キー・全値**を読み、StageファイルIDの文字列参照が0件であることを確認。キー・値・ファイルID自体はログに出さない。
5. Stageが実際に**TEST DataStoreフォルダ1箇所だけ**に親を持つこと、予想ファイル名・実ファイルサイズが適切で、同名ファイルが1件だけであることを確認。
6. Stage専用REQ・予約中のUPDATE REQ・更新リースが存在しないこと、全Script Propertiesの内容が監査前後で完全に不変であることを確認。
7. 外部からの参照や、未調査のほかのワークブック・Driveショートカット等を完全に否定したとは扱わず、**今回も保持継続**を結論とする。

注意：この検証の参照調査は「既知の2つのTESTワークブックのactive/backupポインタ」と「このTEST GASのScript Properties」に限る。世界中の参照元を調査するものではないし、今すぐ削除が安全であることを保証するものでもない。

## TEST Apps Scriptでの手順

1. これまでの隔離TEST Apps Scriptを開く。G4/G5・G6-C〜KのQAコードはそのまま残しておく。
2. [`qa/G6_Isolated_Stage_Cleanup_Impact_QA.gs`](../qa/G6_Isolated_Stage_Cleanup_Impact_QA.gs)全文を、新規GSファイル `G6_Isolated_Stage_Cleanup_Impact_QA` としてコピーして保存。
3. `vaaQaG6LStageRetentionImpactReadOnly` を1回実行。
4. `VAA_QA_G6_STAGE_CLEANUP_IMPACT` JSONを共有。内部でG6-KのREAD_ONLY監査が先に実行されるため、既存監査ログも出る。

## 期待ログ

| 項目 | 期待値 |
| --- | --- |
| `phase` | `G6_STAGE_CLEANUP_IMPACT_READ_ONLY` |
| `strictReadOnly` | `true` |
| `priorStageForensicsPass` | `true` |
| `actualReadyReceipts` | `4` |
| `exactlyOneStageFile` | `true` |
| `stageNameMatched`, `exactSingleTestParent`, `stageFileNonempty` | `true` |
| `stageUnlinkedInPriorAudit` | `true` |
| `stageReferencedByKnownWorkbookPointers` | `false` |
| `propertyStageReferenceCount` | `0` |
| `knownWorkbookActivePointersExpected` | `true` |
| `knownWorkbookPointersStable`, `scriptPropertiesStable` | `true` |
| `stageRequestReceiptExists`, `reservedUpdateReceiptExists`, `targetUpdateLeaseExists` | `false` |
| `externalReferenceScopeFullyAudited` | `false` |
| `retentionDecision` | `PRESERVE_PENDING_FINAL_CLEANUP_REVIEW` |
| `readyForSingleFileCleanupDesignReview` | `true` |
| `cleanupAuthorized`, `casAuthorized`, `updateAuthorized`, `automaticRetryAuthorized` | `false` |
| `actualCleanupPerformed`, `actualCasPerformed`, `actualUpdatePerformed` | `false` |
| `propertiesModified`, `propertiesDeleted` | `0` |
| `workbookModified`, `driveModified` | `false` |
| `pass` | `true` |

## 後続工程の停止・保全ルール

- どれかの安全条件が不一致なら`pass:false`または例外で停止。Stageを勝手に削除しない。
- `readyForSingleFileCleanupDesignReview:true`は**後片付け方式のレビューが可能**という意味。削除・CAS・再試行を許可する意味ではない。
- 次のG6-Mでは、Stageを証跡として保持し続ける場合のコスト・期間と、明確な対象IDのみを使って破棄する場合の「再確認・誤削除防止・操作権限・記録」を別に設計する。
- G6-Jの`vaaQaG6JStageOnlyOnce`を再実行しない。
- G6-IのStage作成前プリフライトは、既にStageが存在するので再実行して合格を期待しない。
- 実フルUPDATE途中停止・CAS後の復旧・Google実クォータ障害の復旧成功は未検証である。
