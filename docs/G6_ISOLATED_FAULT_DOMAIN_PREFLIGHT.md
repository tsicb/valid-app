# G6-C：独立した障害再現用TEST領域の事前設計（READ_ONLY）

更新：2026-11-19。**G6-Cは準備可否のみ判定する。ファイル作成・障害注入・復旧実行は含まない。**

## 確認済み

- G5-H：TEST Script Properties 8件、3,972 bytes、READY履歴3件（CREATE、APPEND、REPLACE）、異常履歴0、活動中のリース0。
- G6-A：メモリ上の架空容量スナップショットでアドミッション／新規REQ／既存REQ／単一値の境界検証すべて合格。
- G6-B：`VAA_QA_G6_FAILURE_GATES`は`pass:true`。3件のREADY、APPEND/REPLACE digest、現行DataStore完全一致、壊れた履歴や期限違いのリースを判別。
- まだ障害注入を実行していない。既存G4/G5のシート・REQは保護対象。

## 今回の狙い

途中停止・復旧試験では、G4/G5で使ったTESTシートへ直接故障を注入しない。

将来のG6-Dでは次のような「専用の架空シート」を別のrequestIdで構築する予定。ただし今回のG6-Cでは**作成しない**。

- 専用のCREATE requestId：`QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1`
- 専用の架空企業表示名：`QA_SYNTHETIC_ONLY_G6C_FAULT`
- 出力先：G4で確認済みのTEST管理フォルダ（PRODではない）。
- 入力：G4と同じ架空応募1件・架空求人1件。実企業・実応募者を含まない。
- `targetSpreadsheetId`を渡さないCREATE型のため、G4/G5の既存シートへ更新を送らない。
- requestId未使用と容量ガード合格を確認して初めて後続の作成検証へ進む。

段階ごとの障害点（あくまで設計候補）：
1. 新規REQ履歴保存前
2. 対象検証完了後
3. DataStoreステージング後／CAS確定前
4. DataStore CAS確定後／シート反映前
5. DATA_WRITTEN後／REPORT_DONE前
6. REPORT_DONE後／READY前

G6-CではGAS本体の関数やステージ順が揃っているかを調べる。**障害発生時に安全に復旧できることの証明ではない**。特にCAS直後の停止と、REQステータスが更新済みかどうかは分けて点検する必要がある。

## 実行方法：TEST GAS限定

1. これまで使用してきた隔離TEST Apps Scriptプロジェクトを開く。
2. G4・G5・G6-BのQAファイル、および中央APIの`vaaStageAppendDataStore_`、`vaaCommitStagedAppendDataStore_`、`vaaExecuteAppendDataStoreUpdate_`などが存在することを確認。
3. [G6-C QAファイル](../qa/G6_Isolated_Fault_Domain_Preflight_QA.gs)の全文を、新しいGSファイル`G6_Isolated_Fault_Domain_Preflight_QA`として手動コピーして保存する。
4. **`vaaQaG6CFaultDomainPreflightReadOnly`だけ**を1回実行。
5. `VAA_QA_G6_FAULT_DOMAIN_PREFLIGHT`のJSONを共有。内部の資格情報やID・応募行はログ出力されない。

## 期待条件

- `phase:"G6_FAULT_DOMAIN_PREFLIGHT_READ_ONLY"`、`strictReadOnly:true`
- `baselinePass:true`、`actualReadyReceipts:3`、`finalTestDataStoreMatches:true`
- `candidateRequestIdAlreadyExists:false`
- `candidateIndependentOfHistoricalIds:true`
- `candidateDoesNotTargetExistingWorkbook:true`
- `candidateOutputIsTestOnly:true`、`candidateSyntheticCompany:true`
- `candidatePayloadValidationCode:"OK"`、`budgetAllowed:true`
- `candidateSyntheticApplications:1`、`candidateSyntheticJobs:1`
- `canonicalStageOrderValid:true`、`updateHelpersPresent:true`、`plannedFaultPointCount:6`
- `readyForSeparateProvisioningPlan:true`
- `planOnly:true`、`faultDomainProvisioned:false`、`faultInjectionAuthorized:false`
- `actualFailureInjected:false`、`actualResumeTested:false`
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`

## 注意

- `readyForSeparateProvisioningPlan:true`は「別のテスト用シートを準備する次段階へ進む条件を満たす」という意味。**障害注入を許可したものではない**。
- G4/G5の既存CREATE・APPEND・REPLACE関数を再実行しない。
- 異常時は原因確認を優先し、REQを削除・上書きしない。
- G6-Dでは専用の架空シート作成の安全性を別に検証し、G6-E以降で故障注入範囲・検証方法・復旧条件を実装する予定。
