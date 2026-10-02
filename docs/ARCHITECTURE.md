# Architecture

## 1. Product surfaces

### A. GitHub Pages `index.html`

Internal work screen.

Two modes:

- **new company**: create a new management sheet and analysis report data
- **existing company**: update one specific company's data

The existing-company mode is intentionally narrow. It should not become a global admin/navigation hub.

### B. Google Spreadsheet / 個社管理シート

Internal **company home**.

Visible sheets are centered on:

- `00_このレポートについて`
- `30_分析レポート初期設定`
- `31_分析レポート表示項目`
- `40_仕事名KWマスタ`
- `41_画像マスタ`
- `42_企業IDマスタ`

`01_データ連携情報` is hidden.

The home sheet gives the normal routes to:

- analysis report
- data update
- internal settings/master tabs

### C. GitHub Pages `report.html`

Final analysis experience.

- company sharing is allowed here
- no admin/index return navigation is normally shown
- report access is controlled by a Viewer token

## 2. Normal route

Existing company:

```text
Shared Drive folder
  -> company management sheet (home)
      -> report                    [view analysis]
      -> index existing-company    [update data / sharing settings]
           -> report               [after update]
```

New company:

```text
Shared Drive folder / new-company entry document
  -> index new-company
      -> create management sheet
      -> report
```

External/company user:

```text
shared report URL -> report.html only
```

## 3. Central API (Google Apps Script)

The Central API owns:

- authentication/access-key validation
- create/update request lifecycle
- workbook creation and update
- managed-folder / target validation
- spreadsheet schema and storage-layout checks
- DataStore-backed analysis datasets
- master-sheet synchronization
- Viewer token mapping and report data delivery
- sharing stop/resume/URL rotation
- Report Registry and audit functions
- lightweight sharing-state load (`manageSharingLoad`)
- managed image / image URL persistence

Current spreadsheet schema is `3.0`.

Important distinction:

- human release label: e.g. `Central API v2.45`
- internal compatibility constant: `EXPECTED_PAGES_VERSION`

They are not the same version namespace.

## 4. Viewer / sharing model

Public report URL:

```text
report.html#r=VIEWER_TOKEN
```

The company name is not encoded into the URL. It comes from canonical report metadata.

Sharing actions:

- copy URL: no confirmation
- open report: no confirmation
- resume viewing: no confirmation
- stop viewing: confirmation
- rotate sharing URL: strong confirmation; old URL becomes unusable after successful rotation

Viewer token mappings and Registry linkage must remain consistent.

## 5. Sharing-load performance

The old admin flow loaded a broad managed state and took roughly 10-15 seconds in measured cases.

The current sharing card uses `manageSharingLoad`, which keeps safety checks but omits unrelated Registry/master/history reads. Measured examples after the change were roughly 3-4 seconds total, with API processing roughly 1.5-2.6 seconds.

`debug=1` may display timing diagnostics. Do not use the old full managed-state builder merely to populate the sharing card.

## 6. Storage / folders

New company management sheets are stored under the configured shared Drive root:

- shared-folder root
- an existing first-level folder
- a newly created first-level personal/organizing folder

Deeper folder hierarchy is intentionally outside the managed selection model.

After creation, linkage should use Spreadsheet ID / Registry rather than repeated Drive discovery as the canonical relation.

Output-folder UI remembers successful-save history in localStorage:

1. most recently used valid folder (default selection)
2. shared-folder root
3. older recently used folders
4. unused folders
5. create a new personal folder

## 7. Report analysis behavior to preserve

Key behaviors include:

- age mode / application-month mode
- global period + age filters
- separate target-age concept
- month progress
- basic / detailed / custom analysis
- graph ON/OFF
- multiple line chart in month mode with pointer tooltip
- target-rate >= 50% emphasis
- TOP image thumbnail + filename in one sticky column
- TSV table copy
- Excel export of currently displayed results
- sidebar scrollSpy
- sticky global analysis bar
- sticky table header
- floating horizontal scrollbar
- lower/upper age Range Picker
- managed image

Application-month column safety limit is currently **36 months**.

The chart's **10-series** limit is a separate safety/readability rule for the number of plotted series, not the number of month columns.

## 8. Image pipeline

TOP-image flow uses a Cloudflare Worker against Tenichi job pages.

Worker extraction order currently includes:

1. JobPosting JSON-LD image
2. picture/source srcset
3. img data-src

Returned image URLs are canonicalized to absolute HTTP(S) URLs. In particular:

```text
/images/... -> https://ten.1049.cc/images/...
```

Normalization also exists defensively in Pages and Central API. Existing relative URLs in `41_画像マスタ` are repaired during normal synchronization.

The Worker success cache is 6 hours. Worker v2 changed the internal cache key so stale relative-URL cache entries are naturally bypassed.

## 9. `viewer-admin.html`

Deprecated and removed.

Do not recreate it without a new product decision. Its old responsibilities were intentionally redistributed and then simplified around the company-home flow.
