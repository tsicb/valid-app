# Current State

Last updated: 2026-10-02

This file describes the **repository baseline**, not a guarantee that each external runtime has already been deployed to the same version.

## Versions

- GitHub Pages: **v30.41**
- Central API source baseline: **v2.45**
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

### Central API GitHub Actions

- `Central API check` workflow added for syntax/checksum validation
- `Central API sync to GAS` workflow added for manual GitHub -> standalone GAS source synchronization
- sync preserves live `appsscript.json` / non-server files via temporary `clasp pull`
- source sync requires explicit `SYNC` confirmation
- Web App redeployment remains a separate manual step
- repository secrets `CLASPRC_JSON` and `GAS_SCRIPT_ID` are configured
- first manual `Central API sync to GAS` run completed successfully; clasp reported `Script is already up to date.`

## Central API source-of-truth status

`central-api/*.gs` is now the canonical GitHub source mirror for Central API v2.45.

The current Apps Script source and the mirrored GitHub source are code-equivalent. Repository files use LF line endings, and `central-api/SOURCE_SHA256SUMS.txt` records the LF-normalized checksums.

After Actions secrets are configured, use the manual sync workflow to copy GitHub source into the Apps Script project. A successful source sync still does not imply that the versioned Web App deployment was updated.

If Apps Script is edited outside GitHub, reconcile those edits back into GitHub before the next development change.

## Next-chat startup

A new AI/chat should begin by reading:

1. `AGENTS.md`
2. this file
3. `docs/ARCHITECTURE.md`
4. the current files involved in the requested change

Do not reconstruct state from old ZIPs if the repository is available.
