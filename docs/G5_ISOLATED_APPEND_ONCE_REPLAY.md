# G5-B/G5-C：隔離TEST Apps ScriptでAPPENDを1回だけ実行しREADY再送を検証

更新：2026-11-19。**G5-Aの読み取り専用プリフライト合格を確認した段階。これから行うG5-BはTESTシートの実書込み。**

## 前提と合格済み証跡

- G4：専用TEST GASにて架空応募1件・求人1件のCREATEがREADYに到達（`reused:false`）。同じrequestIdの再送で`reused:true`・`sameSpreadsheet:true`・`pass:true`を確認、出力個社シート数3件で変化なし。
- G4-D：TEST Script Properties 6件 / 1790 bytes、REQ READY 1件、レポート登録1件、Viewerマッピング1件、更新Lease 0、異常履歴0。
- G5-A：`VAA_QA_G5_APPEND_PREFLIGHT`は`safeToAppendOnce:true`、データ形式／更新プロトコル正常、フォルダ隔離正常、元の保存1応募・1求人と一致、マージ試算は応募1→2件・求人1件、更新用requestId履歴なし、更新リースなし、容量条件通過。
- これらは実APPEND完了の証拠ではない。今回のG5-Bが実更新の最初の1回になる。

## ソース配置：TESTプロジェクト限定

GitHub [QA専用補助ファイル](../qa/G5_Isolated_Append_Once_Replay_QA.gs) を、既存の隔離TEST Apps Scriptに新しい`G5_Isolated_Append_Once_Replay_QA`というGSファイルとして手動配置する。

- 既存`G4_Isolated_Create_Replay_QA.gs`、`G5_Isolated_Append_Preflight_QA.gs`およびTESTの中央APIソースは上書きしない。
- このファイルは`central-api/`外。通常のGAS同期ワークフロー対象外であり、本番への同期・デプロイをしない。
- TESTのルート/出力は既にG4/G5-Aで確認済み。プロジェクト編集先を本番と取り違えないこと。
- 設定済み`ACCESS_KEY`は共有しない。実データ、実社名、実応募者名を使わない。

## G5-B：APPENDを1回だけ

関数`vaaQaG5AppendOnce`を1回実行。

この関数は、実行直前に`vaaQaG5AppendPreflightReadOnly`を再実行して合否を確認する。元のG4 READYのTEST用シートとDataStoreの一致、未使用requestId、容量、更新リース不在などに問題があれば実書込みせず停止する。

合格時だけ、TEST Apps Script内の`doPost`へ架空応募2件（既存1件＋新規1件）・架空求人1件・`APPEND`・`IDENTITY_V1`を送る。

ログの`VAA_QA_G5_APPEND`には以下を期待する：

- `phase:"G5_APPEND_ONCE"`, `ok:true`, `status:"READY"`, `stage:"READY"`
- `reused:false`, `updateStrategy:"APPEND"`
- `sameTarget:true`, `requestIdMatched:true`
- `receiptExists:true`, `receiptReady:true`, `receiptMatchesTarget:true`, `receiptStrategyMatches:true`
- `updateLeaseExists:false`
- `oldApplications:1`, `addedApplications:1`, `finalApplications:2`, `finalJobs:1`
- `dataStoreVerified:true`, `dataStoreMatchesExpected:true`, `actualFinalApplications:2`, `actualFinalJobs:1`, `pass:true`

**最重要：実行が失敗・タイムアウト・`pass:false`の場合、`vaaQaG5AppendOnce`を再実行しない。** GASのDataStore更新は、書込み途中で接続や応答が失敗してもシート側だけ更新済みの可能性がある。実シート・履歴・DataStoreを読み取り専用で照合するまで操作を停止する。

G5-Bが正常終了しても、ここでいったん止め、G5-C関数はまだ実行しない。

## G5-C：READY再送（G5-B合格後）

G5-Bの結果が`READY`で、保存履歴と対象シートが一致したことを確認できた場合にのみ、`vaaQaG5ReplayReady`を1回実行する。

再送関数は、書込み前に次の停止条件を設ける：

- 保存REQの`status`・`stage`がREADYでない、対象シートや更新方式が一致しない
- requestIdへ紐づく更新用digestが今回送信予定の架空ペイロードと一致しない
- 更新リースが残存している
- 現在のDataStoreが想定の架空2応募・1求人と一致しない

期待する追加ログ：
- `VAA_QA_G5_APPEND_REPLAY` / `reused:true`, `dataStorePointerUnchanged:true`, `pass:true`
- 出力TESTフォルダの個社シート数が3件のままである
- 対象シート／DataStoreの応募行数も2件のまま

## 監査

G5-C後、`vaaAuditScriptPropertyCapacityReadOnly`でREAD_ONLY計測する。

- `REQUEST_RECORDS.count=2`（CREATE1件、APPEND1件。READYの再送は履歴数を増やさない）
- `requestLifecycle.ready=2`、`malformed=0`、`activeLease=0`
- 保存容量および単一値が制限以内
- 共有ログにはキー/ID/URL/トークン/個人情報が含まれない

## 今回の検証範囲

- G5-B：編集権限を持つTEST GASエディタ内から直接`doPost`を呼ぶ結合テスト。HTTP通信・GAS Web Appの実POST動作・CORSは含めない。
- G5-C：完了済み同一requestIdの冪等性。途中失敗→再開や誤操作時の復旧とは別ケース。
- REPLACEとrequestId不一致拒否、故障注入・容量不足境界は後続のG5/G6で検証予定。
- 本番GASや本番Driveフォルダ、従来の公開WebアプリはこのQA工程では操作しない。
