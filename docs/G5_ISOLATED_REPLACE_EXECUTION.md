# G5-E/F/G：隔離TEST GASでのREPLACE一回実行・READY再送・不一致payload拒否

更新：2026-11-19。**実UPDATEはこの手順のG5-Eのみ。自動実行は行わない。**

## 前工程の実測結果

- G4 CREATEは架空応募1件・求人1件、READY。再送は既存READYを返しシート重複なし。
- G5 APPENDは架空応募を1件追加し、1件→2件、求人1件、READY。再送は`reused:true`でDataStoreポインタが変わらず、保存データ2件を維持。
- G5-D READ_ONLYは`safeToReplaceOnce:true`、直前APPENDのREADY/digestと保存済み2応募・1求人の一致、TEST root/output隔離、更新Leaseなし、requestId未使用、容量ガード合格。
- この時点でREPLACEの実更新・再送・不一致拒否試験はまだ行っていない。

## 設計

`qa/G5_Isolated_Replace_Once_Replay_QA.gs` は**QA用**。既存G4、G5-A、G5-B/C、G5-Dを利用し、`central-api/`には含まれない。TEST GASへ手動で新規ファイルとして配置する。

架空データを2応募→1応募に全件入替え。求人1件の名称を`QA架空求人_REPLACE後`、給与金額MINを1600に変更する。別の応募識別キーも生成済みの合成値に切替える。

## G5-E：実REPLACE（1回限り）

1. **これまで使用したTEST Apps Scriptだけ**を開く。PRODは開かない。
2. [G5-E/F/G QAソース](../qa/G5_Isolated_Replace_Once_Replay_QA.gs)全文を新規GSファイル`G5_Isolated_Replace_Once_Replay_QA`として保存する。既存ファイルは変更しない。
3. 関数`vaaQaG5ReplaceOnce`を**1回だけ**実行する。実行直前に`vaaQaG5ReplacePreflightReadOnly`を再度通し、`safeToReplaceOnce:true`でなければ停止する。
4. ログ`VAA_QA_G5_REPLACE`を確認。

期待値：
- `phase:"G5_REPLACE_ONCE"`、`ok:true`、`status:"READY"`、`stage:"READY"`
- `reused:false`、`updateStrategy:"REPLACE"`
- `sameTarget:true`、`receiptReady:true`、`receiptMatchesTarget:true`、`receiptStrategyMatches:true`
- `updateLeaseExists:false`
- `finalApplications:1`、`finalJobs:1`、`actualFinalApplications:1`、`actualFinalJobs:1`
- `dataStoreVerified:true`、`dataStoreMatchesExpected:true`、`pass:true`
- **注意**：中央マージエンジンのREPLACE統計では、入替前の実DataStoreに2応募あっても`oldApplications:0`となる。これはREPLACE集計の統計値で、実更新の直前データ2件とは区別する。G5-Dの`previousApplications:2`が元件数の証跡。

**異常時は厳密停止**：エラー・タイムアウト・`pass:false`ならこの関数を再実行しない。実DataStoreとREQ_の書込みが部分的に完了している可能性がある。シート・REQ・DataStoreポインタを読み取り専用で調べる。

**G5-EがREADYでも、その時点でG5-F/Gには進まない。まずログを共有して次のゲートを判定する。**

## G5-F：同一requestId再送（G5-E合格後のみ）

関数`vaaQaG5ReplaceReplayReady`を1回実行。
- 実行前にREADY履歴、同じ対象TESTシート、REPLACE方式、保存されたdigest、最新のDataStoreが架空応募1・求人1と完全一致することを確認。
- APIへ同じrequestId/payloadを一度送信。
- `VAA_QA_G5_REPLACE_REPLAY`: `reused:true`、`dataStorePointerUnchanged:true`、`pass:true`を期待。

## G5-G：同じrequestIdで異なるpayloadを拒否（G5-F合格後のみ）

関数`vaaQaG5ReplaceRejectPayloadMismatch`を1回実行。
- G5-F同様のREADY/digest/保存済みデータ検証を通す。
- **架空の**求人給与MINだけを1600→1700へ変更し、同じrequestId・REPLACE・対象TESTシートで1回POSTする。
- APIが`ok:false`, `code:"REQUEST_PAYLOAD_MISMATCH"`を返すことを期待。
- `VAA_QA_G5_REPLACE_MISMATCH`: `rejectedByApi:true`、`receiptUnchanged:true`、`dataStorePointerUnchanged:true`、`dataStoreMatchesExpected:true`、`pass:true`を期待。元の1応募・1求人と給与MIN1600は維持。
- 拒否応答も**期待どおりなら合格**。認証情報や元の生データはログに出さない。

## G5最終容量監査（G5-G合格後）

`vaaAuditScriptPropertyCapacityReadOnly`を再実行し、Script Propertiesの`REQUEST_RECORDS.count=3`（G4 CREATE1, G5 APPEND1, G5 REPLACE1）、`requestLifecycle.ready=3`、`malformed=0`、`activeLease=0`、単一値9216 bytes上限以内、総容量512000 bytes以内を確認。G5-Fの再送もG5-Gの拒否応答も新規REQ_を増やさない想定。

## 範囲と禁止事項

- 実APIロジックはTEST Apps Script内の`doPost`直接呼出し。HTTP/CORS経路の検証ではない。
- PROD Apps Script、PRODフォルダ、本番Web App、実応募者データには一切触れない。
- 手動TEST用GSファイルを`central-api/`へ移したり、PRODへ同期させない。
- 旧G4/G5 APPENDのCREATE/実行関数を再実行しない。
