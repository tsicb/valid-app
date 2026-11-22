# 旧READY97件の非公開退避と小型REQマーカー化 — 実装・運用手順

更新: 2026-11-22 / 状態: **GitHub実装済み、全CI PASS。GAS未SYNC、本番COPY/COMPACT未実行。**

## 現時点の結論

既存の独立した非公開バックアップスプレッドシートに隔離タブ `legacy_quarantine_v1` を作り、旧READY97件の元JSONを**完全一致で保存・読み戻し**した後、同じ `REQ_<requestId>` キーの値だけを次の59Bマーカーに変更する。

```json
{"status":"RETIRED","archiveSchema":"LEGACY_QUARANTINE_V1"}
```

キーは削除しない。既存の本番Webアプリv63のV2受付処理は、非空の `REQ_` がある時点で新規V2予約を行わず、履歴JSONにSpreadsheet IDがなければ `REQUEST_RECEIPT_UNVERIFIED` で停止する。したがってWebアプリの再デプロイや通常の `02_EntryPoint.gs` / `24_Request_Ledger_V2_Production_Gate.gs` の改修は不要。

削減量は前回のREADY97件 **193,222推定B（キー＋値）** から、元のキー容量を維持して新しいマーカー97×59Bを差し引くため、概算 **187,499B**。スプレッドシート側の保存量・Script Properties容量の測り方を踏まえ、正確な削減量は最終の読み取り専用容量監査で確認する。

## 実装済みのGAS関数（すべて25番に追記）

- `vaaLedgerProdQuarantineAuditReadOnly`: 現状・コピー・途中完了・マーカー化後の全97件を、既存の非公開バックアップと管理フォルダとV1/V2台帳から照合。元データ・IDはログに出さない。`strictReadOnly:true`, `propertyWrites:0`, `archiveWrites:0`。
- `vaaLedgerProdQuarantineCopyOnce`: 明示的にGASエディタから起動するCOPY。既存バックアップ（独立・PRIVATE・管理者ルート直下）の `legacy_quarantine_v1` タブを必要時に新規作成し、97件を1回の `setValues` で保存。元REQには一切触らず、コピー直後に全97件の元JSON、SHA-256 digest、IDハッシュ、元分類、所在地分類の一致を再検証する。同じ完全一致のタブがすでにあれば、追記・二重行を作らず確認のみ。
- `vaaLedgerProdQuarantineCompactOnce`: COPYの97件全件一致が確認でき、元REQが97件のまま、マーカーがまだ0件である場合だけ、97件のキーを**維持**して値を置換する。内部の一括 `props.setProperties(changes,false)` 呼び出し後、全件読戻しを行い、意図した97件以外のScript Propertiesが一致することと、バックアップが完全なことを再検証する。部分書込・応答喪失時は `unknownCompletion:true`。自動再試行しない。

### 保護条件

- 本番移行モードは **OFF**。本番V2ゲートとPRIVATE台帳のスコープが正常であること。
- 現役管理フォルダ内の旧READY **2件**、既存ERROR **4件**、独立V2管理のREADY **1件**を対象から除外。V2の1件は名前で推測せず、V2ジャーナルの完成済みREADY rev2を照合して確認する。
- フォルダ外READY **81+1+15=97件**、旧UPDATE（更新digest欠落）**39件**という元監査の内訳が変わっていたら、処理しない。管理フォルダはルート＋直下サブフォルダの全件走査が必須。
- V1正常READY台帳、独立バックアップの既存 `receipts` タブ、V2ジャーナルに候補IDがあれば、コピー・置換とも停止。既存の通常台帳に不完全旧UPDATEを混ぜない。
- 既存のバックアップタブ・行・ヘッダーの不正、元REQやバックアップのSHA-256不一致・重複・部分書き込み、フォルダ走査不成立、レジストリ/Viewer参照不正、アクティブ更新lease、途中のソース変化で停止。
- この工程で **REQキー削除0、Viewer/Registry変更0、Webアプリ更新0、V1/V2変更0**。
- 管理者用エディタ関数であり、通常のdoPostから呼ばれない。ソースをSYNCしただけでは実データは変わらない。
- GAS ScriptLock保持中に検証・書込を行う。バックアップ／プロパティの一括書込が原子的に完了すると仮定せず、応答不明・部分完了は独立の読み取り専用監査で状態を確認する。

