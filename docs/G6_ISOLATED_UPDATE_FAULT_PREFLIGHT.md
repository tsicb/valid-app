# G6-E：独立TESTシートへの障害検証用APPEND — 読み取り専用プリフライト

更新：2026-11-19。**実UPDATE・DataStoreステージング・CAS・故障注入・復旧実行は一切行わない。**

## G6-D完了の証跡

実ログ `VAA_QA_G6_FAULT_DOMAIN_CREATE`：
- `ok:true`、`READY`、`reused:false`、`pass:true`。
- G4/G5の既存シートとは異なるTESTシート1件を作成。
- 独立DataStore（架空応募1件、架空求人1件）で `dataStoreMatchesSynthetic:true`。
- 従来のREQ3件と元DataStoreは不変。
- `actualFailureInjected:false`。

この結果を受け、障害再現は独立TESTシートのみに限定する。G4/G5のシートへ故障注入しない。

## G6-Eの目的

故障注入に使用するUPDATE payloadを架空データだけで準備する。

- 新規requestId：`QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1`（未使用であることを検証）。
- 対象：G6-DでCREATEした独立TESTシート。G4/G5の古いシートには更新しない。
- 方式：`APPEND` + `IDENTITY_V1`。
- 入力：既存の架空応募1件と、応募識別キーが異なる架空応募1件。求人は架空1件。
- 想定：応募`1→2件`（既存1件スキップ、新規1件追加）、求人`1件維持`。
- READ_ONLYでDataStoreを読み取り、元データがG6-DのCREATE直後と完全一致すること、元REQ3件とG6-D CREATE READYが保持されていること、TESTフォルダ外へ出ないこと、対象リースがないこと、容量ガードを通ることを確認する。
- `VAAAppendMergeCore.merge`で、実際のUPDATEと同じ統合結果をメモリ上で試算する。保存されているDataStoreは変更しない。

## 障害ポイントの分類（G6-Eでは再現しない）

| 故障ポイント | 想定状態 | 再送の扱い |
| --- | --- | --- |
| 新規REQ受付前 | 履歴なし／旧DataStore | 読取監査後にのみ新規実行検討 |
| 対象リース取得後・REQ保存前 | リースとREQの状態が不確か | 自動再送禁止 |
| PROCESSING履歴保存後 | 未完了REQ、旧ポインタ | 自動再送禁止 |
| DataStoreステージング後・CAS前 | 未完了REQ、旧ポインタ、未接続blobの可能性 | 自動再送禁止 |
| DataStore CAS後・mirror更新前 | 未完了REQ、新ポインタの可能性 | 自動再送禁止／DataStore実態を優先監査 |
| READY後・応答返却前 | READY履歴と新ポインタ | 読取監査で確認後のみ同一ID再送を検討 |

この表は**検証設計の予測**。実障害で各状態が成立すること、また自動的に復旧できることを保証するものではない。

## TEST Apps Scriptでの操作

1. G4/G5/G6-B/C/DのQAファイルがある、これまでの隔離TEST Apps Scriptを開く。
2. [G6-E QAソース](../qa/G6_Isolated_Update_Fault_Preflight_QA.gs)を新規GSファイル`G6_Isolated_Update_Fault_Preflight_QA`に全文コピーする。既存ファイルの上書き禁止。
3. `vaaQaG6EUpdateFaultPreflightReadOnly`だけを1回実行。
4. `VAA_QA_G6_UPDATE_FAULT_PREFLIGHT` JSONを共有。ID/URL/認証情報/応募行の生データはログに出さない。

## 期待ログ

- `phase:"G6_UPDATE_FAULT_PREFLIGHT_READ_ONLY"`、`strictReadOnly:true`。
- `faultDomainInspectionPass:true`、`priorReadyReceipts:4`。
- `candidateRequestIdAlreadyExists:false`、`candidateIndependentOfHistoricalIds:true`。
- `candidateTargetsIndependentTestWorkbook:true`、`candidateDataStoreIndependent:true`、`currentDataStoreCreatedByG6D:true`。
- `existingApplications:1`、`existingJobs:1`、`syntheticBaselineMatches:true`。
- `payloadValidationCode:"OK"`、`updateProtocolCode:"OK"`、`budgetAllowed:true`、`targetUpdateLeaseExists:false`。
- `mergePlanCode:"OK"`、`expectedFinalApplications:2`、`expectedFinalJobs:1`、`expectedAddedApplications:1`、`expectedSkippedApplications:1`。
- `pointerUnchangedDuringPreflight:true`、`historicalReceiptsUnchanged:true`、`createReceiptStillPresent:true`、`newRequestStillUnused:true`。
- `plannedFaultPointCount:6`、`readyForFaultInjectionDesignReview:true`。
- `planOnly:true`、`faultInjectionAuthorized:false`、`actualFaultInjected:false`、`actualResumeTested:false`。
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`。

## 次工程と安全上の制限

- `readyForFaultInjectionDesignReview:true`は次の試験設計の検討に進めるという意味であり、**実故障注入を許可しない**。
- 次はG6-Fで故障点の再現方法と観測手順を段階別に設計・コードレビューする。最初はローカルメモリ上の模擬故障で挙動を再確認し、必要に応じて別の専用requestIdでTEST実書込みを検討する。
- `vaaQaG6DCreateFaultDomainOnce`は再実行しない。
- TEST中央APIの共有関数を一時書換えたり、PROD GASへQAファイルをコピーしない。
- `readyForFaultInjectionDesignReview:false`、例外、DataStoreの不一致があれば操作を停止し、読み取り専用の監査で原因を確認する。
