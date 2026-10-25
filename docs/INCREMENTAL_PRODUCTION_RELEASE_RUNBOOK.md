# 差分追加・全件入れ替え　本番公開手順 v1

作成日：2026-10-25
対象：`tsicb/valid-app`、PR #2（`feature/incremental-update-pages`）
状態：**PR競合解消・自動テスト完了。本番未マージ・本番GAS未同期・本番Web App未再デプロイ。**

## 1. 結論と切替方針

本番への切替は **GASソースを先に同期（Web Appには未反映） → 既存GAS Web Appを新バージョンへ切替 → PRをmainへマージ → GitHub Pagesの反映を確認** とする。

- GASソース同期と **Web Appデプロイは別操作**。現在の `.github/workflows/central-api-sync.yml` は `clasp push --force` を行うだけで、既存のバージョン付きWeb Appには自動反映しない。
- GAS先行で一時的に「旧Pages＋新GAS」になる場合、旧Pagesからの **CREATEは互換性確認が必要、UPDATEは新プロトコル必須のため拒否される**。反映待ち期間は社内利用者にCSV作成・更新を控えてもらう。共有済みレポートの **閲覧** を停止する設計ではないが、切替直後に実際の閲覧を検証する。
- Pages先行（新Pages＋旧GAS）は管理者認証時の `IDENTITY_V1` capability確認で止まるため、推奨しない。
- `report.html`、`analysis-core.js`、`common-masters-v1.js`、Cloudflare画像Workerは今回の差分更新のために更新する必要はない。
- GitHub Pagesが `main` から公開されることを **Settings → Pages** で公開当日にも再確認する。mainマージ後の反映はGitHub Pagesのビルド／デプロイ状況で判定する。

## 2. 公開のGo/No-Go条件

現時点の **残作業**：
- **2026-10-26 00:10 JST：PR #2の競合は解消済み。GitHubの `mergeable=true` を確認**。マージ操作そのものは未実行。
- 競合の解消内容：`.github/workflows/build-isolated-pages-preview.yml` はmainの全行を保持したまま、featureの旧形式テスト機能の追加行を採用。`.github/workflows/isolated-gas-smoke-sync.yml` はmainとfeatureで完全一致。統合コミットは `365a44e481999c026609936a772270b98aa13a51`。
- **統合後の `Central API check` は全項目成功**：JavaScript 94件、Python 4件、Pages/GAS構文、SHA256照合。実行記録 https://github.com/tsicb/valid-app/actions/runs/40205673562 。本番切替直前には最新HEADについて再確認する。
- `index.html` の本番GAS `SHEETS_API_URL` が既存の本番URLを指し、テスト用 `localhost:8765/__test_api__` になっていないことを確認する。`append-identity-v1.js` がルートに存在することを確認する。
- 作業ブランチの最新コミットSHAとマージ前のmain SHAを記録。**GASに同期するソース** と **最終的にmainにマージするソース** が一致するよう、切替開始後はPR内容を固定する。
- 本番GASの `scriptId` が `GAS_SCRIPT_ID` secretと一致すること、切替先が**テスト用GASではない**ことを確認する。
- 本番GASの `ACCESS_KEY`、`SCHEMA_VERSION=3.0`、現在の `SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID` と運用中の出力フォルダ設定を確認する。**Script Propertiesは今回初期化しない**。
- 本番Web Appは `/exec` の **バージョン付きデプロイ** であることを確認。現在のデプロイID、URL、バージョン番号を記録する。新規URLへの置換はしない。
- 既存利用者のCSV作成・更新が進行していない時間帯を選び、切替中は新しいCSV取込を控えるよう案内する。

## 3. 変更前の復旧材料の確保（必須）

1. GitHubの **マージ前mainのコミットSHA** を保存。GitHub Pagesの旧版へ戻す基準となる。
2. 本番Apps Scriptの **現在公開中の既存Web AppデプロイID・バージョン番号・URL** と、GASソースの旧バージョン（またはGitHub mainの中央APIソース）を保存する。既存バージョンを削除／アーカイブしない。
3. 運用中の個社管理シート、DataStore JSON（`_valid_application_analysis_datastore`）、必要なRegistry/設定の**更新前スナップショットを非公開Driveなど安全な場所に確保**する。少なくとも切替後に更新する会社のDataStoreと管理シートは独立して保存する。本番応募データをGitHubや公開テストリポジトリへコピーしない。
4. 重要なScript Propertiesの **キーの有無・設定先** を確認する。`VAA_APPLICATION_IDENTITY_HMAC_V1` は新方式が初回実行時に発行し、それ以降の重複判定に必要。作成後に勝手に変更・削除しない。秘密値をPR・Issue・ログへ書かない。
5. **DataStoreの標準バックアップは直前の1世代だけ**。その後の更新で元の旧データのバックアップはローテーションされ得るため、上記の独立スナップショットが必要。

