# G4：隔離TEST GASでのCREATE・同一requestId再送検証

更新：2026-11-18。状態：GitHub上でQA専用補助スクリプトを準備。**本番コードの変更、QAでのCREATE実行、TEST Scriptへの補助スクリプト配置はまだ行っていない。**

## ここまでの証跡

- G1：GitHub Actions [Isolated main GAS QA source sync #44276244937](https://github.com/tsicb/valid-app/actions/runs/44276244937) 完了（TESTへGASソース21ファイル、195 Nodeテスト成功）。Web Appデプロイなし。
- G2：TESTの読み取り専用監査は初回0件、TESTのACCESS_KEYとSCHEMA_VERSION登録後2件・54B・REQ_/RPTREG_/VIEWER_ 0件を確認。
- G3：TESTの `/dev` Web App `doGet` は `ok:true`, schemaVersion=3.0, root/outputは次の非公開QAフォルダと一致。API capabilityは APPEND/REPLACE, IDENTITY_V1。
  - TESTルート：`1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU`
  - TEST出力：`1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7`
- G3は接続確認であり、G4 CREATEの成功や冪等性を示すものではない。

## 今回の方法：TESTエディタから直接APIを実行する

`qa/G4_Isolated_Create_Replay_QA.gs` は**QA専用で、本番のcentral-api/に存在しない**。通常のGitHub GAS同期ワークフローでは転送されない。TEST Apps Scriptの編集画面にのみ、手動で新規ファイルを作ってコピーする。

`doPost({postData:{contents: JSON.stringify(payload)}})` をTESTプロジェクト内で呼ぶ。これにより、TEST用ACCESS_KEYをブラウザやGitHub Pagesに貼り付けず、実際のサーバー側CREATE・保存・再送判定をテストできる。Web App HTTP経路自体のPOST試験は別ゲートとして実施する。

## TEST専用ファイル導入

1. **新規作成したTEST Apps Scriptだけ**を開く（本番のプロジェクトでは作業しない）。
2. ツールバーの「ファイル」→スクリプト（`+`）で `G4_Isolated_Create_Replay_QA` という名前の新しいGSファイルを作成。
3. [QA専用ソース](../qa/G4_Isolated_Create_Replay_QA.gs) の全文をコピーして保存。**既存の20ファイルを上書きしない**。
4. QA終了後、この補助ファイルはTESTプロジェクトから削除可能。将来TESTソースを再同期すると、`stage-append-test-gas.mjs`はテストソースを再ステージするため、この補助ファイルはなくなる。

## 実行順序と停止条件

### G4-A：読取り専用プリフライト（先にこれだけ実行）

関数 `vaaQaG4PreflightReadOnly` を選択して実行する。

期待するログ：
`VAA_QA_G4_PREFLIGHT {"phase":"G4_PREFLIGHT_READ_ONLY","safeToCreateOnce":true,"payloadValidationCode":"OK","budgetAllowed":true,"requestIdAlreadyExists":false,"testFoldersMatch":true,"syntheticApplications":1,"syntheticJobs":1,"propertiesModified":0,"propertiesDeleted":0}`

ここで実行できるのはAPIのpayloadバリデーションとScript Properties容量の読み取りのみ。**シートは作成しない**。`safeToCreateOnce !== true`、例外、権限不足、フォルダ不一致なら停止する。

### G4-B：CREATEを一度だけ実行（G4-A合格後）

関数 `vaaQaG4CreateOnce` を**1回だけ**実行。TEST用フォルダ内に架空の応募1件・求人1件の個社シートを作成する。

ログ `VAA_QA_G4_CREATE` を確認し、以下を判定する。
- `ok:true`
- `status:"READY"`、`stage:"READY"`
- `reused:false`（最初のCREATE）
- `receiptExists:true`、`receiptReady:true`
- `responseMatchesReceipt:true`、`requestIdMatched:true`

**重要：エラーまたは時間切れになったら、同じ関数を再実行しない。** シート作成とREQ_記録の書込みの間に失敗した場合、前回のシートが孤立している可能性がある。TESTフォルダを閲覧して先に状態を調査する。

### G4-C：READYの同一requestId再送

G4-BがREADYになったことを確認した場合だけ、`vaaQaG4ReplayReady`を一度実行する。
- `ok:true`、`status:"READY"`
- `reused:true`
- `sameSpreadsheet:true`
- `pass:true`
- TEST出力フォルダに新しい個社シートが追加されないことを人が確認する（過去のテストシートは削除しない）

### G4-D：容量・履歴の読み取り専用確認

`vaaAuditScriptPropertyCapacityReadOnly`を実行し、`REQUEST_RECORDS`=1件、`REPORT_REGISTRY`や`VIEWER_MAPPINGS`がTEST内で増えたことを確認。REQ_の `performance` が保存されないことはNodeテストで検証済み。実プロパティの中身やTOKENはチャットに貼らない。

## 共有する結果

`VAA_QA_G4_PREFLIGHT`、`VAA_QA_G4_CREATE`、`VAA_QA_G4_REPLAY`の各JSONはIDやキーを除く安全な集計情報のみ。まずG4-Aのログだけを共有し、G4-Bの実行はその合格後に進める。

## 安全性の限界

- `vaaQaG4CreateOnce`は実際にTESTのDriveフォルダにシートを作成し、Script PropertiesへREQ/RPTREG/VIEWERを保存する。読み取り専用ではない。
- ブラウザの`/dev` HTTP POSTは試さず、エディタから`doPost`を直接呼び出す方式。HTTPエンドポイントとCORSは別工程。
- 一度作成が始まってからのScript Properties障害で孤立シートが生まれる可能性は、このG4でもゼロではない。異常時は必ず停止して照合する。
- 今回の補助ファイルは隔離用で、本番への同期/マージ対象としない。
