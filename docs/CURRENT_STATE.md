# Current State

Last updated: 2026-10-02

This file describes the **repository baseline**, not a guarantee that each external runtime has already been deployed to the same version.

## Versions

- GitHub Pages: **v30.41**
- Central API documented baseline: **v2.45** (full `.gs` source mirror is not yet committed)
- Cloudflare image Worker: **v2**
- Spreadsheet schema: **3.0**

The current Apps Script project header was manually confirmed by the user as:

- `Integration v2.45 canonical image URL fix / schemaVersion 3.0`
- Script Properties include `SCHEMA_VERSION = 3.0`
- `APP_VERSION` is an independent runtime label

This confirms the runtime project is intended to be the v2.45 / schema 3.0 line, but it is **not yet a full source-level verification** against the repository SHA-256 manifest.

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

## Known architectural follow-up

The repository now contains the Central API architecture/release guide and a v2.45 source-file SHA-256 manifest, but **not yet the full `.gs` source**. Until the full source mirror is added, the deployed Apps Script project remains the code source of truth for API edits.

The Apps Script project header has been manually confirmed as v2.45 / schema 3.0. Before promoting GitHub to the code source of truth for the Central API, export or provide the complete current `.gs` sources and compare them with the documented v2.45 layout/checksums.

A GitHub documentation commit does not imply an Apps Script deployment.

## Next-chat startup

A new AI/chat should begin by reading:

1. `AGENTS.md`
2. this file
3. `docs/ARCHITECTURE.md`
4. the current files involved in the requested change

Do not reconstruct state from old ZIPs if the repository is available.
