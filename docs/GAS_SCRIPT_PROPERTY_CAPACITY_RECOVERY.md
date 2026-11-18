# Script Properties 容量超過の復旧手順（2026-11-18）

## 確認済みの障害

- 新規作成した個社管理シートの非表示 `98_運用ログ` に `DATA_CREATE / ERROR`。
- GASの内部エラー文字列は「プロパティの保存容量の上限を超えています。一部のプロパティを削除してから、もう一度お試しください。」。
- 同じスプレッドシートは「シート1」「98_運用ログ」のみで、初期作成の途中で停止。
- CSVの登録条件が原因であるという根拠はない。ページを閉じずに再現している。
- 2026-11-18の読み取り専用診断で、推定総量529,153 bytes（500 KiB基準で103.4%）、`REQ_` 137件が480,464 bytes（90.8%）を占有することを確認。`REQ_`内はREADY 133件、ERROR 4件、処理中0件、有効リース0件、作成から30日超94件。実際の削除適格性はまだ未検証。

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

## フェーズ2：削除する前の容量回復シミュレーション（読み取り専用）

対象関数：`vaaPreviewOldReadyRequestCleanupReadOnly`

**フェーズ1で容量超過を確定したため、こちらの事前計画を追加。実際の削除処理ではありません。**

この関数は現在のScript Propertiesを1回だけ読み、次の条件に適合する過去の`REQ_`記録を抽出した場合、容量がどの程度改善するかを**計算するだけ**です。

- `REQ_`プレフィックスの記録で、JSONが正常に読める。
- `status=READY`かつ`stage=READY`。
- 作成から30日以上経過している。
- 処理リースが空白または期限切れである。不正な日時のリースは対象外。
- 記録内の`requestId`とキーが一致している。
- 保存先Spreadsheet IDが存在し、CREATE/UPDATEの既知の種類である。
- ERROR/処理中/新しい記録、構造不明な記録は候補から外す。

出力は、候補件数と容量、対象外の理由別件数、古い順に整理した場合に**使用率75%まで下げるための仮の件数・削減見込み容量・整理後の推定使用率**です。CREATE/UPDATE別にも件数を集計します。キー名・ID・値は公開しません。

### 実行手順

