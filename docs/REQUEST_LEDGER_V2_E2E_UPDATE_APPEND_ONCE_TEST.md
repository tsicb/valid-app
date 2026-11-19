# V2予約台帳 — 実Google Apps Script UPDATE（APPEND）統合試験

2026-11-19。**隔離TEST専用。デフォルトOFF。**

## 事前の根拠と目的

20:18〜20:19のGASログで、独立した合成CREATE `QA_JOURNAL_E2E_CREATE_20261119_V2`は`READY rev2`、実DataStoreの架空応募1件・架空求人1件が期待値と一致し、`REQ_`/台帳も一致した。旧合成CREATE V1の`RESERVED rev1`・未READYレシートと途中作成ファイルは保全、歴史的READY4件とV1 READY台帳1件も不変。利用者はTESTの`VAA_JOURNAL_DOP_MODE`と`VAA_REQUEST_JOURNAL_MODE`を両方`OFF`に戻した。

今回の目標は、**CREATE成功で作成された隔離TESTワークブックに対する1回限りのAPPEND更新**を、先行予約→データ更新→READY台帳保存まで検証すること。現在の本番には影響しない。

## 今回追加するQA

`qa/Ledger_V2_E2E_Update_Append_Once_QA.gs`

新しいrequestIdは `QA_JOURNAL_E2E_UPDATE_20261119_V1`。前回失敗したCREATE IDや成功済みCREATE IDは再実行しない。

G4の架空入力を基に、応募識別キー・仕事番号・求人参照IDを別の値に変更した「架空応募1件・架空求人1件」を入力する。既存のAPPENDエンジン `VAAAppendMergeCore.merge` で計画を先に確認し、初期状態の1件ずつに1件ずつを追加。期待される最終状態は**応募2件・求人2件**。

関数は4つ：

| 関数 | 操作内容 |
|---|---|
| `vaaQaLedgerV2UpdatePreflightReadOnly` | **OFF状態での読み取り専用**。既存のREADY4件、旧V1失敗予約、CREATE V2 READY、実DataStoreの初期1+1件、台帳3イベント、UPDATE ID未使用、空き容量、リースなし、V1台帳不変を確認 |
| `vaaQaLedgerV2UpdateArmedPreflightReadOnly` | **armed状態での読み取り専用**。許可requestId・TESTルート/出力・秘密台帳・上記履歴を再検証 |
| `vaaQaLedgerV2UpdateOnce` | **1回のみ実POST、書込みあり**。APPENDで1+1件を追加し、`RESERVED rev1`→`READY rev2`を確認。失敗・例外・応答喪失時は絶対に再実行しない |
| `vaaQaLedgerV2UpdateInspectReadOnly` | 独立2巡の台帳読み取り、REQ_とdigest/target/strategy一致、実DataStore計2件ずつ、lease解放、元4 READYと旧V1失敗とCREATE V2 READYの保全を検証 |

実行済みTESTのジャーナル配置は、**ヘッダー1行＋旧失敗CREATE V1のRESERVED 1行＋正常CREATE V2のRESERVED/READY各1行＝4行**。新しいUPDATE成功後は、これにUPDATEのRESERVED/READYが各1行追加される。既存行は編集しない。

## STEP 1：今回行うのはOFF状態のプリフライトのみ

1. 既存の隔離TEST GASへ`qa/Ledger_V2_E2E_Update_Append_Once_QA.gs`を新規追加する。中央APIファイルは変更不要（23のTESTスコープは`QA_JOURNAL_E2E_UPDATE_20261119_V1`を許可する形式を含む）。
2. `VAA_JOURNAL_DOP_MODE=OFF`、`VAA_REQUEST_JOURNAL_MODE=OFF`を維持する。`VAA_REQUEST_LEDGER_REPLAY_MODE`もOFF/未設定を維持。
3. `vaaQaLedgerV2UpdatePreflightReadOnly`を1回実行。ログ`VAA_QA_LEDGER_V2_UPDATE_PREFLIGHT`を確認する。
4. このログを共有する。**この段階ではarmedにせず、`vaaQaLedgerV2UpdateOnce`も絶対に実行しない。**

期待値：
- `phase:"LEDGER_V2_UPDATE_OFF_PREFLIGHT_READ_ONLY"`、`strictReadOnly:true`
- `existingHistoricalReadyFour:true`
- `failedCreateV1ReservationPreserved:true`、`failedCreateV1ReceiptPreserved:true`
- `completedCreateV2ReadyVerified:true`、`completedCreateV2TargetInTestOutput:true`、`completedCreateV2DataUnchanged:true`
- `journalHasExactlyPreviousThreeEvents:true`
- `updateRequestAbsentFromJournal:true`、`updateRequestAbsentFromProperties:true`
- `targetUpdateLeaseAbsent:true`
- `syntheticUpdatePayloadValid:true`、`syntheticUpdateDigestValid:true`
- `appendPlanAddsOneApplicationAndOneJob:true`
- `capacityAllowed:true`、`testScopeAcceptedInMemory:true`
- `modesOff:true`、`expectedModeSelected:true`、`scriptPropertiesUnchanged:true`
- `actualDoPostInvoked:false`、`actualUpdatePerformed:false`、`pass:true`

## STEP 2：プリフライト合格を確認してから、別途案内する

以下は**隔離TEST GASだけ**で使用する設定。現時点では設定しない。

| Script Property | TEST値 |
|---|---|
| `VAA_JOURNAL_DOP_MODE` | `TEST_ONE_SYNTHETIC_REQUEST_V1` |
| `VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID` | `QA_JOURNAL_E2E_UPDATE_20261119_V1` |
| `VAA_REQUEST_JOURNAL_MODE` | `TEST_RESERVATION_V1` |
| `VAA_JOURNAL_TEST_ROOT_ID` | 既存TESTルートIDを変更しない |
| `VAA_JOURNAL_TEST_OUTPUT_ID` | 既存TEST出力IDを変更しない |

- まず`vaaQaLedgerV2UpdateArmedPreflightReadOnly`をREAD_ONLYで実行し、`pass:true`を確認する。
- その後、`vaaQaLedgerV2UpdateOnce`を**1回のみ**実行し、結果の成否に関係なく`vaaQaLedgerV2UpdateInspectReadOnly`で読む。
- 正常なら`newJournalState:"READY"`、`newJournalRevision:2`、`journalMatchesUpdateReceipt:true`、`updatePayloadDigestMatches:true`、`finalDatastoreExactlyTwoApplicantsAndJobs:true`、`updateTargetLeaseAbsent:true`、`pass:true`。
- エラー・実行タイムアウト・応答喪失・部分書込み時は再試行せず、READ_ONLY検査だけ行う。CAS/台帳追記/REQ_編集/ワークブック削除を行わない。
- 試験終了後はTESTの2モードをOFFに戻す。過去の失敗CREATE V1と正常CREATE V2のIDは再利用しない。

## 本番移行の境界

成功しても本番のScript Properties容量は減らない。CREATE/UPDATEの実TESTが両方合格した段階で、次の重点は**既存READYの安全な外部台帳移管、真正性・再送判定の一致、段階的なREQ軽量化**。処理中・ERROR・RESERVED・不正なREQを削除対象に含めてはいけない。本番の設定切替や履歴削除には別の確認・承認が必要。
