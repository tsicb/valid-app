# G6-A：隔離TEST GAS・Script Properties容量境界の合成シミュレーション（読み取り専用）

更新日：2026-11-19。**実プロパティの増量・削除・編集は行わない。**

## G5最終確定ログ

G5-H：`VAA_PROPERTY_CAPACITY_READONLY` は以下のとおり。

- Script Properties: 8件、3,972 bytes / 推定上限512,000 bytes、0.8％。
- `REQUEST_RECORDS.count=3` / `requestLifecycle.ready=3`（G4 CREATE, G5 APPEND, G5 REPLACE）。
- `REPORT_REGISTRY.count=1`、`VIEWER_MAPPINGS.count=1`。
- `UPDATE_LEASES.count=0`、`malformed=0`、`requestLifecycle.activeLease=0`。
- 単一値最大1,054 bytes、上限9,216 bytes以下。
- G5-G：`REQUEST_PAYLOAD_MISMATCH`拒否と、READYレシート／DataStore／実データの不変性を実環境で確認済み。

## 今回の設計

G6-Aでは本番と同じ容量ガードの純粋関数を、**TEST GASエディタのメモリ内で作った架空Script Propertiesのスナップショット**へ適用し、境界値を判定する。

**実際のScript Propertiesを大量データで埋めない。** `PropertiesService.getScriptProperties().getProperties()` を一度読み取り、既存G5のREADY履歴・件数・容量が保たれているか確認する。その後の高負荷データはすべてローカル変数のオブジェクトに限る。テストコードに実シートや実DataStoreへの書込み関数を含めない。

境界値は実装の定数を参照して計算する：

- 新規requestIdのアドミッション：`90% × 512000 − 24 KiB = 436224 bytes`。436224は許可、436225は拒否。
- 新規REQレシートの書込み：`460800 bytes`（90%上限）ちょうどまで許可、1 byte超過で拒否。
- 既存REQレシートの再保存：`512000 bytes`のハード上限ちょうどまで許可、1 byte超過で拒否。
- 単一value：`9216 bytes`を許可、`9217 bytes`を拒否。
- レシート圧縮：保存専用シリアライザが`performance`だけを省略し、処理対象や再送識別に必要なフィールドを保持することを確認。

値は`UTF8_KEY_PLUS_VALUE_ESTIMATE`による**GAS実装上の推定値**であり、Google側の実際の容量計算を直接証明するものではない。

## TEST GAS側の操作

1. TEST Apps Scriptのエディタを開く。これまで使用してきたG4ファイルと中央API関数が存在することを確認。
2. [`qa/G6_Isolated_Capacity_Boundary_ReadOnly_QA.gs`](../qa/G6_Isolated_Capacity_Boundary_ReadOnly_QA.gs)の全文を新しい`G6_Isolated_Capacity_Boundary_ReadOnly_QA`というGSファイルにコピーして保存。
3. 関数`vaaQaG6CapacityBoundaryReadOnly`だけを1回実行。
4. ログの`VAA_QA_G6_CAPACITY_BOUNDARY` JSONを共有。認証キー、Script ID、シートID、プロパティのキー・値・生データは出力しない。

## 期待する合格条件

- `phase:"G6_CAPACITY_BOUNDARY_READ_ONLY"`, `pass:true`
- `strictReadOnly:true`, `testEnvironmentMatched:true`, `syntheticSnapshotsOnly:true`
- `actualReadyReceipts:3`, `actualMalformedReceipts:0`, `actualActiveLeases:0`, `actualStatePass:true`
- `syntheticAdmissionAtBoundaryAllowed:true`, `syntheticAdmissionAboveBoundaryRejected:true`
- `syntheticNewReceiptAtCeilingAllowed:true`, `syntheticNewReceiptAboveCeilingRejected:true`
- `syntheticExistingReceiptAtQuotaAllowed:true`, `syntheticExistingReceiptAboveQuotaRejected:true`
- `syntheticSingleValueAtLimitAllowed:true`, `syntheticSingleValueAboveLimitRejected:true`
- `receiptPerformanceRemoved:true`, `receiptEssentialFieldsRetained:true`
- `propertiesModified:0`, `propertiesDeleted:0`, `workbookModified:false`, `driveModified:false`

## 停止条件と後続

- `pass:false`または例外終了時は、容量ガードを無効化せず、TESTプロパティを編集・削除しない。
- 今回は`doPost`の実行経路での処理途中の障害注入を検証していない。
- G6-B以降で、まず読み取り専用の復旧監査から設計し、必要なら**TESTのみで実施できる**故障注入を用意する。
- PRODへの同期・デプロイ・プロパティ変更は行わない。
