# 限定更新型APPEND v1：隔離実環境QA実施手順

作成: 2026-11-24 / 対象: [draft PR #61](https://github.com/tsicb/valid-app/pull/61) の `feature/append-limited-update-core-v1`

## 検証範囲と状態

- **自動QA**：実在しない応募者だけのCSV（`tests/fixtures/append-smoke/`）を使用し、実際のPages CSV正規化→HMAC→限定更新GAS純粋統合・DataStore計画→`analysis-core.js` のViewerレコード生成を検証。
- **Google実環境QA**：**未実施**。本ドキュメントは、隔離GASとテスト用Sheetを使って動作確認するための手順であり、実環境での成功を示すものではない。
- 本番 `main`、本番Web App、Script Properties、本番企業Sheet、既存REQ/READY・DataStoreを変更・削除しない。
- 以前の共用TEST GASには独自QAスクリプトがある。今回の専用同期は**新規の空のスタンドアロンTEST GASプロジェクト以外を拒否**する。既存TEST GASにSYNCしない。
- 同期ワークフローは `clasp push` まで。Web Appの新規デプロイ・Script Properties設定はテストプロジェクト側で個別に行う。
- 使用するDrive root/outputは、既に分離されたTEST専用フォルダを指定する。本番フォルダIDはワークフローとstagerが拒否する。

## 1. GASテストプロジェクトの準備

1. [Apps Script](https://script.google.com/home/projects/create) で独立した新規空プロジェクトを作る。**過去にQA関数を配置したTESTプロジェクトは再利用しない**。作成したTEST Script IDを控え、GitHubやPR本文に書き込まない。
2. [Isolated main GAS QA source sync](https://github.com/tsicb/valid-app/actions/workflows/isolated-main-gas-qa-sync.yml) の `Run workflow` でブランチ `feature/append-limited-update-core-v1` を選ぶ。
3. `expected_sha` は、その時点のPR #61最新コミットの完全な40桁SHAに一致させる（古いSHAでは停止）。`test_script_id` は新規TEST GAS、`test_root_folder_id` と `test_output_folder_id` は既存の隔離TEST専用フォルダ、`confirm=TEST_ONLY` を指定する。
4. 先にソース・構文・ハッシュを確認し、TEST GASを `clasp pull` して未改造の新規テンプレートであることを確認した後、TEST専用Script IDへのみソースを配置する。既存コードがあれば失敗して**pushしない**。
5. 新規TEST GASの Script Properties に、**TEST専用** `ACCESS_KEY`、`SCHEMA_VERSION=3.0`、`VAA_LIMITED_APPEND_ENABLED=true` を設定する。本番のアクセスキー・人物識別用HMACキー・DataStoreフォルダ設定をコピーしない。
6. TEST GASを **新規Web Appデプロイ**して、`https://script.google.com/macros/s/.../exec` を控える。権限・公開範囲はテストに必要な最小限とし、URLやアクセスキーを公開PRに貼らない。
7. Web App GETが `IDENTITY_V1` / `APPEND` / `REPLACE` と `limitedAppend.protocol=LIMITED_APPEND_V1`, `limitedAppend.enabled=true` を応答することを確認する。GETが古いデプロイバージョンのままならブラウザQAを開始しない。

## 2. テスト画面を生成する

1. [Build isolated Pages test bundle](https://github.com/tsicb/valid-app/actions/workflows/build-isolated-pages-preview.yml) の `Run workflow` でブランチ `feature/append-limited-update-core-v1`、`test_api_url=TEST専用Web App URL`、`confirm=TEST_ONLY` を指定する。
2. ワークフローは本番URLを拒否し、GETでSchema 3.0・隔離Driveフォルダ・`LIMITED_APPEND_V1 enabled:true` を確認する。認証に誤ったキーを使った拒否応答も確認し、合格時のみZIPを生成する。
3. 実行結果のArtifactsから `valid-app-isolated-pages-test` を取得。ローカルに展開し、フォルダ内で `python serve_isolated_test.py` を実行して `http://localhost:8765/index.html` を開く。`python -m http.server` は使用しない（API転送ができない）。
4. ブラウザにはTEST GASアクセスキーだけを登録する。すべて `samples/` の架空CSVを使う。既存本番レポート、求人・応募CSVは使用しない。
5. テスト操作の対象は **今回新しく生成する架空企業の個社管理Sheet** に限定する。CREATE結果がタイムアウトしても同じリクエストで状態を確認し、重複CREATEしない。

## 3. 保存・レポートの期待値

### シナリオA：ステータス更新＋既存給与の凍結

| 操作 | 入力 | 期待結果 |
|---|---|---|
| A1: CREATE | `01_初回応募.csv` + `01_初回求人.csv` | 応募7件（通常2＋AirWork5）、通常求人時給1,200円、求人マスタ2件 |
| A2: APPEND | `02_重複追加応募.csv` + `02_改稿求人.csv` | 応募＋3件→合計10件、既存の架空甲は未対応→選考辞退、時給1,200円維持 |
| A3: 同一CSVを再APPEND | A2と同じ | 応募追加0、ステータス更新0、合計10件、給与1,200円のまま |
| A4: AirWork減少 | `03_日次数減少応募.csv` | 合計10件維持、日別件数減少警告、既存AirWork行は削除しない |
| A5: REPLACE（別途QA） | `04_全件入れ替え応募.csv` + `04_入れ替え求人.csv` | 合計4件、時給1,600円に変更。限定APPEND候補は送信しない |

A2では、ステータスの「進捗順位」は採用しない。現行応募日時・仕事番号・レコードIDは不変。Viewer `対応状況別`、`応募月別`、`時給下限別` の変化と合計を照合する。

### シナリオB：求人CSVを入れ忘れた応募の補完

**必ずAとは別の新しい架空企業TEST SheetでCREATEから開始**する。同じ企業ID `DEMO001` を使うが、別Sheetなのでデータは混在しない。

| 操作 | 入力 | 期待結果 |
|---|---|---|
| B1: CREATE | `06_未突合初回応募.csv` のみ | 応募1件、`APPLICATION_EMBEDDED`、求人突合フラグ0 |
| B2: APPEND | `08_別求人先行・更新候補後続.csv` + `07_後日補完求人.csv` | 応募1件のまま、保存済み`DEMO_UNJOINED`代表維持、ステータス`面接確定`、`JOB_CSV`へ昇格、給与1,350円、フラグ1 |
| B3: 同一CSVを再APPEND | B2と同じ | 追加0、ステータス更新0、求人新規補完0、突合済1件を維持 |

B2のCSVは同じ人の「別求人の応募」が先にあり、元の保存応募は2行目にある。先頭行だけを代表とする通常仕様を残しつつ、一時候補によって元応募の更新を行えることを確認する。更新前後で `APPレコードID` と既存 `JOB求人参照ID` が一致すること。

**表示上の特別確認**：代表応募への通常JOINは0件でも、重複除外行に有効な求人JOIN候補が1件ある。確認画面に「求人CSVを使わない」と誤案内しないことを確認する。

### シナリオC：旧機能・不正入力の安全性

- 限定更新OFF時は、旧APPENDの追加・重複除外が以前どおり。限定更新リクエストを送るなら明示的なエラーで拒否し、黙って部分更新しない。
- CSV_B `05_CSV_B形式.csv` では`PERSON_ID`を使い、同月の別応募日時でステータス上書きしない。
- AirWork `AGG_DAILY` と `REPLACE` は限定更新候補を使用しない。
- 同一応募日時・同求人で複数の異なるステータスがある場合は更新を見送る。
- 同じrequestIdで候補内容を変更したリクエストはダイジェスト不一致で拒否する。
- 検査は `99_内部状態`、`91_求人分析マスタ`、`98_運用ログ`、DataStoreリンク先、Viewerの状態を横断して実施。元のTEST保存済みファイルを勝手に削除しない。

## 4. 安全性／保存境界

- `limitedAppendCandidates` と `limitedAppendProtocol` は **リクエスト専用**で、完成したDataStore JSON・Sheet列・Viewerデータ・REQ記録へそのまま残さない。
- 氏名・応募者ID・メール/電話の原文はCandidate・Viewer・DataStoreに残さず、企業＋月＋人物のHMAC識別キーのみを使う。ログ・スクリーンショットもアクセスキーと個人情報を除外する。
- `JOB_CSV`取得済みの給与はAPPENDでは凍結する。補完による`APPLICATION_EMBEDDED`→`JOB_CSV`の昇格はその求人を共有する他の応募にも影響し得るため、Viewerで職種・給与分布を確認する。
- 新規/試験環境であってもリクエスト処理中の同時再実行は行わず、タイムアウトや応答不明の場合は先に保存状態を確認する。
- 本番へのGAS SYNC/Web App再デプロイ、`main`へのPRマージ、Script Properties変更はこのQAの一部ではない。

## 5. 判定記録

| 項目 | 状態 |
|---|---|
| Nodeによる架空CSV A/B→限定統合→Viewer検証 | GitHub ActionsのCIで検証（履歴を参照） |
| GAS構文・SHA-256・既存回帰試験 | GitHub ActionsのCIで検証（履歴を参照） |
| 本物の隔離GAS Web App /exec経由 | **未実施** |
| 隔離TEST Sheetへの実書込み | **未実施** |
| READY再送、DataStore CAS、運用ログ、Viewerブラウザの実確認 | **未実施** |
| 本番ソース、設定、既存データ | **変更なし** |

QA途中で不整合があれば、PRはdraftのまま固定し、運用中の本番環境で再試行せず、テスト専用の実行履歴とデータを検証する。
