# 限定更新型APPEND：Pages→GAS接続の実装境界（試験段階）

更新日: 2026-11-23  
状態: **Draft PR #61 / 検証コードのみ。実際のPages/GAS経路は未接続。**

## 2026-11-23 実装進捗（PR #61内のみ）

この文書の「将来接続（まだ実装しない）」という節は最初の設計段階の記録である。
**現在のドラフトPRには、PagesとGASの接続コードを実装済みだが、本番環境では完全に未有効化**。

- `index.html` と `limited-append-candidates-v1.js`: 認証応答 `capabilities.incrementalUpdate.limitedAppend.enabled === true` かつ APPEND のときだけ、一時候補を生成し `limitedAppendProtocol:LIMITED_APPEND_V1` と `limitedAppendCandidates` を付けて送信。通常の応募件数は変えない。CREATE/REPLACEは既存形式。
- `central-api/26_Limited_Append.gs`: 純粋統合エンジンをGASへ移植。元の `11_Append_Merge.gs` を変更せず、既存JOB_CSV給与・代表応募の仕事番号とAPP IDを保持する。
- `central-api/13_Append_Update_Guard.gs`: Script Property `VAA_LIMITED_APPEND_ENABLED` の値が明示的な文字列 `true` でない限り、機能はOFF。機能を要求しているのにOFFなら拒否し、黙って従来APPENDへフォールバックさせない。機能を使う場合だけ候補もrequestIdダイジェストに含める。旧要求のダイジェストは不変。
- `central-api/12_Append_DataStore.gs`: 一時候補は統合計算にのみ渡し、保存用 `plan.payload` のトップレベルから完全に除外。ステージ関数にも誤混入を拒否する保護を追加。
- `tests/append-limited-gas-gate.test.cjs` / `tests/append-limited-pages-wiring.test.cjs`: GASの機能OFF/ON、実際のPages関数、requestIdダイジェスト、保存非混入、新規応募者の候補、GASファイル初期化順などを検証。
- `central-api/SOURCE_SHA256SUMS.txt`: 変更されたGAS 12・13と新規26のハッシュを反映。

**残るゲート:** 実ブラウザからQA用GAS/Web App、QA専用シートへの多ファイルCSV投入、レポート集計確認、ID/給与不変検証、操作ログの確認。本番GASへSYNCせず、本番の `VAA_LIMITED_APPEND_ENABLED` も変更しない。PRはdraftのまま。

---

前提: [APPEND_LIMITED_UPDATE_V1_DESIGN.md](APPEND_LIMITED_UPDATE_V1_DESIGN.md)。応募者・同月・同一企業のI1重複判定を維持。ステータス更新と求人CSV未取得補完だけを対象とする。通常APPEND、REPLACE、AirWork、Viewer、DataStore運用、履歴を遡及更新しない原則を守る。

## 1. ブランチ上の実証済み部品

