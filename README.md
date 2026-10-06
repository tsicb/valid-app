# 有効応募分析 / valid-app

社内の営業担当が求人・応募CSVから個社管理シートと分析レポートを作成・更新し、分析レポートだけを企業共有できるツールです。

## 入口

既存企業では **個社管理シートを企業ホーム**として使います。

- 分析を見る -> 個社管理シートから分析レポート
- データを更新する -> 個社管理シートから更新用 `index.html`
- 設定を変える -> 個社管理シート内の設定・マスタ

新しい企業は、新規作成用 `index.html` から個社管理シートを作成します。

## Repository map

- `index.html` - データ作成・更新
- `report.html` - 分析レポート（企業共有可能な終点）
- `analysis-core.js` - 分析ロジック
- `common-masters-v1.js` - 共通マスタ
- `central-api/` - Google Apps Script Central API の正本ミラー
- `cloudflare-worker/` - Tenichi TOP画像取得Workerの開発ソース
- `docs/ARCHITECTURE.md` - システム構成・責務
- `docs/CURRENT_STATE.md` - 現在のリリース状態・直近設計
- `docs/DEPLOYMENT.md` - 反映順・確認手順
- `AGENTS.md` - AI/開発者向けの変更ルール

## Current repository baseline

- Pages: **v30.45**
- Central API source: **v2.47**
- Image Worker: **v2**
- Spreadsheet schema: **3.0**

Central APIの11本の `.gs` は、現行Apps Scriptから共有されたソースとコード内容が一致することを確認したうえでGitHubへミラーしています。リポジトリではLF改行を正規形とします。

詳細と「何が現在の正本か」は `AGENTS.md` と `docs/CURRENT_STATE.md` を参照してください。
