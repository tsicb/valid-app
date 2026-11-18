# G5-A：隔離TEST GAS / APPEND更新の読み取り専用プリフライト

更新：2026-11-18。**この段階でUPDATEは実行しない。**

## 直前の合格結果

- G1：TEST専用GASソース同期完了（実行記録 #44276244937）。
- G2：初期0件、TEST認証後2件のScript Properties読み取り専用監査合格。
- G3：`/dev` 接続のservice、schema=3.0、TEST root/outputフォルダ一致。
- G4-A：`safeToCreateOnce:true`
- G4-B：`VAA_QA_G4_CREATE` = ok:true / READY / reused:false / receiptReady:true
- G4-C：`VAA_QA_G4_REPLAY` = ok:true / READY / reused:true / sameSpreadsheet:true / pass:true。出力TESTフォルダ内の個社シート総数は3件で変わらず。
- G4-D：Script Properties 6件、1,790 bytes、REQ_READY=1、RPTREG=1、VIEWER=1、SYSTEM=1、activeLease=0、largestValue=753 bytes。書込みリミット内。

## 意図

G4で新規作成したTEST用のシートだけを、将来のUPDATE対象として再利用する。

G5-Aでは**一切UPDATEしない**。G4で作ったDataStoreの実体とTEST専用保存フォルダを読み取って、保存データが架空応募1件・架空求人1件という初期状態から変化していないか確認する。さらに中央APIの純粋マージ関数で APPEND予定データ（既存応募1件＋新規応募1件）を試算し、1件の追加、最終応募2件、求人1件になることを調べる。

途中で対象が外部フォルダだったり保存履歴の初期状態と不一致なら停止する。APPEND用requestIdが既に存在する場合、Script Propertiesの容量不足または更新リース残存がある場合も合格にしない。

## TEST Apps Scriptでの操作

1. **TEST Apps Scriptプロジェクトだけ**を開く。本番では絶対実行しない。
2. G4の手動QAファイル`G4_Isolated_Create_Replay_QA.gs`が存在することを確認。
3. `qa/G5_Isolated_Append_Preflight_QA.gs` の全文をコピーし、`G5_Isolated_Append_Preflight_QA`という**新しい**スクリプトファイルとして保存する。G4・中央APIファイルは上書きしない。
4. **`vaaQaG5AppendPreflightReadOnly`だけ**を実行する。
5. ログ`VAA_QA_G5_APPEND_PREFLIGHT` のJSONを確認。個社シートやScript Propertiesへの書込みは意図的に行わない。

## 合格条件

- `safeToAppendOnce:true`
- `payloadValidationCode:"OK"`, `updateProtocolCode:"OK"`
- `budgetAllowed:true`
- `requestIdAlreadyExists:false`, `updateLeaseExists:false`
- `targetInTestOutput:true`, `dataStoreInTestRoot:true`, `initialRowsMatch:true`
- `mergePlanCode:"OK"`
- `expectedOldApplications:1`, `expectedAddedApplications:1`, `expectedFinalApplications:2`, `expectedFinalJobs:1`
- `propertiesModified:0`, `propertiesDeleted:0`, `workbookModified:false`

このログはTEST用資格情報、spreadsheetId、URL、トークン、応募データを含まない。

## 注意

- G5-Aの純粋マージ計画合格は実際のAPPEND成功ではない。G5-Bの更新実行関数は**まだこのPRに含めない**。
- 前回のG4完成シートだけが前提。過去のテストシートは更新しない。
- TESTのソース同期を再実行すると、手動配置したG4/G5のQAファイルは消える可能性がある。今はGitHub Actions GASソース同期を再実行しない。
- G5-Aが異常停止したとき、G4 CREATEやAPPENDを書き込み側から再実行しない。必要な状態だけを読み取り専用で調査する。
- URL/ACCESS_KEYを貼り付けず、QAログの集計情報だけ共有する。