- \`experimental/append-limited-update-core.cjs\`: 元の \`central-api/append-merge-core.js\`（本体 \`11_Append_Merge.gs\`）の \`merge()\` を実行後に限定更新を行う純粋関数 \`mergeLimited()\`。**GASでは呼ばれていない。**
- \`experimental/append-limited-update-sidecar.cjs\`: 保存対象から除外された応募者候補を、既存の \`VAAClientIdentity.assign()\` と同じI1方式でHMAC仮名化する。求人CSVとの真の仕事番号一致のみ証跡化する。raw氏名、応募者ID、メール・電話番号を候補へ入れない。
- \`tests/append-limited-update-core.test.cjs\`、\`tests/append-limited-update-sidecar.test.cjs\`: 同一応募だけのステータス更新、別応募排除、候補の衝突、求人マスタの昇格、リプレイ、CSV_B正規化との互換などを試験。

**重要:** これらはNode環境の隔離実装で、 \`index.html\` / \`central-api/*.gs\` / \`SOURCE_SHA256SUMS.txt\` の動作変更を伴わない。「自動更新が実用化済み」とは扱わない。

## 2. Pages側の将来接続（まだ実装しない）

1. 現行の \`normalizeApplicationCsv\`、CSV前処理、第一重複除外、JOIN、第二重複除外は維持する。代表応募と応募件数を変えない。
2. \`globalDuplicateData\` にある第一重複除外候補と、 \`vaaApplyApplicationIdentities()\` の第二重複除外候補のうち **PERSON_ID/PERSON_NAMEのみ** を一時的な候補列へ集める。AirWorkは候補にしない。
3. 認証済み \`vaaFetchIdentitySecret()\` の結果をメモリ内でのみ利用し、各候補のI1識別キーを生成する。既存の \`globalFinalData\` と同じ企業、人物識別方式・月であることを保証する。異なる人物の偽補完候補は拒否。
4. 元求人CSVの **最初の同一企業＋正規化仕事番号行** だけをJOIN証跡として採用する（現在のJOIN規則に合わせる）。JOB_CSVのデータは既存 \`buildJobAnalysisMeta\` / \`buildJobRecordFromJoinedRow\` を用いて既存のJOB_ANALYSIS_HEADERSへ投影する。元の求人全文・応募者の個人情報は送らない。
5. 必要な場合にだけ仮名化した一時候補を、通常の \`applicationData\` とは**独立**したリクエスト用のフィールドへ付ける。**保存される \`applicationData.rows\`、既存の集計件数、CSVダウンロード対象へ混入させない。** CREATE、REPLACEは通常どおり。
6. 前段の全候補保管はブラウザ一時メモリのみ。個人情報・候補をlocalStorage、URL、ログへ記録しない。画面離脱／保存終了後は参照を解放する。

推奨リクエストイメージ（まだワイヤ仕様未確定）:

- \`payload.datasets.applicationData\` / \`jobAnalysisMaster\`: 既存形式のまま、各人物につき一つ。
- \`payload.limitedAppendCandidates.applicationData\` / \`jobAnalysisMaster\`: **任意、APPEND専用、一時入力のみ**。既存HMACキー／企業ID／仕事番号／応募日時／対応状況／証跡（JOB_CSVか）／一時求人参照を格納。
- \`payload.limitedAppendProtocol\`: 新機能が利用可能な場合だけ明示したバージョン。通常の \`updateProtocol=IDENTITY_V1\` と混同しない。

**注意:** 実際の \`buildSheetsPayloadV3\` が \`payload.datasets\` をそのまま送信・保存へ流すため、候補を \`datasets\` に足すだけでは意図せず永続保存される危険がある。サイドカーは明示的な一時入力として扱い、保存境界で必ず削除する。シート表示やViewerへも渡さない。

## 3. GAS側の将来接続（まだ実装しない）

- **コード**: 本体 \`11_Append_Merge.gs\` の純粋処理に、 \`mergeLimited()\` 相当の検証済み関数を移植する。既存 \`merge()\` を変更せず、フラグで \`APPEND\` の場合のみ新関数を呼び出す。候補がない場合は旧ロジックと意味が一致することを回帰試験する。
- **検証**: 候補数・列の許可リスト・HMAC形式（PERSON_ID/PERSON_NAME）・企業ID・応募月・メインアップロード内同じI1キーの存在・仮求人参照IDと仕事キーの一致を検査する。集計行AGG_DAILYは一切更新候補に入れない。
- **保存境界**: \`12_Append_DataStore.gs\` の \`vaaBuildAppendStorePlan_\` で一時候補を \`mergeLimited()\` だけに渡す。 \`plan.payload.datasets\`・\`buildAnalysisDataStoreObject_\`・旧バージョンのステージ/リトライ記録に候補そのものを**絶対に引き継がない**。APP/JOB ID、CAS、stage→verify→commitは維持。
- **重要: 再送防止**: \`13_Append_Update_Guard.gs\` の現在の \`vaaDigestUpdateRequest_\` は更新方式・プロトコル・対象・ \`payload.datasets\` をハッシュする。候補がトップレベルにあるなら、**候補と新機能プロトコルもダイジェスト対象に追加することが必須**。同じrequestIdで候補を入れ替えても同じリクエストと見なす事故を防ぐ。
- **結果**: \`vaaSummarizeUpdateStats_\`、保存した \`updateStats\`、既存READY再送結果にも「ステータス更新件数」「求人情報補完件数」「不一致・曖昧件数」を引継ぐ。個別人物の識別情報をログや統計に含めない。
- **互換性**: 新機能フラグを使わない要求は、従来のAPPEND/REPLACEとして処理する。旧Pagesは改修前と同じ応答を得る。新機能が必要なのに古いGASなら、黙って新機能を実行したと表示しない。

## 4. マスタ参照と突合フラグの解釈

- \`JOB_CSV\` 取得済み求人は給与・仕事名を上書きしない。
- \`APPLICATION_EMBEDDED\` からの昇格は既存JOB IDを維持し、ソースをJOB_CSVへ変更する。そのJOBを参照する**他の応募の求人情報も変化し得る**のでQAが必要。
- 一時候補が **同一企業＋同一仕事番号** のJOB_CSVを本当に参照している場合のみ既存応募のフラグを0→1にできる。別求人からは不可。
- ただし、同一人物による**同一求人への異なる応募日時**のCSVから補完する場合もあり、元のフラグの「その保存代表イベント自身を取り込む際に求人CSVとJOINされた」という履歴的意味を緩める可能性がある。初回QAでは、(a)同じ応募日時の候補だけフラグを更新するか、(b)同じ求人の任意の後続応募でのJOINを補完証跡として認めるか、Viewer表示の解釈も含めて確定する。
- \`JOB_CSV\`が欠けている今回入力を理由に、過去のJOB_CSVに含まれた情報やフラグを削除しない。

## 5. 試験で今後追加すべきこと

- 実際のPagesイベント処理で第一重複除外・第二重複除外の双方から候補を取得するブラウザ試験。現在は \`normalizeApplicationCsv\` と独立した候補処理までを単体試験で検証。
- 任意候補がGASの\`requestId\`ハッシュに入る一方、最終DataStore JSONに候補が**存在しないこと**を検査する保存境界テスト。
- JOB参照マスタの既存ID維持、給与凍結、旧マスタの昇格、親ExcelミラーとViewerの整合、旧旧リクエストの同一処理結果再送をQAで確認。
- 空時刻・不正時刻・名前のみ／応募IDのみ・CSV_A/B別仕様・分割CSV/逆順・補足候補の順序入替・同一イベント内のステータス競合をテスト。
- 未改修 \`APPEND\` / \`REPLACE\` / \`AGG_DAILY\` が同じ結果になること。

## 6. 推奨導入順

1. PR #61で単体処理とプロトコル設計をレビューする。**まだmainへマージしない。**
2. GASにデフォルトOFFの新分岐を追加して、API契約・ダイジェスト・Datastore非保存を隔離テストする。 \`central-api/SOURCE_SHA256SUMS.txt\` も更新。単体テスト/CI合格まで未同期。
3. Pagesの候補生成・転送を同じブランチで接続し、新旧ブラウザ・新旧GASの組み合わせで誤更新しないことをテストする。
4. QA専用シートと隔離されたWeb Appで初回、再アップロード、衝突、AirWork、REPLACEを検証。
5. 本番GAS SYNC・Web App更新・Pages更新は**別途明示した承認と監査**後。旧環境でも通常更新が失敗しない段階的な互換性確認を含める。

結論: **全応募イベントの保存やステータス更新日時CSVの追加は不要**。使うのはあくまでも「ブラウザ内の一時的な更新判断材料」であり、応募者単位で代表1件保存する現行分析モデルは維持できる。
