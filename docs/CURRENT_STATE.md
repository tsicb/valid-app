# Current State

Last updated: 2026-10-02

This file describes the **repository baseline**, not a guarantee that each external runtime has already been deployed to the same version.

## Versions

- GitHub Pages: **v30.41**
- Central API source baseline: **v2.46**
- Cloudflare image Worker: **v2**
- Spreadsheet schema: **3.0**

The current Apps Script project header was manually confirmed as:

- `Integration v2.45 canonical image URL fix / schemaVersion 3.0`
- Script Properties include `SCHEMA_VERSION = 3.0`
- `APP_VERSION` is an independent runtime label

The complete 11-file GAS source was then provided from the current Apps Script project and compared against the previously recorded v2.45 source snapshot.

**Result: code content matched.**

The raw upload used CRLF line endings, while most of the prior package used LF. After line-ending normalization, the code is identical. The repository now stores the canonical Central API source under `central-api/*.gs` with LF line endings.

The four root Pages files on `main` match the v30.41 release snapshot:

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

### Central API GitHub Actions

- `Central API check` workflow added for syntax/checksum validation
- `Central API sync to GAS` workflow added for manual GitHub -> standalone GAS source synchronization
- sync preserves live `appsscript.json` / non-server files via temporary `clasp pull`
- source sync requires explicit `SYNC` confirmation
- Web App redeployment remains a separate manual step
- repository secrets `CLASPRC_JSON` and `GAS_SCRIPT_ID` are configured
- first manual `Central API sync to GAS` run completed successfully; clasp reported `Script is already up to date.`

## Central API source-of-truth status

`central-api/*.gs` is now the canonical GitHub source for Central API v2.46.

The v2.45 Apps Script source and the original GitHub mirror were verified code-equivalent before this change. GitHub has since advanced to v2.46. Repository files use LF line endings, and `central-api/SOURCE_SHA256SUMS.txt` records the current v2.46 LF-normalized checksums.

GitHub currently contains v2.46 source. The last runtime version explicitly confirmed before this change was v2.45. Use the manual `Central API sync to GAS` workflow to copy v2.46 source into Apps Script, then update the versioned Web App deployment separately before treating v2.46 as live.

If Apps Script is edited outside GitHub, reconcile those edits back into GitHub before the next development change.

## Next-chat startup

A new AI/chat should begin by reading:

1. `AGENTS.md`
2. this file
3. `docs/ARCHITECTURE.md`
4. the current files involved in the requested change

Do not reconstruct state from old ZIPs if the repository is available.
