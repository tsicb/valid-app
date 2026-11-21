# 本番Webアプリ：次バージョンへの最短更新手順（2026-11-21）

## 次工程：カナリアの読み取り専用再利用証明（2026-11-21）

直前の本番カナリアは1回限りのCREATE成功（`READY:true`, `reused:false`）。終了後にOFFへ復帰（`VAA_PROD_CANARY_OFF pass:true`）、既存全体監査で`journalReady:2`、`journalPending:0`、`modernReadyWithoutReq:1`、`pass:true`。**カナリアは消費済みなので再送せず、既存のV2 READYから再利用可能であることを照合する。**

今回のGitHubソース追加はファイル `central-api/24_Request_Ledger_V2_Production_Gate.gs` のみ。最新CI [44857554443](https://github.com/tsicb/valid-app/actions/runs/44857554443) 合格。追加関数：

- `vaaLedgerProdCanaryReplayProofReadOnly`：本番GASエディタで実行する、現在設定済みCREATEカナリアIDだけの読み取り専用証明。V2 READY rev2・元REQなし・V1衝突なし・元の個社管理シートの存在とフォルダ・本番モードとScript Properties安定性をチェックする。**doPost・CREATE・UPDATE・ジャーナル予約は実行しない**。
- `vaaLedgerProdReadyRetireEnableAllNewOnce`：次の明示承認後に限る、通常の**新規**V2 READYに対するREQ自動退避をONにする管理関数。内部で上記証明と既存全体監査を実行し、1キーだけ変更。旧REQの削除はしない。現時点で**実行禁止**。
- `vaaLedgerProdReadyRetireDisableAllNewOnce`：ON後のOFF関数。稼働中のdoPostが終了してから使う。旧REQを消さず、V2のsticky gateは変更しない。

### 今回の人手操作（1回のSYNCと1回の読み取り専用関数）

1. GitHub Actions `Central API sync to GAS` を `branch=main`、`confirm=SYNC` で実行。変更は24番の1本のみ、26本完全一致、`VERIFIED_MATCH`、余分0を確認。同期で本番Webアプリの保存版v63は変わらない。
2. 本番GASエディタを新しく開き直し、`vaaLedgerProdCanaryReplayProofReadOnly` だけを実行する。
3. ログ `VAA_PROD_CANARY_REPLAY_PROOF` で `pass:true`、`replayEligible:true`、`canaryReady:true`、`canaryReqAbsent:true`、`v1Absent:true`、`targetVerified:true`、`sourceStable:true`、`propertyWrites:0`、`journalWrites:0`、`propertyDeletes:0` を確認。ID・Google Sheet URLは貼らず、集計ログだけ共有。
4. `pass:false` の場合、**POSTも退避ONもせず**、ログの`errorStage`/`errorCode` だけをもとに調査する。
5. 合格後、通常の新規CREATE/UPDATEのREQ退避を有効化するか、改めて判断する。`vaaLedgerProdReadyRetireEnableAllNewOnce` の実行は**今回には含まれない**。先行して実行しない。

これにより、本番での2回目の同一requestId POST（重複作成リスク）も、別の架空ファイル生成も不要。現行の一般CREATE/UPDATEと履歴の扱いは、この読み取り専用検証だけでは変わらない。

## 50件超のScript Propertiesを扱う管理関数（2026-11-21）

GASの設定画面では50個を超えるとリストが読み取り専用になるため、**GASエディタから管理関数を実行**して、設定キー1個だけを変更する。Script Properties自体が50件で停止するわけではない。

- `vaaLedgerProdRetireCanaryArmOnce`：`VAA_PROD_READY_RETIRE_MODE` を `OFF` → `CANARY_ONE_NEW_READY_V1` に変更。実行前に既存の `vaaLedgerProdRetireCanaryPreflightReadOnly` を内部から再検証し、本番V2有効・専用ID未使用・CREATE専用・旧移管OFF・管理範囲正常でなければ設定を変えない。ScriptLockで保護し、読み戻し検証を行う。同じ関数を2回呼んでも稼働中カナリアを勝手にOFFにしない。
- `vaaLedgerProdRetireCanaryOffOnce`：実際のCREATE処理が**完全に終了した後**、専用モードだけを `OFF` に変更。すでにOFFなら変更しない。全件退避モード等を上書きしない。失敗・通信断でもGAS実行中にOFFにしない。
- 両関数は `central-api/24_Request_Ledger_V2_Production_Gate.gs` の正規ソースに記録。ログは固定コード・件数・真偽値のみであり、ID、認証キー、REQ本体は出力しない。**REQの読み書き・削除、doPost実行は一切行わない**。
- 変更はエディタ専用管理関数の追加のみ。**公開済みWebアプリ v63 を新たにデプロイする必要はない**。Version 63の `doPost` はScript Propertiesを読んで動作する。
- GitHub Actions `Central API check` [run 44853321326](https://github.com/tsicb/valid-app/actions/runs/44853321326) で構文・ソース整合性・回帰テストが成功。管理コードを実行する前に `Central API sync to GAS` で `main` の正規ソースを1度だけ `SYNC` し、差分がファイル24のみ、追加/余分なスクリプトが0、実際のfresh pullで一致することを確認する。SYNCは本番Webアプリの既存デプロイには影響しない。
- 直近のGASエディタタブを閉じ、SYNC後は新規タブで読み直して管理関数を選択する。古いタブに保存・手書きの99_一時ファイル作成・任意のプロパティ一括表示ログは行わない。

管理関数を使った本番の最短操作順：
1. 正規ソースを上記SYNCで反映（本番v63 Webアプリはそのまま）。
2. GASエディタの関数一覧から `vaaLedgerProdRetireCanaryArmOnce` を手動実行する。ログ `VAA_PROD_CANARY_ARM` の `pass:true`、`enabled:true`、`propertyWrites:1`、`propertyDeletes:0`、`actualPostInvoked:false` を確認。 `pass:false` ならPOSTせず停止。
3. 管理者承認済みの [架空CREATE 1件専用画面](https://tsicb.github.io/valid-app/qa/production-canary-one-shot.html) から**1回だけ**送信。ID/ACCESS_KEYはローカル入力で、会話やGitHubに貼らない。
4. GAS実行が終了したことを確認後、エディタで `vaaLedgerProdRetireCanaryOffOnce` を手動実行する。 `VAA_PROD_CANARY_OFF` の `pass:true`、`off:true`、`propertyDeletes:0` を確認。
5. 既存 `vaaLedgerProdReadyRetirePreflightReadOnly` でV2 READYのREQ未保持・台帳整合性・保留0・書込0を確認する。失敗や応答不明なら同一IDを再送しない。

この関数方式は「Properties画面の50件制限」を迂回するための正規操作方法であり、Script Properties自体の容量制限を解除するものではない。容量問題の根本対策は後続の新規READY自動整理。

## v63公開済み・カナリア準備（2026-11-21更新）

- 管理者報告：既存Webアプリは **v63 (2026-11-21 10:25 JST)**、デプロイは1件。 `/exec` GETで `ok:true`、`service:"valid-application-analysis-sheet-api"`、`schemaVersion:"3.0"` を確認。
- エディタの `vaaLedgerProdRetireCanaryPreflightReadOnly`：`pass:true`、本番V2有効、退避と旧移管OFF、カナリアID未使用、ソース安定、書込み・削除0、`activationAuthorized:false`。
- [本番1件限定の送信画面](https://tsicb.github.io/valid-app/qa/production-canary-one-shot.html) を追加。GitHubソース：[qa/production-canary-one-shot.html](../qa/production-canary-one-shot.html)。架空の応募1件・求人1件のみ。ブラウザでACCESS_KEY・正確なカナリアCREATE IDを入力し、明示承認チェックと最終確認文字列がそろった場合だけPOST可能。ページ読み込み時のPOSTなし。認証キー・IDは保存せず、送信試行フラグのみ保存し再送を遮断する。既存本番`/exec`へ直接送信し、管理者にID・認証キーの開示を求めない。
- `tests/production-canary-one-shot.test.cjs` 追加、GitHub Actions `Central API check` 成功。送信画面の準備とテストは**本番POST、モード変更、REQ削除ではない**。

### 本番カナリア1件：実行前に別途明示承認が必要

1. **本番カナリアCREATEを1件実行し、該当REQ_のみを退避すること**について管理者の明示的承認を得る。別の包括的QAは追加しない。
2. 本番GAS Script Propertiesで設定済み `VAA_PROD_READY_RETIRE_CANARY_REQUEST_ID` の値（公開禁止）が送信画面のIDと完全一致し、`VAA_PROD_READY_RETIRE_CANARY_OPERATION_MODE=CREATE`、旧履歴移管OFF、V2ゲートONをローカルで確認。IDの変更・再利用はしない。
3. 今回の1件に限り `VAA_PROD_READY_RETIRE_MODE=CANARY_ONE_NEW_READY_V1` に設定する。旧履歴移管や広域RETIREモードはONにしない。設定後にエディタ専用の「モードOFF前提」preflightを再実行しない。
4. 上記の送信画面を一度だけ操作する。企業データを入れず、画面内の固定された架空CSV相当データを使う。送信画面は再送しない。失敗・通信断時にもボタンを押し直したり、ロックを消して再試行しない。
5. GAS実行の終了を確認する。**進行中に削除モードをOFFにすると完了処理が停止するおそれがある**。結果不明なら先にGAS「実行数」で進行中リクエストがないか確認し、記録を残す。結果不明のまま同じIDに再POSTしない。
6. 実行終了後は `VAA_PROD_READY_RETIRE_MODE=OFF` に戻す。 `VAA_PROD_LEGACY_MIGRATION_MODE` は常にOFF、Sticky V2はON維持。
7. 既存の `vaaLedgerProdReadyRetirePreflightReadOnly` で、`pass:true`、`journalPending:0`、`sourceStable:true`、`modernReadyWithoutReq` がカナリア前基準値（直近0件）から+1以上になったことを確認する。以前の本番V2 READYは1件・REQありだった。通常業務による新規READYが増えても、カナリア以外のREQ削除をこの操作で意図しない。判定不能・不整合ならそこで停止し、既存台帳を破壊せず調査する。
8. カナリアで作成された架空の個社管理シートは、その後の照合が完了するまで削除・移動しない。成功しても恒久的な広域RETIREを勝手に有効化しない。

※このカナリアは「実際の送信1件とREQなしREADY台帳」を見るための最小限の実地確認。既存の隔離メモリテストにある再送防止は再利用し、ここではリトライ操作を追加して工数を増やさない。


目的：本番 `/exec` を「1件限定READY退避カナリア対応ソース」へ更新し、次工程のカナリア試験に進める状態にする。**この公開だけではREQ削除を一切有効化しない。** 本番での削除・CREATE試験は別の判断。

## 現状と省略できる工程

- 現行デプロイ：Webアプリ1件、保存済みバージョン **62**（2026-11-20 16:11 JST）。
- `AUDIT_V62`：26本のうち差異2本、`BEFORE_EXACT_CANARY_SOURCE`。V2ゲートあり、正確な1件限定カナリアはなし。
- 本番エディタの `Central API sync to GAS / AUDIT`：remote 26、GitHub 26、changed 0、extra 0。**再SYNC不要**。
- エディタ専用 `vaaLedgerProdRetireCanaryPreflightReadOnly`：以前に `pass:true`、`canaryUnused:true`、退避/旧移管OFF、書込/削除0を確認。
- 既存CI：`tests/request-ledger-v2-one-canary-retire.test.cjs` がOFF時無削除、限定CREATE/UPDATE、対象外保持、失敗時HALTを確認。カナリアの実本番CREATEと再送は**まだ行っていない**。
- 省略：新規TEST環境作成、同じソースの再SYNC/再AUDIT、追加ワークフロー、新たな包括的QA。既存の隔離TEST監査は任意であり、公開の必須条件にはしない。

## 公開前（書込なし）

1. これ以降、本番GASエディタを別の古いタブで保存・編集しない。GitHubのソース変更がないことを確認。
2. 本番Script Propertiesは `VAA_PROD_READY_RETIRE_MODE` と `VAA_PROD_LEGACY_MIGRATION_MODE` が**未設定または`OFF`**、既存のV2 sticky gate は変更していないことを確認。値を変更する必要はない。カナリアIDや認証情報は公開しない。
3. `Deploy > Manage deployments` で、現行Webアプリが1件、バージョン62であることを確認する。既存のアクセス権/実行ユーザー設定は変更しない。

## Webアプリの更新（これだけが公開操作）

1. 本番GASエディタの `デプロイ > デプロイを管理` を開く。
2. **現在の既存Webアプリ**を選択し、編集（鉛筆）を押す。**「新しいデプロイ」は押さない**。
3. バージョンのメニューで **「新バージョン」** を選択する。説明例：`V2 READY one-request canary installed / retirement OFF`。
4. 実行ユーザー、アクセス範囲、デプロイの種類を変えずに `デプロイ` する。バージョン番号は画面に表示された実値を記録する（63と決めつけない）。
5. 再び `デプロイを管理` で、アクティブな既存Webアプリが1件のまま、新バージョンを参照していることを確認する。デプロイID・`/exec` URLは変更してはいけない。
6. **ここで一旦停止**し、バージョン番号と「公開デプロイ1件」「URL維持」の事実だけを共有。URL・ID・キーは共有不要。

Google公式：既存URLを維持する更新は、新しい保存バージョンを作り、既存デプロイをそのバージョンへ編集する方法。
https://developers.google.com/apps-script/concepts/deployments

## 公開後の最小限の非破壊確認

1. 既存の `/exec` にブラウザで `GET` し、レスポンスの `ok:true`、service、schemaVersion 3.0をローカル画面で確認。応答にはフォルダIDなどが含まれるため本文全体を貼らない。
2. エディタ専用 `vaaLedgerProdRetireCanaryPreflightReadOnly` を実行する。判定は `prodV2Enabled:true`、`globalRetireOff:true`、`legacyMigrationOff:true`、`canaryConfigValid:true`、`canaryUnused:true`、`sourceStable:true`、`pass:true`、変更・削除0を期待。**エディタでの診断は、新デプロイが正しく切り替わった証明にはならないため、上記バージョン確認を併用**。
3. この段階で `doPost` のCREATE/UPDATEは送らない。普段の企業運用のPOSTを試験用途に流用しない。

## 異常時・戻し方

- デプロイ失敗、想定外の複数デプロイ、/exec応答異常：**削除モードをOFFのまま維持**し、手動CREATE/UPDATEを再送しない。
- 公開前の戻し先は**保存済みバージョン62**。既存デプロイを編集して62を選択すればURLを維持できる（現在のエディタソースを巻き戻す操作ではない）。
- カナリアモードを後日ONにした後でバージョン62へ戻す場合は、**まずカナリアモードをOFFに戻す**。v62は `CANARY_ONE_NEW_READY_V1` を不正値としてHALTする。
- 予約/READY確定/削除の応答が不明な場合は同じ操作を再実行せず、読み取り専用の監査で事実を確定する。

## 次工程：別承認の本番1件試験

新バージョンの非破壊確認後、専用の架空CREATE payload（**通常Pages UIのUUID requestIdは使わない**）、実行範囲、1回限りのPOST手順、二重作成防止とREQなし再送の確認を確定する。削除モードの変更と本番POSTは別々に明示承認する。成功後に初めて通常の新規READYの恒久整理を検討する。旧REQ履歴の一括整理は別工程。
