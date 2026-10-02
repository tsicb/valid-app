# Central API documentation

This directory documents the Google Apps Script Central API used by 有効応募分析.

Current documented baseline: **v2.45**, spreadsheet schema **3.0**.

## Source mirror status

The full `.gs` source is **not yet committed to GitHub**. Until it is exported/mirrored, the deployed Apps Script project remains the code source of truth for Central API edits.

`SOURCE_SHA256SUMS.txt` records the exact SHA-256 values of the v2.45 source snapshot used with Pages v30.41. It can be used to verify a future export before establishing the full GitHub mirror.

## v2.45 source-file layout

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

## Rules

- Never commit Script Property values such as `ACCESS_KEY`.
- Do not change action/protocol names casually.
- Preserve authentication, managed-folder checks, schema/storage-layout checks, Viewer-token validation and Registry consistency.
- `manageSharingLoad` is the lightweight sharing-card load path; do not regress it to the old broad managed-state read.

See `CENTRAL_API_V2_45_GUIDE.md`, repository `AGENTS.md`, and `docs/ARCHITECTURE.md`.
