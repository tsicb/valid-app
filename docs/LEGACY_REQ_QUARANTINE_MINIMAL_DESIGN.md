# 旧REQ97件の最小工数・安全退避設計（設計確定／本番未変更）

更新：2026-11-22　状態：**GAS管理関数はGitHubに実装済み、CI PASS／本番GAS未SYNC・実データ未変更**

## 目的と根拠

第1・第2回の本番読み取り専用監査は双方 `pass:true`、前後Script Properties一致、書込0。既存の旧履歴は103件（READY99・ERROR4）。READY99のうち現在の管理フォルダ内は2件、**管理フォルダ外は97件／193,222推定bytes**（登録・Viewer関連81件／131,189B、参照なし1件／3,456B、ゴミ箱15件／58,577B）。外部81件は45個のユニークなSpreadsheet IDに紐づき、Viewer-onlyは75件／39対象。53個のフォルダ外Viewerマッピング対象のうち4対象に最近30日以内のViewerアクセス記録がある。現在のフォルダには6フォルダ29シート。ERROR4、現在管理内READY2、旧V2 READY1は今回触らない。

目的は、不要になった旧REQの**元JSONのみを現行のScript Propertiesから外に移し、二重CREATE／UPDATE防止を壊さず容量を戻すこと**。旧Viewer/Registry自体の削除は別テーマにする。

## 結論：単一ハッシュリストより「元REQキーを残す小型退避済み印」が低工数

当初は旧requestIdのハッシュ97個を1個のScript Propertyに集約する案を想定した。既存のSHA-256（hex 64桁）なら `97` 件でJSON約6.6KBであり、単一プロパティの9KiB制限内。しかし、この案では **doPost／V2予約判定コードの変更、新しいWebアプリバージョンのデプロイ、稼働バージョンの検証、ガード用プロパティの初期化** が必要。管理作業とリスクが増す。

追加の実コード確認で、**より簡単な既存仕様**が確認できた。

1. `central-api/24_Request_Ledger_V2_Production_Gate.gs` の `vaaLedgerProdDecideUnderLock_` は、V1/V2でREADY未記録でも **元 `REQ_<requestId>` に空でない値があれば `LEGACY` に戻り、V2の新規予約を行わない**。
2. `central-api/04_Request_Target.gs` の `getRequestRecord_` は、該当REQをJSONとして読んでも `spreadsheetId` がなければ `null` を返す。
3. `central-api/02_EntryPoint.gs` の実装は、 `storedReceiptExists && !requestRecord` なら **`REQUEST_RECEIPT_UNVERIFIED` を返して処理停止**。この分岐は書き込み・CREATE/UPDATE実行より先にある。

したがって、元JSONを専用バックアップへ完全コピーしたあと、同じREQキーの値を下記の小さな**正常なJSONマーカー**で上書きすれば、現行の本番V2経路は既存のまま再送を拒否する。

```json
{"status":"RETIRED","archiveSchema":"LEGACY_QUARANTINE_V1"}
```

このJSONは59 ASCII bytesで、**requestIdもspreadsheetIdも元の情報も含めない**。元のrequestIdは既存の `REQ_` キー部分にだけ残る。97件の値は計5,723 bytes。キー分は従来どおり残り、実際の削減額は元REQ総量193,222 bytesから新しい値5,723 bytesと97個のREQキー容量を差し引いた額になる。キー容量が未計測のため正確な削減量・使用率は本番完了後の容量監査で判断する。

**重要：REQのキー件数104は減らない**。減らすのはその値のサイズ。個別のキーも完全に消したい場合は、将来の別案件としてハッシュリスト・再デプロイ方式を検討すればよい。現在の容量使用率51.3%とユーザーの低工数優先を考えると、数KBの追加削減のために本番doPostを変更する価値は低い。

## 退避先：既存の独立非公開バックアップ

