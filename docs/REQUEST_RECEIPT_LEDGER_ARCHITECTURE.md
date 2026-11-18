# 次段階の設計案：requestId履歴の長期保管と冪等性維持

状態：2026-11-18時点の設計案。**未実装・未承認・本番移行不可。**
PR #16は「容量増加を抑え、危険な新規処理を開始前に停止する」初期防御に限定する。
この資料はその後のPR #17以降の実装境界を定義する。

## 背景と目標

- 独立監査：Script Properties 382,382/512,000B（74.7%）、REQ_ 137件/333,690B（使用量の約87.3%）。件数500件基準の自動削除では容量制限を防げなかった。
- 直近のV2手動縮小では55件の古いREADY履歴からperformanceのみを除外し、requestId/保存先/更新ダイジェストを維持。今後の新規REQはPR #16で軽量化する。
- しかし履歴が積み上がれば再び上限に近づく。単純なREQ削除は、古いrequestIdの再送を「新規」と誤判定し、CREATEの二重シート作成やUPDATEの二重処理につながる。
- 求める性質：**存在を確認できないことと、存在しないことを区別し、どの障害時も誤って新規作成に進まないこと**。

## 選択肢の比較

| 保存方式 | メリット | 懸念 | 方針 |
|---|---|---|---|
| Script Propertiesのみ | 既存APIと互換、低遅延 | 合計500KiB上限で履歴が増やせない | アクティブな処理・小さなキャッシュ用 |
| 非公開Google Sheets台帳 | GAS標準サービス、履歴の行単位照合、運用監査が容易 | 行検索・排他制御・共有設定・手作業編集への対策が必要 | **第1候補** |
| Driveの個別JSON | 取得したファイルの復元性が高い | requestId→ファイル参照索引の維持・多数ファイルの探索に課題 | バックアップ/スナップショット向き |
| Firestore等の外部DB | スケール・キー照会性能に優れる | 権限/課金/サービス運用が新たに必要 | 規模拡大時の比較対象 |

第1候補は**専用の非公開Google Sheets「requestId台帳」**。ただし現時点で採用決定ではなく、保管先を非公開とし、動作テストで性能/回復性を測定した後に判断する。

## 提案する台帳構造

最小限の列で保管する。例：

1. `requestKey`: requestIdに対応する安定した照合キー。生requestIdを使うかハッシュを使うかは設計・セキュリティ確認後に決定。
2. `recordJson`: 保存済REQ_レシートと同じ構造のJSON（performance無し）。requestId、CREATE/UPDATE、対象Spreadsheet ID、status/stage、更新方式・payloadDigest、Viewer/管理URL、updateStats、lease情報などを保持。
3. `recordDigest`: JSONのSHA-256。二重書込みや改ざん検出。
4. `revision`、`updatedAt`、`schemaVersion`: 状態更新と将来互換のため。

閲覧/編集権限は実行アカウントのみ。トークン・Drive ID・個人情報などの実値はログや公開リポジトリに一切出さない。レポート共有URL等が含まれるため、台帳自体の権限確認が必須。

## 読み取り経路（冪等性を最優先）

- requestIdに対応するレシートをScript PropertiesのREQ_から取得（アクティブキャッシュ）。
- 無い場合は非公開台帳を**必ず照会**する。READYを見つけた場合は元の結果を再返却し、新規シート/UPDATE処理を実行しない。PROCESSING/ERRORは既存の再開・確認手順で判断する。
- 台帳の読み込みエラー、ID不一致、重複キー、破損、ファイル権限不明はすべて**fail-closed**。単純に「データが無い」と解釈してCREATEを開始してはならない。
- 台帳が初期化済みで利用可能かを、秘密の情報を表示しないread-only診断で判定する。REQ_も台帳も見つからない場合だけ新規作成へ進める。

## 書込み経路（副作用より先にレシート予約）

旧コードは `SpreadsheetApp.create` の後で最初のREQ_を保存するため、作成と保存の間の障害では孤立シートが残り得る。この点も将来の台帳導入時に解消する。

1. ScriptLock取得後、REQ_と台帳の両方を検査（台帳の参照失敗は停止）。
2. requestId・モード・UPDATEダイジェストと対象を確定し、台帳に**CREATING/RESERVED**状態を先に永続化。読戻し・レコードダイジェストを検証。
3. この予約が成功してからSpreadsheetApp.create/UPDATE lease等の副作用へ進む。
4. Spreadsheet ID取得後、台帳と必要なScript Propertiesのアクティブ記録を更新。状態遷移は `RESERVED→CREATED/TARGET_VALIDATED→PROCESSING→READY/ERROR`。
5. アプリ停止/時間切れなどでRESERVEDが残った場合、同じrequestIdで無条件再作成しない。Drive/ログを照合してから再開可能か判断する。台帳書込み失敗時に新規シートを作らない。
6. UPDATEは必ずtarget + strategy + payloadDigestを再照合し、APPENDを重複反映しないことを検証。

**重要：Google SheetsとScript Propertiesは原子的な分散トランザクションではない。**
故障時はどちらか一方だけ更新される可能性があるため、台帳優先順位、revision比較、二重書込みの再試行方法、ロールフォワード手順を先に定義する。

## 既存READY履歴の安全な移行（新規実装後）

- 移行対象は原則READYかつ休止中で参照整合性が確認されたもの。ERROR/PROCESSING/リース/不正レコードは自動対象外。
- 第1段階：**読み取り専用プレビュー**。候補件数/削減予定容量/除外内訳を秘密のない集計値だけで表示。
- 第2段階：**非公開バックアップ**と台帳へのステージ書込み。重複キー、元のREQ_完全一致、digest、再送レスポンス、更新戦略の保持を各件検証。まだREQ_は削除しない。
- 第3段階：**本番切替前の隔離検証**。特定のrequestIdがScript Propertiesに存在しない状態でも台帳から正しくREADYを再返却できることを、実本番とは別のQA台帳で検証。
- 第4段階：別々の明示承認を得た場合に限り、確認済みREQ_の一部を削除して容量解放。削除直前も台帳と元値を再照合し、1件ずつ読戻し検証。自動一括削除は当面しない。
- 第5段階：元REQ_が無い状態での同じrequestId再送、CREATE/UPDATE、障害時のfail-closedを検証。バックアップは保持。

## 最低限のQAケース

- Script Propertiesあり/なし × 台帳READY/PROCESSING/ERROR/不在/読取り失敗
- 同一requestIdのCREATE再送でSpreadsheetApp.createが二度呼ばれない
- UPDATE APPEND/REPLACEで、同じrequestId + 異なるdigestやstrategyを拒否
- 台帳照会障害、ACL変更、単一行破損、重複行、revision不整合
- Side effect直前の障害、Driveで作成後の台帳保存障害、Apps Script時間切れ、再試行
- ScriptLock競合、長時間実行と処理リース切れ、別リクエスト同一更新先
- 古いREADYをScript Propertiesから安全移行した後も再送結果が不変
- VIEWER/RPTREG/認証・HMAC・管理URLを破損/漏洩させない

## PR #16で確定できることと残すこと

PR #16では、REQ_軽量化、保存前のバイト予算、異常なDrive確認での**履歴自動削除禁止**までを検証する。
上記の専用台帳、移行、過去REQ_の自動削除、Webアプリの新規デプロイ、未完成CREATEの再実行は**一切実装・実行しない**。
