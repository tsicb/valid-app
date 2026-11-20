# 本番GAS反映前：AUDIT（読み取り専用）→SYNC（別承認）

2026-11-20。PR #48で V2本番ゲートと旧READY一括移管コード（初期OFF）を GitHub `main` に統合済み。本番GASへは未同期・未デプロイ。

## 今回準備できた外部台帳

ユーザー接続のGoogle Drive上、本番中央APIの管理ルート直下に、次の二つの非公開Google Sheetsファイルを新規作成した。実ファイルIDは機密扱いとしてこの公開リポジトリに記載しない。

- 主台帳：`receipts`（READY_ARCHIVE_V1 の7列ヘッダー）、`journal_v2`（V2の8列ヘッダー）。
- 別ファイルの独立バックアップ：`receipts`（同じ7列ヘッダー）。

両ファイルはヘッダー行以外空、管理ルート直下に親が1件のみ、Google Driveの共有状態なし・ownerのみ。主台帳とバックアップは別ファイル。旧REQの実コピー、ファイル内容の復元、本番Script Properties設定はまだ行っていない。

## 操作を2段階に分離

既存 `.github/workflows/central-api-sync.yml` の手動実行入力を拡張した：

| 入力 | 動作 |
|---|---|
| `AUDIT` | 記録済みGitHubソースを構文・ハッシュ検証→`clasp pull`でGAS現行ソースを一時ローカル取得→ファイル名と内容ハッシュを比較する。**GASへpushしない** |
| `SYNC` | AUDITと同じ検証を行い、想定外のGAS側スクリプトが**0件**のときに限り、GitHubソースへ置き換えて`clasp push --force`する。Web Appデプロイは行わない |

この手順は `GAS_SCRIPT_ID` と `CLASPRC_JSON` の既存GitHub Actions Secretsを利用する。Secretsの値自体は表示しない。表示するのは追加予定/変更予定/同期時に消える可能性があるスクリプトのファイル名と件数のみ。Script Propertiesの中身も読み出さない。

## 手順

1. GitHub `tsicb/valid-app` → `Actions` → `Central API sync to GAS` → `Run workflow`。
2. ブランチ `main` を選択し、`confirm` に **`AUDIT`** を入力して実行。
3. 実行が成功したら、そのRunの`Summary`で`Changed files`、`New GitHub files`、`Unexpected remote scripts` を確認。
4. `Unexpected remote scripts` が1件以上なら**SYNCしない**。とくにQAなど手動作成ファイルが見つかれば、消去せずGitHubとの設置境界を確認する。
5. `GAS_SCRIPT_ID` が本番側を指していることも、移行前にオペレーターが別経路で確認する。TESTのScript IDと誤認してはいけない。
6. GAS反映の具体的なGOは、AUDIT結果を確認したあと別途判断する。`SYNC`はGASコードの書換えであり、本番動作が変わる可能性がある。

## 次段階の設定（現時点では未実施）

実本番台帳IDとバックアップIDは機密のままGAS Script Propertiesにだけ入れる。設定名は`VAA_REQUEST_LEDGER_SPREADSHEET_ID`、`VAA_PROD_LEGACY_BACKUP_SPREADSHEET_ID`。本番ルートと出力の照合用設定は `VAA_PROD_LEDGER_ROOT_ID` と `VAA_PROD_LEDGER_OUTPUT_ID`。先に本番用ゲートをONにしないこと。

実行モード `VAA_JOURNAL_DOP_MODE`、`VAA_REQUEST_JOURNAL_MODE`、`VAA_PROD_LEGACY_MIGRATION_MODE`、`VAA_PROD_READY_RETIRE_MODE` は、未承認の間はOFF（または未設定）を維持する。Sticky fence `VAA_PROD_LEDGER_FENCE` は本番有効化後にだけ使い、設定したら単純なOFF切替では戻せない。先行予約と外部台帳READY再送を同一リリースで検証してから有効化する。

## 重要：今回の完了基準

- GitHubワークフローが`AUDIT`をサポート。
- `AUDIT`に`clasp push`やLive GAS書換え経路がない。
- `SYNC`は外部GASの想定外ファイルがある場合に拒否する。
- 新しいPrivate台帳2冊が存在し、正しいシート名／ヘッダー／権限／親フォルダ／空であることを読み戻し済み。
- **本番GASへのSYNC、Script Propertiesの更新、Web App再デプロイ、REQコピー・削除は未実施**。
