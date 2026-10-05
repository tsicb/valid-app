# Pages v30.42 / Central API v2.47 / Image Worker v2 Release Checklist

今回の機能差分はPages + Central APIです。Image Workerの再デプロイは不要です。

- [x] Pages v30.42 ソースをGitHubへ反映
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
