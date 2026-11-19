# requestId台帳・第1実装：READY履歴の安全な「コピー」基盤

2026-11-19。対象：`tsicb/valid-app` の `central-api/20_Request_Ready_Ledger_Foundation.gs`。

## 目的と開発方針

元々の問題は **Script Propertiesの履歴が時間とともに増加し、500KiBの保存容量に再び近づくこと**。容量ガードが正常に停止できても、長期的には新規CREATE/UPDATEが実行不能になる。したがって最終的には、READY履歴を非公開の台帳に長期保存し、Script Propertiesを小さく保つ設計へ移行する。

本PRで最初に作るのは、READYレシートの保存・整合性照合を行う**本物のGoogle Sheets向け保存処理**。ただし、既存の`doPost`には接続せず、履歴削除も行わない。隔離TESTでのみ使用する基盤として登録する。

G6-A〜MのQA成果は保管し、今後はこの台帳の実装・統合・移管を少数工程で進める。G6のStage削除検証を延々と継続しない。

## 台帳仕様

事前に**非公開**のGoogleスプレッドシートを用意し、`receipts`タブの**A1:G1**に以下のヘッダーをこの順で配置する。

| 列 | フィールド | 意味 |
|---|---|---|
| A | `requestKey` | requestIdをSHA-256で固定長ハッシュ化した検索キー |
| B | `recordJson` | 元Script Propertiesの`REQ_`レシートを**完全な文字列のまま**コピー |
| C | `recordDigest` | `recordJson`のSHA-256 |
| D | `revision` | 初期コピー版は常に1。変更不可 |
| E | `updatedAt` | コピー日時（ISO 8601） |
| F | `schemaVersion` | `READY_ARCHIVE_V1` |
| G | `recordStatus` | `READY`のみ |

シートIDは隔離TEST GASのScript Properties `VAA_REQUEST_LEDGER_SPREADSHEET_ID` に登録する。**本PRにはID・URL・認証情報を記載しない。**

スプレッドシートの共有権限は原則、管理するTEST実行アカウントのみに制限し、手動編集/公開リンク/外部共有を避ける。ファイルIDを設定しただけでは非公開や正当な所有関係が自動検証されるわけではないので、TESTでの設定時に別途確認する。

## 実装済み（このPR）

`vaaLedgerReadyLookupReadOnly_(props,requestId)`：
- 設定なし、アクセス不能、シート/ヘッダー不一致、照合の失敗 → エラーで停止。
- A列をSHA-256キーで完全一致検索。0行なら`NOT_FOUND`、1行ならレコードJSON・ダイジェスト・requestId・ステータス・方式を検証し`FOUND`、複数行なら`LEDGER_DUPLICATE_KEY`で停止。
- **注意：`NOT_FOUND`は将来の`doPost`へまだ接続していない。** 台帳に既存履歴を全移管するまでは、台帳に未登録の古いrequestIdを「新規」と見なすことがあるため、この検索結果だけでCREATEを開始してはいけない。

`vaaLedgerReadyCopyOneUnderLock_(props,requestId)`：
- 呼出側がScriptLockを保持していることを前提とした、READY履歴の1件ずつのコピー。
- 元`REQ_`は`READY/READY`、正しいrequestId、CREATE/UPDATE、正しい対象sheet IDと更新digest/strategyを保持し、アクティブなリースなし、対象Driveファイルを確認できる場合に限定。
- レシートJSONは改変せず台帳に保存し、SHA-256照合・読戻し検証。既に同じレコードがあるなら何も追加せず`VERIFIED_EXISTING`、不一致なら`LEDGER_EXISTING_CONFLICT`。
- 書込み応答が途切れた場合は`LEDGER_WRITE_UNCERTAIN`。**二度目の無条件書込みや元履歴の削除は実施しない**。まずread-onlyで確認する。
- 既存REQの削除、READY以外の保存、バルク移管、現行API切替、自動アーカイブは実装しない。

`vaaLedgerReadyCopyOneStandalone_(requestId)`：
- 単独実行用の手動TEST関数。`ScriptLock`を取得・解放し、1件のREADYをコピーする。
- `doPost`から呼ばない（doPostは既にScriptLockを取得するため）。
- 実際に台帳に1行書き込む関数なので、**この段階では実TESTへの実行を指示しない**。QAとスキーマを確認し、TEST用台帳を別途作成した後に限定する。
- 成功ログは状態フラグだけ。個別requestId、Sheet ID、保存JSONを出力しない。

## 回帰テスト

`tests/qa-request-ledger-ready-archive.test.cjs`：
- 正常なREADYのコピーとSHA-256/完全一致、同一レコードの冪等コピー。
- 既存異種レシートの拒否、UPDATEのstrategy/digest保存とリース拒否。
- 台帳の権限・構成・検索・単一行破損・重複キーによるfail-closed。
- 保存前エラー／保存後応答喪失の違いをメモリ内Spreadsheetで再現し、元REQを削除しないこと。
- 非READY・レシート不正・対象Drive未検証の拒否。
- `doPost`に未接続であること・書込み経路が既存PRODに影響しないこと。

## 残る工程（増やさず3つにまとめる）

1. **隔離TEST台帳の実動作確認**：TEST専用非公開スプレッドシートに匿名のREADYをコピー・読戻し。まず新しいTEST合成履歴で検証。既存G4/G5/G6履歴と保管中Stageを改変・削除しない。
2. **再送判定の統合**：READY台帳照会が使える時の正規API読取側をfail-closedで接続。全READYの移管対象判定、台帳の可用性・履歴網羅性を証明してから「REQが無くても再送判定ができる」ことを検証。PROCESSING/ERROR/RESERVEDの設計を同時に扱い、単純な`NOT_FOUND`でCREATEさせない。
3. **本番移管・運用整理**：非公開バックアップ、重複/ダイジェスト/権限検証、移管→読戻し→確認済みREQの少量削除を独立承認に分ける。必要なら自動移管を最後に導入。実PRODへは別の明示判断まで一切反映しない。

## 注意

- このPRがマージされても本番GASの保存先は変わらず、Script Propertiesの消費は減らない。
- ユーザーから新しい台帳の場所・TEST権限が確認される前に、台帳作成やコピーを実行しない。
- 移行後の拡張台帳（新規処理の`RESERVED/PROCESSING/ERROR`等）では、本モジュールのREADYコピー限定APIをそのまま完全な履歴台帳と誤用しない。
- 詳細な長期構想は [REQUEST_RECEIPT_LEDGER_ARCHITECTURE.md](REQUEST_RECEIPT_LEDGER_ARCHITECTURE.md) に記載。
