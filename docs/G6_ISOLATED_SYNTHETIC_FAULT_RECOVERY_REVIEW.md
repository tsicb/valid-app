# G6-F：6つの故障点と復旧判断の合成シミュレーション（READ ONLY）

2026-11-19。**実障害を発生させず、TEST Apps Scriptの読み取りとメモリ上の架空状態だけで検証する。**

## 前工程の実測

G6-Eの実ログ：
- `VAA_QA_G6_FAULT_DOMAIN_INSPECT`は`pass:true`、独立したG6-DのTESTシートは架空応募1件・求人1件、G4/G5とは異なるDataStoreを指している。
- `VAA_QA_G6_UPDATE_FAULT_PREFLIGHT`は`readyForFaultInjectionDesignReview:true`、REQ READY履歴4件、APPEND用の新requestIdは未使用、更新リースなし、容量・プロトコル正常。
- APPEND純粋マージ計画は応募1件追加、既存1件をスキップ、最終2件、求人1件。元データ・履歴・ポインタは不変。
- `actualFaultInjected:false`、`actualResumeTested:false`。G6-Eでは故障を起こしていない。

## G6-Fの対象

`qa/G6_Isolated_Synthetic_Fault_Recovery_Review_QA.gs`

1. G6-E読み取り専用の事前確認をもう一度実行し、現在もREADY4件・独立TESTシート・架空DataStore・未使用requestIdであるか照合する。
2. G6-D CREATEのDataStoreポインタと所有requestIdを読み取り、現状を保存する。
3. **メモリ内だけ**に6つの想定停止状態（架空レシート、target lease、DataStoreポインタの旧/新を表す記号）を生成する。
4. 実際の中央APIの`getRequestRecord_`、`vaaValidateUpdateRequestRecord_`、`isLeaseActive_`、`stageRank_`、`buildReadyResponse_`を使って停止・確認方針を分類する。
5. 異常系12項目（破損REQ、欠落した対象、digest/方式不一致、READYと旧ポインタ、READYでDataStore未検証、他処理のリース、CASの所有者不明、期限切れPROCESSING、REQなしの新ポインタ、不正なリース、未知のポインタ状態）を合成入力で判定する。
6. 終了時に実TESTの旧READY履歴3件・G6-DのCREATE履歴・新TESTシートのDataStoreポインタが変わらず、候補requestIdが未使用、UPDATEリースが生成されていないことを確認する。

## 想定故障点と判定

| ポイント | 想定される状態 | 合成判定 |
| --- | --- | --- |
| 新規リクエスト受付前 | REQなし、リースなし、旧ポインタ | `REVIEW_FRESH_REQUEST_AFTER_AUDIT` |
| 対象リース取得後・REQ保存前 | REQなし、リースあり、旧ポインタ | `HALT_LEASE_WITHOUT_RECEIPT` |
| PROCESSINGの保存後・blob作成前 | PROCESSING、旧ポインタ | `HALT_PROCESSING_BEFORE_COMMIT` |
| blobステージング後・CAS前 | PROCESSING、未接続blob、旧ポインタ | `HALT_STAGED_DATA_NOT_COMMITTED` |
| CAS後・mirror反映前 | PROCESSING、候補requestIdによる新ポインタ | `HALT_CAS_COMMITTED_MIRRORS_UNCERTAIN` |
| READY保存後・応答喪失 | READY、新ポインタ、整合確認済み | `REVIEW_READY_REPLAY_AFTER_AUDIT` |

これらは「模擬状態ならどの停止判断を返すか」のチェックであり、実際の障害が必ずこの組み合わせの状態を残すとは限らない。

特にCASの直前・直後では、処理履歴とDataStoreの確定状況が異なる可能性があるため、**書込み済みか不明なら自動再送しない**。

`REVIEW_FRESH_REQUEST_AFTER_AUDIT`と`REVIEW_READY_REPLAY_AFTER_AUDIT`は、あくまで次段階での担当者による確認候補。今回のコードは**再実行・復旧を許可しない**。

## 操作

1. G4/G5/G6-D/G6-EのQAファイルがある、これまでの**隔離TEST Apps Script**を開く。
2. [G6-F QAソース](../qa/G6_Isolated_Synthetic_Fault_Recovery_Review_QA.gs)全文を、新規スクリプトファイル`G6_Isolated_Synthetic_Fault_Recovery_Review_QA`に貼り付けて保存する。
3. `vaaQaG6FSyntheticFaultReviewReadOnly`を1回だけ実行する。
4. ログ`VAA_QA_G6_SYNTHETIC_FAULT_REVIEW`のJSONを共有する。直前のG6-E/G6-D読み取り専用監査ログも併せて出る場合がある。

## 期待値

- `phase:"G6_SYNTHETIC_FAULT_RECOVERY_REVIEW_READ_ONLY"`, `strictReadOnly:true`
- `isolatedTestBaselinePass:true`, `actualReadyReceipts:4`。
- `scenarioCount:6`、`simulatedDecisionsPass:true`、6つの`scenarios[].pass:true`。
- `negativeGatesPass:true`、`negativeGates`の12項目すべて`true`。
- `historicalReceiptsUnchanged:true`、`createReceiptUnchanged:true`、`dataStorePointerUnchanged:true`。
- `candidateRequestIdUnused:true`、`targetLeaseNotCreated:true`。
- `simulationOnly:true`、`actualFaultInjected:false`、`actualUpdatePerformed:false`、`actualResumeTested:false`、`automaticRetryAuthorized:false`。
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`、`pass:true`。

## 範囲・停止条件

- 中央APIの`doPost`、`vaaStageAppendDataStore_`、`vaaCommitStagedAppendDataStore_`、リースの取得／解放関数は**呼び出さない**。
- 本番PROD、G4/G5の既存TESTシート、G6-Dの独立TESTシートを変更しない。
- `pass:false`や例外があれば原因を調べ、UPDATE・再送・REQの手動編集・削除を行わない。
- 合格後も、ここから故障注入を自動的に開始しない。次のG6-G以降で、故障注入の対象・段階・操作権限・復旧監査を分けて実装する。
- ID・URL・accessKey・生のREQ/応募データはログに表示しない。
