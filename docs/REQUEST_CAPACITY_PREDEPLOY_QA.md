# PR #16 本番適用前の隔離GAS検証手順

更新：2026-11-18。ステータス：準備中。**QA同期・QAデプロイ・本番同期・本番デプロイは未実施。**

## 既に確認したこと

- PR #16はコミット `3528fe2de4b6dee0f46f611f6f45ed2f075a2cab` でmainにマージ済み。
- mainへのマージ後 `Central API check` が成功。JavaScriptテスト193件、Pythonテスト4件、GAS構文検査とSHA256検証が成功。
- 対象機能は(1)新規開始前の容量90%/24KiBバッファ、(2)REQレシートの保存時performance除外、(3)各REQ書込み前のbyte投影、(4)危険な古いREQ自動削除の停止、(5)Drive確認不能・REQ破損時のfail-closed。
- 以上はリポジトリ上の模擬テスト結果であり、実際のGAS/Driveの結合試験完了を意味しない。

## QA環境の安全条件

1. **専用の独立したTEST Apps Scriptプロジェクト**を用意する。現在の本番Script IDとは異なること。
2. テスト用ルートDriveフォルダとテスト用出力フォルダを別途用意し、本番ROOT/OUTPUTフォルダ、その配下のフォルダ、共有運用フォルダを利用しない。2つのテストフォルダのIDは互いに異なるものとする。
3. TEST Script Propertiesにはテスト用ACCESS_KEY/SCHEMA_VERSIONだけを設定する。**本番のACCESS_KEY・HMAC秘密値・Viewerトークン・REQ履歴・個社データを複製しない**。テスト用アクセスキーは別管理。
4. TEST Apps Scriptプロジェクトは専用のテスト作業者だけが編集できるようにし、送信CSVも架空の企業・応募情報だけとする。
5. GitHub Actionsの`CLASPRC_JSON`はプロジェクト同期の認証用であり、ワークフローは本番Script IDとの一致を拒否する。ただしID比較だけではフォルダの親子関係までは検証できないので、操作前に人間がテスト専用であることを確認する。

## 追加した手動ワークフロー（実行はまだしない）

- `.github/workflows/isolated-main-gas-qa-sync.yml`
- アクション名：`Isolated main GAS QA source sync`
- `Run workflow` ブランチは`main`のみ、`expected_sha`は実行時の**main HEADの40桁SHAと完全一致**する値。
- 他入力：`test_script_id`、`test_root_folder_id`、`test_output_folder_id`、`confirm=TEST_ONLY`。
- ガードはTEST Script ID≠本番ID、テスト用フォルダ識別子の形式、既知の本番フォルダID使用禁止、`central-api/*.gs`のテスト用フォルダ差替えの検証、全Nodeテスト/JS構文/SHA256、既存TESTプロジェクトのappsscript.json保持。
- 成功時は**テストGASのソース同期のみ**（`clasp push --force`）。Web Appのデプロイは行わず、本番GASプロジェクトと本番Script Propertiesは変更しない。
- ブランチやコミットSHAが違う場合は同期開始前に停止する。TEST_SCRIPT_ID/DriveフォルダIDはチャットやCIログにそのまま貼らない。

## 合格条件と順序

| ゲート | 内容 | 合格条件 | 本番への作用 |
|---|---|---|---|
| G0 | main自動テスト | 193 Nodeテストと4 Pythonテスト・構文・SHA成功 | なし |
| G1 | TEST GASへソース同期 | 指定TESTのみ、デプロイなし、TESTのappsscript.json保持 | なし |
| G2 | TEST GASの読み取り専用監査 | `vaaAuditScriptPropertyCapacityReadOnly`を実行、QA用プロパティだけが計測される | なし |
| G3 | TEST専用Web Appを手動でテスト版公開 | URL/資格情報は非公開、テストフォルダのみ使用 | 本番なし |
| G4 | 模擬CREATEと同一requestId再送 | CREATE 1回のみ、再送はreused READY・追加シート0件 | 本番なし |
| G5 | 模擬UPDATE APPEND/REPLACEと再送 | 正常更新、同一requestId再送の重複更新なし、digest/strategy相違は拒否 | 本番なし |
| G6 | 不正REQ、Drive確認失敗、容量不足 | 当該ケースでは追加CREATE/UPDATEなし、既存REQ削除なし、識別可能な安全エラー | 本番なし |
| G7 | リリース判断 | 独立結果を監査・承認し、初めて本番ソース同期/デプロイを検討 | 要別途承認 |

G6で容量不足を作る場合は本番Script Propertiesへ大きなダミー値を書かない。既存Nodeテストによる容量境界検証を基本とし、TEST Apps Scriptだけで可能な方法を別途設計して実行する。

## 停止条件

- 指定したTESTフォルダが本番と接続する、TEST Script IDが本番IDと等しい、別アカウントの共有設定が不明、QAのプロパティに本番シークレットが存在する場合は停止。
- GAS同期でテスト版以外のソース・マニフェストが変更された、`index.html`が想定外に変化した、Viewer/Report登録の副作用が本番に届いた可能性がある場合は停止。
- テストCREATEでシートができたのにREQ状態更新が失敗した場合は同じrequestIdで再CREATEせず、ファイルの存在・レシートを照合する。
- G0〜G6は本番デプロイを認可しない。本番への切替と復帰手順は別工程で明示的な承認を取る。

## 失敗した過去の本番CREATEについて

元の未完成個社シート（例：シート1、98_運用ログ）の所在・元requestIdの記録を照合するまで、容量が回復していても同じCSVを新規CREATEとして繰り返さない。QAでは必ず合成データを使う。
