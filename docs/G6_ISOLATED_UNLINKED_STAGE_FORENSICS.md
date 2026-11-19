# G6-K：未接続Stageの2巡READ_ONLY監査と後続判断の保留

更新：2026-11-19

## 前提：G6-Jの実TESTログ

`VAA_QA_G6_STAGE_ONLY_CREATE` は `pass:true`。G6-D専用の隔離TESTシートを対象に、正規の `vaaStageAppendDataStore_` で架空Stageファイルを1件だけ作成した。

- Stageデータ：架空応募2件・求人1件。本文は正規APPEND計画と一致し、検証コード`OK`。
- 元DataStoreポインタは変更なし、Stage未接続、CAS未実行。
- REQ READY履歴4件は維持。Stage専用ID、予約中のG6-E UPDATE用IDはどちらもREQとして未使用。
- 更新リースは0、既存G4/G5とG6-DのDataStoreは変化なし。
- 意図的にDriveに未接続Stageファイル1件が残っている。二重作成・削除をしてはいけない。

## G6-Kで行うこと

G6-Jの「作成直後の検証」に加え、時間をおいた別の独立実行で、ステージが正常・未接続状態のまま保持されているかを確認する。

新しいQA関数：`vaaQaG6KVerifyUnlinkedStageReadOnly`

1. G6-Jの既存`vaaQaG6JStageDetailsReadOnly_`を1巡実行。これだけでTESTフォルダ所属、Stage同名ファイル数、正規APPEND結果との完全一致、旧DataStore状態、READY4件、履歴とleaseの不変を確認する。
2. 検証済みのStageファイルをDriveから読み取り、ファイル名・TEST親フォルダを再確認する。JSON内のrequestId／対象sheet ID／identity version／更新方式／APPEND統計／2データセットとマージ結果を比較する。
3. G6-JのREAD_ONLY監査を独立してもう1巡実行。同一ファイル・同一個社シート・同一ポインタを指していることを確認。
4. 同じStageファイルをもう1回読み取り、本文が2巡間で変化していないことを確認する。
5. 実Script Propertiesの過去3件とG6-D CREATE 1件が変更されず、G6-I Stage専用IDとG6-E予約UPDATE IDが未使用、リースなしであることを確認。
6. **Stageはそのまま保存する。CAS／削除／再送／REQ変更はしない。**

## 合格時に意味すること

`stagePreservationDecision:"PRESERVE_FOR_NEXT_REVIEW"`、`readyForCleanupDesignReview:true` は、後続の保存／後片付けの設計レビューへ進めるという意味であり、削除操作が許可されたわけではない。

`cleanupAuthorized:false`、`casAuthorized:false`、`updateAuthorized:false`、`automaticRetryAuthorized:false` が引き続き必須。

未接続Stageは、今後のG6-Lで「証拠として保持するか」「いつ・どのような条件で安全な単一ファイル削除を許可するか」を別工程で検討する。**G6-Kではどちらの変更操作も実施しない。**

## TEST Apps Script操作

1. これまでの隔離TEST Apps Scriptを開く。G4/G5とG6-C/D/E/F/G/H/I/JのQAファイル・中央APIが揃っていることを確認。
2. [`qa/G6_Isolated_Unlinked_Stage_Forensics_QA.gs`](../qa/G6_Isolated_Unlinked_Stage_Forensics_QA.gs)を新規GSファイル `G6_Isolated_Unlinked_Stage_Forensics_QA` に全文コピーして保存。既存の関数は編集しない。
3. `vaaQaG6KVerifyUnlinkedStageReadOnly` だけを実行。
4. `VAA_QA_G6_UNLINKED_STAGE_FORENSIC` のJSONを共有。G6-D READ_ONLY監査が2回出るのは正常。

## 期待ログ

| 出力 | 期待値 |
| --- | --- |
| `phase` | `G6_UNLINKED_STAGE_FORENSIC_READ_ONLY` |
| `strictReadOnly` | `true` |
| `independentReadPasses` | `2` |
| `firstStageAuditPass`、`secondStageAuditPass` | `true` |
| `stageFileCount` | `1` |
| `stageNameMatchesExpected`、`stageInTestFolder` | `true` |
| `stageIdAndTargetStableAcrossPasses` | `true` |
| `stageBodyValidFirstRead`、`stageBodyValidSecondRead` | `true` |
| `stageContentsStableAcrossReads` | `true` |
| `stageIsUnlinked`、`originalPointerUnchanged` | `true` |
| `originalDataStoreStillSynthetic` | `true` |
| `actualReadyReceipts` | `4` |
| `historicalReceiptsUnchanged`、`createReceiptUnchanged` | `true` |
| `reservedUpdateRequestUnused`、`stageRequestUnused`、`updateLeaseAbsent` | `true` |
| `stagePreservationDecision` | `PRESERVE_FOR_NEXT_REVIEW` |
| `readyForCleanupDesignReview` | `true` |
| `cleanupAuthorized`、`casAuthorized`、`updateAuthorized` | `false` |
| `actualCleanupPerformed`、`actualCasPerformed` | `false` |
| `propertiesModified`、`propertiesDeleted` | `0` |
| `workbookModified`、`driveModified` | `false` |
| `pass` | `true` |

## 例外・不一致時の停止ルール

- Stageが0件、複数件、JSON不正、TESTフォルダ外、別シートの内容、2回の読み取りで変化、データポインタ切替・REQ/Lease新規生成、既存履歴の変化が見つかった場合、`pass:false` またはエラーで停止する。
- **G6-Jの作成関数を再実行しない。Stageファイルを手動削除しない。**
- 実フルUPDATE途中の例外やGoogle側クォータエラーの回復能力を証明したわけではない。あくまでStageをCAS前で放置した制御停止状態が検証できたことを確認する。
- TEST外へのコピー・PROD Apps Script変更なし。認証情報・ファイルID・応募行はログへ出力しない。
