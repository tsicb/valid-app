# Central API

This directory contains the canonical GitHub source mirror for the Google Apps Script Central API used by 有効応募分析.

Current baseline: **v2.47**, spreadsheet schema **3.0**.

## Verification status

The current Apps Script project supplied by the user contained all 11 source files. They were compared with the previously recorded v2.45 snapshot.

Result: **code-equivalent / no substantive source difference**.

The Apps Script export used CRLF line endings. The repository canonicalizes source text to LF, so checksum comparison must use the LF-normalized files recorded in `SOURCE_SHA256SUMS.txt`.

## Source-file layout

- `00_Config.gs` - schema/app constants and sheet definitions
- `01_DataStore_Performance.gs` - DataStore/performance helpers
- `02_EntryPoint.gs` - Web App entry points and main request pipeline
- `03_Workbook.gs` - workbook/sheet creation and writing
- `04_Request_Target.gs` - request records and target resolution
- `05_Masters.gs` - master-sheet synchronization, including image master
- `06_Viewer.gs` - report Viewer data route
- `07_ViewerManagement.gs` - authentication, sharing and management actions
- `08_Finalize_Diagnostics.gs` - finalize/diagnostics paths
- `09_Registry_Audit.gs` - report Registry and audit
- `10_Utils_State_ImageWorker.gs` - shared utilities/state/image-worker integration

## v2.47 gender analysis

- adds `gender` to Viewer display definitions
- exposes `性別` as a custom-analysis axis
- keeps spreadsheet schema 3.0
- Pages v30.43 performs CSV_A/CSV_B normalization, gender normalization, basic aggregation, legacy-header detection and report presentation

## v2.46 custom-analysis defaults

- company-specific custom-analysis row/column defaults are controlled from `30_分析レポート初期設定`
- row axis supports up to three levels
- the old hidden `34_カスタム分析設定` is retained as a compatibility mirror
- Viewer normalizes defaults against currently enabled analysis axes
- no Pages code change is required for this feature

## GitHub Actions

- `Central API check` validates syntax and the SHA-256 manifest.
- `Central API sync to GAS` manually synchronizes GitHub `.gs` source into the standalone Apps Script project via clasp.
- The sync preserves the live `appsscript.json` and non-server files by pulling the GAS project into temporary staging before push.
- Source sync does **not** redeploy the Web App.

Required one-time setup and secrets are documented in `docs/GAS_ACTIONS_SETUP.md`.

## Rules

- Start Central API changes from these `.gs` files.
- Never commit Script Property values such as `ACCESS_KEY`.
- Do not change action/protocol names casually.
- Preserve authentication, managed-folder checks, schema/storage-layout checks, Viewer-token validation and Registry consistency.
- `manageSharingLoad` is the lightweight sharing-card load path; do not regress it to the old broad managed-state read.
- Update `SOURCE_SHA256SUMS.txt` whenever the canonical source changes.
- Use the manual GitHub Actions sync to update GAS source after GitHub changes.

See `CENTRAL_API_V2_47_GUIDE.md`, repository `AGENTS.md`, `docs/GAS_ACTIONS_SETUP.md`, and `docs/ARCHITECTURE.md`.
