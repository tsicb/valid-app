# G6-D：専用架空TESTシートを1回作成するQA（実CREATE）

更新：2026-11-19。G6-C READ_ONLYが合格してから進む。**障害注入はまだ行わない。**

## 前提：G6-C実測

`VAA_QA_G6_FAULT_DOMAIN_PREFLIGHT`は`readyForSeparateProvisioningPlan:true`。
- G6-B再監査もPASS（CREATE/APPEND/REPLACEのREADY3件）。
- 新規requestIdは未使用、既存シートを指さないCREATE、TEST出力フォルダのみ。
- 架空応募1件・求人1件、容量ガード通過、段階順正常、障害計画ポイント6。
- `faultDomainProvisioned:false`、`actualFailureInjected:false`。

## G6-Dの目的と対象

既存G4/G5のTESTシートとは**別の新規Googleスプレッドシート1件**を、G4と同じ隔離TEST出力フォルダに作る。

- 新規requestId：`QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1`
- 架空表示名：`QA_SYNTHETIC_ONLY_G6C_FAULT`
- 入力：G4と同じ**架空応募1件・架空求人1件**。実企業・実応募者データは使用しない。
- G4/G5の既存シートへの更新は行わない。
- 作成後に新規シートIDとG4/G5のシートIDが異なること、DataStoreポインタも異なること、TESTルートにのみ保存されていること、保存済みデータが架空1応募1求人と完全一致することを検証。
- 作成前後のG4 CREATE・G5 APPEND・G5 REPLACEの3つのREADYレシートをバイト列として比較し、元のシートのDataStoreポインタも不変であることを確認。

## 手順：TEST Apps Scriptのみ

1. これまで使用した**隔離TEST Apps Script**を開く。実働PRODプロジェクトではないことを確認。
2. [G6-D QAソース](../qa/G6_Isolated_Fault_Domain_Create_Once_QA.gs)全文を、新しいGSファイル`G6_Isolated_Fault_Domain_Create_Once_QA`にコピーして保存。G4/G5/G6-B/G6-Cファイルおよび中央API本体は編集しない。
3. 関数`vaaQaG6DCreateFaultDomainOnce`を**1回だけ**実行。最初にG6-C読み取り専用プリフライトを自動実行し、未使用requestId・安全条件を確認してから`doPost`で1件CREATEする。
4. 実行ログ`VAA_QA_G6_FAULT_DOMAIN_CREATE`を共有。ログにはID/URL/アクセスキー/生データを含めない。

## G6-DのPASS条件

- `phase:"G6_FAULT_DOMAIN_CREATE_ONCE"`, `ok:true`
- `status:"READY"`, `stage:"READY"`, `reused:false`
- `requestIdMatched:true`, `receiptReady:true`, `responseMatchesReceipt:true`
- `sameTestOutput:true`, `differentWorkbookFromG4G5:true`, `differentDataStorePointer:true`
- `dataStoreInTestRoot:true`, `dataStoreMatchesSynthetic:true`
- `actualApplications:1`, `actualJobs:1`
- `historicalReceiptsUnchanged:true`, `originalDataStoreStable:true`
- `actualFailureInjected:false`, `pass:true`

PASS時点で3件の過去READYレシートに、新しいCREATE READYが1件追加されるため、Script Properties上のREQは通常4件となる。G6-B/G6-Cのプリフライトは3件前提なので、以後**再実行して合格を期待しない**。

## 障害・タイムアウト・応答不明時

**`vaaQaG6DCreateFaultDomainOnce`を再実行しない。** API応答が途絶えても、TESTシート作成とREQ保存がすでに完了している可能性がある。

代わりに、読み取り専用関数`vaaQaG6DInspectFaultDomainReadOnly`で、既存のREADYレシート・フォルダ帰属・DataStoreの状態を調べられる。これは**復旧を実行しない**し、RETRYを認可しない。

- `VAA_QA_G6_FAULT_DOMAIN_INSPECT`の`pass:true`なら作成結果の照合ができている。
- `pass:false`、`RECEIPT_NOT_READY`や部分完了なら、元のREQやファイルを編集・削除せず、ログを共有して停止。
- 初回が`pass:true`でも、今すぐ追加の再送・故障注入をしない。後続のG6-E以降で、独立したシートを使用した障害注入方法の安全性を検証する。

## 実施範囲

TEST Apps Script内部`doPost`への直接呼出し。Web App HTTP経路ではない。障害注入や意図的な部分書込みは含まず、本番Drive・本番Apps Scriptには同期しない。
