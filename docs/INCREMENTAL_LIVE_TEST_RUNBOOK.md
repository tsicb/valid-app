# 差分追加・全件入れ替え｜隔離環境での実地検証

作成日: 2026-10-23
対象ブランチ: `feature/incremental-update-pages`
状態: **新規作成・差分追加・全件入れ替え・AirWork・CSV_BはGoogle実環境で検証済み。旧形式移行の専用テストは未実施。**

## 1. 公開前の安全条件

- `main` へのマージ、現在の本番GASへの同期、既存Web Appの再デプロイは、この段階では行わない。
- 本番の応募者情報や個社管理シートをテスト入力・テスト対象に利用しない。
- テスト用の **別Apps Scriptプロジェクト**、別のテスト用Driveルートフォルダと出力フォルダ、独立したアクセスキーを使用する。
- テスト環境の `00_Config.gs` **コピーのみ**、`ROOT_FOLDER_ID` と `SHEET_OUTPUT_FOLDER_ID` をテスト用の別フォルダIDへ変更する。GitHub本体の `00_Config.gs` にテストIDをコミットしない。
- テストGASのScript Propertiesはテスト専用で設定する：`ACCESS_KEY`（強力な別キー）、`SCHEMA_VERSION=3.0`。HMAC鍵 `VAA_APPLICATION_IDENTITY_HMAC_V1` は初回実行時に自動生成されるので本番からコピーしない。`SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID` も本番の値を引き継がない。
- Apps Scriptの権限・Web App公開範囲を運用上必要な最小限にする。テストURLとアクセスキーを公開リポジトリへ入れない。

### 実地テストに必要なもの

1. このPRブランチの15本の `central-api/*.gs` を反映した **テスト用GAS Web App /exec URL**。
2. テスト用のGAS設定と別Driveフォルダ（管理対象チェックのため、作成する個社管理シートもテスト出力フォルダへ保存）。
3. 下記の合成CSVと、PC上でlocalhost配信するテスト用Pagesコピー。

現在のリポジトリにある `.github/workflows/central-api-sync.yml` は本番 `GAS_SCRIPT_ID` に同期するため、**実地検証の準備目的で実行しないこと**。

### 推奨：GitHub Actionsからテスト用GASへ同期（PCでのclasp設定不要）

テスト用Apps Scriptのスタンドアロンプロジェクトを新規作成したら、以下の手順でコードを配置する。

