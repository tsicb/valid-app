# Current State

Last updated: 2026-11-20

This file documents the repository baseline and the latest production-release verification. Older development checkpoints below are historical snapshots and may contain descriptions such as "not deployed" that were true at that earlier date.

## New V2 READY source-retirement preflight (2026-11-20; PR #53 merged and GAS source synced)

- **Controlled GAS source SYNC confirmed:** GitHub Actions [run #44756995296](https://github.com/tsicb/valid-app/actions/runs/44756995296), `CONFIRM_MODE: SYNC`, GitHub `main` SHA `0f70a7e68375445eb063a1e54599d65f28c96284`, audit `remote=26 expected=26 changed=2 new=0 unexpected=0`; only `24_Request_Ledger_V2_Production_Gate.gs` and `25_Request_Ledger_V2_Legacy_Batch_Migration.gs` differed. `clasp push --force` succeeded: pushed 27 files (manifest included). This is **source sync, not Web App redeploy**. No retirement flag was activated, no historic COPY/RETIRE was authorized and no historical `REQ_` records were deleted. Next: execute editor-only `vaaLedgerProdReadyRetirePreflightReadOnly` once with both retirement and legacy-migration settings OFF; examine its aggregate `VAA_PROD_READY_RETIRE_PREFLIGHT` output. Do not enable deletions solely because the preflight passes.

- Objective: stop accumulating freshly finalized `REQ_` data in Script Properties without changing the `report.html` read route, the production V2 admission protocol, or old legacy records. The actual retirement implementation is **already** present behind `VAA_PROD_READY_RETIRE_MODE=RETIRE_VERIFIED_NEW_READY_V1`, but this mode remains OFF and was not activated in this change.
- Add manual-only `vaaLedgerProdReadyRetirePreflightReadOnly` to `24_Request_Ledger_V2_Production_Gate.gs`. Requires V2 PROD sticky gate active, NEW READY retirement mode OFF, historical migration mode OFF, PRIVATE ledger scope valid, valid journal header and <=1000 journal events. Verifies each V2 READY rev2 event via chain lookup, receipt validation, V1 collision exclusion, source REQ exact JSON match, lease absence and Drive managed-folder checks. Outputs only aggregate counts and bounded error categories; no request IDs or receipt payloads.
- `activationAuthorized:false`, `propertyWrites:0`, `journalWrites:0` and `propertyDeletes:0` are invariant: `pass:true` means only *read-only audit conditions passed*, NOT permission to enable the existing deletion flag.
- Legacy history 145 records remains out of scope. The existing source-sync gate (AUDIT before SYNC) still applies. After controlled synchronization, run the read-only preflight while retirement and migration remain OFF. Then separately plan an isolated live CREATE/UPDATE test, benchmark timing and inspect replay behavior before any production retirement mode activation.
- **GitHub verification:** [PR #53](https://github.com/tsicb/valid-app/pull/53) merged to `main` at `8ca18c66b6d10751718fcacf1bd206838efba27c`. CI passed 498 Node regression tests, 4 Python tests, GAS syntax and SHA manifest. **Not yet synced to production GAS.** Before any AUDIT/SYNC, clean temporary `99_Legacy_Target_Inventory_ReadOnly*` files in GAS. Expect `24_Request_Ledger_V2_Production_Gate.gs` to differ and, if PR #52 was not synced yet, also `25_Request_Ledger_V2_Legacy_Batch_Migration.gs`. Do not SYNC if any unexpected GAS script appears. After controlled source sync, run `vaaLedgerProdReadyRetirePreflightReadOnly` once while both retirement and legacy migration are OFF, and share the JSON log. Do not flip the retirement flag or redeploy Web App on audit alone.
- **Never flip** the activated V2 production sticky gate back to OFF. The new preflight does not alter `doPost`, viewer responses or the live Web App deployment unless separately deployed.

## Production target survey completed; protected-target migration change (2026-11-20; PR #52 merged)

- The operator's standalone read-only `VAA_PROD_LEGACY_TARGET_INVENTORY_V2` returned `pass:true`, `surveyCompleted:true`, `sourceStable:true`, `requestPropertiesSeen:145`, `validReadyCandidates:102`, `quarantinedLegacyReady:39`, `nonReady:4`, `modernJournalExcluded:1`, `eligibleAfterJournal:101`, `targetsVerified:45`, `targetCannotOpen:46`, `targetTrashed:10`, `targetWrongMime:0`, `targetOutsideManagedOutput:0`, `targetOtherCheckError:0`, `unexpectedInvalidReady:0`, `quarantinedJournalCollision:0`, and `propertyWrites:0`, `archiveWrites:0`. 46 cannot-open targets may be deleted, permission-changed or otherwise unavailable; the audit cannot distinguish those reasons.
- The current migration audit stops on the first missing target (`REVIEW / TARGET_INVALID`). The proposed narrow GitHub-only patch categorizes historical targets per record, checks dual-archive consistency before excluding any, retains the 39 legacy UPDATE receipts and the 56 inaccessible/trashed target histories in the original Script Properties, and counts `legacyReadySeen`, `quarantinedTargetReady`, `targetCannotOpen`, `targetTrashed`, `targetWrongMime` and `targetOutsideManagedOutput`. Only target-verified histories may be placed into the existing READY replay archive; unexpected target verification failures still STOP the audit.
- `RETIRE` is globally blocked while *any* legacy metadata quarantine or target quarantine remains. `COPY` remains explicitly OFF and must not run without a separate operator-approved production audit and mode change. Even a successful copy of all 45 candidate histories **would not reclaim Script Properties bytes**, because no source REQ_ is deleted. Do not claim the historical capacity issue is solved.
- [PR #52](https://github.com/tsicb/valid-app/pull/52) was merged to `main` at `f7e61f9fe8da53f4abf3121c50338126e001da71` after its branch CI passed 491 JavaScript regression tests, 4 Python tests, GAS syntax and source checksum checks. The PR also fixed a pre-existing test that used a fixed historical timestamp for a supposed future lease. **GitHub only so far:** the revised GAS migration source has NOT been synced to live GAS; no production properties, Web App or ledger rows changed. Next: remove any temporary `99_Legacy_Target_Inventory_ReadOnly` script from live GAS, run `Central API sync to GAS` with `AUDIT`, verify only `25_Request_Ledger_V2_Legacy_Batch_Migration.gs` differs, then run `SYNC` if clean. After source sync, run editor-only `vaaLedgerProdLegacyAuditReadOnly` with migration mode OFF. No COPY or RETIRE permission is implied.

## Temporary target survey stopped during enumeration; independent count-only replacement (2026-11-20)

- Operator ran the temporary `vaaLegacyTargetInventoryReadOnly`. It returned `errorStage:ENUMERATE`, `errorCode:UNCLASSIFIED`, `sourceStable:true`, `validReadyCandidates:null`, `quarantinedLegacyReady:null`, `propertyWrites:0`, `archiveWrites:0`, `pass:false`. This result cannot classify target health because the survey stopped before reaching the target checks.
- Unlike the last production standard audit (which reached `REVIEW / TARGET_INVALID`), the temporary helper called `vaaLedgerProdLegacyEntries_` and aborted at an unclassified error. Cause is not yet proven; do not label targets missing or claim 39 histories were excluded based on this result.
- Prepared a **standalone editor-only count-only helper** `vaaLegacyTargetInventoryV2ReadOnly` that enumerates raw `REQ_` snapshot entries with per-entry guarded evaluation and continues examining safe records even when other records are invalid. It checks V2 journal, quarantined UPDATE identity, active leases, and individual target access/type/trash/location, and emits aggregate counts without IDs, source values or dynamic error text. Local mock verification covered a synthetic 145-REQ case (102 strict-valid, 39 protected, 4 non-READY), five target status categories, unknown record failures and snapshot immutability. No live result yet.
- No change to `central-api/*.gs`, Web App v62, sticky V2 production properties, private Sheets or historical request receipts is authorized. Migration mode stays OFF and COPY/RETIRE remains prohibited. A successful count-only survey is **not** migration approval.

## Legacy dual-archive audit now stops at target verification (2026-11-20)

- After the operator's PR #51 controlled GAS source synchronization, their next editor-only `vaaLedgerProdLegacyAuditReadOnly` returned `pass:false`, `errorStage:REVIEW`, `errorCode:TARGET_INVALID`, `propertyWrites:0`, `archiveWrites:0`, with all report counters at their initialized defaults. This strongly indicates the earlier `ENUMERATE` receipt-format blocker has been passed; the current failure is during per-target Drive verification.
- `validateUpdateTargetDriveFile_` emits `TARGET_INVALID` when Drive cannot open the target spreadsheet or the file is not Google Sheets. It **cannot** distinguish deleted target, removed permissions, transient Drive fault or wrong MIME from this code alone. No target ID or personal data should be printed in logs. Never infer that all target files are missing from a single stopped scan.
- Prepare one temporary editor-only `vaaLegacyTargetInventoryReadOnly` which calls existing ledger scope, source validation, and V2 journal lookups, then surveys **all** strict-valid historical READY targets. Count cannot-open, wrong MIME, trashed, outside managed tree, other check errors and verified cases; preserve the 39 non-replayable legacy UPDATE quarantine and non-READY records. No Script Property or Sheet writes, no COPY/RETIRE authorization.
- Existing migration code remains unchanged and migration mode remains OFF. Preserve activated V2 sticky gate. Inspect total per-status counts and source stability before deciding whether missing historical targets require a permanent quarantine mechanism.

## Production legacy ENUMERATE diagnosis and quarantine predicate refinement (2026-11-20; PR #51 merged, pending live SYNC)

- Follow-up editor-only diagnostic output: `VAA_PROD_LEGACY_REVIEW_PROBE` reported `requestPropertiesSeen:145`, `errorStage:ENUMERATE`, `errorCode:LEDGER_RECEIPT_INVALID`, `sourceStable:true`, `propertyWrites:0`, `archiveWrites:0`, `pass:false`. The failure is **before target/ledger review**, so no historic archive COPY/RETIRE was authorized.
- Code review found that the newly added quarantine predicate required a 20+ character canonical Google spreadsheet ID, **more restrictive than** `vaaLedgerReadyValidateRaw_` which merely tests for a nonempty spreadsheet ID and an exact UPDATE target match. This mismatch can reject old UPDATE receipts intended to be protected. The live root cause is still an inference, not independently proven from secret records.
- Follow-up code change removes the extra canonical-ID constraint **only from the NON-REPLAYABLE quarantine classification**, preserving exact original requestId, READY status/stage, UPDATE mode and equal nonempty target/spreadsheet, and requiring both absent digest and invalid strategy. Quarantined REQ values are never archived, replayed or deleted by this path. Existing strict V1 READY validator and V2 doPost admission are unchanged.
- Editor-only audit now reports a static, allowlisted `errorCode` and distinguishes `ENUMERATE` from `REVIEW`; unknown messages are rendered as `UNCLASSIFIED` so request IDs, source records and private Drive values are not logged. Test fixtures cover short/legacy target representations, invalid missing target, fail-closed handling and redaction.
- **GitHub verified:** [PR #51](https://github.com/tsicb/valid-app/pull/51) merged to `main` at `867fea7a1aa1f68c9c3e15be09c26c4c3c7dc9e4`, after 487 Node regression tests and 4 Python tests passed, plus GAS syntax and checksum validation. **Not yet live:** the modified editor-only migration source has not been synchronized to the active GAS project. The deployed Web App v62 and V2 sticky production mode are unchanged. Migration flag remains OFF; historic REQ_ and archives remain untouched. Next: remove any temporary `99_` diagnostic editor file, run existing AUDIT action and verify only `25_Request_Ledger_V2_Legacy_Batch_Migration.gs` differs, then controlled SYNC and read-only legacy audit. No COPY/RETIRE is approved.

## Legacy READY post-SYNC audit still blocked; exact-code diagnosis pending (2026-11-20)

- The operator confirmed `SYNC` of PR #50 and re-ran the editor-only `vaaLedgerProdLegacyAuditReadOnly`. The result was `pass:false`, `errorStage:REVIEW`, `quarantinedLegacyReady:0`, `sourceStable:false`, `propertyWrites:0`, `archiveWrites:0`. Because the audit only assigns counters and sourceStable after the entire enumeration/review succeeds, zeros and false in this failure response are **defaults**, not conclusive live totals or evidence of mutation.
- The original 145-property shape inventory remains the last valid count-only assessment: 102 strict-valid READY, 39 historical UPDATE READY missing replay proof, 4 nonREADY. The quarantine implementation passed code tests, but this production audit has not yet proven it can finish on the actual history set.
- Do **not** set migration COPY/RETIRE flags, change sticky V2 PROD gate, alter archived receipts or retry source data. Next execute a temporary read-only `vaaLegacyReviewErrorCodeReadOnly` in the GAS editor. This directly invokes the currently synced enumeration and review routines and captures only allowlisted error category and failing phase, without printing receipt values, IDs or errors. Resolve the specific fail-closed condition before a production COPY authorization.

## Legacy READY shape inventory and protected-copy fix (2026-11-20; PR #50 merged)

- Operator's complete read-only inventory reported `requestPropertiesSeen:145`, `validReady:102`, `invalidReady:39`, `nonReady:4`, `invalidJson:0`, and `sourceStable:true` with zero writes. All 39 invalid READY were historical UPDATE receipts simultaneously missing `updatePayloadDigest` and an allowed `updateStrategy`; the other validation failure counters were zero. Do not reconstruct/guess replay identity from old payloads.
- `25_Request_Ledger_V2_Legacy_Batch_Migration.gs` has a narrowly scoped **synced-to-GAS-source** fix: classify those provably legacy UPDATE receipts as quarantined, leave original REQ_ untouched, reject any new/unknown malformed READY, and audit/copy only strictly valid READY receipts (excluding fresh V2 journal READY). New `quarantinedLegacyReady` aggregate counter; RETIRE is blocked while any quarantined READY exists, even after dual backups. COPY continues to preserve every original REQ_.
- 102 strict-valid READY **includes** the first modern V2 UPDATE; likely up to 101 legacy-ready candidates pending journal and target checks. The exact count must come from the next read-only audit, not inferred as guaranteed.
- **GitHub integration:** [PR #50](https://github.com/tsicb/valid-app/pull/50) merged to `main` at `3bbd774e3f2c8a7e564fb881c0b13a20f66a51a9`; branch CI passed 484 Node regression tests, 4 Python tests, GAS syntax and SHA-256 source verification. Main-branch Central API check also passed. **GAS source now synced:** the operator confirmed `AUDIT` run 44704200437 had `remote=26 expected=26 changed=1 new=0 unexpected=0` (only `25_Request_Ledger_V2_Legacy_Batch_Migration.gs` changed), followed by successful [`SYNC` run 44704719450](https://github.com/tsicb/valid-app/actions/runs/44704719450) (`clasp push --force`, 27 files). The manually invoked audit function now uses the updated GAS HEAD; the already deployed Web App v62 is unchanged and needs no redeploy for this editor-only function. Legacy migration mode remains OFF, and no old REQ_ COPY/RETIRE was performed. Read-only Drive check still shows header-only main and backup `receipts`. **Next: run `vaaLedgerProdLegacyAuditReadOnly` once with legacy migration OFF, then inspect the aggregate result before approving any COPY.**

## Legacy migration read-only diagnostic: historic receipt format mismatch (2026-11-20)

- Operator ran `vaaLegacyAuditFailureDiagnosticReadOnly` on live GAS. Returned `pass:false`, `errorStage:VALIDATE_RECEIPT`, `errorCode:LEDGER_RECEIPT_INVALID`, `requestPropertiesSeen:145`, `requestsInspected:2`, `readyInspected:2`, `sourceStable:true`, `propertyWrites:0`, `archiveWrites:0`. The second inspected READY receipt did not satisfy the current strict V1 receipt format; it does **not** mean all 145 properties are invalid.
- Failure occurs during source enumeration, before target or archive checks. The source snapshot was stable. Do not copy, retire, edit historic `REQ_` or modify the sticky V2 flags.
- Next: append and run a single temporary read-only *aggregate shape inventory* across all REQ properties, reporting only fixed field-issue category counts (not record values, IDs, URLs or hashes). Determine compatibility policy from complete counts before changing migration code. This diagnostic is not part of the published GAS mirror; no Web App redeploy required.

## Production V2 gate ACTIVE — first normal UPDATE independently verified (2026-11-20)

- Operator activated the production V2 sticky gate using the one-time preflight/activation function. Their GAS result was `VAA_PROD_V2_ACTIVATION` with `pass:true`, `productionActivated:true`, `checkedFiles:2`, `checkedTabs:3`, `capacityAllowed:true`, `readyRetirementEnabled:false`, `legacyMigrationEnabled:false`, `requestHistoryModified:false`. `modesOff:true` describes the pre-activation state.
- After activation, operator performed a normal **existing-company UPDATE** in the v62 UI and reported success. Independent read-only private main ledger inspection confirms exactly 2 V2 journal events for the same hashed request: `RESERVED` rev1 followed by `READY` rev2. Both rows have V2 schema; the previous-digest link matches; UPDATE target, strategy and payload digest match between reservation, finalization and READY receipt; timestamps are ordered. Main V1 `receipts` and independent backup `receipts` remain header-only (0 historical copies). All private ledger file access/parent checks remain valid.
- This proves the first production V2 UPDATE completed its two-stage journal flow. It **does not** prove new CREATE, a replay after REQ retirement, Script Properties source-record retention by independent readback, or zero duplicate workbooks; none of those can be asserted from this check alone. New READY retirement and legacy batch migration remain OFF. No old REQ_ data was migrated or deleted.
- The production gate is now **sticky**. Do not disable/delete `VAA_JOURNAL_DOP_MODE=PROD_V2_GATED`, `VAA_REQUEST_JOURNAL_MODE=PROD_RESERVATION_V2`, or `VAA_PROD_LEDGER_FENCE=ACTIVE_V1`. If a request HALTs, inspect ledger before any retry; never blindly retry a RESERVED/ERROR ID.
- **Historic migration audit STOPPED (2026-11-20):** operator ran `vaaLedgerProdLegacyAuditReadOnly` with legacy migration OFF; the result was `pass:false`, `errorStage:REVIEW`, `propertyWrites:0`, `archiveWrites:0`, `copyAuthorized:false`, `retireAuthorized:false`. Aggregate counts (`ready:0`, etc.) and `sourceStable:false` are initialized defaults on exception, **not evidence** of zero histories or Script Property mutation. The actual failure is within legacy READY source validation or target/archive review. **Do not COPY, RETIRE, disable V2 PROD mode, or blindly re-run migration.** Next use a private temporary read-only first-failure diagnostic (no IDs/values in logs) to classify the exact error before proposing the smallest correction. This audit failure does not invalidate the independent successful V2 UPDATE.

## Production deployment v62, ledger connections registered (2026-11-20)

- GitHub Actions `AUDIT` run 44671755009 confirmed 19 remote GAS scripts, 26 GitHub scripts, 2 changed, 7 new, 0 unexpected remote scripts. `SYNC` run [44683105124](https://github.com/tsicb/valid-app/actions/runs/44683105124) successfully pushed 27 files (26 scripts + manifest) to the configured Apps Script project, at source commit `b07176a`.
- Operator subsequently executed a one-time safe connection setup script. Confirmed log: `PROD_LEDGER_CONNECTION_SETUP`, `propertiesVerified:4`, `modesOff:true`, `ledgerAccessVerified:true`, `productionActivated:false`, `requestHistoryModified:false`, `pass:true`. The four connection properties reference the new private main ledger, independent backup and managed root/output folders. Temporary editor file `99_Ledger_Setup_Temporary.gs` was then deleted.
- Operator updated the existing versioned Web App deployment to **version 62 (2026-11-20 16:11 JST)** and confirmed its URL was unchanged. The externally accessible GET response has **not yet been independently confirmed**. Runtime functions behind the Web App have not yet been end-to-end exercised with a new synthetic request.
- **V2 production gate is still OFF**. PROD fence has not been armed. Legacy migration and READY retirement are OFF. No historical REQ_ archival or retirement performed. Next: read-only pre-activation verification, then a separately reviewed cutover; never turn the mode OFF after production fence activation. 
- The historical "not synced"/"not deployed" statements below apply to earlier implementation snapshots only.

## Production ledger provisioning and safe GAS source audit (2026-11-20)

- Two new private Google Sheets files were created in the real managed **root** folder: V2 journal/READY main ledger and separate READY backup. Google Drive readback confirms single direct root parent, unshared owner-only permissions and exact header-only tabs (main `receipts` / `journal_v2`, backup `receipts`). No request history copied.
- Upgraded the existing manual GAS sync workflow with `confirm=AUDIT`: source syntax and SHA manifest checks, `clasp pull` only, GitHub versus GAS filename and normalized SHA comparison, no push or deployment. `SYNC` now refuses any unrecognized live GAS scripts that would otherwise be deleted. See [the production read-only GAS audit runbook](PROD_GAS_CUTOVER_READ_ONLY_AUDIT.md).
- **Later operational update:** source sync, connection settings, Web App v62 and the first production UPDATE under V2 are now verified as recorded above. Historical REQ copy and retirement remain outstanding.

## Production V2 request-journal integration (2026-11-20, PR #48; source only, OFF)

- Added `central-api/24_Request_Ledger_V2_Production_Gate.gs` and integrated its gated admission/READY finalization into `doPost`. Production mode is **dormant** by default. Existing TEST journal and legacy request behavior remain available when the PROD gate is not armed.
- Production gateway checks private Google Sheets ledger ACL and direct root folder, V1 READY + V2 journal, UPDATE target/strategy/digest and target file before replay; reserves a new V2 event before any CREATE/UPDATE side effect; RESERVED/ERROR/unavailable/corrupt journal is fail-closed. A sticky Script Property fence refuses unsafe OFF fallback after activation.
- New V2 READY hot receipt retirement is a **separate OFF-by-default mode**, only for new PROD-V2-admitted requests after verified journal READY. Historical legacy REQ_ are never auto-deleted by this path.
- Scope-aware journal functions retain the original isolated TEST default. Targeted Node regression tests pass; no production GAS sync, Web App deployment, property changes or data migration were performed by this GitHub PR. See [full activation and cutover notes](REQUEST_LEDGER_V2_PRODUCTION_GATE.md).
- Also added `central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs`: default-OFF, editor-only dual-private-ledger backup + V1 COPY of up to 10 historic READY receipts per call, separate gated RETIRE after 100% dual-copy verification and safe READY replay. Non-READY, V2 pending and active leases are excluded; no automatic retry. See the [batch migration section](REQUEST_LEDGER_V2_PRODUCTION_GATE.md).
- Remaining for completion: production private ledger and independent backup provisioning/verification; guarded activation and end-to-end test; actual historic READY dual-copy/inspect and separately authorized retirement; gradual enablement of new-request READY retirement. The previous isolated TEST one-off legacy READY copy is verified and the mode returned to OFF.

## Request receipt capacity recurrence guard (2026-11-18, PR #16 draft)

- Storage recovery was independently verified at 382,382 B / 512,000 B (74.7%), but 137 REQ_ entries still account for 333,690 B and the 500-record count-only pruning policy cannot prevent byte saturation.
- Draft mitigation: new `central-api/19_Request_Property_Byte_Guard.gs` calculates UTF-8 key+value projected usage. Before creating any new workbook or acquiring a new UPDATE target lease, preflight requires at least 24 KiB reserved *within* a 90% (460,800 B) write budget. New request receipts are refused at the threshold with a safe user-facing code; no Drive sheet is created by a refused CREATE.
- All `saveRequestRecord_` writes now serialize a shallow copy that omits **only optional `performance`**, preserving the in-memory performance object for immediate API responses. Saved READY/ERROR/PROCESSING records retain requestId, mode, target, update digest/strategy, status/stage, viewer URLs and updateStats. A replayed READY result can have `performance: {}` as with V2 historical compaction.
- Every REQ_ write is checked for the 9-KiB single-value limit. Fresh key writes must remain <=90% of the estimated 500-KiB store. Existing key updates may use the full 500-KiB limit so an already-running request is not rejected simply because the 90% admission ceiling has been reached.
- Legacy count-only `pruneRequestProperties_` is disabled as a destructive cleanup action; it remains as a no-op compatibility shim. Existing missing-target-specific delete behavior is **replaced with fail-closed requestId preservation**; transient Drive errors or malformed prior REQ records must not cause new CREATE. No historical REQ_, VIEWER_, RPTREG_ or configuration records are bulk modified or deleted. For the longer-term authoritative ledger design and zero-loss migration gates, see [requestId ledger architecture](REQUEST_RECEIPT_LEDGER_ARCHITECTURE.md).
- This change is a *safety brake*, not an unlimited-growth solution. No automatic archival or historical compression is introduced. Other property writers (registry, viewer, identity, datastore) are not yet covered by the REQ_ specific byte guards; 24-KiB admission margin is a risk buffer, not an absolute quota guarantee.
- **PR #16 draft code only.** No GAS source sync, new Web App release or production data mutation authorized. After isolated test/review, separate explicit release approval and controlled end-to-end test are required; the old failed CREATE must be reconciled by request ID and workbook before any retry.

## PR #16 merged; isolated TEST GAS source-sync QA prepared (2026-11-18, latest)

- PR #16 was merged into `main` at `3528fe2de4b6dee0f46f611f6f45ed2f075a2cab`. Main branch `Central API check` passed 193 Node tests, 4 Python tests, GAS syntax and SHA-256 checks.
- Request persistence now omits optional `performance` from new REQ_ Script Property values (retained in memory for immediate response), uses a new-request byte-budget guard before CREATE workbook or UPDATE lease side effects, avoids destructive count-only pruning, and fails closed instead of deleting an existing receipt when Drive or receipt verification fails.
- **GitHub main only**. No production GAS source sync, Web App v61 deployment, or Script Properties modification was performed by this engineering change. Historical V2 compaction backups remain private.
- The historical isolated GAS workflow is pinned to a feature branch, so it cannot safely test current `main` as-is. QA preparation PR #17 introduces a **new**, manual, SHA-pinned `main` TEST GAS source-sync workflow, keeping the historical workflow untouched.
- New test workflow requires independent TEST Apps Script ID and test-only Drive root/output folder IDs; verifies source syntax, regression tests, manifest, exact commit, production ID exclusion, then stages folder-swapped GAS source and runs test-project `clasp push --force` **without a Web App deployment**. It is not triggered automatically and has not been run.
- [QA release gates](REQUEST_CAPACITY_PREDEPLOY_QA.md) require dedicated test Script Properties and synthetic applicant data, then isolated CREATE replay, UPDATE replay and fail-closed verification before any production deploy decision.

## Independent production property-capacity audit confirms recovery (2026-11-18, latest)

- After V2 COMMIT, the operator manually ran the **read-only** `vaaAuditScriptPropertyCapacityReadOnly` at `2026-11-18T07:38:21.501Z`. Independent reported total **382,382 / 512,000 bytes (74.7%)**, exactly matching the V2 commit summary; **258** properties. UTF-8 key+value estimate, not Google's internal billing measurement.
- Aggregate categories: REQUEST_RECORDS 137 entries / 333,690 B (approx. 87.3% of current usage), REPORT_REGISTRY 38 / 32,485 B, VIEWER_MAPPINGS 77 / 15,850 B, PROTECTED_CONFIG 4 / 227 B, SYSTEM_CONFIG 2 / 130 B; UPDATE_LEASES 0. Largest value 4,541 B; no per-value-limit issues.
- Request lifecycle: READY 133, ERROR 4, inProgress 0, malformed 0, activeLease 0; 94 older than 30 days and 0 older than 90 days. No additional writes, deletions, or source deployments were required for audit.
- **Incident state: storage compaction and independent verification COMPLETE.** This is not proof of a successful end-to-end CREATE or of repair of the partially-created workbook; those require separate safe validation. No automatic cleanup is authorized.
- Capacity headroom to 512,000 B is 129,618 B; margin under the desired 75% (384,000 B) is only 1,618 B, so recurrence-prevention design is the next priority. Current count-based `pruneRequestProperties_` does not address byte saturation at 137 REQ entries. Preserve request ID replay checks, protected config, RPTREG and VIEWER mappings; evaluate byte-budget preflight and retention/archival without deleting history as a separate change.
- Both private backups (V1/V2) retained; never publish contents, IDs or URLs. Do not rerun a completed V2 COMMIT.

## Production recovery V2 COMMITTED and verified (2026-11-18, operator commit receipt)

- Operator explicitly approved and ran `vaaCommitReadyPerformanceCompactionV2` after a V2 PREPARE and separate AUTHORIZE. Live success receipt:
  `VAA_COMPACTION_V2_COMMITTED {"phase":"V2_COMMITTED_VERIFIED","scriptPropertiesModified":55,"scriptPropertiesDeleted":0,"estimatedBeforeBytes":529156,"estimatedAfterBytes":382382,"estimatedUsagePercent":74.7,"nonTargetDriftSinceBackup":false,"privateBackupRetained":true,"oldV1BackupUntouched":true}`.
- Exactly **55** old READY receipts had only their optional `performance` removed. Zero Script Property deletions. Final code-level readback verified each write and checked the complete expected final Script Properties snapshot as well as count/capacity.
- Estimated storage fell **529,156 → 382,382 bytes** (103.4% → 74.7% of the assumed 512,000 B quota), reducing by **146,774 B**. This is the observed V2 COMMIT summary rather than an independent post-commit audit.
- Old V1 and new V2 private Drive backups remain retained; do not expose either backup, or property contents and identifiers, in GitHub or chat. V2 User Properties plan and approval are cleared on success. Do not rerun V1 or V2 COMMIT.
- **Completed:** independent editor-only read-only capacity audit corroborated 382,382 B / 74.7%. See the latest section above.
- Before testing any new CREATE from the incident, reconcile the previously failed workbook (which may contain only `シート1` and `98_運用ログ`) and its original request ID/record to avoid duplicate workbook creation. No production CREATE retry performed as part of this recovery.
- Follow-on engineering work: protect future writes with byte-budget checks **before** `saveRequestRecord_` and replace count-only `pruneRequestProperties_` (currently capped at 500 records) with a retention policy that preserves request replay/idempotency and protected VIEWER/RPTREG/identity records. Design/test in a separate PR with no automatic history deletion.

## V2 scoped compaction recovery prepared for review (2026-11-18, historical PR preparation)

- User's live halt audit: all 55 selected READY receipts remain exact originals, zero compacted/unknown/missing; private backup intact; total estimated 529,155 B over 258 properties. The **full** Script Properties snapshot differs from the PREPARE snapshot, although total bytes/count match. The time at which that change occurred is unknown.
- PR #13 introduces independent V2 PREPARE/AUTHORIZE/COMMIT function names and separate User Properties + private backup; it never reuses or deletes V1 private backup.
- V2 checks all selected original raw values and eligibility, accepts unrelated drift only if the **current** projected capacity after the exact planned savings is <= 384,000 B, and verifies a full expected final snapshot after each individual write/readback.
- Failure logs contain only a fixed stage, redacted error category and attempted/accepted/verified write counts, for safe distinction of quota refusal from readback or integrity stops. No automatic retry/rollback or Script Properties deletion.
- **Historical preparation status.** PR #13 was subsequently merged, the operator synced its source and successfully completed the separate V2 PREPARE, AUTHORIZE and COMMIT. See the latest section above. GAS Web App v61 remained unchanged.

## Compaction HALTED after backup / approval (2026-11-18, current)

- PR #11 merged at `c264d61`; user synced `main` source to GAS and ran `vaaPrepareReadyPerformanceCompactionBackup` -> `PREPARED_PRIVATE_BACKUP` (55 READY receipts; 146,774 bytes projected saving; no Script Property writes or deletes).
- User ran `vaaAuthorizeReadyPerformanceCompaction` -> `APPROVED_NOT_COMMITTED` (backup private and verified; no Script Property writes or deletes).
- User explicitly approved the final commit and manually ran `vaaCommitReadyPerformanceCompaction`, which returned `VAA_COMPACTION_HALTED {"appliedCount":0,"backupRetained":true,"scriptPropertiesDeleted":0}` followed by `VAA_COMPACTION_STOPPED_AFTER_0_UPDATES_CHECK_LOG_AND_PRIVATE_BACKUP`.
- **Do not retry COMMIT or delete any property/backup.** `appliedCount=0` counts only verified writes; a first write with readback failure remains possible. A changed full snapshot or over-quota `setProperty` rejection are both plausible, not confirmed.
- Diagnostic PR #12 adds editor-only `vaaAuditStoppedReadyPerformanceCompactionReadOnly` to inspect the current full snapshot, private backup and per-target exact comparisons **without logging IDs or writing anything**. Next operator step: after PR merge/CI and manual GAS sync, run the read-only function and share only the safe `VAA_COMPACTION_HALT_AUDIT_READONLY` JSON. GAS Web App v61 is unchanged.

## Guarded performance compaction implementation (2026-11-18, historical PR review snapshot)

- Live read-only preview: `VAA_PERFORMANCE_COMPACTION_PREFLIGHT_READONLY` found 86 eligible old READY receipts (222,976 B optional performance data). Hypothetical 55-record change (20 CREATE / 35 UPDATE) would save 146,774 B and decrease estimated Script Properties usage to **382,381 / 512,000 B (74.7%)**.
- Draft guarded recovery source `central-api/16_Ready_Receipt_Recovery.gs`: three **manual Apps Script editor-only** stages: private Drive backup of exact request receipt values, separate same-user authorization, and script-lock protected, snapshot-fenced performance-only compaction. No Script Property deletes; all replay/target/digest/viewer references remain unchanged. Backups remain private in the executing user's My Drive and are never logged.
- Preparation verifies the new backup is private *while still empty*, then stores original receipt text; integrity digest is rechecked before allowing any Script Property write. The plan expires after 2 hours. Any concurrent property change aborts before mutation, and a partial write failure stops immediately with the original backup retained.
- **Historical review status only.** Since this snapshot, PR #11 was merged and the operator executed PREPARE, AUTHORIZE and a stopped COMMIT attempt; see current section above. Web App v61 is unchanged.
- [Full recovery procedure](GAS_SCRIPT_PROPERTY_CAPACITY_RECOVERY.md) details the three-stage approach, recovery limitations and post-operation verification. Subsequent recurrence prevention is a separate change.

## Non-destructive READY request receipt compaction preview (2026-11-18)

- Operator's `VAA_REQUEST_CLEANUP_PREFLIGHT_READONLY` result: total 529,155 B (103.4%), eligible 93 old READY receipts (321,206 B), deletion proposal 46 old receipts (16 CREATE / 30 UPDATE) would free 149,559 B to 379,596 B (74.1%). **No property was deleted.**
- Removing READY `REQ_` receipts would lose requestId deduplication and can allow repeated CREATE/UPDATE processing. Rather than proceeding with deletion, we created a new read-only alternative `vaaPreviewReadyRequestPerformanceCompactionReadOnly`: simulate dropping only the optional `performance` subobject from old READY receipts, while retaining every other field, including request IDs, spreadsheet IDs, update strategy/digest, output URLs and updateStats.
- This function estimates savings without any live writes. It returns counts and aggregate byte totals only, with no secrets or IDs. It requires a separate Apps Script editor execution after source sync; performance-only feasibility has **not yet been measured on the user's live project**.
- Actual compaction needs its own guarded, backed-up operation and explicit approval after reviewing the new output. GAS deployed Web App v61 remains unchanged; do not repeatedly submit CSVs while quota remains exhausted.

## Script Properties saturation: 103.4% and cleanup preflight (2026-11-18)

- Actual protected audit result: `propertyCount=258`, estimated `529153/512000` bytes (103.4%); `REQ_` 137 entries, `480464` estimated bytes (90.8%); 133 READY, four ERROR, zero in progress, zero active leases; 94 older than 30 days. `RPTREG_` 38 and `VIEWER_` 77 entries must not be touched during recovery. This diagnoses quota saturation as the source of the new CREATE failure, not CSV content.
- Recovery-preflight function `vaaPreviewOldReadyRequestCleanupReadOnly` added in `central-api/15_Property_Capacity_Diagnostics.gs`. It estimates the number/bytes of **old READY only** records necessary to reduce total estimated property usage to 75%, and excludes ERROR, in-progress, current lease, malformed, unlinked or newer records. Output is aggregated, with no keys, values or sheet IDs.
- This function is **read-only**. No `deleteProperty` or `setProperty` is called, and it cannot authorize deletion. Removing old request receipts would weaken retry idempotency for old requestIds; any real cleanup requires explicit approval, backups, concurrency guards and post-deletion verification.
- [Recovery procedure](GAS_SCRIPT_PROPERTY_CAPACITY_RECOVERY.md) documents running the editor-only preflight after `Central API sync to GAS`; existing Web App v61 remains unchanged, and no CSV retry should occur before property recovery is confirmed.

## Script Properties quota incident — read-only diagnostic ready (2026-11-18)

- A newly created company workbook (2026-11-18) logged `DATA_CREATE / INTERNAL_ERROR`: Script Properties storage capacity exceeded; workbook creation had reached only the default sheet and `98_運用ログ`. User reproduced without closing index/report. **No evidence currently points to malformed applicant CSV.**
- Existing `saveRequestRecord_()` writes a `REQ_` record before `pruneRequestProperties_()` runs; exhausted capacity can therefore block even the cleanup path. The 2026-11-18 read-only audit (summarized above) identified the allocation, with `REQ_` using ~90.8% of estimated bytes.
- Safe diagnostic source: `central-api/15_Property_Capacity_Diagnostics.gs`, function `vaaAuditScriptPropertyCapacityReadOnly`. It reads Script Properties only and logs aggregate counts/UTF-8 byte estimates and request age/status counts. Does **not** log keys/values or change properties, Drive, Sheets, GAS Web App, viewer tokens or stored reports.
- [Read-only recovery runbook](GAS_SCRIPT_PROPERTY_CAPACITY_RECOVERY.md) explains synchronization to the existing GAS project, Apps Script editor execution, and safe result sharing. **Do not delete any properties or repeat new CREATE while recovery investigation is incomplete.**
- [PR #8](https://github.com/tsicb/valid-app/pull/8) prepared the diagnostic. [CI #44236295948](https://github.com/tsicb/valid-app/actions/runs/44236295948): **144/144 tests passed**. This section does not imply that code has been synced to GAS or diagnostic output collected; these are the next operator-assisted steps.
- Existing deployed GAS Web App **v61** remains in place; no new version/deployment required just to run the diagnostic in the editor.

## Shared drilldown for basic and detailed report tables (2026-11-14)

**Production code released; actual company-browser visual acceptance pending.**

- [PR #7](https://github.com/tsicb/valid-app/pull/7) merged into `main` at `7661ec77fa78135b5b430b6e1dcda7e62e6d404f`. No Central API/GAS/Worker/DataStore changes: only `analysis-core.js`, `report.html` and `tests/report-shared-drilldown.test.cjs`.
- The same existing nine-field anonymous modal now opens for **age composition**, **basic analysis cross tables**, **basic self-axis distribution tables**, **note-first-line details**, **Indeed tag details**, and **TOP-image details**. Clickable metrics include individual intersection counts, row totals, column totals, overall totals, target-age application counts and recent-month application counts where displayed.
- Newly attached `drilldownRecords(options)` functions use the **original input record arrays and exact same category functions** as each aggregation (lazy on click; no per-table cloned record matrices). `rowKey`, `columnLabel`, `columnLabels` and `targetOnly` identify membership. Dataset scope/age-period filters remain unchanged and **the number returned is checked against the cell's displayed integer before opening**. Changes to sorting do not change stored row labels/keys.
- Indeed tag drilldown keys by tag **code**, so the same application can legitimately be counted under multiple tags. The existing `（タグなし）` bucket is preserved. TOP image drilldown keys by source filename, including the `（TOP画像なし）` bucket. Display-limited groups remain limited as before.
- **Not clickable:** percentage/ratio cells, number of job postings, per-job application rates, forecast/estimated cells, graphs and month-progress dashboard (stage 3 deferred).
- Existing custom-analysis modal flow is unchanged except for sharing the final record-modal opener, and its original application count filtering remains intact.
- [Branch CI #43585526436](https://github.com/tsicb/valid-app/actions/runs/43585526436): **139 / 139 tests passed**, including shared matching, age/column/month selectors, target/recent, multi-tags, image matching, delegated event dispatch, and JavaScript parsing.
- User-browser smoke still required: refresh shared report; click counts in age/basic/detail tables; inspect exact 9-column record content and matching count; verify month mode and target/recent cells; confirm sorting, copy/Excel, sticky headers/horizontal scrollbar and unchanged custom drilldown.

## Custom applicant drilldown business columns (2026-11-14)

- [PR #6](https://github.com/tsicb/valid-app/pull/6) merged into `main` at `5acc9af72691879c2d03580b54e38c37a6a0a505`.
- Applicant detail modal shows exactly nine fields in order: **仕事番号／応募日時／対応状況／仕事名／勤務都道府県／年代／性別／応募媒体／下限給与**. Record ID and source data type are no longer displayed, but retained internally.
- Exact stored application clock time is displayed without timezone conversion; `AGG_DAILY` and date-only inputs are labelled **（時刻不明）** instead of showing a synthetic midnight.
- Workplace prefecture and job title come from the joined `jobAnalysisMaster`; minimum salary displays the normalized salary type and `給与金額MIN` as e.g. `時給 1,300円`. Missing pay type/amount, old gender field, or unmatched job attributes are displayed as `—` rather than inferred.
- The 9-column table retains horizontal scrolling, sticky headers, 50-record paging, and modal close behavior. Exact source strings are escaped before rendering; no name, phone, email, raw address, identification key or Viewer token is shown.
- Changes limited to `report.html` and `tests/report-custom-detail-columns.test.cjs`. No Central API/GAS v61, DataStore, app identity or analysis aggregation changes.
- [Feature CI #43579004036](https://github.com/tsicb/valid-app/actions/runs/43579004036): **129/129 tests passed**, including eight new tests for data fields, clock time, `AGG_DAILY`, pay formatting, missing jobs, escaping, paging and JavaScript syntax.
- Real-browser modal visual acceptance pending. Existing Viewer tokens allow access to these extra non-contact attributes; continue to restrict report sharing appropriately.

## Default report charts ON (2026-11-12)

- `report.html` now starts with the global chart toggle **ON**. The initial HTML `aria-checked`, label and tooltip are aligned; `initializeViewerPeriod` also resets charts to ON on each new report load.
- Users can still switch graphs OFF/ON; analyses rerender with the selected state. Switching OFF is **not** persisted across reloads (a new load returns to ON).
- Existing lazy-render behavior through `IntersectionObserver` is retained, so offscreen charts are created as they approach the viewport.
- Change scope: `report.html` and `tests/report-chart-default-on.test.cjs` only. No changes to GAS v61, datasets, chart calculation or external Viewer URLs.
- [GitHub Actions #43241483576](https://github.com/tsicb/valid-app/actions/runs/43241483576): **121/121 tests passed**, including four new tests for ON initial state, reload behavior, OFF→ON toggle and lazy chart rendering.
- Live-browser visual acceptance after GitHub Pages deploy is still pending.

## Custom analysis age axis & anonymous applicant drilldown (2026-11-12)

**Production code status: RELEASED / awaiting user-browser acceptance.**

- [PR #5](https://github.com/tsicb/valid-app/pull/5) merged into main at `129e87474625c4be368e578f0b60149d338bcd3e`.
- GAS Central API source synced from verified feature commit `91d23a51c5536c7bef494f793ec8143a1849f62c` via [Actions #43233271271](https://github.com/tsicb/valid-app/actions/runs/43233271271) and [#43233443196](https://github.com/tsicb/valid-app/actions/runs/43233443196); both `completed/success` on exact expected SHA.
- The operator redeployed the **existing** Apps Script Web App to **version 61** (2026-11-12 23:10 JST), preserving the deployed URL and prior v60 for rollback. Runtime public `/exec` could not be directly fetched from the assistant environment; this version confirmation is operator-reported.
- [main CI #43234766012](https://github.com/tsicb/valid-app/actions/runs/43234766012) and [Pages deploy #43234765436](https://github.com/tsicb/valid-app/actions/runs/43234765436) both completed successfully on the merge SHA; pre-merge Node tests **117 passed / 0 failed**.
- The report's custom analysis now includes the **年代** application-scope row/column axis. It uses the existing `record.ageBucket` (normal / shifted age group, existing global age filter) and is subject to display-setting `age` visibility and the stored `年齢` column.
- Count cells, row totals, column totals and grand total open a 50-record-per-page **anonymous detail modal**. The drilldown references exactly the records counted by the custom pivot, preserving job-join scope. Displayed columns: record ID, application date (no time), medium, age band, status, job number/title, and daily-aggregate indicator; no name, phone, email address, raw address, or identity key.
- Central API `customAnalysisAxisRules_()` permits 年代 in `30_分析レポート初期設定` through `['年代','age']` but **does not change data schemas or stored applicant records**. No manual data migration is required.
- **Pending browser smoke**: refresh an existing report; select 年代 as row or column; click a nonzero leaf cell / row total / column total / grand total and verify count and representative records, 50-record paging if applicable, modal exit and restored scroll, sticky horizontal layout, Excel/TSV output. Test available axes with the age display setting ON/OFF. Do not paste tokenized Viewer URL or applicant detail to public issues.
- Rollback references: Web App v60 and pre-PR main `07cce8eb83a41477277a0d1ca9d48eae715a2d79`. Revert frontend and restore compatible GAS deployment together when necessary; do not delete or rotate existing tokens/keys.

## Production release: incremental APPEND/REPLACE (2026-10-26)

**Status: RELEASED / PRODUCTION ACCEPTANCE PASSED / NORMAL CSV OPERATION RESUMED.** New Pages source and existing GAS Web App deployment are aligned.

- GAS: Existing Web App deployment updated from **version 59** to **version 60** (operator-reported). Its public `/exec` GET was verified by the operator: `schemaVersion=3.0`, `updateProtocol=IDENTITY_V1`, strategies `APPEND/REPLACE`, identity version 1. Version 59 is retained as a rollback reference.
- Source sync: [GitHub Actions #40212200066](https://github.com/tsicb/valid-app/actions/runs/40212200066), success at feature commit `b39c442d27ab635df98663a4528b87741e95e065` (`clasp push --force` 16 files).
- GitHub: [PR #2](https://github.com/tsicb/valid-app/pull/2) merged; release merge commit `c68346af0567d12780f0288ec1b90254e4520022`. [Pages deployment #40212837619](https://github.com/tsicb/valid-app/actions/runs/40212837619) and [main CI #40212838082](https://github.com/tsicb/valid-app/actions/runs/40212838082) both succeeded. Previous main rollback baseline is `7aa3fae0f2280b91fbc9ae9ea27ffac2397bdff2`.
- Production acceptance, **synthetic test company only**: CREATE 7 → APPEND 10 (+3) → identical APPEND 10 (+0) → AirWork daily reported decrease (7 to 3) still retained 10 → REPLACE 4 (hourly pay 1200 to 1600) → CSV_B APPEND 5 (+1, PERSON_ID). Each stage was verified with Sheets internal state/log and DataStore JSON, not merely a success message.
- Operator confirmed a **pre-existing company report remains viewable** after rollout. All six synthetic data-write scenarios passed; normal CSV activity may resume.
- Original 49 production DataStore files still matched all 49 independent private backup files by name and size after the acceptance tests; all 12 production management Sheets were separately backed up before deployment. This does not represent a full new hash comparison or a post-release snapshot of subsequent real updates.
- **Legacy migration**: If a company DataStore lacks `applicationIdentityVersion=1`, its first APPEND intentionally returns `MIGRATION_REQUIRED`. Perform a carefully checked initial REPLACE **only when complete historical source CSVs are available**; do not use a partial CSV and accidentally discard earlier applications.
- Other release cautions: reload older open `index.html` tabs before operating; preserve the long-lived HMAC Script Property; retain GAS v59 and the private baseline backup. UI visualization of the AirWork decrease warning was not independently observed, although detection in DataStore `aggregateDecreases` was verified.
- Details and privacy-safe acceptance records: [production runbook](INCREMENTAL_PRODUCTION_RELEASE_RUNBOOK.md) and PR #2 conversation.

## Custom-analysis sticky header width fix (2026-10-26)

- [PR #4](https://github.com/tsicb/valid-app/pull/4) merged into main as `cc94c998c26a483b0e3a18635886a9a5ce596ffc` (report-only UI repair).
- Root cause: detached sticky-header copy did not inherit `#customResult .custom-table` natural-width styling and could expand to the generic 720px minimum even when the source measured 686px; cloned inline sticky offsets could also persist.
- Fix: copy exact first-row header widths to custom-only `colgroup` and clone table dimensions, mirror border collapse, clear cloned header sticky positioning. Keep source pivot sticky columns and non-custom tables intact.
- Headless Chromium synthetic reproduction: source widths 112/134/104/112/112/112 (686px), clone was 720px before fix and exactly 686px after. Additional Node tests cover 1–3 axes, resizing, non-custom tables, and inline script syntax; PR CI passed **107/107**.
- No GAS, Worker, Sheets or DataStore changes. User-browser confirmation of existing Viewer table, sticky mode, and horizontal scrolling remains a separate postdeploy check.

## Report custom-analysis row-axis drag reorder (2026-10-26)

**Production status: MERGED AND DEPLOYED; real-browser UX confirmation pending.**

- [PR #3](https://github.com/tsicb/valid-app/pull/3) merged into `main` at `d749694bedf42dac62b3418630ee6bfc80b5f7b5`.
- [GitHub Pages deploy #40263090090](https://github.com/tsicb/valid-app/actions/runs/40263090090): **success** at the same merge commit; [main CI #40263090305](https://github.com/tsicb/valid-app/actions/runs/40263090305): **success**.
- Only `report.html` and `tests/report-custom-axis-reorder.test.cjs` changed. Central API, DataStore, Sheets, Worker, and `analysis-core.js` were **not** changed or redeployed.
- Custom-analysis row axes 1–3 are displayed in a vertical sortable list. Drag handles work through Pointer Events, plus up/down buttons and keyboard arrow keys. Dropping outside cancels. Reorder triggers existing debounced aggregate only after commit.
- Column axis remains independent; duplicate-axis rules, available-axis filtering, viewer-token route and Sheet defaults are unchanged.
- Node automated regression suite: **100/100 passed**, including six focused tests for drag/keyboard/reorder/empty optional rows and report JavaScript syntax.
- Operator follow-up smoke: open an existing report with at least two active custom row axes, move 1↔2 and 1→3, check pivot grouping and table output, confirm column axis unchanged; also check narrow viewport/touch where available.
- Previous `main` before this UI release was `7f5a9be70e9813d8a6e98052f82d03432f2f362c`. Rollback should use a reversible commit rather than force-push.

## Versions

- GitHub Pages: **v30.45**
- Central API source baseline: **v2.47**
- Cloudflare image Worker: **v2**
- Spreadsheet schema: **3.0**

The current Apps Script project header was manually confirmed as:

- `Integration v2.45 canonical image URL fix / schemaVersion 3.0`
- Script Properties include `SCHEMA_VERSION = 3.0`
- `APP_VERSION` is an independent runtime label

The complete 11-file GAS source was then provided from the current Apps Script project and compared against the previously recorded v2.45 source snapshot.

**Result: code content matched.**

The raw upload used CRLF line endings, while most of the prior package used LF. After line-ending normalization, the code is identical. The repository now stores the canonical Central API source under `central-api/*.gs` with LF line endings.

The four root Pages files on `main` are the Pages v30.45 source baseline:

- `index.html`
- `report.html`
- `analysis-core.js`
- `common-masters-v1.js`

## Latest user-flow model

- Individual management sheet = company home
- Existing-company index = company-specific update/work screen
- Report = final analysis destination and company-shareable surface
- Global/admin-style navigation was intentionally reduced to keep the normal route obvious

## Recent completed work

### Navigation / UX

- `viewer-admin.html` removed
- sharing settings moved into index and later simplified around company-home routing
- new vs existing index copy separated
- URL company-name parameters removed
- report sharing URL shortened to token-only form
- company management-sheet home simplified around `分析を見る` / `データを更新する`
- existing update page no longer acts like a global navigation hub

### Sharing

- stop/resume/URL rotation moved to dedicated sharing UI
- confirmation strength varies by risk
- lightweight `manageSharingLoad` introduced
- measured sharing load improved from roughly 10-15s to roughly 3-4s in the recorded test
- `debug=1` timing display retained for diagnostics

### Output folders

- first-level folder selection under shared root
- recently successful destination folders remembered in localStorage
- most recent valid folder is the default selection
- shared root is shown immediately after the most recent folder
- wording encourages `自分用のフォルダを新しく作る`

### Report

- age lower/upper Range Picker
- month-column limit raised from 24 to 36
- row-label tooltip truncation detection hardened against subpixel/rounding edge cases
- sticky/floating-scroll/managed-image and other existing interactions preserved

### Images

- Worker v2 canonicalizes relative image paths
- Central API v2.45 canonicalizes stored image URLs and repairs existing relative paths on sync
- report/Pages retain defensive canonicalization

### Custom analysis defaults (Central API v2.46)

- `30_分析レポート初期設定` now owns the company-specific initial custom-analysis axes
- four visible settings are ensured: `カスタム分析 行軸1`, `カスタム分析 行軸2`, `カスタム分析 行軸3`, `カスタム分析 列軸`
- existing workbooks migrate their previous hidden `34_カスタム分析設定` values into the new visible settings on finalize/update
- row axes support the report's existing maximum of three levels
- duplicate/hidden/unavailable axes are normalized safely before Viewer data is returned
- the 30-sheet dropdown exposes technically available axes so setting order does not matter; Viewer then enforces the current `31_分析レポート表示項目` state when report data is read
- `34_カスタム分析設定` remains hidden as a compatibility mirror
- Pages remain v30.41; no report-side code change was required because report already accepts `rowAxes`

### Gender analysis (Pages v30.42 / Central API v2.47)

- application CSV column `性別` is now retained in `applicationData` after `年代`
- source gender values are normalized for analysis: `男` / `男性` -> `男性`, `女` / `女性` -> `女性`, blank / `不明` -> `不明`, while `未回答` remains distinct
- gender is a basic-analysis item under the `求職者` group and is available as a custom-analysis axis
- the report title is `性別ごとの応募傾向`
- gender analysis uses `男性` / `女性` / `未回答` / `不明`; old blank gender values are displayed as `不明`
- generic category sorting is used: total applications descending, then target applications descending, then Japanese label order
- `氏名文字種区分` now uses the same generic category sorting instead of a fixed label order
- legacy application datasets without a `性別` header do not show the gender table or gender custom axis
- index help now explains that gender is stored for aggregate application-trend analysis
- spreadsheet schema remains 3.0; `SHEETS_APP_VERSION` / `EXPECTED_PAGES_VERSION` remain the existing internal compatibility values

### Application CSV normalization (Pages v30.43)

- application CSV_A and CSV_B are normalized before the existing ETL/JOIN pipeline
- encoding is detected per file: UTF-8 BOM / valid UTF-8 first, otherwise Shift_JIS fallback
- CSV_A aliases such as `お仕事NO`, `就業形態`, `掲載仕事備考`, `勤務地名1` are converted to the existing canonical fields
- CSV_B fields such as `応募先企業ID`, `応募日`, `応募者名`, `応募媒体名`, `MAIL`, `応募者対応ステータス（企業）` are converted to the same canonical fields
- CSV_B job-location parts (`求人都道府県` / `求人市区町村` / `求人勤務地住所`) are joined into the canonical `勤務地1` value
- applicant `都道府県` and `住所` are handled after parsing instead of header aliasing, avoiding duplicate `住所` headers in CSV_B
- multiple application CSV files can still be uploaded together; each file is decoded and normalized independently before concatenation
- job CSV parsing remains on the existing header-alias path

### Effective analysis-axis availability (Pages v30.44)

- custom-analysis axis choices now require both the corresponding `31_分析レポート表示項目` setting and source-data capability
- capability is evaluated from the stored source datasets before the current period/age filters, so temporary zero-result filters do not make axis choices appear/disappear
- job-derived axes such as 職種 / 雇用形態 / 勤務地都道府県 / 募集背景 are hidden when their required source values do not exist
- basic-analysis tables use the same capability rule for job-derived axes, avoiding tables that contain only an unavailable source attribute
- 勤務地・居住都道府県一致 no longer requires a matched job record when the application dataset already contains a valid match result
- new ETL runs store an unknown prefecture match as blank when either prefecture cannot be resolved; report presentation renders that value as `（不明）`
- existing DataStore rows are not rewritten automatically; companies receive the corrected prefecture-match values after their CSV data is updated again
- this is a Pages-only change; Central API v2.47 and spreadsheet schema 3.0 are unchanged

### Application-embedded job-analysis fallback (Pages v30.45)

- `jobAnalysisMaster` can now include job-analysis rows sourced from application CSV data when no job CSV row is matched
- each job-analysis row records `求人分析情報ソース` as `JOB_CSV` or `APPLICATION_EMBEDDED`
- when a job CSV row is matched, job CSV values take priority and blank core attributes can fall back to the application CSV copy
- repeated applications for the same job key merge non-empty embedded attributes, so fallback quality does not depend only on the first application row
- application-only fallback is limited to compatible core attributes such as 仕事名 / 職種 / 雇用形態 / 求人勤務地名称 / 勤務地 / 求人備考 / 募集背景
- salary, text-length, image, video and Indeed-tag analyses remain job-CSV-only so their existing definitions are not diluted by application CSV data
- `求人データ突合フラグ` and the report KPI `求人データ突合率` continue to mean actual job-CSV matching; they are not inflated by fallback data
- Viewer records now distinguish `matched` from `jobAvailable`; core job analyses and custom axes use `jobAvailable`, while job-CSV-only analyses continue to use `matched`
- basic column axes for 職種 / 雇用形態 now use job-analysis availability and show `（求人情報なし）` only for applications without either source
- process information records counts for applications/job-master rows using application-embedded fallback
- Central API v2.47 and spreadsheet schema 3.0 remain unchanged; the DataStore already accepts dynamic dataset headers

### Central API GitHub Actions

- `Central API check` workflow added for syntax/checksum validation
- `Central API sync to GAS` workflow added for manual GitHub -> standalone GAS source synchronization
- sync preserves live `appsscript.json` / non-server files via temporary `clasp pull`
- source sync requires explicit `SYNC` confirmation
- Web App redeployment remains a separate manual step
- repository secrets `CLASPRC_JSON` and `GAS_SCRIPT_ID` are configured
- first manual `Central API sync to GAS` run completed successfully; clasp reported `Script is already up to date.`

## Central API source-of-truth status

`central-api/*.gs` is now the canonical GitHub source for Central API v2.47.

The original v2.45 Apps Script source and GitHub mirror were verified code-equivalent. v2.46 was subsequently synchronized and its sheet-update behavior was confirmed. GitHub has now advanced to v2.47. Repository files use LF line endings, and `central-api/SOURCE_SHA256SUMS.txt` records the current v2.47 LF-normalized checksums.

GitHub currently contains v2.47 source. The v2.46 behavior was confirmed before this change. Use the manual `Central API sync to GAS` workflow to copy v2.47 source into Apps Script, then update the versioned Web App deployment separately before treating v2.47 as live.

If Apps Script is edited outside GitHub, reconcile those edits back into GitHub before the next development change.

## Documentation checkpoint (2026-10-12)

- Added `docs/ANALYSIS_AXIS_AVAILABILITY.md` as the current 30-axis source/availability contract and a future smoke-test checklist.
- This checkpoint is documentation-only. No Pages, Central API, Worker, or spreadsheet schema code was changed; runtime deployment status is unchanged.

## Historical incremental-update development checkpoint (2026-10-23; not deployed at that time)

- Work remains on draft PR [#2](https://github.com/tsicb/valid-app/pull/2), branch `feature/incremental-update-pages`; the running GitHub Pages `main` and deployed GAS were **not** updated. The mainline documents/architecture remain the production baseline.
- Central API modules: `11_Append_Merge.gs` (pure merge), `12_Append_DataStore.gs` (safe staged storage), `13_Append_Update_Guard.gs` (protocol/replay/company lease), `14_Append_Identity.gs` (authenticated stable HMAC key). `02_EntryPoint.gs` is wired to APPEND/REPLACE protocol; `01_DataStore_Performance.gs` marks new CREATE DataStores identity-v1.
- Pages: `index.html` and `append-identity-v1.js` implement browser-only applicant HMAC, AirWork daily ordinal keys, APPEND/REPLACE selection and confirmation, API capability gate, and APPEND preview delay.
- Local automated JavaScript tests cover 87 checks (2026-10-25): pure merge, staged DataStore mock, protocol, auth, browser identity, synthetic cross-layer lifecycle, real Pages CSV_A/B normalization, localhost smoke-site builder, isolated test-GAS source stage and safeguards, syntax and SHA-256 source manifest. Do **not** describe this as a Google service integration test.
- A dedicated manual **Isolated test GAS sync** workflow is registered on the default branch so the GitHub Actions Run workflow UI can start it. The workflow requires selecting the feature branch, TEST_ONLY confirmation, a test-only Script ID different from the production GAS_SCRIPT_ID, and separate test Drive folder IDs. It only pushes GAS source; does **not** deploy a Web App. Safety checks are tested.
- A manual **Build isolated Pages test bundle** GitHub Actions workflow validates the deployed TEST GAS via public GET (protocol, schema and exact test Drive folders), builds a localhost-only copy of index/report against the provided TEST /exec URL, and uploads an artifact containing fake CSVs. No public Pages deploy, no access key in the artifact. The deployed test GAS GET/POST preflight has been verified in the manual workflow.
- **2026-10-25 localhost connectivity fix (not deployed)**: Browser POST authentication in the isolated preview showed `再接続待ち` despite successful GET preflight. To avoid cross-origin GAS ContentService redirects, preview Pages now call a fixed same-origin `/__test_api__`; Python `serve_isolated_test.py` proxies only to the configured TEST GAS `/exec` endpoint, bound on 127.0.0.1 without logging keys/bodies. Use `python serve_isolated_test.py`, not `python -m http.server 8765`. Bundle workflow tests invalid-key POST before artifact generation; source changes remain on draft PR #2. The cause is still provisional until this path is tested on the user's PC.
- Isolated test Apps Script is deployed separately and public GET/POST preflight succeeded. Actual Sheets/DataStore CREATE succeeded (7 applicants), followed by APPEND that retained first-save job data and stored 10 applicants (+3, 6 skipped as existing). This was confirmed in the test Sheets log and DataStore `updateStats` on 2026-10-25. Test-only Script ID/Drive folder IDs were not committed.
- **2026-10-25 update confirmation-first flow**: Actual initial APPEND preview stayed at 800 seconds because `report.html` standby tab was reserved before the user confirmed in `index.html`. After the consent click, the GAS update finished correctly. Feature branch now reserves the report tab synchronously inside the modal ACCEPT click and keeps the INDEX tab visible during CSV parsing/consent. CREATE retains its original early tab. Five event-level tests cover consent, cancel, REPLACE acknowledgement, early mode snapshot and tab ordering. User must rebuild the isolated Pages artifact to test the fix; main Pages and production GAS remain unchanged.
- `tests/fixtures/append-smoke/` contains synthetic CSV_A/B and job files. `scripts/build-append-smoke-site.mjs` generates local Pages copies pointing at an explicitly test-only GAS URL and rejects the production GAS URL. Manual live test steps: `docs/INCREMENTAL_LIVE_TEST_RUNBOOK.md`.
- **Do not run the production `Central API sync to GAS` workflow or merge PR #2 before isolated real-service verification**. The API must be deployed in tandem with new Pages: new API rejects old Pages UPDATE by design.
- Core design: `docs/APPEND_UPDATE_IMPLEMENTATION_PLAN_V1.md`.

## Next-chat startup

A new AI/chat should begin by reading:

1. `AGENTS.md`
2. this file
3. `docs/ARCHITECTURE.md`
4. `docs/ANALYSIS_AXIS_AVAILABILITY.md` when analysis axes, availability, or application-embedded job information are relevant
5. the current files involved in the requested change

Do not reconstruct state from old ZIPs if the repository is available.

- **2026-10-25 completed smoke scenarios**: Isolated Google Sheets/DataStore confirmed CREATE=7, APPEND=+3→10, repeated CSV=+0→10, AirWork daily decrease (incoming 3 vs saved 7) preserves 10, REPLACE→4 with revised hourly pay 1,600, then CSV_B PERSON_ID APPEND→5 (CSV had 2 duplicate same-month person-ID rows and the browser kept 1). State READY and DATA_UPDATE SUCCESS. The migration of a legacy non-identity DataStore is still untested in real Google services.
- **2026-10-25 unmatched-job warning UX fix (test branch, not published)**: for UPDATE with a selected job CSV but zero matched applications, show the warning inside the existing mode confirmation modal, before the click that opens report.html. The consent also acknowledges the unmatched warning, so no second window.confirm fires after the report tab opens. REPLACE still requires the destructive-operation checkbox; cancel does not open a tab or save. CREATE retains existing behavior. Five new regression tests cover this; 87 JavaScript tests pass in CI. The user needs to generate a fresh isolated Pages artifact to verify the change in Chrome.

- **2026-10-25 legacy migration verified in isolated Google services**: The separate `LEGACY_MIGRATION_TEST` workbook was created in old format with 7 applicants. First APPEND correctly failed with `MIGRATION_REQUIRED` (audit ERROR). REPLACE saved **4** applicants with `applicationIdentityVersion=1` (not the planned 7; likely the 04 synthetic CSV was selected). Subsequent APPEND accepted 5 of 9 uploaded rows, skipped 4 duplicates, and saved 9 total; audit SUCCESS and DataStore stats match. Job master remained 2 rows at hourly pay 1600. Existing original demo workbook stayed at 5 applicants. Backups retain only the most recent previous generation; after APPEND the backup is the 4-row REPLACE snapshot, **not the original legacy snapshot**. Core migration behavior is therefore validated in live Google services, with test counts noted accurately. Production rollout is still pending.

- **2026-10-25 production release plan prepared, not executed**: `docs/INCREMENTAL_PRODUCTION_RELEASE_RUNBOOK.md` defines PR conflict resolution, no-write cutover window, independent DataStore backups, versioned GAS deployment before Pages merge, acceptance checks and safe rollback. PR #2 conflict was resolved by a merge commit on feature branch (main workflow contents preserved; isolated legacy fixture additions retained). GitHub reported `mergeable=true` and post-merge CI passed 94 JavaScript tests plus 4 Python proxy tests, Pages/GAS syntax and source manifest: https://github.com/tsicb/valid-app/actions/runs/40205673562. PR remains draft and unmerged; no production sync. No production GAS/Pages deployment has been performed.

- **2026-10-26 predeployment data backup verified, no production code changes**: Copied all 12 existing managed production Sheets (folder hierarchy preserved) and all 49 raw JSON DataStores (99,569,396 source bytes) to a private, unshared Drive archive outside managed output. Verified DataStore backup filenames/sizes 49/49, all 12 current Sheet DataStore pointers represented, sample Sheet internal-state readback. Private archive link shared with operator, not committed. GitHub main rollback SHA was `7aa3fae0f2280b91fbc9ae9ea27ffac2397bdff2` when snapshotted; feature PR remains draft. Still need to record actual **deployed** Apps Script Web App version/deployment ID in editor and compare current HEAD to GitHub before syncing. No production script/source/deployment was changed.
