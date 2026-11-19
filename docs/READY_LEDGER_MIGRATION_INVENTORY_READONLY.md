# READY移管前のScript Properties棚卸し（READ ONLY）

2026-11-20。V2 CREATE / APPEND UPDATEの隔離Google環境でのREADY保存を独立監査した後の工程。
この工程は**移管前の集計**だけを行う。既存REQ_・台帳・個社シートのコピー、削除、切替、バックアップ作成、Web Appデプロイはしない。

## 実行するもの

- QAコード: `qa/Ready_Ledger_Migration_Inventory_ReadOnly_QA.gs`
- 実行関数: `vaaQaReadyMigrationInventoryReadOnly`
- 依存する既存関数: `vaaScriptPropertyCapacitySummary_` / `vaaUtf8ByteLength_`（`central-api/15_`）、`vaaLedgerReadyValidateRaw_`（`central-api/20_`）
- QAは`central-api/`の同期対象ではない。まず隔離TESTのGASエディタに新しい`.gs`として手動追加する。通常の`doPost`、Pages、公開Web Appには接続しない。

## 検証の境界

1. `getProperties()` を2回独立取得して、値とキーの完全一致をメモリ内で比較する（ログには出さない）。途中で変化したら`pass:false`。
2. `REQ_`だけを集計し、`READY/READY`、一致するrequestId、既存V1 READY台帳と同じレシートバリデーション、非稼働/妥当な処理リースを確認する。UPDATEはターゲットリースのキーが**存在するだけでも除外**する。
3. 隔離テストの`QA_JOURNAL_E2E_CREATE_...` / `QA_JOURNAL_E2E_UPDATE_...`はV2テスト管理履歴として旧READY V1コピー候補から除外する。
4. 集計値のみ出力。個々のrequestId、キー、レシート全文、ファイルID、URL、秘密情報、企業・応募データを出力しない。
5. `structurallyCopyableCount`は「保存形式が暫定的に一致した件数」であり、**移管適格件数ではない**。作成から30日以上かどうかの件数も独立に表示するが、日付だけで移管/削除を承認しない。
6. `pass:true`は読み取り中にスナップショットが変化せず、集計数が整合したことだけを意味する。Driveファイルの存在・管理フォルダ所属、台帳の非公開性、V1/V2既存行との一致、すべての過去requestIdの網羅性、再送判定は**未確認**である。

出力の主な項目：

| 項目 | 意味 |
|---|---|
| `sourceStableAcrossReads` | Script Propertiesの2回の読み取りが同一 |
| `requestPropertyCount` | `REQ_`総件数 |
| `structurallyCopyableCount` | 形式・リースだけで見た旧READYコピー候補の件数 |
| `structurallyCopyableByMode` | CREATE / UPDATE別の候補件数・概算占有量 |
| `exclusionCounts` | 非READY、壊れたJSON、ID・レシート・リース不整合、既存V2試験履歴など |
| `candidateAtLeast30DaysOld` | 候補のうち作成時刻が30日以上古い数 |
| `candidateCreatedAtUnknownOrFuture` | 候補だが作成時刻の確認が必要な数 |
| `candidateBytesAreUpperBoundOnly` | 数字は仮の上限。解放可能容量と断定しない |
| `migrationAuthorized` / `deletionAuthorized` | 常に`false` |

## 手順（まずTESTのみ）

1. 隔離TEST GASの`VAA_JOURNAL_DOP_MODE`と`VAA_REQUEST_JOURNAL_MODE`は`OFF`を維持（直前のUPDATE試験から戻していない場合は戻す）。`VAA_REQUEST_LEDGER_REPLAY_MODE`も`OFF`/未設定を維持する。**本番の設定は変更しない。**
2. GitHubの`qa/Ready_Ledger_Migration_Inventory_ReadOnly_QA.gs`全文を、**隔離TEST**の既存Apps Scriptプロジェクトへ新規ファイルとして追加する。依存する`15_`・`20_`はTEST側にあることを確認する。
3. `vaaQaReadyMigrationInventoryReadOnly`を一度実行し、`VAA_QA_READY_MIGRATION_INVENTORY`のJSONログを共有する。
4. `pass:true`、`strictReadOnly:true`、`sourceStableAcrossReads:true`、`countsReconciled:true`、`migrationAuthorized:false`、`deletionAuthorized:false`を確認する。
5. TESTの結果をレビューしてから本番用の**読み取り専用**設置・監査を別途判断する。本番では現在公開されているWeb Appには触れない。

## 次の工程（このPRに含まない）

- PREPARE: 本番READYの構造分類に加えて、候補対象Drive・非公開台帳の権限/正当な所在、V1 READY/V2ジャーナル既存行との競合、REQ_完全一致を**読み取り専用**で検証する。巨大な全件検査は分割し、quota/時間切れをHALTとして扱う。
- COPY: 移管先の非公開台帳と保全バックアップが独立検証されてから、既存`20_`のコピー機構を1件ずつ使用する。元REQ_は残す。失敗や結果不明は再試行禁止、読取監査のみ。
- REPLAY: 新規リクエストも必ず先行RESERVEDを保証する本番用V2ゲートを別途設計・隔離試験する（現状の`23_`は**合成TESTの1-ID限定**）。V1 READY/V2の両台帳、REQ_欠落時、不明状態をfail-closedに扱う。
- RETIRE: 再送・真正性・容量・バックアップが全て合格し、別途明示承認された場合に限り、REQ_削減を少数単位で設計・実施する。ERROR/PROCESSING/RESERVED/不正・競合レシートは対象にしない。

V2 UPDATEの独立監査で`READY rev2`、応募/求人2+2、digest一致、旧履歴保全が確認されている。APIレスポンス側`VAA_QA_LEDGER_V2_UPDATE`ログは共有されていないため、総合証跡としては取得可能なら既存ログを別途確認する。**UPDATE関数を再実行して取得しないこと。**
