# Central API v2.47 - gender analysis

## Purpose

応募CSVの `性別` を正式な応募者属性として取り込み、基本分析・カスタム分析・個社表示設定へつなげます。

## Data flow

- Pages v30.42 が応募CSVの `性別` を取得
- `applicationData` では `年代` の次、`氏名文字種区分` の前に保存
- 元値は加工せず保持し、現在の想定値は `女性` / `男性` / `未回答` / 空欄
- 空欄はreport表示時だけ `（空欄）` と表示

## Viewer / display settings

- `VIEWER_DISPLAY_DEFINITIONS_` に `gender` を追加
- 31_分析レポート表示項目では `性別ごと` としてON/OFF可能
- カスタム分析軸に `性別` を追加
- report上の見出しは `性別ごとの応募傾向`

## Sorting

性別は特別な固定順を持たせず、一般カテゴリと同じ規則を使います。

1. 総応募数 降順
2. ターゲット応募数 降順
3. 日本語文字順

`氏名文字種区分` も従来の固定順をやめ、同じ一般カテゴリソートへ統一します。

## Backward compatibility

- spreadsheet schema 3.0据え置き
- `SHEETS_APP_VERSION` / `EXPECTED_PAGES_VERSION` の内部互換値は据え置き
- `性別` ヘッダーを持たない旧applicationDataでは性別の基本分析とカスタム軸を表示しない
- 旧データを `（空欄）100%` と誤って見せない

## Privacy / help

indexの「データの取り扱い」に性別を追加し、応募傾向の分析項目として保存し、分析レポートでは集計表示に利用することを説明します。

## Deployment

1. Pages v30.42 はGitHub Pagesへ反映
2. GitHub Actions `Central API sync to GAS` を手動実行
3. Apps Script側でv2.47ソースを確認
4. 既存Web App deploymentをv2.47へ更新
5. 性別列を含む応募CSVで1社更新し、基本分析・カスタム分析・旧データ互換を確認