1. 当該PRのCIが成功して`main`に反映されたら、[Central API sync to GAS](https://github.com/tsicb/valid-app/actions/workflows/central-api-sync.yml) を`main`、`SYNC`で手動実行する。
2. Apps Scriptエディタで `vaaPreviewOldReadyRequestCleanupReadOnly` を実行する（公開Webアプリの再デプロイは不要）。
3. 実行ログの `VAA_REQUEST_CLEANUP_PREFLIGHT_READONLY` のJSONのみ共有する。
4. 候補が十分あることと推定削減量を確認した後、バックアップ・冪等性保護・排他ロック・実行上限・事後検証を含む**別の削除計画**を承認する。

**注意：古い`REQ_`は「処理の完了記録」であり、削除すると過去のrequestIdの再送を新規処理と解釈する可能性があります。** 30日経過・READYであっても、そのまま消してよいという意味ではありません。この段階では`deleteProperty`は一度も呼びません。

## フェーズ3：READY履歴を削除せずに容量回復できるか診断

2026-11-18の`vaaPreviewOldReadyRequestCleanupReadOnly`の結果：

- 現在の推定使用量：529,155 bytes（103.4%）。
- 30日以上前のREADY記録で、削除対象としての検討条件を満たしたものは93件（合計321,206 bytes）。
- そのうち古い順に46件を削除する**仮のプラン**では149,559 bytes削減し、74.1%まで下がる見込み。
- **削除は未実施。** 古いrequestIdを再送した際の二重処理防止を維持するため、削除以外の方法を優先評価する。

新しい読み取り専用関数：

`vaaPreviewReadyRequestPerformanceCompactionReadOnly`

旧READY記録には、応答のタイミング計測等を保持した`performance`オブジェクトがある。これだけを削除した仮の値をメモリ上で作成し、保存容量の差を集計する。実データの変更はない。

候補の条件は、30日以上経過、`status=READY / stage=READY`、リースなし、キーとrequestId一致、保存先Spreadsheet IDあり、既知CREATE/UPDATE方式、`performance`データあり。処理中・ERROR・日付不明などは対象外。

結果は、対象レコード数、全候補の容量削減見込み、推定使用率75%まで減らすとした仮の件数、実現可否のみを集計し、秘密情報は出さない。

**重要：** この方法なら、保存先情報・updatePayloadDigest・updateStrategy・requestIdなどの重複処理防止情報を残したまま、詳細な処理性能情報のみを縮小できる可能性がある。ただし再送時の`performance`情報は一部欠け得るため、実際の縮小は別PRでバックアップ・実行前後検証・操作承認を経て実施する。

### 実行

1. PRをマージ後、[Central API sync to GAS](https://github.com/tsicb/valid-app/actions/workflows/central-api-sync.yml) で`main` / `SYNC`を実行する。
2. Apps Scriptエディタで`vaaPreviewReadyRequestPerformanceCompactionReadOnly`を1回実行する。
3. ログの`VAA_PERFORMANCE_COMPACTION_PREFLIGHT_READONLY`から始まるJSONだけを確認する。
4. `canReachTargetWithPerformanceOnly`がtrueなら、削除ではなく小容量の値へ置換する方式を優先検討する。falseなら別の安全な保存先移行や限定削除を検討する。

## フェーズ4：実際の縮小処理（準備中・まだ実施しない）

実測のperformance縮小試算：
- 30日以上前のREADYのうち、性能計測情報を縮小できる記録：86件。
- 縮小できる容量総量：222,976 bytes。
- 75%を達成する仮プラン：55件（CREATE 20件、UPDATE 35件）、146,774 bytesの削減、推定382,381 bytes（74.7%）。

[安全な縮小処理ソース](../central-api/16_Ready_Receipt_Recovery.gs) を別PRで準備する。**この段階ではスクリプトソースを書いただけで、本番の書換えは行っていない**。

安全のため、GASエディタからの**3段階の明示的な管理者操作**に分離した。

1. `vaaPrepareReadyPerformanceCompactionBackup`：Script Propertiesを読み込み、候補を再計算。まず実行者のマイドライブ直下に**空のバックアップファイル**を作り、非公開であることを検証してから、縮小対象の元の記録を格納・SHA-256検証。管理者のUser Propertiesに短時間有効な作業計画を保存。**Script Propertiesは変更しない**。
2. `vaaAuthorizeReadyPerformanceCompaction`：同じ実行者がバックアップの非公開状態とハッシュを検証し、計画に対して承認フラグをUser Propertiesへ保存する。**Script Propertiesは変更しない**。
3. `vaaCommitReadyPerformanceCompaction`：同じ実行者が明示的に実行したときに限り、ScriptLock取得、準備時の全Script Propertiesスナップショット・候補順序・元の値を完全照合し、古いREADY記録の`performance`部分だけを`setProperty`で縮小。各書込後に読戻し、最終的な件数と容量を検証。**Script PropertiesのdeletePropertyは呼ばない**。

- バックアップには元の`REQ_`保存情報（個社シートID等を含む）が格納される。**バックアップファイルの共有・公開・チャット添付は禁止**。ファイルは実行者のマイドライブに非公開のまま保持する。ファイルIDは診断ログに表示しない。
- 計画の有効期限は2時間。準備から実行までの間にどのScript Propertyでも変化があれば**変更は0件で停止**し、再準備が必要。
- 途中エラーでは自動で削除・ロールバックせず、バックアップを残して即停止する。容量上限超過状態では**元の値への一括復元ができるとは限らない**。中断後は個別に復旧計画を検討する。
- Googleの上限の扱いによっては、推定容量が上限を超えている間、**値を小さくするsetPropertyさえ拒否される可能性**がある。成功を保証しないため、バックアップの確保を必須とする。
- `REQ_`の元のrequestId・保存先・更新方式・ダイジェスト・共有情報・ステータス・件数を残すことで、古いrequestId再送の重複処理防止を維持する。
- 応答に含まれる性能計測値のみ、過去の記録の再送時には`{}`に変わる可能性がある。シート・DataStoreに保存済みの応募情報は変更しない。
- この処理は自動定期実行でもWeb Appの通常ルートでもなく、Apps Scriptエディタからの手動操作限定。公開Web Appの再デプロイは不要。

**重要：このPRのコードがCIに通っても、利用者の明示的な承認を得るまで本番へGAS同期しない。** 先にバックアップや縮小関数を実行することもしない。

縮小に成功したら、再度 `vaaAuditScriptPropertyCapacityReadOnly` で容量を確認し、500件の件数基準より先に容量が一杯になる現行の`pruneRequestProperties_`の再発防止設計を別工程で行う。

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

## フェーズ5：COMMIT が 0 件で停止した場合の読み取り専用調査（2026-11-18）

実行ログ `VAA_COMPACTION_HALTED {"appliedCount":0,...}` と
`VAA_COMPACTION_STOPPED_AFTER_0_UPDATES_CHECK_LOG_AND_PRIVATE_BACKUP` が出た。

- `appliedCount=0` は「書込み後の読戻しまで完了した件数が0」であり、最初の `setProperty` が成功して読戻しで失敗した可能性は残る。
- 既存の `vaaCommitReadyPerformanceCompaction` は内部の例外を安全のため一律メッセージに置き換えるため、このログだけでは原因確定できない。
- **COMMITの再実行、Script Propertiesの手動削除、非公開バックアップの削除、バックアップ内容の共有は禁止。**
- 旧承認は再実行の承認ではない。新たな縮小案には別の確認・承認を要する。

追加した読み取り専用関数：
`vaaAuditStoppedReadyPerformanceCompactionReadOnly`
（`central-api/17_Ready_Receipt_Halt_Audit.gs`）。

当該PRのテスト成功・マージ後にCentral API syncを `main` / `SYNC` で実行し、
既存のGASエディタでこの関数だけを手動実行する（Webアプリv61の再デプロイ不要）。
ログ `VAA_COMPACTION_HALT_AUDIT_READONLY` のJSONだけ共有する。
ファイルURL・ID・スクリプトプロパティ名と内容は一切共有しない。
この関数はScript/User PropertiesもDriveファイルも書き換えない。

主な判定：

- `SNAPSHOT_CHANGED_SINCE_PREPARE_DO_NOT_RETRY`：
  55件に触れていなくても他のScript Propertyが変わっている。事前計画の再利用不可。
- `TARGET_WRITE_DETECTED_DO_NOT_RETRY`：
  0件と表示されても対象の一部が縮小済み。再実行不可。
- `PREWRITE_REVALIDATION_FAILED_DO_NOT_RETRY`：
  書込み前の計画照合に失敗。診断・コード修正を優先。
- `PREWRITE_CHECKS_PASS_FIRST_WRITE_OR_READBACK_FAILURE_SUSPECTED`：
  スナップショット・対象・計画を再検証できるが、最初の書込みもしくは読戻しで停止した疑い。
  容量超過による `setProperty` 拒否は一候補であり、この診断だけでは確定しない。
- `BACKUP_DIGEST_MISMATCH` など：
  バックアップ整合性を優先調査し、縮小を行わない。

計画の期限（準備から2時間）が切れてもこの監査は読み取り専用で実行可能。
ただし新たなCOMMITは不可。容量回復手段の選択は監査結果と現行の
`vaaAuditScriptPropertyCapacityReadOnly` を踏まえた別工程とする。