## 最少操作で進める実際の順番（後続工程・本番実行は未承認）

| 段階 | 操作 | 正常時の期待 |
|---|---|---|
| 1 | GitHub Actions `Central API sync to GAS` → `main`、`confirm=SYNC` | 内部AUDIT 26/26、変更25番のみ、追加0、余分0、`LEGACY25_SOURCE_PRECHECK: PINNED_PREVIOUS_PRODUCTION_SOURCE`、事後 `VERIFIED_MATCH` |
| 2 | 本番GASエディタで `vaaLedgerProdQuarantineCopyOnce` を1回 | `pass:true`, `sourceStable:true`, `archiveVerified:true`, `backedUp:97`, `rawReady:97`, `compacted:0`, `propertyWrites:0`, `archiveWrites:97` |
| 3 | COPYログを確認し、**別途明示的に置換実行を承認した後だけ** `vaaLedgerProdQuarantineCompactOnce` を1回 | `pass:true`, `sourceStable:true`, `archiveVerified:true`, `backedUp:97`, `rawReady:0`, `compacted:97`, `propertyWrites:97`, `propertyDeletes:0` |
| 4 | 必要に応じ `vaaAuditScriptPropertyCapacityReadOnly` | 容量削減を確認。旧汎用容量監査のライフサイクル区分では `RETIRED` が非READYに分類されるため、内訳は本専用監査を参照 |

通常時は **SYNC 1回、COPY 1回、COMPACT 1回**。追加の専用スプレッドシート作成、手動97件確認、Webアプリ再デプロイは不要。SYNC時の事前差分監査はworkflow内で実施され、想定外のソースがあればPUSH前に停止。

**絶対にCOPYとCOMPACTを連続して無確認で実行しないこと。** COMPACTは元JSONをScript Propertiesから消す実データ変更であり、COPY結果を確認してから別に承認する。

## 異常終了時

ログは `VAA_PROD_QUARANTINE` で始まり、`pass:false`、`errorStage`、`errorCode`、`unknownCompletion` などを表示。元のREQ JSON・requestId・Spreadsheet URL・企業名は表示しない。

- `COPY` の書込が不明な場合：`vaaLedgerProdQuarantineAuditReadOnly` のみ実行し、`backedUp` / `rawReady` / `compacted` とエラーを確認。書込済みかもしれないのでCOPYを自動・盲目的に再実行しない。新タブが部分作成されていれば回復手順を別途設計してから復旧する。
- `COMPACT` の書込が不明な場合：同じ読み取り専用監査で、元JSONのままの件数とマーカー化済みの件数を確認。例えば20件だけ置換された場合も、残り77件を勝手に置換しない。状態ごとの専用復旧計画を作る。
- `pass:false` で元JSONのバックアップ一致が確認できない場合、REQの削除・置換は禁止。
- その他の台帳・Drive・Script Propertiesを手動で編集して回復を試みない。

## 検証・変更履歴

- GitHubで変更した本番GASソース：`central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs` **のみ**。新規GASソースなし。通常の受付・Viewer・Registryコード未変更。
- 合成97件を使用する回帰テスト：`tests/request-ledger-quarantine-compact.test.cjs`。元履歴全件保存・監査、現役2、ERROR4、V2 READY1の保護、旧UPDATE39、CSV由来でない実JSON、重複、ソース変化、Drive移動、V1/V2衝突、ACL障害、書込不明と一部完了などを検査。
- 既存Webアプリの再送防止も `tests/request-ledger-v2-production-gate.test.cjs` の合成テストで確認済み。
- 最終GitHub Actions CI: [Central API check #45011803321](https://github.com/tsicb/valid-app/actions/runs/45011803321) — 全Node回帰テスト、GAS構文、SHA-256マニフェスト、Pythonテストが成功。
- `.github/workflows/central-api-sync.yml` の前回正常SYNCソース不変ピンをコミット `7a34bb4cf3cc45774dd15957888cbdaef7223c09` に更新。25番以外の差分や新規・余分GASスクリプトがあれば、SYNC開始前にブロックする。

現段階での本番データ変更は **0件**。COPYもCOMPACTもまだ実行していない。
