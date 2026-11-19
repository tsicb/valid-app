# G6-H：DataStore CAS境界の実装コード障害注入（メモリ内）＋隔離TESTソース照合

更新：2026-11-19。

G6-G実ログ：`VAA_QA_G6_FAIL_FAST_PREWRITE` は `pass:true`。実装ガード12項目すべて合格。REQ READY 4件・G4/G5とG6-DのDataStore・新UPDATE requestId未使用・leaseなしを維持。実UPDATE・故障注入は未実施。

## G6-Hで一歩進むこと

これまではGAS TEST上で不正入力の「書込み前拒否」と、合成状態の分類を検証した。G6-Hでは**本物の中央APIのDataStoreステージング/CAS関数**をGitHubのNodeテスト環境に読み込み、**Google Apps ScriptのAPIだけをメモリ内の偽物に差し替えて**、書込み途中の例外を起こす。

- テスト対象の関数本体はコピー・改変せず、リポジトリの`central-api/12_Append_DataStore.gs`から読み込む。
- `LockService`、`DriveApp`、`SpreadsheetApp`、`rptReadStateData_`、`rptSetStateValues_`等の入出力だけをNode VM内のダミーで模擬する。
- TEST Apps Scriptの実DataStore・Google Drive・Script Propertiesのデータは**一切変更しない**。
- バックアップblobの削除はダミー配列への記録に限る。実ファイルをゴミ箱へ移さない。
- `doPost`は実行しない。これはGoogle側の実際の失敗・タイムアウトを証明するものではない。

## Node回帰試験の内容

実装の`vaaStageAppendDataStore_`と`vaaCommitStagedAppendDataStore_`を、次の合成条件で実行する。

| 状況 | 期待する結果 |
| --- | --- |
| Stageは成功したがCASは未実施 | 元のDataStoreポインタは変更なし |
| Stage内容が不正／読めない | 新しいダミーStageだけを破棄し、元ポインタは変更なし |
| Stageファイル作成自体が失敗 | 元ポインタ変更なし |
| CASで並行更新を検出 | `DATASTORE_CONFLICT`、元ポインタを上書きしない |
| Stageファイル欠落／検証不合格 | CAS前に停止し、元ポインタ変更なし |
| `rptSetStateValues_`の書込み前に例外 | 元ポインタ変更なし |
| ポインタ書込み後に例外 | 新ポインタになっている可能性があり、自動再送しない |
| ポインタ書込み後のflushで例外 | 新ポインタと旧バックアップを保持し、自動再送しない |
| CAS確認読み取りの不一致 | `DATASTORE_COMMIT_UNCERTAIN`、旧バックアップは破棄しない |
| CAS正常確定 | 新ポインタと直前のバックアップを保持、さらに古いバックアップのみ削除対象 |
| 同じrequestIdでCAS再実行 | `reused:true`、ポインタの重複更新なし |

主眼は、CASの境界でエラーが起きた場合に「失敗したから旧状態」と短絡できないことの実証。特に**新ポインタへ切り替えた直後に応答や検証が失敗したケースでは、処理の実態を監査するまでは再送しない**。

実際のGAS`doPost`の例外処理やViewerの後続mirror・Registry復旧までは今回対象外。

## TEST Apps Scriptでの読み取り専用照合

GitHub Actionsはリポジトリのコードを試すため、手元のTEST Apps Scriptに同じ関数が入っているとは限らない。そこで次の読み取り専用ソース照合を行う。

1. これまでの隔離TEST Apps Scriptを開く。G4/G5/G6-A〜Gと中央APIが配置済みであることを確認。
2. [`qa/G6_Isolated_Cas_Fault_Attestation_QA.gs`](../qa/G6_Isolated_Cas_Fault_Attestation_QA.gs)を新規`G6_Isolated_Cas_Fault_Attestation_QA`ファイルへ全文コピーし、保存。既存ファイルは編集しない。
3. `vaaQaG6HCasFaultAttestationReadOnly`を**1回**実行し、`VAA_QA_G6_CAS_FAULT_ATTESTATION`のJSONを共有。
4. 直前のG6-D/E/F/Gの読み取り専用ログも出るが正常。

照合関数は、実TEST GAS上の`vaaStageAppendDataStore_`、`vaaCommitStagedAppendDataStore_`、`vaaExecuteAppendDataStoreUpdate_`、`doPost`の関数文字列をその場で読み、事前ガード、Stage検証と破棄、CAS書込み→flush→検証→Lock解放→旧バックアップ破棄、同一requestId再利用の順序がGitHub版の想定から変わっていないことを確認する。

## 期待ログ

- `phase:"G6_CAS_FAULT_ATTESTATION_READ_ONLY"`、`strictReadOnly:true`
- `priorFailFastPass:true`、`actualReadyReceipts:4`
- `sourceAttestationPass:true`および`sourceChecks`の7項目すべて`true`
- `historicalReceiptsUnchanged:true`、`createReceiptUnchanged:true`、`originalDataStoreUnchanged:true`、`candidateDataStorePointerUnchanged:true`
- `candidateRequestStillUnused:true`、`targetLeaseStillAbsent:true`
- `inMemoryFaultHarnessOnly:true`、`actualFaultInjected:false`、`actualUpdatePerformed:false`、`actualResumeTested:false`
- `automaticRetryAuthorized:false`
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`
- `pass:true`

## 停止条件と限界

- `pass:false`や例外が出た場合は**TEST中央APIを編集せず停止**し、GitHubソースとの差分・既存状態を読み取り専用で確認する。
- このソース照合は文字列の順序を検査するもので、関数内のロジックを形式的に証明するものではない。
- CI側もダミーのGoogleサービスでしか障害を起こしていないので、Google Sheets実行途中の不整合・Apps Scriptの制限・Script Propertiesの実クォータ失敗は未検証。
- G6-Dの`vaaQaG6DCreateFaultDomainOnce`を再実行しない。
- G6-Eの新APPEND requestIdを使用した実UPDATEや実故障注入は次工程で別途可否判定するまで禁止する。
- 本番Apps Script・本番Drive・本番CSV/個人情報にはアクセスしない。
