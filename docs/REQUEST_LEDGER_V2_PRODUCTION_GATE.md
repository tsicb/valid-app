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

## 既存の隔離TEST実績

- 新規V2 CREATE/UPDATEは隔離TESTでREADY rev2まで成功。
- 旧READY4件はtarget/台帳監査合格。
- 旧READY1件をV1へ1回だけコピー、元REQと完全一致、残り3件未移管。
- `VAA_QA_READY_COPY_ONE_MODE=OFF`に戻している。
- この統合PRは上記の手動QAを繰り返すものではない。

## 制限と残課題

このPRは恒久運用への重要なコード統合だが、**本番運用完了ではない**。不確実なGoogle Sheets書き込み結果から自動的に再実行する経路は用意しない。START済みのRESERVED/ERRORは管理者監査を要する。READY/REQのダブルライトは原子的でなく、エラーはHALTで保全する。運用監査・本番バックアップ・旧REQ移管・本番有効化・退避の承認は未完了。