1. [Apps Script](https://script.google.com/home/projects/create) で空の**テスト専用**スタンドアロンプロジェクトを作る。既存の本番プロジェクトを複製・上書きしない。プロジェクト設定でScript IDを控える。
2. [GitHub Actions: Isolated test GAS sync](https://github.com/tsicb/valid-app/actions/workflows/isolated-gas-smoke-sync.yml) を開き、`Run workflow` のブランチを **`feature/incremental-update-pages`** にする。ワークフローファイルは実行ボタンを表示するためmainにも登録済みだが、アプリのmainコードには反映していない。
3. 入力を設定：`test_script_id` = テスト用Script ID、`test_root_folder_id` = テスト用親フォルダID、`test_output_folder_id` = テスト用出力フォルダID、`confirm` = **TEST_ONLY**。
4. `Run workflow` で実行。構文・SHA256・自動テストに合格したソースだけをテストGASへ同期する。既存の `GAS_SCRIPT_ID` と一致すると拒否し、**本番GASへの同期・Webアプリの公開は行わない**。
5. Apps Scriptの**テスト用プロジェクト**でScript Propertiesに `ACCESS_KEY`（本番と異なるキー）、`SCHEMA_VERSION=3.0` を設定する。本番HMAC鍵や本番DataStoreフォルダIDをコピーしない。
6. テストプロジェクトのWeb Appを新規デプロイして `/exec` URLを得る。公開範囲は実際のクロスオリジン画面が利用できる最小構成にし、実データを投入せず架空CSVのみを使用する。アクセスキーをGitHubのコード・Issue・PR本文に記載しない。

GitHubで設定済みの `CLASPRC_JSON` と `GAS_SCRIPT_ID` は、OAuthと「本番Script IDではない」安全確認のために使用する。追加の認証情報はGitHubに公開しない。認証情報が有効でない場合、GitHub Actions側で安全に失敗するので、本番同期へ変更して回避しない。

### 代替：ローカルclaspを使う方法



1. Apps Scriptで本番とは別の**新規スタンドアロンプロジェクト**を作り、Script IDを控える。
2. このfeatureブランチをローカルにチェックアウトし、`npm install -g @google/clasp@3.3.0` と `clasp login` を行う。
3. 以下のコマンドで **テスト専用Script ID** を指定した `.clasp.json` を作る。本番Script IDは絶対に指定しない。

```bash
node -e "const fs=require('fs');fs.writeFileSync('.clasp.json',JSON.stringify({scriptId:process.argv[1],rootDir:'.gas-test',scriptExtensions:['.gs','.js']},null,2)+'\n')" "TEST_GAS_SCRIPT_ID"
clasp pull
node scripts/stage-append-test-gas.mjs "TEST_ROOT_FOLDER_ID" "TEST_OUTPUT_FOLDER_ID"
```

4. `.clasp.json` がテスト専用Script IDを指すこと、`.gas-test/00_Config.gs` が**テスト用フォルダ**を指すことを確認してから `clasp push --force` を行う。このコマンドが変更するのは指定した**テスト用GASプロジェクトのソースのみ**であり、Web Appのデプロイは別操作。
5. テストGASのScript Propertiesを設定し、Apps Script側でWeb Appを新規デプロイしてテスト用の `/exec` URLを得る。

`stage-append-test-gas.mjs` は本番root/outputフォルダIDを拒否する。また、取得済みの `.gas-test/appsscript.json` がなければ作業を開始しない。テスト用フォルダIDは生成したローカルの `.gas-test/00_Config.gs` のみに保持し、GitHubへコミットしない。

## 2. 推奨：GitHub Actionsでテスト専用画面と架空CSVを取得

GASをWebアプリとしてデプロイして `/exec` URLが発行されたら、**PCへのGit cloneやNode.jsのインストールなし**でテスト画面を用意できる。

1. [Build isolated Pages test bundle](https://github.com/tsicb/valid-app/actions/workflows/build-isolated-pages-preview.yml) を開く。
2. `Run workflow` のブランチに `feature/incremental-update-pages` を選択する。
3. `test_api_url` に**テストGASの** `https://script.google.com/macros/s/.../exec` を指定し、`confirm` に `TEST_ONLY` を入力して実行する。
4. Actionsはまず公開GETで `IDENTITY_V1`、APPEND/REPLACE、Schema 3.0、およびテスト専用親/出力フォルダIDを検証する。不一致なら停止し、テスト画面を生成しない。
5. 成功後、実行結果ページ下部のArtifactsから `valid-app-isolated-pages-test` をダウンロードする。
6. ZIPをPCのフォルダに展開し、エクスプローラーで `index.html` があるフォルダのアドレスバーに `cmd` と入力して開く。そこで **`python serve_isolated_test.py`** を実行する（`python -m http.server 8765` は使わない）。`http://localhost:8765/index.html` がテスト画面になる。
7. 展開された`samples`フォルダの架空CSVでテストする。

生成物の `index.html` と `report.html` は同じ `localhost:8765/__test_api__` に送信し、付属の `serve_isolated_test.py` がテスト用GASへ転送する。これによりブラウザのCORS制約を回避する。Python側は `127.0.0.1` のみにバインドし、接続先GASは生成時に確定したテストURLに固定する。アクセスキーと送受信本文はログに記録しない。本番Pagesとは独立している。ZIPには**テスト用API URLは含まれるが、アクセスキーや応募者の個人情報は含まれない**。テストが終わったらZIPと展開フォルダは削除可能。

### 代替：ローカルでテスト用画面を生成



テスト用GASを別プロジェクトでデプロイしたら、このブランチの作業ディレクトリで実行する。

```bash
node scripts/build-append-smoke-site.mjs "https://script.google.com/macros/s/テスト用デプロイID/exec"
cd .smoke-pages
python serve_isolated_test.py
```

ChromeまたはFirefoxで `http://localhost:8765/index.html` を開き、**テスト専用アクセスキー**を登録する。

- このスクリプトは `index.html` と `report.html` のAPI参照先をテスト用GASへ書き換えた一時コピーを生成する。
- 本番GAS URLを指定するとエラーで停止する。GitHubの元ファイルや `main` は変更しない。
- 生成された `.smoke-pages/` はGit管理対象外。アクセスキーや応募者情報を生成ファイルへ埋め込まない。
- localhost配信は実利用の報告・共有URLではない。生成したテストレポートのURLは他の端末では使えない。

## 3. 合成CSV（個人情報なし）

配置場所: `tests/fixtures/append-smoke/`

| ファイル | 用途 | 入力応募数 |
|---|---|---:|
| `01_初回応募.csv` | 新規作成。通常応募2＋AirWork5 | 7 |
| `01_初回求人.csv` | 初回の求人時給 1,200円 | 1求人 |
| `02_重複追加応募.csv` | 重複通常応募1＋新規通常応募1＋AirWork7 | 9 |
| `02_改稿求人.csv` | 同じ求人を時給1,500円に改稿 | 1求人 |
| `03_日次数減少応募.csv` | AirWorkの同じ日を3件として再報告 | 3 |
| `04_全件入れ替え応募.csv` | 残す通常応募1＋AirWork3 | 4 |
| `04_入れ替え求人.csv` | 求人の正式訂正時給1,600円 | 1求人 |
| `05_CSV_B形式.csv` | 同月同人物IDが2行。CSV_B形式の確認 | 2行 |

AirWorkの仮想仕事番号は `AIRWORK_ONLY`、通常求人は `DEMO_JOB`、企業IDは `DEMO001`。合成名はすべて架空である。

### テスト画面が「保存先情報が返りませんでした」と表示した場合（2026-10-25確認）

今回のテストでは、初回CREATEの画面表示がエラーでも、テスト用個社管理シート `有効応募分析_20261025_033228` が生成され、`99_内部状態` に `状態=READY` / 応募7件 / 求人2件、`98_運用ログ` に `DATA_CREATE=SUCCESS` が記録されていることを確認した。

- **CREATEを繰り返さない**：同じ企業のテスト用シートが重複して作られる可能性がある。
- テスト用個社管理シートを開き、`99_内部状態` の `READY` および最終件数、`98_運用ログ` を確認する。
- featureブランチの `index.html` に、`ok=true` でも `spreadsheetUrl` が欠落した応答をREADY確定と誤判断せず**同一requestIdで再照会**する修正を加えた。`READY` かつ `spreadsheetId` が返っている場合は正規のSheet URLを構築する。
- 新しいテスト画面ZIPに更新し、既存シートの「データを更新する」からAPPENDを検証する。初回CREATEを再実行する必要はない。
- 当初のGAS応答から実際にどの項目が欠けていたかは未採取。画面の誤判定対策は自動テスト済みだが、この不具合の完全な根本原因は**実地再検証が必要**。

### 差分追加が800秒以上継続した場合（2026-10-25）

実地でAPPENDが800秒以上継続する事象を確認。テスト対象の`99_内部状態`は応募7件・求人2件・CREATEのまま、`98_運用ログ`にもUPDATE成功行はなく、DriveのDataStoreフォルダにもAPPEND用の新規保存ファイルが無いことを確認した。この観察は「まだ確定保存されていない」ことを示すが、どのGAS工程で停滞したかまでは未特定。

- ブラウザは最大15分（`SHEETS_MAX_AUTO_RESUME_MS=900000`）、単一POSTは最大5分30秒（`SHEETS_POST_TIMEOUT_MS=330000`）待機する。画面が800秒以上表示されても、GAS処理が続いている根拠にはならない。
- 途中で別のUPDATEやCREATEを新規開始しない。必要ならテスト画面を閉じるが、GASサーバー側の実行停止を意味しない。
- テスト用Apps Scriptプロジェクトの左側「実行数」を開き、最近の`doPost`の実行ステータス（実行中／失敗／完了）、実行時間、エラーメッセージを確認する。ACCESS_KEYなど認証情報は共有しない。
- 原因の候補はGAS側のリース待ち・処理エラー・ネットワークタイムアウトや、ブラウザ側の`ok=true`でも保存先が欠落した応答の再試行。現時点で決めつけない。
- ブラウザ側`ok=true`かつ`spreadsheetUrl`無しの応答は、従来最大15分再試行できてしまう設計を修正し、**同一requestIdで3回の確認後に`API_INCOMPLETE_READY`を返してstatus/stageを表示**する。自動テスト追加済み。まだ実地反映していない。
- GAS実行履歴とシート状態を照合してから、同じテストシートで再検証する。

### UPDATE時のタブ表示順序を修正（2026-10-25）

実地テストで、index.htmlの「差分追加を実行」確認モーダルより先にreport.htmlの待機タブが開き、800秒以上待ち続ける事象を確認。元のindexタブで同意クリックすると正常にGAS更新が完了した。テスト用Google Sheetsの状態、DataStore統計と運用ログで、保存済み7件→10件（重複除外6件／新規3件）を確認した。

- **改修後のUPDATE**：indexでCSV処理→更新モード確認モーダル→「差分追加を実行」または確認済みREPLACEのクリックイベント内でreport待機タブを開く→保存完了後にレポートを表示。
- **CREATEは従来どおり**：実行ボタンのクリック時にreport待機タブを予約する。
- 更新方法（APPEND/REPLACE）は実行ボタンのクリック直後に確定し、CSV読込・確認・保存要求の間で一致させる。
- キャンセル／Esc／全件入れ替え確認チェック未選択ではタブ生成なし、GASへの保存要求も送らない。
- `tests/update-confirm-tab-order.test.cjs` に5つの回帰テストを追加し、確認クリックと同期したタブ生成・キャンセル時の無動作を検証。
- 次の検証は**既存の10件保存済みテストシート**で、同じ `02_重複追加応募.csv` を再APPENDして追加0件・合計10件となること。重複CREATEはしない。
- 本番反映は未実施。新しいテスト画面ZIPをBuild isolated Pages test bundleから取得して試す。

## 4. 実地確認の順序と期待値

| 順番 | 操作 | 追加応募 | 保存総数 | 求人給与の期待値 |
|---|---|---:|---:|---|
| 1 | `01_初回応募.csv`＋`01_初回求人.csv` で新規作成 | 7 | 7 | 1,200円 |
| 2 | `02_重複追加応募.csv`＋`02_改稿求人.csv` を「差分追加」 | 3 | 10 | **1,200円のまま** |
| 3 | 同じ2ファイルをもう一度「差分追加」 | 0 | 10 | 1,200円 |
| 4 | `03_日次数減少応募.csv` を「差分追加」 | 0 | 10 | 1,200円 |
| 5 | `04_全件入れ替え応募.csv`＋`04_入れ替え求人.csv` で「全件入れ替え」 | 4 | 4 | **1,600円へ変更** |
| 6 | `05_CSV_B形式.csv` を「差分追加」 | 1 | 5 | 1,600円 |

※ AirWorkは通常求人とは別の仮想仕事番号を持つ。初回の求人マスタは「通常求人」と「AirWork（応募実績）」の2種類となる。初回の空欄求人属性は、後日のCSVで自動補完しない。

### 各操作で確認すること

- 更新確認モーダルに対象企業と方式が出る。REPLACEでは確認チェックが必須。毎回最初の選択はAPPEND。
- APPENDでは未統合のアップロードデータだけを最終レポートとして先行表示しない。
- API完了時の `updateStats`、`99_内部状態` の `analysisDataStoreApplicationRows` と `analysisDataStoreJobRows`、`91_求人分析マスタ`、`98_運用ログ`、レポート合計件数が一致する。
- 元の応募者ステータスは後日CSVで変更しても保持される。新しい応募だけ追加。
- 4番はAirWork件数減少の警告が表示され、すでに保存された7件は削除されない。
- 既存求人の `求人参照ID` と既存応募の `レコードID` はAPPENDでも維持される。
- 共有URL、初期設定、表示設定、画像・企業IDマスタが想定どおり保持される。
- 認証失敗時に `manageIdentityKey` がHMAC鍵を返さない。氏名・応募者ID・HMAC鍵がDataStore・Sheet・ログへ保存されていないことを確認する。
- 保存途中エラー、同じrequestIdでの再送、別requestIdでの同時更新についてはテスト環境のバックアップを確保してから実施する。

### 05_CSV_B形式の差分追加と確認画面の改善（2026-10-25）

- **実地検証済み**：`04_全件入れ替え応募.csv` の4応募の状態から `05_CSV_B形式.csv` をアップロード。CSV内2行は同月の同じ応募者IDでブラウザ内重複除外され、送信1件、差分追加1件、保存合計**5件**となった。DataStoreの最後の応募識別方式は`PERSON_ID`、レコードIDは`APP000005`。求人マスタは2件、既存時給1,600円は維持。テスト用個社シートの`99_内部状態` / `98_運用ログ` と保存JSONで確認済み。
- **確認画面の改修済み（テストブランチ、未公開）**：既存企業の更新で「求人CSVを選択したが応募データとの求人突合が0件」の場合、既存の更新確認モーダル内に警告と「応募CSV内情報で分析する」旨を先に表示する。差分追加／全件入れ替えの実行ボタンによる同意で警告も確認したこととし、そのクリックで初めてレポートタブを開く。後続`createGoogleSpreadsheet()`では同じ警告の二重`window.confirm`を表示しない。
- **保護**：更新確認モーダルの警告表示がない状態で`unmatchedJobAcknowledged`を省略し、求人突合0件の更新を直接実行しようとすると保存前にエラー停止する。REPLACEは警告があっても破壊的操作の確認チェック必須。キャンセル時はreportタブも保存要求も発生しない。
- 通常の更新（求人突合あり）では警告は表示しない。CREATEの従来の初回タブ表示・求人突合0件のネイティブ確認については今回変更しない。
- `tests/update-confirm-tab-order.test.cjs`に追加5件を実装し、CIでJavaScriptテスト**87件成功**（Pythonの中継テスト4件も成功）。実ブラウザでの更新確認順序は、次回のテスト用ZIP生成後に再確認する。

## 5. 旧データの初回移行

旧バージョン（`applicationIdentityVersion` のないDataStore）からのAPPENDでは `MIGRATION_REQUIRED` を返し、過去期間すべてのCSVを使ってREPLACEする。元の既存レポートをテストのために消去しない。テストプロジェクト内で旧版データを準備できない場合、この項目は**実地未検証**として残す（自動テストでは検証済み）。

## 6. 旧形式データからの移行を実地検証する（専用の別シート）

テスト用アプリの通常版でCSV_A/CSV_B/APPEND/REPLACEが動作したため、残る重要なシナリオは古いデータの初回移行。**ここまで検証してきた5応募の個社管理シートは触らない。**

テスト用ZIPには、通常の `index.html` と別に**旧形式CREATE専用の `legacy-create.html`** を追加した。これはlocalhostだけで動作し、架空の `01_初回応募.csv`・`01_初回求人.csv` 以外の入力や既存SheetのUPDATEを拒否する。GASへ送信する際、応募の識別キー列と `updateProtocol` を外し、以前の形式を模したDataStoreを作る。GASへの追加コードや再デプロイは不要。

### 手順

1. [Build isolated Pages test bundle](https://github.com/tsicb/valid-app/actions/workflows/build-isolated-pages-preview.yml) を**新しい実行**として開始する。ブランチは `feature/incremental-update-pages`、confirmは `TEST_ONLY`、GAS URLはこれまでのテスト用 `/exec`。
2. Artifactsをダウンロード・展開し、`python serve_isolated_test.py` を起動。今回だけ `http://localhost:8765/legacy-create.html` を開く。
3. 新規会社名を `LEGACY_MIGRATION_TEST` とし、`samples/01_初回応募.csv` + `samples/01_初回求人.csv` で**新しい個社管理シートを1件作る**。保存後、生成されたシートURLを控える。想定：応募7件、求人2件。元の5件入りシートとは別のSheetであることを確認する。
4. 新しいテストSheetの `99_内部状態` で `applicationIdentityVersion` がないことを確認する。レポート初期設定、画像・企業マスタなどの構成は通常の個社管理シートと同じ。
5. **通常の** `http://localhost:8765/index.html#sheet=新規スプレッドシートID` を開き、`02_重複追加応募.csv` + `02_改稿求人.csv` を `差分追加`。期待するAPI応答：`MIGRATION_REQUIRED`（「旧形式は初回のみ全件入れ替えで移行してください」）。保存済み7件とDataStoreファイルIDが変わらないことを確認する。
6. 同じ新規テストSheetで `01_初回応募.csv` + `01_初回求人.csv` を `全件入れ替え`。確認チェックとモーダル同意後、応募7件・求人2件、`applicationIdentityVersion=1`、元の旧形式DataStoreが`analysisDataStoreBackupFileId`に保持されることを確認する。
7. 同じSheetへ `02_重複追加応募.csv` + `02_改稿求人.csv` を `差分追加`。期待：9件アップロード中、既存6件と重複、新規3件追加 → 合計10件。旧求人の給与1,200円維持。
8. テスト終了後も、既存5件入り検証シートを削除・変更しない。新しく作成した移行テスト用Sheetは必要に応じて保持する。

### 判断ポイント

- 旧データへの差分追加は**保存前に安全に拒否**する。
- 全件入れ替えで旧データが再構築され、以降は通常の差分追加が使える。
- 元の旧形式DataStoreは新方式の一世代バックアップとして保持される。
- 実ブラウザの結果を確認するまでは、**「旧形式からの移行テスト成功」とは記録しない**。

## 7. リリース判定

Google実環境の実地確認が完了するまではPR #2をドラフトのまま維持する。テストで不一致があればGitHubの作業ブランチで修正してCIを再実行する。実地確認後、GASソース同期→Web Appデプロイ→Pages公開を短い切替期間で連続実行する。

**この手順はテスト環境の作成と検証のためのものです。実地検証済み・本番公開済みという意味ではありません。**
