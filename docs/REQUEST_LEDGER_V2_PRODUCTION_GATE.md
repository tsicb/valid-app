# requestId台帳 V2：本番ゲートの統合設計（初期OFF）

更新日：2026-11-20。個別QAを増やす方式を終了し、既存TEST検証済みのV2予約/完了記録を一体化する。

## 今回の変更範囲

- `02_EntryPoint.gs`：既存のdoPostに、本番V2判定（既定DISABLED）と本番V2 READY完了を追加。従来のTESTドメインは引き続き別経路に残す。
- `22_Request_Ledger_V2_Journal.gs`：既存のTESTスコープを既定に維持しつつ、`scope='PROD'`を指定した場合だけ本番の非公開台帳/管理フォルダ認証を要求。
- `24_Request_Ledger_V2_Production_Gate.gs`：旧REQ_とV1 READY/V2ジャーナルを統合して判定。既定OFF・不整合時停止。新規副作用より先にV2 RESERVEDを記録し、完了時にREADY rev2。新規READYのREQ_を退避できるオプションは独立した別設定（既定OFF）。
- `tests/request-ledger-v2-production-gate.test.cjs`：通常/失敗/再送/退避を1つの回帰テストに集約。
- 既存のQAファイル、Pages、Viewer、他の管理機能、既存REQ_の値に変更なし。

このGitHubのPRやマージは、本番の有効化・Web App再デプロイ・REQの削除を許可しない。

## ゲートの動作

| 条件 | 判定 |
|---|---|
| 本番フラグ未設定、両モードOFF | 既存の経路を維持 |
| 過去に本番有効化されたことを示す保護フラグだけ残り、モードがOFF | STOP。旧経路への黙った切り戻し禁止 |
| モードはPRODだが台帳の権限、フォルダ、ヘッダーなど不一致 | STOP |
| 旧REQ_のみ存在、V1/V2に記録なし | 旧REQの再送・復旧経路を保持 |
| V1 READYまたはV2 READYが見つかる | ID・モード・UPDATE strategy/digest・管理フォルダを確認して結果再送 |
| V2 RESERVED / ERROR | STOP。自動復旧・同じrequestIdで副作用再実行禁止 |
| 新規IDでREQなし、V1/V2不在かつ台帳正常・容量許容 | V2 RESERVED rev1を先に永続化してからCREATE/UPDATEへ進む |
| READY確定 | 元REQ READYとV2 READY rev2を確認 |
| READY退避モードOFF（既定） | REQは残す（容量増加の根本解消にはまだならない） |
| READY退避モードON（別承認が必要） | **新規V2経由のREADYに限り**V2 READYの検証後にREQを退避。旧履歴を自動削除しない |

## プロパティ設定（将来の本番切替準備時のみ）

下記は設定名／設定値の仕様。現時点では本番Script Propertiesを変更しない。

| プロパティ | 有効化時の値 |
|---|---|
| `VAA_REQUEST_LEDGER_SPREADSHEET_ID` | 本番用のPRIVATE Google Sheets台帳ID（非公開）。`receipts`と`journal_v2`のヘッダー整合性が必要 |
| `VAA_PROD_LEDGER_ROOT_ID` | 本番API設定の管理ルートIDと完全一致 |
| `VAA_PROD_LEDGER_OUTPUT_ID` | 本番API設定の個社シート出力先IDと完全一致 |
| `VAA_PROD_LEDGER_FENCE` | `ACTIVE_V1`（有効化後は消さない） |
| `VAA_REQUEST_JOURNAL_MODE` | `PROD_RESERVATION_V2` |
| `VAA_JOURNAL_DOP_MODE` | `PROD_V2_GATED` |
| `VAA_PROD_READY_RETIRE_MODE` | 当初`OFF`。新規のV2 READYの退避を承認した場合のみ`RETIRE_VERIFIED_NEW_READY_V1` |

本番用台帳のGoogleファイルの共有アクセスがPRIVATEであり、ルートフォルダの直下にただ1つの親として格納されていることをAPIで検証する。TESTの台帳IDを使わない。旧テストフラグやQAの一時的なテスト値は本番に持ち込まない。

### 本番切替の依存関係（まだ実施しない）

1. このPRをCI合格後にマージしてもGASへ自動反映しない。TEST専用ファイルが削除され得るため、既存QA入りGASへの一括同期は事前差分照合なしに行わない。
2. 本番用PRIVATE台帳の独立バックアップ/アクセス確認と、個別の本番非破壊dry-runを準備する。
3. 本番切替に伴う無停止操作順序と既存REQ/二重実行防止の再送試験を確認してから、別途有効化を承認する。
4. 新規REQ_の自動退避を有効化する場合は、その後の検証結果をもって別途承認する。REPLAYゲートをOFFに戻してはならない。
5. 旧REQ_の容量削減には、**別途**バックアップ、V1への一括コピー・検証、既存のREQなし再送ゲートの照合、そして承認付きの整理が必要。今回のPRでは旧REQを削除しない。

