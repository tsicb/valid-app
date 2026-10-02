# Central API v2.46 - custom analysis defaults

## Purpose

個社管理シート側で、企業へ共有する分析レポートのカスタム分析初期軸をあらかじめ設定できるようにします。

## User-facing settings

`30_分析レポート初期設定` に次の4項目を追加・維持します。

- `カスタム分析 行軸1`
- `カスタム分析 行軸2`
- `カスタム分析 行軸3`
- `カスタム分析 列軸`

新規作成時の初期値は、行軸1=`対応状況`、行軸2/3=空欄、列軸=`応募媒体` です。

## Behavior

- report側は既存の3段行軸機能をそのまま利用し、Pagesの変更は不要です。
- Viewer dataでは `rowAxes` 配列と `colAxis` を返します。
- 行軸は最大3つまで。重複軸は除外します。
- `31_分析レポート表示項目` でOFFになっている軸、または利用不能な軸は安全な候補へフォールバックします。
- 仕事名KW系の軸は、KWマスタに値があり、かつ該当表示項目がONの場合に候補となります。
- `給与区分` は給与系分析のいずれかがONの場合に候補となります。
- 30番シートのプルダウンには技術的に利用可能な軸を表示し、設定順序に依存しないようにします。実際のreport初期値として有効かどうかは、Viewer読込時の `31_分析レポート表示項目` を基準に判定します。

## Existing workbook migration

- 既存のhidden `34_カスタム分析設定` は削除しません。
- 30番シートに新しい4項目がまだ無い場合、34番の既存 `rowAxis` / `colAxis` を移行元として使用します。
- 30番シートが新しい正規の設定入口です。
- 34番シートは互換用ミラーとして更新し、hiddenのまま維持します。

## Compatibility

- spreadsheet schemaVersion 3.0据え置き
- Pages v30.41据え置き
- Viewer token / sharing / Fast Handoff / managed image / Range Picker等の既存仕様変更なし

## Deployment

この差分はCentral APIのみです。

1. GitHub Actions `Central API sync to GAS` を手動実行
2. Apps Script側ソースを確認
3. 既存Web App deploymentを新しいversionへ更新
4. 既存企業を1件更新し、30番シートに4項目が追加されることを確認
5. reportを再読み込みし、設定した行軸1～3・列軸で初期表示されることを確認