### 実施記録：非共有Driveへの独立バックアップ（2026-10-26）

本番コードへの同期・デプロイ・PRマージを行わず、**現行の本番データの独立スナップショット**を作成した。バックアップの実際のDriveフォルダURL・各社Sheet ID等は公開リポジトリに書かない（作業担当者に別途案内）。

- コピー先：本番出力先の通常フォルダ**外**、同じプロジェクト上位の所有者のみ閲覧できる非共有フォルダ。
- 個社管理シート：管理対象フォルダの直下1件＋担当別フォルダの計11件＝**12件**を元のフォルダ区分ごとにコピー。
- DataStore：本番の `_valid_application_analysis_datastore` に存在する**49 JSONファイル（合計99,569,396バイト）**をすべてコピー。
- 検証：49件の元ファイルとコピーの**ファイル名・サイズが全件一致**。個社管理シート12件の名称・所在を確認。12社すべての現在参照中DataStoreがコピー対象に含まれることを検証。サンプル2件のコピー（12タブ構成）で `99_内部状態` の値が元と一致。
- コピー元のシート・DataStoreは移動・削除・更新せず。コピー先フォルダは非共有。**管理シートのバックアップ12件すべてをメタデータで確認し、12件とも非共有**。JSONもサンプル確認で非共有。
- **注意**：Google Sheetsはコピー時にファイルIDが変わる。コピーの `99_内部状態` には元DataStoreのIDが残るため、そのまま新たな本番Sheetとして運用・公開しない。復旧は元のSheet ID・DataStore参照・Registry/Viewer tokenの整合を確認しながら行う。
- バックアップは2026-10-26時点のスナップショットであり、**今後の通常更新分は自動的に追随しない**。本番切替直前に既存処理が終了していること、バックアップ取得後に書き込みがあった企業について追加保全が必要かを確認する。

**未取得／公開前の手作業**：
- 本番GASの「デプロイ → デプロイを管理」で、現在稼働中の**デプロイID・版番号・版の説明**を記録する。Apps ScriptのDeployment一覧を取得できる連携がないため、現時点では公開版番号を確認できていない。
- Apps Scriptエディタの現行HEADソースがGitHub mainと同内容か、同期前に比較する。GitHubの旧mainコミットは復旧基準として確保できるが、**現在公開中のGASソースと一致する保証ではない**。旧版はApps Scriptのプロジェクト履歴からも保持する。

### 本番GAS既存デプロイの確認票（2026-10-26、読み取り専用）

GitHub上で確認できた事項：
- `main` と `feature/incremental-update-pages` の `index.html` は、同じ既存GASの `SHEETS_API_URL`（`/exec`）を参照する。リリースでURLを新設・差し替えない。
- 既存の `Central API sync to GAS` workflow は `clasp pull` 後に `clasp push --force` を実行する**書き込み処理**。現状確認目的では起動しない。
- GitHub Actionsの `GAS_SCRIPT_ID` と `CLASPRC_JSON` はSecretであり、GitHubの画面から値を読み戻せない。設定があることと、**本番スクリプトIDとの同一性が確認できたことは別**。
- リポジトリのソースヘッダーや `APP_VERSION` 表示は、Google Apps Scriptの実際の**バージョン番号**と同義ではない。
- 接続中のツールでは、Apps Scriptの本番公開デプロイの版番号・デプロイ一覧を取得できていない。以下は未完了。

本番利用者側でApps Scriptエディタを開き、**操作は閲覧のみ**で次を記録する（Secretは転記しない）。

| 確認項目 | 記録内容 | 合格基準 |
|---|---|---|
| 本番のApps Scriptプロジェクト | エディタのプロジェクト名・Script ID | 本番運用しているプロジェクトだと確認 |
| 公開中のWebアプリ | 「デプロイ → デプロイを管理」でアクティブなWebアプリを選択 | WebアプリのURLが `main/index.html` の `SHEETS_API_URL` と完全一致 |
| 既存デプロイ情報 | デプロイID、現在の**数字のバージョン番号**、説明、URL | ロールバック対象の同一デプロイを特定可能 |
| 実行・アクセス権限 | 現行Webアプリの実行ユーザーとアクセス可能なユーザー範囲 | 後の既存デプロイ編集時に設定を変えない |
| GASソースの復旧根拠 | 現在公開中の版をバージョン履歴から再度選択できること | 既存の公開版を削除・アーカイブしない |
| GAS Script Properties | `SCHEMA_VERSION`、`APP_VERSION`、DataStore関連の**キーの存在と設定状態** | Secret値・HMAC値は貼り付けたり公開リポジトリに保存しない |
| Github Secretとの対象一致 | `GAS_SCRIPT_ID` が現在確認した本番Script IDに設定されていることを保守担当者が確認 | 値を照合できない場合、同期前に正しい値で再設定し直す。推測で同期しない |

