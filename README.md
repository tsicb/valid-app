# 有効応募分析 / valid-app

社内の営業担当が求人・応募CSVから個社管理シートと分析レポートを作成・更新し、分析レポートだけを企業共有できるツールです。

## 入口

既存企業では **個社管理シートを企業ホーム**として使います。

- 分析を見る -> 個社管理シートから分析レポート
- データを更新する -> 個社管理シートから更新用 `index.html`
- 設定を変える -> 個社管理シート内の設定・マスタ

新しい企業は、新規作成用 `index.html` から個社管理シートを作成します。

## 応募・求人データの更新（2026-10-26本番公開）

既存企業の個社管理シートの「データを更新する」から、更新方法を選びます。

- **差分追加（APPEND）**：既存応募を保持し、新しい応募のみ追加。応募の重複を識別キーで判定し、求人マスタの既存情報も保持。
- **全件入れ替え（REPLACE）**：今回のCSVで応募・求人分析データを作り直す。初回移行や正式訂正用。過去応募を消したくない場合は選ばない。
- **旧形式の初回更新**：旧DataStoreで最初のAPPENDが `MIGRATION_REQUIRED` になるのは仕様。完全な過去応募CSVを用意し、初回のみREPLACEしてidentity v1へ移行する。
- **共有レポート**：原則として個社管理シートから確認。既存の共有Viewer URLは更新後も維持。

本番GASは**Web App v60**、GitHub Pagesのリリースmerge commitは `c68346af`。公開・受入結果と復旧手順は [本番公開手順書](docs/INCREMENTAL_PRODUCTION_RELEASE_RUNBOOK.md) に記載しています。

## Repository map

- `index.html` - データ作成・更新
- `report.html` - 分析レポート（企業共有可能な終点）
- `analysis-core.js` - 分析ロジック
- `common-masters-v1.js` - 共通マスタ
- `central-api/` - Google Apps Script Central API の正本ミラー
- `cloudflare-worker/` - Tenichi TOP画像取得Workerの開発ソース
- `docs/ARCHITECTURE.md` - システム構成・責務
- `docs/ANALYSIS_AXIS_AVAILABILITY.md` - カスタム分析30軸の取得元・利用可能条件・テスト観点
- `docs/CURRENT_STATE.md` - 現在のリリース状態・直近設計
- `docs/DEPLOYMENT.md` - 反映順・確認手順
- `AGENTS.md` - AI/開発者向けの変更ルール

## Current repository baseline

- Pages: **v30.45**
- Central API source: **v2.47**
- Image Worker: **v2**
- Spreadsheet schema: **3.0**

Central APIの15本の `.gs` は、現行Apps Scriptから共有されたソースとコード内容が一致することを確認したうえでGitHubへミラーしています。リポジトリではLF改行を正規形とします。

詳細と「何が現在の正本か」は `AGENTS.md` と `docs/CURRENT_STATE.md` を参照してください。
