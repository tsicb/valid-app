# Central API

This directory contains the canonical GitHub source mirror for the Google Apps Script Central API used by 有効応募分析.

Current baseline: **v2.45**, spreadsheet schema **3.0**.

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

## Rules

- Start Central API changes from these `.gs` files.
- Never commit Script Property values such as `ACCESS_KEY`.
- Do not change action/protocol names casually.
- Preserve authentication, managed-folder checks, schema/storage-layout checks, Viewer-token validation and Registry consistency.
- `manageSharingLoad` is the lightweight sharing-card load path; do not regress it to the old broad managed-state read.
- Update `SOURCE_SHA256SUMS.txt` whenever the canonical source changes.
- GitHub source changes still need to be applied/deployed to the Apps Script Web App runtime.

See `CENTRAL_API_V2_45_GUIDE.md`, repository `AGENTS.md`, and `docs/ARCHITECTURE.md`.
