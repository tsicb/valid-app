# Pages v30.43 / Central API v2.47 / Image Worker v2 Release Checklist

今回の機能差分はPages + Central APIです。Image Workerの再デプロイは不要です。

- [x] Pages v30.43 ソースをGitHubへ反映
- [x] GitHub Pages build / deploy成功
- [x] Central API v2.47 ソースをGitHubへ反映
- [x] GAS構文チェック
- [x] SOURCE_SHA256SUMS.txt照合
- [ ] GitHub Actions「Central API sync to GAS」を手動実行
- [ ] Apps Script側のソースがv2.47になったことを確認
- [ ] 既存Web App deploymentをv2.47へ更新
- [ ] 性別列を含む応募CSVで個社シートを更新し、applicationDataに性別が保存されることを確認
- [ ] reportの「求職者」内に「性別」が表示されることを確認
- [ ] 女性 / 男性 / 未回答 / 空欄が別カテゴリとして集計されることを確認
- [ ] 総応募数 → ターゲット応募数 → 日本語文字順の一般カテゴリソートを確認
- [ ] 氏名文字種区分も同じ一般カテゴリソートになっていることを確認
- [ ] カスタム分析で「性別」を行軸・列軸に選べることを確認
- [ ] 性別ヘッダーを持たない旧DataStoreでは性別分析が出ないことを確認

## Pages v30.43 入力CSV確認

- [ ] UTF-8 BOMの応募CSV_Aを正常に読み込める
- [ ] Shift_JIS/CP932の応募CSV_Bを正常に読み込める
- [ ] 応募CSV_A / CSV_Bを同時選択してもcanonical化後に処理できる
- [ ] CSV_Bの `応募先企業ID` が企業IDとしてJOINに利用される
- [ ] CSV_Bの `応募者対応ステータス（企業）` / `MAIL` / `応募媒体名` が既存分析項目へ反映される
- [ ] 性別が `男性` / `女性` / `未回答` / `不明` に正規化される
- [ ] CSV_Bの `都道府県` と `住所` が同名ヘッダー衝突を起こさない
