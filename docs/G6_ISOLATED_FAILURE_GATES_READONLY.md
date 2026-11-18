# G6-B：隔離TESTの障害停止ガードと現状復旧準備の読み取り専用監査

更新：2026-11-19。**意図的な障害注入・実際の復旧操作はまだしない。**

## 前提：G6-Aの実測

G6-A `VAA_QA_G6_CAPACITY_BOUNDARY` は `pass:true`。

- 3件のREQはすべてREADY、不正な履歴・活動中リースなし。
- 推定Script Properties 3,972 bytes、プロパティ実変更・削除なし。
- 新規処理アドミッション436224/436225、新規REQ書込460800/460801、既存REQ上書512000/512001、単一value9216/9217の境界テスト合格。
- `performance`保存省略、必須レシート項目の維持を確認。
- これらはメモリ内合成テストであり、Google側のクォータエラーや実故障・再開の成功を証明するものではない。

## G6-Bの目的

G4/G5で作成したTESTのREADY履歴を維持し、今回のREAD_ONLY監査では以下を確認する。

- G4 CREATE、G5 APPEND、G5 REPLACEの3件の既存レシートがREADYで、すべて同じ隔離TESTシートを指す。
- APPENDとREPLACEの保存済み`updatePayloadDigest`は元の架空payloadのSHA-256と一致する。
- G5 REPLACE後のDataStoreが架空応募1件、架空求人1件の完全一致状態にある（既存`vaaQaG5ReplaceReadyGateReadOnly_`による確認）。
- 未解析のREQ、未完了REQ、活動中のUPDATEリースは存在しない。
- 実装済みの純粋／読み取り専用ガードに**メモリ内の架空の壊れたREQ履歴**を渡し、正常に拒否されることを確かめる。
- 保存履歴の構造異常、digest不一致、更新方式不一致、活動中と期限切れの処理リースを判別できることを確かめる。

**G6-Bでは`doPost`を呼ばない。意図的なエラー・停電・部分書込・クォータ到達を実環境で発生させない。** 実際の障害復旧についての結論は後続のG6-C以降で検証する。

## TEST Apps Scriptでの操作

1. これまで使用したTEST Apps Scriptを開く。本番Apps Scriptには配置しない。
2. G4、G5-A/B/C/D/E/F/GのQA用ファイルと中央APIの監査・ガード関数が残っていることを確認。
3. [`qa/G6_Isolated_Failure_Gates_ReadOnly_QA.gs`](../qa/G6_Isolated_Failure_Gates_ReadOnly_QA.gs)を新規GSファイル`G6_Isolated_Failure_Gates_ReadOnly_QA`へ全文コピーし、保存する。ほかのファイルは編集しない。
4. `vaaQaG6BFailureGatesReadOnly`のみを実行し、`VAA_QA_G6_FAILURE_GATES`のJSONを共有する。

## 期待ログ

- `phase:"G6_FAILURE_GATES_READ_ONLY"`、`strictReadOnly:true`、`testEnvironmentMatched:true`、`pass:true`
- `actualReadyReceipts:3`、`actualMalformedReceipts:0`、`actualActiveLeases:0`、`actualStatePass:true`
- `g4CreateReceiptReady:true`、`g5AppendReceiptReady:true`、`g5ReplaceReceiptReady:true`
- `g5AppendDigestMatches:true`、`g5ReplaceDigestMatches:true`、`finalTestDataStoreMatches:true`
- `syntheticFailureGatesPass:true`。内訳は壊れたREQ・対象ID欠落の拒否、正しいREQの解析、digest/strategy不一致の拒否、活動中／期限切れleaseの判別など。
- `propertiesModified:0`、`propertiesDeleted:0`、`workbookModified:false`、`driveModified:false`、`actualFailureInjected:false`

## 安全上の注意と次工程

- 失敗・例外・予期しないログが出た場合は関数の書込み側へ切り替えず、読み取り専用で状況を点検する。
- G4/G5で作成したシートやREADY履歴を削除・初期化・書換えしない。
- G6-Cでは、対象TESTのREADY履歴と既存シートを温存したまま、故障注入するなら**別の合成requestId／検証領域**を使う。さらにまずread-onlyの段階で、実行条件・戻し方・障害箇所を検証する。
- 元のACCESS_KEY、Script ID、秘密鍵、個人情報、REQの原文をログやチャットへ出さない。
