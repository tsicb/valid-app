# AGENTS.md

This repository is the working source for the **有効応募分析 (Valid Application Analysis)** tool.

Read this file first, then read `docs/CURRENT_STATE.md` and `docs/ARCHITECTURE.md` before making changes.

## Source of truth

- GitHub repository: `tsicb/valid-app`
- Default branch: `main`
- The files at repository root (`index.html`, `report.html`, `analysis-core.js`, `common-masters-v1.js`) are the GitHub Pages source of truth.
- `central-api/` is the canonical source mirror for the Google Apps Script Central API. The current mirrored baseline is **v2.45 / schema 3.0**.
- `cloudflare-worker/` is the development source for the Tenichi TOP-image Worker. A GitHub change is not deployed until the Worker is deployed.
- Do not rebuild from an old ZIP or an old chat attachment. Always inspect current `main` first and apply the smallest required diff.

## Product model / normal user flow

Do not treat the three surfaces as peer applications.

- **個社管理シート = company home** for internal sales users.
- **index.html = work screen** used for creating a new company or updating one existing company.
- **report.html = final analysis destination** and the only surface intended for company/external sharing.

Normal existing-company route:

`shared Drive folder -> company management sheet -> update page (index) -> report`

Normal view-only route:

`shared Drive folder -> company management sheet -> report`

New-company route:

`shared Drive folder / new-company entry link -> index -> management sheet created -> report`

The existing-company index is intentionally company-specific. Do not casually re-introduce global navigation such as "find another company" or "find any report" into that work screen.

## Important current design decisions

- `viewer-admin.html` was dismantled and removed. Search/sharing responsibilities were folded into `index.html`, then the existing-company flow was simplified around the company-home model.
- `report.html` is an endpoint. Do not add internal/admin navigation back to index or management screens without a new design decision.
- Public report URLs use viewer tokens and do not carry company names. Current form: `report.html#r=TOKEN`.
- Existing update route: `index.html#sheet=SPREADSHEET_ID`; sharing deep link may add `&panel=sharing`.
- Company name must come from canonical stored metadata, not URL parameters.
- Sharing actions have different confirmation strengths: copy/open = none, resume = none, stop = confirm, URL rotation = strong confirm.
- Sharing initial load uses the lightweight `manageSharingLoad` path. Do not replace it with the old full managed-state load.
- `debug=1` can display sharing-load timings. It is a diagnostic path, not normal UI.
- Month columns in basic analysis allow up to 36 months. The graph's 10-series limit is a separate concept and should not be conflated with month count.
- Age Range Picker uses independent lower/upper selectors. Preserve this behavior.
- Preserve sticky headers, sticky global analysis bar, floating horizontal scrollbar, scrollSpy, managed image flow, Fast Handoff, Viewer token route, Pivot 3-axis behavior, table copy and Excel export.
- Image URLs must be canonical HTTP(S) absolute URLs. `/images/...` must normalize to `https://ten.1049.cc/images/...`.
- The Worker normalizes image URLs too; Pages and Central API retain defensive normalization.
- Recent output-folder order is stored in localStorage based on **successful saves**, not merely selection. The most recently used valid folder is default, followed by shared-root, then older used folders.

## UI language

User-facing Japanese should avoid development terminology where possible.

- "Viewer" -> `分析レポート`
- "Admin" / `管理` for report sharing -> `共有設定`
- Individual management sheet is positioned as the company's internal home.

Brand colors:

- primary: `#148ecc`
- signature accent: `#eeff16`

Semantic colors (warning, danger, target-age emphasis, target-rate emphasis, etc.) are separate from brand colors.

## Central API rules

See `docs/ARCHITECTURE.md` and `central-api/README.md`.

- Current schema: `3.0`.
- Current source baseline: Central API **v2.45**.
- GitHub `central-api/*.gs` is the canonical code mirror. When editing GAS behavior, start from those files.
- Preserve existing protocol/action names unless there is a concrete reason to version them.
- `EXPECTED_PAGES_VERSION` is an internal protocol/build compatibility value and is not the same thing as the human release label `Pages v30.x`.
- Do not weaken authentication, managed-folder checks, workbook/schema validation or viewer-token checks for performance.
- Prefer performance improvements that remove unrelated reads/writes rather than caching away correctness checks.
- Spreadsheet ID / Registry are canonical linkage data; Drive discovery is not the canonical relationship after creation.

## GAS mirror / deployment discipline

GitHub is now the code source for Central API edits, but GitHub commits do **not** automatically deploy Apps Script.

When Central API changes:

1. edit and validate `central-api/*.gs` in GitHub
2. apply the same source to the Apps Script project
3. deploy/update the Web App as required
4. verify the runtime version/behavior
5. update `docs/CURRENT_STATE.md` if the release baseline changes

If the Apps Script editor was modified outside GitHub, export/compare it against `central-api/*.gs` before continuing, then reconcile GitHub first.

Canonical repository text uses LF line endings. `central-api/SOURCE_SHA256SUMS.txt` records the LF-normalized source hashes.

## Security / repository hygiene

Never commit:

- access keys
- Script Properties values such as `ACCESS_KEY`
- private credentials or API tokens
- user/customer data exports
- temporary debug payloads containing personal data

Public service URLs already required by the frontend are not treated as secrets, but do not add credentials to them.

## Change procedure

1. Inspect current `main` and relevant docs.
2. Identify the smallest code path that owns the behavior.
3. Preserve unrelated behavior and protocols.
4. If Central API behavior changes, update the relevant `central-api/*.gs` source and any release/current-state docs in the same change. If Worker behavior changes, update `cloudflare-worker/` and `docs/CURRENT_STATE.md`.
5. Validate before finishing.

Minimum validation for Pages changes:

- JavaScript syntax
- duplicate HTML IDs
- important feature references still present
- targeted browser smoke when practical

Minimum validation for Central API changes:

- GAS/JavaScript syntax across all `.gs` files
- action dispatch / expected response shape
- relevant schema/protocol constants
- no embedded secret values
- update `SOURCE_SHA256SUMS.txt` when source changes

For multi-component changes, deploy dependencies first:

1. Cloudflare Worker (if changed and consumed by the other layers)
2. Central API (if changed)
3. GitHub Pages

If only Pages changed, do not redeploy GAS/Worker unnecessarily.

## Repository workflow

The user has chosen direct GitHub operation for this project. Small, well-scoped, validated changes may be committed directly to `main`. For wide or risky refactors, prefer a branch/PR unless the user explicitly requests direct-main work.

Keep `docs/CURRENT_STATE.md` short and current so a new chat can resume by reading the repository instead of reconstructing history from old conversations.
