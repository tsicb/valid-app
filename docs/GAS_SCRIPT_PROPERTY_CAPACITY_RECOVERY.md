# Script Properties 容量超過の復旧手順（2026-11-18）

## 確認済みの障害

- 新規作成した個社管理シートの非表示 `98_運用ログ` に `DATA_CREATE / ERROR`。
- GASの内部エラー文字列は「プロパティの保存容量の上限を超えています。一部のプロパティを削除してから、もう一度お試しください。」。
- 同じスプレッドシートは「シート1」「98_運用ログ」のみで、初期作成の途中で停止。
- CSVの登録条件が原因であるという根拠はない。ページを閉じずに再現している。
- 今回のログだけでは、`REQ_` と `RPTREG_` / `VIEWER_` 等のどれが容量を占めているかは未確認。

## フェーズ1：読むだけの安全な容量診断

目的：どの種類のScript Propertiesが合計容量を使用しているかを把握し、具体的な削除候補を**確定する前**に状況を記録する。

診断ソース：`central-api/15_Property_Capacity_Diagnostics.gs`

関数：`vaaAuditScriptPropertyCapacityReadOnly`

この関数の性質：

- **読み取り専用**：`PropertiesService.getScriptProperties().getProperties()`を1回呼ぶだけ。書込み/削除/Driveアクセス/シート更新/API送信/トリガー変更はしない。
- `REQ_`、`RPTREG_`、`VIEWER_`、`VAA_TARGET_UPDATE_`、保護設定、システム設定、その他を集計。
- 種類ごとに件数、UTF-8キー容量・値容量・最大値容量を表示。
- `REQ_`のREADY/ERROR/その他、30日・90日以上の記録、処理中リース数、および30日以上経過した完了/エラー記録（候補件数のみ）を表示。
- **秘匿情報は出力しない**：プロパティキー名の実値、保存値、認証トークン、シートID、企業名、requestId、エラー本文は返さない。
- 合計容量はUTF-8のキー＋値の**概算**。Google内部の課金バイト数を完全に再現する保証はない。
- 容量制限の参考値は500 KiB/ストア、9 KiB/値。最新の正式値はGoogle Apps Script quotasで確認。

### 実行手順

1. GitHub PRの自動テストとSOURCE_SHA256SUMS.txtの一致を確認する。
2. PRを`main`へマージし、[Central API sync to GAS](https://github.com/tsicb/valid-app/actions/workflows/central-api-sync.yml) を実行する。対象は`main`、確認入力は`SYNC`。
3. 同期成功後、**現在のGASプロジェクトのApps Scriptエディタ**を開く。新しいGASバージョン・Webアプリのデプロイは不要（エディタで実行するだけ）。
4. 関数セレクタで`vaaAuditScriptPropertyCapacityReadOnly`を選び「実行」。権限を求められた場合は利用者の運用基準に従い判断する。
5. 実行ログの`VAA_PROPERTY_CAPACITY_READONLY`から始まるJSONを確認・共有する。キー・値の生データやApps Scriptの「スクリプト プロパティ」一覧画面は共有しない。
6. 容量内訳・古いリクエスト候補数を確認してから、対象限定・バックアップと再検証付きの整理処理を**別工程で**計画する。

> ソース同期は編集ソースのみを更新し、公開中のGAS Web App v61には自動反映されない。復旧診断では公開版の変更は不要。

## フェーズ2：結果が出てから実施すること

- 容量の主要因を判定する。特に`REQ_`系が大きい場合は既存`pruneRequestProperties_`が「setPropertyより後に走る」ことが再発要因になり得る。
- `VIEWER_`（共有URLの対応関係）、`RPTREG_`（レポート登録）、`ACCESS_KEY`、`VAA_APPLICATION_IDENTITY_HMAC_V1`、進行中のUPDATEリースは削除候補から除外。
- 削除対象は**十分古い、完了/失敗リクエストのうち必要性を検証したもののみ**。30日経過は集計上の候補条件であり、自動削除を許可する条件ではない。
- 安全な整理を行った後に**同じリクエストの復旧要否**を判断し、失敗した作成が重複しないよう保存結果を検証する。
- 記録の「最大500件」という件数だけでなく、全体のバイト数を基準にして保存前に余裕を作る改善を検討。
- 復旧確認まで、同じCSVの新規作成ボタンを繰り返さない（空のシートが増える可能性がある）。

## セキュリティ注意

- Script Properties画面をスクリーンショットで公開・共有しないこと。アクセスキーや共有URL管理の秘密情報が含まれる可能性がある。
- 認証情報、トークン値、HMACキー、Drive ID一覧のエクスポートをGitHub、チャット、スプレッドシートに保存しない。
- 診断関数は **deleteProperty / setProperty を一切呼ばない**。プロパティの削除やWeb Appデプロイは別の明示的な工程にする。
