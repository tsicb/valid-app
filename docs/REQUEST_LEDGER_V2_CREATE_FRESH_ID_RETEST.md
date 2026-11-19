# V2予約台帳：初回障害を保存したままの新規CREATE再検証

2026-11-19。隔離TESTのみ。本番GAS・実企業データ・既存REQ/台帳履歴を変更しない。

## 出発点

- 前回の1回限りの実CREATE `QA_JOURNAL_E2E_CREATE_20261119_V1`は、Google Sheetsの`03_Workbook.gs`の表示書式設定時にサービス接続障害。**処理は失敗**。
- 台帳`journal_v2`には **RESERVED rev1が1件のみ**。同IDのScript Propertiesには未READYレシートと、隔離TEST出力フォルダ内に部分作成されたワークブックが残っている。
- 既存の歴史的READY4件・V1台帳合成READY1件は保全。
- 前回の切替設定`VAA_JOURNAL_DOP_MODE`と`VAA_REQUEST_JOURNAL_MODE`は利用者がともに`OFF`に戻した。
- 実CREATEの不合格が、スプレッドシート書式処理の恒常的バグなのか、一時的なGoogle Sheets接続障害なのかは**未確定**。書式例外を握りつぶすコード変更は今回は実施しない。

## 今回の変更

- 中央API`23_Request_Ledger_V2_DoPost_Bridge.gs`のTEST requestId許可形式を`_V1`と`_V2`に限定して拡張。実行許可は依然として**正確な1 ID一致**、TEST root/output一致、非公開台帳一致を必要とする。
- 新しい合成requestIdは`QA_JOURNAL_E2E_CREATE_20261119_V2`。これは以前の失敗IDではなく、新規独立CREATE専用。以前のV1 IDには一切書き込まない。
- `qa/Ledger_V2_E2E_Create_Fresh_Id_QA.gs`を追加。既存G4/G5/G6-Dの4 READYを保護しながら、V2台帳に旧IDのRESERVED1件が残ること、旧エラーレシートとTESTワークブックが存在すること、新IDが未使用であることを照合する。
- 実CREATEが途中で失敗した場合は**その新IDでも二度と再実行しない**。読み取り専用Inspectorだけを使用し、旧IDおよび新IDの状態を保持する。
- NodeモックでOFF/armed事前検証、旧エラー資産と既存4件保全、1回実行・2回目拒否、結果不明時の停止をテスト。

## STEP 1：現時点の読み取り専用事前検証（今回の操作）

既存の隔離TEST Apps Scriptへ、最新`23_Request_Ledger_V2_DoPost_Bridge.gs`を反映し、`Ledger_V2_E2E_Create_Fresh_Id_QA.gs`を新規追加する。その他、これまでの`20_`/`21_`/`22_`とG4/G5/G6/READY台帳QAを維持する。

`02_EntryPoint.gs`についてはGitHub mainの現行ソースをTEST内で使用している場合、今回のPRは同ファイルを更新しない。差分は`23_`と新QAのみ。

TEST Script Propertiesのモードは**この時点では両方OFFのまま**。まず`vaaQaLedgerV2RetestPreflightReadOnly`を実行する。

期待値：

- `phase:"LEDGER_V2_RETEST_OFF_PREFLIGHT_READ_ONLY"`、`strictReadOnly:true`
- `originalFourReadyPresent:true`
- `oldFailedReservationPreserved:true`、`oldErrorReceiptPreserved:true`
- `originalReadyV1ArchivePreserved:true`
- `journalHasOldReservationOnly:true`、`newJournalIdAbsent:true`、`newReqPropertyAbsent:true`
- `oldAndNewIdsNotInReadyArchive:true`
- `newCanonicalPayloadValid:true`、`capacityAllowed:true`
- `modesOff:true`、`expectedModeSelected:true`
- `inMemoryIsolatedTestScopeAccepted:true`
- `scriptPropertiesUnchanged:true`、`historicalReadyUnchanged:true`
- `actualDoPostInvoked:false`、`actualJournalWrite:false`、`pass:true`

このログを確認するまで**次の工程に進まない**。

## STEP 2：別途の合格確認後に限る（現時点で実行しない）

TEST Script Propertiesへ次の設定を行う。**本番への設定禁止**。

| キー | 値 |
|---|---|
| `VAA_JOURNAL_DOP_MODE` | `TEST_ONE_SYNTHETIC_REQUEST_V1` |
| `VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID` | `QA_JOURNAL_E2E_CREATE_20261119_V2` |
| `VAA_REQUEST_JOURNAL_MODE` | `TEST_RESERVATION_V1` |
| `VAA_JOURNAL_TEST_ROOT_ID` | 既存G4 TESTルートID |
| `VAA_JOURNAL_TEST_OUTPUT_ID` | 既存G4 TEST出力ID |

この状態で`vaaQaLedgerV2RetestArmedPreflightReadOnly`をREAD_ONLYで実行して`pass:true`を確認した後、`vaaQaLedgerV2RetestCreateOnce`を**1回だけ**実行する。その結果に関係なく、`vaaQaLedgerV2RetestInspectReadOnly`をREAD_ONLYで実行して証跡を保管する。

成功時は旧IDのRESERVED1件が残り、新IDにRESERVED rev1 / READY rev2が追加され、旧READY4件とV1台帳の1 READYが変更されない。新しいワークブックの応募1件・求人1件が期待値に一致することも確認する。

例外・接続障害・タイムアウト・結果不明はすべて**再試行せずINSPECTのみ**。データ削除、CAS、READYの手動記入、部分ワークブックの処理再開は禁止。検証終了後はTESTの2モードをOFFに戻す。

## 完成条件との関係

これは「予約を保存してから実CREATEが正常終了する」ことを実Google環境で確かめる限られた統合試験である。現在のPROD Script Properties使用容量は減らない。次は独立したUPDATE統合試験を必要最小限で行い、その後、READYの台帳移管・照合済みREQの安全な整理へ進む。仮に二度目の接続障害が発生した場合は、単純な試行回数の追加ではなく、Sheets API障害の切り分けと処理構成の改善を優先する。
