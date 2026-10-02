# Pages v30.41 / Central API v2.46 / Image Worker v2 Release Checklist

今回の差分はCentral APIのみです。Pages / Workerの再デプロイは不要です。

- [x] Central API v2.46 ソースをGitHubへ反映
- [x] GAS構文チェック
- [x] SOURCE_SHA256SUMS.txt照合
- [ ] GitHub Actions「Central API sync to GAS」を手動実行
- [ ] Apps Script側のソースがv2.46になったことを確認
- [ ] 既存Web App deploymentをv2.46へ更新
- [ ] 既存企業を1件更新し、30_分析レポート初期設定にカスタム分析4項目が追加されることを確認
- [ ] 行軸1～3／列軸を変更し、report再読み込みで初期表示へ反映されることを確認
- [ ] 31_分析レポート表示項目でOFFの軸を設定した場合、安全な軸へフォールバックすることを確認
- [ ] 既存の34_カスタム分析設定が非表示のまま維持されることを確認