- 新しいスプレッドシートを作らない。`VAA_PROD_LEGACY_BACKUP_SPREADSHEET_ID` で既に検証済みの**独立・非公開・管理者ルート直下**のブックを使い、既存 `receipts` タブは変更しない。
- 専用タブ例：`legacy_quarantine_v1`。ユーザーの追加Drive操作は不要。存在しない場合は管理関数が初回に作成し、既存・不正ヘッダーなら停止（安全な再開のため不明な行は上書きしない）。
- 最小列：`requestHash`（既存 `vaaLedgerReadyHash_` によるSHA-256）、`rawJson`（元のREQ値を完全保存）、`rawDigest`（元JSONのSHA-256）、`sourceKind`（`OLD_UPDATE_NO_PROOF`／`OLD_READY_TARGET`）、`location`（`OUTSIDE_WITH_LINK`／`OUTSIDE_NO_LINK`／`TRASHED`）、`archivedAt`、`schemaVersion`。元JSON中にrequestId等が入るため**公開不可**。ログ・GitHubに元JSONやIDを出さない。
- 行ID、元JSON、digest、原分類を**読み直して完全一致**する。二重行・不一致・他のスプレッドシート、共有設定変更、ゴミ箱入り、アクセス障害ではFAIL CLOSED。V1/V2の `receipts` / `journal_v2` に古いUPDATEの不完全READYを混ぜない。
- アーカイブは元REQを保持している間に実施し、**書込完了の応答だけを信用せず再取得・整合性確認**する。返答が消失したときは自動再試行せず、読み取り専用で現在状態を確認してから回復する。

## 実行順序と安全条件

| 段階 | 実装予定の管理関数／操作 | データ変更 | 人間側の操作 |
|---|---|---|---|
| A | `vaaLedgerProdQuarantinePreflightReadOnly` | なし | 設計・GitHubテスト内で事前検証。必要時のみ手動 |
| B | GitHubからGASの管理関数だけSYNC | GASソースのみ | 1回 |
| C | `vaaLedgerProdQuarantineCopyOnce` | 既存非公開バックアップへCOPY、元REQ不変 | 1回 |
| D | `vaaLedgerProdQuarantineCompactOnce` | 原文とバックアップを照合し、対象 `REQ_` 値を59Bマーカーへ置換 | 1回 |
| E | 独立の最終READ-ONLY照合と容量計測 | なし | 正常時はDの終了時ログ内で自動判定。別確認は異常時のみ |

合計：**追加で本番Webアプリの新バージョンを出さずに、原則1 SYNC + 2 GASエディタ関数実行**。ただし、これは安全検証に合格した場合の目標であって、未知のエラーから自動的な追加操作を行う意味ではない。

### コピー対象の確定

- 先行監査と同じ完全な管理フォルダ列挙（共通ルート＋直下サブフォルダ）で、**実行時にも**管理外であることを確認。
- 候補は元の `status:READY`、旧V2 journal未登録、現在管理外の歴史的REQのみ（見込み **97件**）。うち旧UPDATE39件については現行の `vaaLedgerProdLegacyEntries_` が意図的に隔離する欠落メタデータ形状に限る。
- 現役フォルダに戻っているシートは元REQを維持し、対象件数の変化があれば事前監査の既知の集計と不一致としてSTOP、判断し直す。
- ERROR4件、現役READY2件、独立の現代V2 READY1件、QA系IDは対象から除外。
- 現在のV1 READYアーカイブ、V2ジャーナルに過去IDの不整合がないことを検査する。ソースJSONの完全一致、V1/V2の競合、元REQのlease状態、不正JSON、管理フォルダの取得失敗はSTOP。
- 最近Viewerアクセスがあった外部4対象は **Viewer/Registry削除の慎重判断**に必要。REQの原文をバックアップへ移す処理はViewerマッピングにも元の分析レポートにも触れないので、今回の97件から機械的に除外する必要はない。ただし業務管理対象へ戻っていれば必ず保護する。

### 上書きコミット

