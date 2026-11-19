# READY台帳・再送判定ゲートの統合（デフォルトOFF、TEST限定）

2026-11-19。PR #37で、非公開TEST Google Sheets台帳へ架空READY1件を保存、独立二巡読戻しとREADYレスポンスの再構成に成功（`pass:true`）。Script Propertiesの元READY4件とG6-DのTEST個社シートは不変。

## なぜこのゲートが必要か

従来の`doPost`は、`REQ_requestId`が無い場合に新規CREATE/UPDATEを開始する。将来READY履歴をScript Propertiesから台帳へ移した後もこのままなら、古いrequestIdの再送を「新規」と間違えて処理してしまう。

**このPRでは、既存REQのないケースに台帳READY照会のゲートを追加するが、一般的な新規処理の権威切替はまだしない。** 現在の台帳`READY_ARCHIVE_V1`はREADY保存に特化し、RESERVED/PROCESSING/ERRORを含む完全な新規受付台帳ではないため。

## 実装範囲

- `central-api/21_Request_Ready_Ledger_Replay_Gate.gs`: `vaaLedgerReplayDecisionReadOnly_`を追加。書込み副作用なし。
- `central-api/02_EntryPoint.gs`: ScriptLock取得後、既存REQプロパティ**なし**のときだけ、実体作成・更新リース・REQ保存より先に新ゲートを呼ぶ。READY検証に成功すれば既存`buildReadyResponse_`を返す。FAILは`errorOutput_`、不明を新規扱いしない。
- `tests/qa-ledger-ready-replay-gate.test.cjs`: 実際の`doPost`関数をVM内のFake Googleサービスで呼び、同一CREATE/UPDATE再送、モード・対象・digest相違、台帳不在/破損/重複/権限変更、対象Drive外、従来REQ存在時優先、OFF時従来挙動を検証。
- `qa/Ledger_Ready_Replay_Gate_ReadOnly_QA.gs`: すでに保存した架空READY行と本物のTEST台帳を**読み取り専用**で確認。TESTモードに必要な設定はメモリ上だけで組み立て、実Script Propertiesは変えない。

## モード（誤用防止）

`VAA_REQUEST_LEDGER_REPLAY_MODE`が未設定または`OFF`のとき、`vaaLedgerReplayDecisionReadOnly_`は`DISABLED`を返し、従来の`doPost`挙動を保持する。**本番環境でもOFFのまま。**

テスト専用`TEST_READY_REPLAY_ONLY_V1`を明示的に設定した場合のみ、以下のTEST Script Propertiesとの一致を必須にする：

- `VAA_LEDGER_REPLAY_TEST_ROOT_ID` = 実行中の`API_CONFIG.ROOT_FOLDER_ID`
- `VAA_LEDGER_REPLAY_TEST_OUTPUT_ID` = 実行中の`API_CONFIG.SHEET_OUTPUT_FOLDER_ID`
- `VAA_LEDGER_REPLAY_TEST_REQUEST_ID` = 許された**1件の架空requestId**

さらに、非公開Google Sheets台帳の親フォルダがTESTルート直下の1件だけであること、レコードstatus/stage/target/mode/update digestの一致、対象シートがTEST出力ツリー内のGoogle Sheetsであることを検証。

| 条件 | 判定 |
| --- | --- |
| モードOFF/未設定 | `DISABLED`。既存API挙動を維持 |
| TESTモード＋許可済み1 IDの完全なREADY | `READY`。再送レスポンスのみ |
| 台帳にIDが存在しない | `HALT`。**新規実行しない** |
| 台帳照会不可、重複、破損、非公開・TEST所属不一致 | `HALT` |
| 既存REQ_が存在 | 従来のREQ経路を優先。ゲートは呼ばれない |
| CREATE/UPDATEモード・UPDATE target/strategy/digest不一致 | `HALT` |

注意：TESTモードを本当のTEST `doPost`に有効化すると、許可された架空ID以外の**通常の新規リクエストも停止**する。一般運用には使わない。新規受付と古い再送の両方を正式に許可するには、全履歴網羅性を確認したうえで、READY以外の予約履歴も持つ権威台帳と安全な新規受付処理が必要。

## 今回の実TEST操作

このPRのマージだけでは本番/TESTの`doPost`は更新されない。現段階では、TEST GASに次の2ファイルのみを追加してQAを実行する（既存の`02_EntryPoint.gs`は上書きしない）。

1. [`central-api/21_Request_Ready_Ledger_Replay_Gate.gs`](../central-api/21_Request_Ready_Ledger_Replay_Gate.gs)をTESTに追加。
2. [`qa/Ledger_Ready_Replay_Gate_ReadOnly_QA.gs`](../qa/Ledger_Ready_Replay_Gate_ReadOnly_QA.gs)をTESTに追加。
3. `vaaQaLedgerReplayGateInspectReadOnly`のみ実行する。**TESTモードのScript Propertiesを設定しない**。このQAがメモリ上で模擬設定する。
4. `VAA_QA_LEDGER_REPLAY_GATE`を共有する。

期待値：

- `phase:"LEDGER_READY_REPLAY_GATE_READ_ONLY"`, `strictReadOnly:true`
- `previousSheetsArchiveInspectPass:true`, `syntheticArchiveRowCount:1`, `historicalReadyReceipts:4`
- `testModeOnlyEnabledInMemory:true`, `realTestReplayFlagStillOff:true`
- `missingRealSyntheticRequestProperty:true`
- `archivedReadySelected:true`, `replayResponseFromLedgerReady:true`
- `unknownRequestBlocked:true`, `changedOperationBlocked:true`, `nonAllowlistedRequestBlocked:true`
- `defaultOffPreservesLegacy:true`, `scriptPropertiesUnchanged:true`
- `actualPostInvoked:false`, `actualCreateOrUpdatePerformed:false`, `actualReceiptDeleted:false`, `ledgerRowWritten:false`, `cleanupAuthorized:false`
- `pass:true`

## この後、容量問題を完了させるために必要なこと

1. **全状態対応の台帳に拡張**：READYだけでなく、CREATE/UPDATE開始前の予約・PROCESSING・ERRORも冪等な形で記録し、保存失敗/曖昧応答でも新規実行を禁止する。
2. **移管と既存REQの整理を独立させる**：旧READYのコピー＋完全一致＋再送確認→独立バックアップ→権威切替→個別REQ削除の順。曖昧状態やリース・期限・参照の不明なレコードは除外。
3. **本番切替と再発防止**：非公開台帳の権限・保存性能・欠損/重複/遅延の監査、CREATE/UPDATEの安全な受付を総合試験し、段階的に切替。切替が終わるまでは古いREQは削除しない。

**本PRは外部台帳からのREADY再送をテストできる実装であり、まだ容量整理・新規受付の完全移管ではない。**
