# V2予約台帳：doPost統合（TEST専用・デフォルトOFF）

2026-11-19。PREVIEWコードの追加。実TESTの既存G4/G5/G6履歴4件、既存V1台帳READY1件、未接続Stage、PRODは維持。

## 完了した内容

- 予約台帳`journal_v2`へ`RESERVED rev1`を書き、**再読込で確認してから**CREATEまたはUPDATEの副作用に進む機能を、既存`doPost`へTEST限定で追加。
- 完了時には`REQ_` READYレシート保存と、UPDATEリース解放の後で、ScriptLock下に`READY rev2`を記録・再検証する。READYジャーナルの保存に失敗した場合、API成功レスポンスを返さず、RESERVEDのまま保留し自動再送しない。
- READY履歴が`REQ_`に残っていなくても、台帳側の`READY rev2`または従来の`receipts`で検証済みなら、同一結果だけ返す。CREATE/UPDATEの方式、target、更新ダイジェスト、対象ファイルのTEST出力フォルダ所属を照合。
- `RESERVED`、`ERROR`、重複、破損、不明、照合不能は**新規処理とみなさず停止**。従来の途中状態からの自動再開は、TEST統合モードでは行わない。
- TESTモードがOFFに戻されても、`QA_JOURNAL_E2E_CREATE_`／`QA_JOURNAL_E2E_UPDATE_`という合成テスト用IDは従来の新規受付に落ちないよう常時遮断。
- それ以外の通常リクエストは、モード未設定/OFFなら既存の`doPost`の挙動を維持。

## 追加したソース

- `central-api/23_Request_Ledger_V2_DoPost_Bridge.gs`（新規）：TEST専用のモード判定、厳格な単一requestId許可、CREATE/UPDATE開始前の予約、READY再送判定、終了時のREADY確定。
- `central-api/02_EntryPoint.gs`（更新）：取得済みScriptLock内で23を呼び、`ADMITTED`が確定した時だけ従来の処理に進む。処理成功時にREADYのジャーナル記録を確認してから成功レスポンスを返す。
- `tests/qa-ledger-journal-v2-doPost-integration.test.cjs`：**本物のdoPost関数**をVMにロードし、Mock Sheets/Drive/Propertiesで予約→処理入口の順序、通信応答喪失、既存REQ/READYとV2状態、UPDATE digest、モードOFF、誤設定、リプレイを検証。
- `qa/Ledger_V2_DoPost_Integration_Preflight_QA.gs`：TESTでの実Google Sheets `journal_v2`が空、従来READYが1行、TESTのREADY履歴4件が不変、モード未有効であることを**READ_ONLY**で確認。

## TESTモードの境界

通常のScript Propertiesに以下を設定**しない限り**、新しい予約処理は動きません。

| 設定 | TEST用の値 |
|---|---|
| `VAA_JOURNAL_DOP_MODE` | `TEST_ONE_SYNTHETIC_REQUEST_V1` |
| `VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID` | `QA_JOURNAL_E2E_CREATE_20261119_V1`（合成CREATE1件） |
| `VAA_REQUEST_JOURNAL_MODE` | `TEST_RESERVATION_V1` |
| `VAA_JOURNAL_TEST_ROOT_ID` | TESTルートのID |
| `VAA_JOURNAL_TEST_OUTPUT_ID` | TEST出力フォルダID |
| `VAA_REQUEST_LEDGER_SPREADSHEET_ID` | 既存の非公開TEST台帳ID |

さらに、**実コードの`API_CONFIG`のroot/outputが隔離TESTのG4 QA定数と一致**することが必要です。QA構成が見つからなければ有効化できません。非公開台帳の親TESTフォルダも照合します。

**本PRでは上記5つのモード関連設定は追加・変更しません。** TESTで実`doPost`を開始する許可も出しません。

## TEST Apps Scriptでの次操作（READ_ONLYのみ）

1. これまでの隔離TEST Apps Scriptに、中央API`22_Request_Ledger_V2_Journal.gs`、中央API`23_Request_Ledger_V2_DoPost_Bridge.gs`、QA`Ledger_V2_DoPost_Integration_Preflight_QA.gs`の3ファイルを新規追加する。
2. 現在のTEST `02_EntryPoint.gs`は**まだ上書きしない**。本番も変更しない。
3. 新しいScript Properties設定を追加せず、`vaaQaJournalV2DoPostPreflightReadOnly`のみ実行する。
4. ログ `VAA_QA_LEDGER_V2_DOP_PREFLIGHT` を共有する。

期待値：`historicalReadyReceipts:4`、`v1ReadyArchiveRowCount:1`、`v2JournalHasHeaderOnly:true`、`v2CandidateAbsent:true`、`syntheticIdNotInRealProperties:true`、`realDoPostV2ModeOff:true`、`realV2JournalModeOff:true`、`inMemoryTestScopePass:true`、`syntheticIdFencedWhenModeOff:true`、`actualDoPostInvoked:false`、`actualReservationWritten:false`、`scriptPropertiesUnchanged:true`、`pass:true`。

## 実運用までの未完了点

- この統合は合成CREATE/UPDATEの入口・READY確定を**メモリ内でテスト**したもので、実Googleの`doPost`処理が最後まで成功したと確認したものではない。実TESTでの1回のみの統合試験と障害復旧確認が必要。
- 現在のV2ジャーナルはRESERVED→READY/ERRORの**2イベント固定**。運用に必要なPROCESSINGの進捗監視、予約済みERRORの承認付き再開、バックアップの扱いは未完成。ERROR/RESERVEDを機械的に再開してはいけない。
- 今回の実装をPRODに投入するのではなく、まず安全なTEST統合結果を確認すること。旧`REQ_`の削除・一括移管・自動整理は禁止。
- 長期的には非公開台帳だけで新規受付できる状態を確認した上で、READYデータを照合済み分から段階的に外部保管・削減する。容量上限に近づいた場合は従来のcapacity guardが引き続き動作する。