## 旧READY履歴の一括移管と容量解放（別承認、初期OFF）

本PRは `25_Request_Ledger_V2_Legacy_Batch_Migration.gs` も追加する。これにより、旧READYを1件ずつの専用QAで処理する方式を終了し、管理者がまとめて移管・監査できる。ただし本番書き込みは本PRでは実行しない。

旧READYの移管には本番PRIVATE `receipts` 台帳のほかに、独立したPRIVATE Google Sheetsバックアップを追加で用意する。バックアップには同じ`receipts` 7列ヘッダーを設定し、Script Property `VAA_PROD_LEGACY_BACKUP_SPREADSHEET_ID` にIDを保存する。バックアップは主台帳と異なるGoogleファイルで、いずれも本番管理ルートの直下・非公開とする。

| 手動関数 | 条件・操作 |
|---|---|
| `vaaLedgerProdLegacyAuditReadOnly` | コピー状況・未バックアップ件数・除外件数を読み取り専用で集計。ID・値はログに出さない |
| `vaaLedgerProdLegacyCopyBatchOnce` | `VAA_PROD_LEGACY_MIGRATION_MODE=COPY_DUAL_ARCHIVE_READY_V1`を明示設定したときのみ、最大10件を「独立バックアップ→V1本台帳」の順に書込・全値照合。REQは維持 |
| `vaaLedgerProdLegacyRetireBatchOnce` | **別途** `VAA_PROD_LEGACY_MIGRATION_MODE=RETIRE_DUAL_VERIFIED_READY_V1`の承認後のみ。全残存READYが両台帳に完全一致している状態で最大10件を削除し、即時に台帳READY再送を独立照合 |
| `VAA_PROD_LEGACY_MIGRATION_MODE=OFF` | 初期状態。コピー・削除とも不可 |

3つの関数はプロダクションV2のゲートが有効・PRIVATE台帳アクセス正常であることを前提とする。途中でAPIエラーや応答喪失が発生した場合、その回の完了状態は不明である。**自動再実行せず**読み取り専用の`vaaLedgerProdLegacyAuditReadOnly`で状況を確認する。ERROR/PROCESSINGのREQ、未知の権限、現存しない対象、UPDATEリースのある履歴、V2にRESERVEDがある履歴は処理しない。元REQが削除された履歴は非公開の二重アーカイブから再送でき、OFFに戻して従来コードへ無条件フォールバックすることは禁止する。

### 旧形式のUPDATE READYを保護する方針（2026-11-20）

本番の読み取り専用全件診断で `REQ_` 145件のうち、READY 102件が現行の完全な再送条件を満たし、39件の旧UPDATE READYは `updatePayloadDigest` の欠落と `updateStrategy` 不適合が同時に確認された。非READYは4件、JSON不正は0件。旧形式39件は同一更新を安全に識別できないため、`REQ_` 元データを削除してはならず、V1再送用のREADYとして捏造・補完してはいけない。

このため旧READY移管コードは、`requestId`・`status/stage`・`operationMode`・元と更新先のスプレッドシートID一致を確認でき、かつ上記2項目だけが未対応の旧UPDATEを `quarantinedLegacyReady` に計上する。既存REQ_を保持し、主台帳やバックアップへのコピー対象から除外する。その他の不明な不正READYやV2台帳との矛盾は停止する。

現行形式のREADYのみ二重バックアップの候補に残る。旧形式39件の保護対象が1件でも存在する場合、**RETIRE操作全体を禁止**する。コピー工程は別途有効化を明示した際に限り、元REQ_を1件も削除せず最大10件ずつ実行する。旧形式のまま容量解放を急がない。

上記はあくまで将来の本番移行のための「コード準備」。本番での実移管、退避設定の有効化、実際の削除はそれぞれ事前の確認と明示承認が必要。

## 既存の隔離TEST実績

- 新規V2 CREATE/UPDATEは隔離TESTでREADY rev2まで成功。
- 旧READY4件はtarget/台帳監査合格。
- 旧READY1件をV1へ1回だけコピー、元REQと完全一致、残り3件未移管。
- `VAA_QA_READY_COPY_ONE_MODE=OFF`に戻している。
- この統合PRは上記の手動QAを繰り返すものではない。

## 制限と残課題

このPRは恒久運用への重要なコード統合だが、**本番運用完了ではない**。不確実なGoogle Sheets書き込み結果から自動的に再実行する経路は用意しない。START済みのRESERVED/ERRORは管理者監査を要する。READY/REQのダブルライトは原子的でなく、エラーはHALTで保全する。運用監査・本番バックアップ・旧REQ移管・本番有効化・退避の承認は未完了。