- コピー完全一致とバックアップの非公開ACLを再チェック。ScriptLockを取得した中で**再度**REQ元JSON、対象数、管理フォルダ所属、最新V1/V2を検証。
- `REQ_<id>` というキーは**削除しない**。`setProperty` により上記の厳密なマーカーへ置換、`getProperty` で読み戻し。1件ずつまたは安全な内部バッチで処理し、成功数・保護数・残件数だけをログに出す。
- コミット前に**バックアップ全件の元JSON・digest・requestHash完全一致**を検証。マーカーを先に書いてバックアップを後から作る順序は禁止。
- 切替中もキーを空にする瞬間がないため、既存の本番Webアプリv63から同一requestIdで再送されても新規V2に予約されない。UNKNOWN/書込結果不明は停止し、自動的に継続・再試行しない。
- 安全な部分完了を扱えるよう、再実行前のREAD-ONLY監査では「完全な元REQ」「バックアップ一致のマーカー」「不一致／不明」の3状態を区別する。問題があれば原文を再生成したり、既存正常履歴を上書きしない。
- 成功後、現役2READY＋ERROR4＋現代V2 READY1、バックアップ97件、59Bマーカー97件の完全一致を検証する。削減量は本番Script Properties容量監査で実測推定する。

## 実装時に変更すべき箇所（低リスク）

- `central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs` に管理者限定のCOPY、Compact、READ-ONLY検証を追加する。既存の26本を維持し、原則**25番のみ変更**。既存の旧監査の分類関数に退避済みマーカー判定を付け、ERRORとマーカーが混同されないようにする。
- **本番 `02_EntryPoint.gs`、`04_Request_Target.gs`、`24_Request_Ledger_V2_Production_Gate.gs` は変えない。** 通常のWebアプリv63を再デプロイしない。
- 容量監査 `15_Property_Capacity_Diagnostics.gs` は `status:RETIRED` を `inProgressOrOther` と集計する既存仕様がある。容量そのものの数値は正しいがライフサイクル内訳が混ざるので、最終の独立退避監査でマーカーを明確に別集計する。容量監査本体の改修は必要になった時に限る。
- 現行SYNCワークフローは「既存26スクリプトを維持、25番のみソース変更可」のゲートを持つため、原則そのまま再利用。前回の本番25番ソースは、正常SYNC済みのGitHubコミット `7a34bb4cf3cc45774dd15957888cbdaef7223c09` から**不変ピン**を取るよう、実装時に安全チェックを更新する（現在の旧ピン `b4151d0` では再SYNCが拒否され得る）。
- 局所隔離テストは `tests/request-ledger-v2-production-gate.test.cjs` に追加済み。READY未アーカイブでも、元キーが存在＋無効なdetailなら `LEGACY` かつV2 `RESERVED` を追加しないこと、`getRequestRecord_` が `null` になること、doPostが `REQUEST_RECEIPT_UNVERIFIED` で停止することを既存コードで検証。COPY/Compact本番関数実装時には、さらに97件の合成入力、2現役＋4ERROR＋現代1保護、未知の書込結果、ソースdrift、二重マーカー、Drive一覧失敗、バックアップ不一致をテストする。

## 想定しないこと

- この設計は **元REQを削除する計画ではない**。キー自体まで削除するハッシュdenylist方式は省力化のため今回は採用しない。
- Viewer53件・Registry14件のクリーンアップは**未実施・未承認**。関連アクセスログは保全し、別の整理判断とする。
- バックアップ中のJSONは非公開であり、GitHubにサンプルの実データを置かない。
- PREVIEW・COPY・Compactの実装／SYNC／本番実行はこの設計工程ではまだしていない。ユーザー承認なく実行しない。
- もし将来Webアプリのコードが `REQ_` 存在時の停止条件を変更するなら、このマーカーの再送抑止も検証し直す。既存の恒久安全条件として回帰テストに固定しておく。

## 本工程の成果

- 97件の移行方法を、追加Web Appデプロイ不要・新規保管庫ファイル不要・REQキー削除不要の**最小構成**に確定。
- 現行ソースを使った隔離テストをGitHubに追加し、既存の再送防止を確認。
- 本番GASデータへのCOPY、Script Properties書込・削除、Viewer/Registry変更は **すべて0**。

実装済みの関数、COPY/COMPACTの安全条件、実行結果の確認方法は、[実装運用手順書](LEGACY_REQ_QUARANTINE_IMPLEMENTATION_RUNBOOK.md) を最新版として参照してください。本設計書の「実装予定」「まだしていない」は設計時点の記載で、現時点ではコード作成・隔離テストまで完了しています。本番実行はまだです。
