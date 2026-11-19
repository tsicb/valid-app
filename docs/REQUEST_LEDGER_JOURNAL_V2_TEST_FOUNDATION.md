# requestId履歴の恒久対策：V2予約ジャーナルの基盤

更新：2026-11-19。**新規処理に対する権威台帳の基盤設計・実装**。本番切替・履歴削除は行わない。

## これまでに実証できたこと

1. TEST用非公開Google Sheetsの`receipts`タブに、新規の架空READYレシートを1件保存した。
2. 2巡照合で保存JSONとSHA-256が一致し、READYレスポンスを再生成できた。
3. default-OFFの`doPost` READY台帳再送ゲートを実装し、Node回帰テストとTEST GASのREAD_ONLY照合が合格した。
4. ただし**READYだけの台帳**には、処理開始後に途中停止したrequestIdを守る予約情報がない。READYが未登録という理由だけで新規CREATE/UPDATEを許すのは危険。

## V2の設計

TEST用の同一非公開Google Sheetsに、`journal_v2`タブを追加した。従来の`receipts`タブと保存済み1行はそのまま維持する。

| 列 | ヘッダー | 用途 |
|---|---|---|
| A | requestKey | requestIdのSHA-256キー |
| B | revision | イベント番号（1→2） |
| C | phase | RESERVED / READY / ERROR |
| D | recordJson | requestId、CREATE/UPDATE、対象、方式・digest、READYの場合は完全なレシート |
| E | recordDigest | D列JSONのSHA-256 |
| F | prevDigest | 前イベントのdigest（鎖状照合） |
| G | updatedAt | ISO時刻 |
| H | schemaVersion | REQUEST_JOURNAL_V2 |

正常な新規処理のための安全順序：

1. ScriptLock保持下で、REQ_とREADY台帳とV2ジャーナルを確認。既存READYなら再返却、RESERVED/ERRORなら停止、破損・不明も停止。
2. 真に新規かつ同一requestIdに履歴がない場合、**副作用の前にRESERVED revision 1を台帳へ保存し、読み戻して一致を確認**。
3. 予約が成功したときだけ、個社シートCREATE/UPDATEなどを実行する。
4. 処理完了後、`REQ_`に残る完全なREADYレシートを検証し、**READY revision 2**を台帳へ保存して再確認。
5. その後、別途安全性が証明されたREADYについて、REQ_側の保管期間を制限する。削除前には外部READYと対象ファイル・更新digestの完全一致とバックアップを再確認する。

途中停止・通信応答喪失の場合、RESERVEDだけが残っても**新規実行しない**。READYが台帳に残っていればレスポンスだけ返せる。元REQ_がREADYで台帳がRESERVEDのときは台帳側の修復を先に行う（自動再実行しない）。

## 今回実装した範囲

`central-api/22_Request_Ledger_V2_Journal.gs`：

- `vaaLedgerJournalReserveUnderLock_`：TEST制限下で、新規requestIdを1件だけ予約。REQ_や既存READYの重複を拒否。既存履歴の削除はしない。
- `vaaLedgerJournalFinalizeReadyUnderLock_`：同じrequestId・CREATE/UPDATE対象・strategy・digestを持つREQ_のREADYだけをrevision2で記録。
- `vaaLedgerJournalReadOnly_`：イベント番号、HASH、連鎖digest、JSON、状態遷移を検証。行の重複・改変・欠損を拒否。
- `vaaLedgerJournalReplayDecisionReadOnly_`：V1 READYまたはV2 READYの完全検証時のみREADYを返却。ABSENT、RESERVED、ERROR、照合不可を新規扱いせずHALT。
- TESTモード `TEST_RESERVATION_V1` + TESTルート/出力プロパティとの完全一致が必要。TEST非公開シートがTESTルート直下にあることも確認。
- すべての書込み関数は「既にScriptLock保持中」の呼出し前提。未知の例外/応答喪失では無条件再試行しない。

**重要：中央APIの`doPost`にはまだ本モジュールを呼ぶ変更を行っていない。** これだけで本番のScript Propertiesの使用容量は減らない。一般新規受付をONにすることも許可していない。

### 同一requestIdの状態例

| READY V1 | V2最新状態 | 判断 |
|---|---|---|
| FOUND | ABSENT | V1 READYを返す |
| NOT_FOUND | ABSENT | 新規と断定せず、予約手続きが必要 |
| NOT_FOUND | RESERVED | STOP（自動再実行なし） |
| NOT_FOUND | READY | V2 READYを返す |
| NOT_FOUND | ERROR | STOP・調査 |
| FOUND | V2 READY（内容同一） | READYを返す |
| FOUND | V2 READY（内容相違） | STOP・競合 |

## 今回のTESTと変更範囲

- 既存TEST台帳の`journal_v2`タブ：8列ヘッダーだけ追加。行データはまだ書かない。
- 既存TEST台帳の`receipts`タブ：保存済みREADY1行を維持、変更なし。
- 既存TEST READYレシート4件、2ワークブック、G6-J未接続Stage：変更なし。
- 新規GASソース＋Node回帰テストをGitHubに追加。GitHubマージだけではTESTやPROD GASの機能は切り替わらない。

## 完成に向けた残作業（大きく2段階に収束）

1. **切替前の統合TEST**：TEST用の架空CREATE/UPDATEについて、実`doPost`が**RESERVED保存成功後にのみ副作用を開始**し、READY保存失敗や途中停止を安全に扱うことを確認する。前述の旧READY台帳との共存と、REQの欠落時の再送判定を検証。ScriptLock/Sheets間に原子的なトランザクションは存在しないため、欠落や応答喪失は必ずHALT。
2. **旧履歴の移管・本番切替**：旧READYのコピーと完全一致、バックアップ、既存REQなしの再送検証、限定的な削除を分離し、PROD用の非公開台帳のアクセス・容量・失敗時運用を確認してから段階的にONにする。処理中・ERROR・不正REQは移行対象から除外する。削除は実装と明示承認が揃うまで行わない。

本資料は「安全に増え続ける履歴の保存先を移す」ための実装段階の記録であり、途中で削除できると誤認しないこと。