**記録先**：デプロイIDや内部Script IDを含む実値は非公開の作業記録に保存し、この公開GitHubリポジトリには完了／未完了だけ記録する。

**完了判定**：旧デプロイの具体的な数字のバージョン番号、URL一致、復旧方法、同期先Script IDの一致を確認するまで、`SYNC` 実行と既存Webアプリの新バージョン公開に進まない。

## 4. 推奨する実行手順

| No. | 対象 | 実行内容 | 通過条件 |
|---|---|---|---|
| 0 | GitHub | PR #2の競合解消、テスト成功、差分とSHAの最終確認。PRはマージ直前までdraft保持でも可 | `mergeable=true`、全CI成功 |
| 1 | 運用 | CSV作成・更新の新規開始を一時停止し、進行中のGAS実行と画面操作がないことを確認 | 実行中ゼロ |
| 2 | 復旧材料 | 旧main SHA、GAS旧デプロイ版、DataStore/管理シートのスナップショットを記録・保持 | 旧版へ戻す手段あり |
| 3 | GASソースのみ | [Central API sync to GAS](https://github.com/tsicb/valid-app/actions/workflows/central-api-sync.yml) を **最終確認済みfeatureブランチ** で手動実行。入力`confirm=SYNC`。**本番GAS**のScript IDを事前確認 | Actions成功、実行SHA一致、公開Web Appは旧版のまま |
| 4 | GAS公開 | 本番Apps Script → **デプロイ → デプロイを管理** → 既存Web Appを編集 → **新しいバージョン** → デプロイ。旧デプロイURLはそのまま | `/exec`のGETで`IDENTITY_V1`・APPEND/REPLACEが確認できる |
| 5 | GitHub Pages公開 | ブランチとmainの差分を最終確認し、PR #2をmainへマージ。GitHub Pagesの更新が完了するまで待ち、GitHubのDeployments/ActionsまたはSettings → Pagesで状況を確認 | `index.html`が新版を表示し、`append-identity-v1.js`が読み込める |
| 6 | 公開後確認 | 既存レポート閲覧、認証、CREATE、APPEND、REPLACEの基本動作を限定したテスト会社で確認する | 下記表の全項目が正常 |
| 7 | 運用再開 | テスト結果と切替前後のバージョン・Git SHAを記録し、利用者に再開を案内 | 不一致がないこと |

**補足**：もしPRマージに伴う競合解消でGASファイルに追加変更が入る場合、手順3の同期済みソースとズレるため、マージ前に同期し直す。中央APIソースの一致を確認せずにWeb Appを切り替えない。

Apps Script公式仕様では、既存デプロイの **新バージョン** へ更新すると元のデプロイIDとURLは維持される：
https://developers.google.com/apps-script/concepts/deployments

## 5. 本番公開直後の受入確認（本番の実応募データをテストしない）

| 範囲 | 操作・観察 | 合格基準 |
|---|---|---|
| API | 本番`/exec`をブラウザで開く | `schemaVersion=3.0`、`capabilities.incrementalUpdate.updateProtocol=IDENTITY_V1` |
| 管理画面 | 新規`index.html`で社内アクセスキーを認証 | 認証成功・capability不一致なし |
| 管理画面 | 既存企業の更新画面を開く | 差分追加が初期値、REPLACE確認チェックあり |
| 管理画面 | 求人突合0件の架空CSVを使用 | 警告は更新同意モーダル内、**同意前にreportタブが開かない** |
| データ | **本番配下に限定的な検証会社**を架空CSVだけで新規作成 | 7件・求人2件、DataStore `applicationIdentityVersion=1` |
| データ | 部分重複APPENDと同一CSV再APPEND | 7→10件（+3）、再追加0件、既存求人時給を維持 |
| 閲覧 | 公開前から存在する共有済みreport URL（閲覧のみ） | 同じViewer tokenで閲覧できる |
| その他 | 既存の企業管理シートの共有・表示設定・マスタ（読み取り中心） | 既存設定が保持される |

本番配下にテスト会社を追加できない運用の場合、データ作成の試験は隔離GASでの既実施結果を採用し、本番ではAPI・管理画面・既存レポートの**読み取り中心**の動作確認に限定する。実顧客の応募・求人データを故意に全件入れ替えて試験しない。

旧形式の既存会社では、最初のAPPENDが`MIGRATION_REQUIRED`で停止することは**仕様**。完全な過去CSVが揃っていることを確認してから初回REPLACEする。自動的に既存データを削除しない。

## 6. 切替時の新旧組み合わせと対処

| フロント | GAS Web App | 状態 | 対処 |
|---|---|---|---|
| 旧 | 旧 | 現在の本番 | 公開前はこれ |
| 旧 | 新 | **一時的にUPDATEを拒否**。既存レポート閲覧は原則継続 | CSV作成・更新を一時休止し、速やかにPagesを切替 |
| 新 | 旧 | 新UIのcapability判定でETLが進められない | この公開順序を避ける |
| 新 | 新 | 目標状態 | 検証して運用再開 |

既存のタブを開きっぱなしの利用者には、旧`index.html`からのUPDATEが拒否されるため、改めてページを開き直してもらう。必要なら強制再読み込みを案内する。

## 7. 異常発生時の中止・戻し方

**基本方針は「データ保全 > 画面の迅速復旧」。更新確定後に無条件で古いGASへ戻さない。**

| 発生段階 | 推奨対応 |
|---|---|
| GASソース同期前 / PR競合が解消できない | 何も公開せず延期 |
| GASソース同期済み、既存Web Appが旧版のまま | 公開影響なし。ソースやPRを修正してから仕切り直す |
| 新GAS公開後、Pagesはまだ旧版 | 新Pagesまで進めて整合させる。継続不能なら既存Web Appのデプロイ先を**記録済み旧バージョン**へ戻す |
| 新Pages公開後、まだ新方式で書き込みなし | Pagesを旧main SHA相当へ戻し、Web Appを旧バージョンに戻す。両方の整合を確認してから書き込み再開 |
| 新方式でCREATE/APPEND/REPLACEが既に実行された後 | **書き込み停止**。DataStore/管理シートの変更有無と最新保存ファイルを確認。旧GASは全件上書き前提のため、安易に戻すと新方式の差分データを失い得る。可能なら前進修正し、必要なら独立バックアップから慎重に復旧する |
| 共有レポート閲覧だけが壊れた | 同じViewer tokenでの読み取り経路とGAS実行履歴を先に確認。トークンの再発行・共有URLの変更は最終手段 |

GitHub Pagesの差し戻しは、`main`の過去コミットを**revertする新コミット**など、履歴が追える方法を使う。`main`をforce-pushしない。

Apps Scriptデプロイは**削除しない**。既存デプロイの向き先を旧バージョンへ切り替えることで、同じ`/exec` URLを保持できる。旧Web Appソースへ戻しても、新版で書かれたDataStoreの整合は別問題なので、必ず確認する。

## 8. 監視・完了条件

- 切替直後：API/Pagesの対応、社内アクセスキー、少なくとも1つの既存Viewer token閲覧、限定的な架空CSVテストを確認する。
- 初回の実運用更新が発生した会社では、`99_内部状態`、`98_運用ログ`、DataStoreの実保存件数、求人マスタ件数、バックアップファイルIDを照合する。
- `MIGRATION_REQUIRED` は旧DataStoreでの想定内の拒否。予期せぬ `AUTH_INVALID`、`UPDATE_PROTOCOL_REQUIRED`、`REQUEST_PAYLOAD_MISMATCH`、DataStore検証エラーは調査対象。
- HMAC用Script Propertyは一度設定されたら変更・削除せず、ローテーションは別途移行設計を立てる。
- 公開後の版・Commit SHA・GAS deployment version・トラブル有無を記録し、`docs/CURRENT_STATE.md` と必要に応じて `central-api/RELEASE_CHECKLIST.md` の現行運用欄を更新する。

## 9. 本番公開前に残す判断

1. ~~PR #2のマージ競合解消とCIの再実行~~（2026-10-26完了。公開直前のHEAD確認は継続）。
2. 本番App Scriptプロジェクトの現在の公開バージョン・Deployment IDの控え。
3. DataStoreの独立バックアップ方法・保持場所の確定。
4. 社内利用者への一時的なCSV作成／更新停止の案内と切替タイミング。
5. 公開後の限定的な架空CSVテストの扱い（本番にテスト会社を作成するか、読み取り確認のみとするか）。

これらが揃うまでは **本番切替を開始しない**。

関連文書：
- `docs/INCREMENTAL_LIVE_TEST_RUNBOOK.md`（隔離テストの実施結果）
- `docs/APPEND_UPDATE_IMPLEMENTATION_PLAN_V1.md`（統合仕様）
- `central-api/RELEASE_CHECKLIST.md`（従来版の確認項目。今回の公開完了記録とは区別する）
