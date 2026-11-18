# G5-D：隔離TEST GAS／REPLACE更新の読み取り専用プリフライト

更新：2026-11-19。**この段階ではREPLACEは実行しない。**

## 前工程の実測証跡

- G4 CREATE：架空応募1・求人1の個社管理シート作成、READY。
- G4再送：同じrequestIdの再送で `reused:true`、対象シートは不変。
- G4-D容量監査：Script Properties 6件、1,790 bytes、REQ READY 1件、更新リース0件。
- G5-A APPEND事前検証：`safeToAppendOnce:true`、保存済み応募1件・求人1件。
- G5-B APPEND実更新：`ok:true`、`READY`、`reused:false`、応募1件追加、最終2件、求人1件、保存先と履歴一致、更新リースなし、`pass:true`。
- G5-C同一requestId再送：`reused:true`、`dataStorePointerUnchanged:true`、実DataStore応募2件・求人1件を維持、`pass:true`。

## 今回の設計

G5-Dで、架空の応募データを**2件から1件へ全件入替え**するREPLACE予定データを準備し、中央APIと同じ `VAAAppendMergeCore.merge` で事前試算する。ただしスプレッドシートには書き込まない。

- 対象はG4で作成したTESTシート1件のみ。
- G5-Bの`READY`履歴と元のAPPENDのpayload digestを再検証。
- 現在のDataStoreがAPPEND後の架空応募2件・求人1件と完全一致するか照合。
- 保護されたTESTルート・TEST出力フォルダ以外では停止。
- REPLACE用の新requestIdが未使用で、更新リースがなく、容量ガードが通ることを確認。
- REPLACE計画の最終応募1件、求人1件、仕事名・給与MIN・応募識別キーが新値になることを確認。
- 試算や監査はすべてREAD_ONLY。実UPDATE用関数はこのファイルには含まない。

## TEST Apps Script側の操作

1. 本番でなく、これまでの**隔離TEST Apps Scriptプロジェクト**だけを開く。
2. 手動で配置済みのG4、G5-A、G5-B/C QAファイルが残っていることを確認。
3. [G5-D QAソース](../qa/G5_Isolated_Replace_Preflight_QA.gs)の全文をコピーする。
4. 新しいスクリプト`G5_Isolated_Replace_Preflight_QA`を追加し、貼り付けて保存。既存のファイルを上書きしない。
5. 関数`vaaQaG5ReplacePreflightReadOnly`を1回実行する。

期待ログの先頭：`VAA_QA_G5_REPLACE_PREFLIGHT`

## 合格条件

| フィールド | 期待値 |
| --- | --- |
| `safeToReplaceOnce` | true |
| `payloadValidationCode` | OK |
| `updateProtocolCode` | OK |
| `budgetAllowed` | true |
| `requestIdAlreadyExists` | false |
| `updateLeaseExists` | false |
| `targetInTestOutput` / `dataStoreInTestRoot` | true / true |
| `priorAppendReady` / `priorAppendDigestMatches` | true / true |
| `previousApplications` / `previousJobs` | 2 / 1 |
| `baselineMatches` | true |
| `mergePlanCode` | OK |
| `expectedFinalApplications` / `expectedFinalJobs` | 1 / 1 |
| `jobTitleReplacementPlanned` | true |
| `salaryReplacementPlanned` | true |
| `identityReplacementPlanned` | true |
| `propertiesModified` / `propertiesDeleted` | 0 / 0 |
| `workbookModified` | false |

## 安全上の注意

- 今は**`vaaQaG5ReplacePreflightReadOnly`だけ**を実行し、結果のJSONを報告する。
- G5-Bの`vaaQaG5AppendOnce`、G4の`vaaQaG4CreateOnce`、G5-Cの`vaaQaG5ReplayReady`を再実行しない。
- プリフライトが`safeToReplaceOnce:false`、または例外終了した場合、いかなる実UPDATEも行わず原因を確認する。
- 実REPLACEの一回実行、同一requestId再送、不一致digestの拒否については、**別の明示的なG5-E/G5-F QA工程**として用意する。
- TESTのACCESS_KEY、Web App URL、Script ID、DataStore内の生データはチャットに共有しない。
- このQAソースは`central-api/`の外にあるので、本番同期へ含まれない。
