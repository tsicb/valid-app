# Deployment

GitHub commit state and deployed runtime state are separate for Central API and Cloudflare Worker.

## GitHub Pages

Source files are at repository root.

Typical Pages-only change:

1. validate the changed Pages code
2. commit/push to `main`
3. wait for GitHub Pages publication
4. smoke-test the affected route

If Central API and Worker did not change, do not redeploy them.

## Central API (Google Apps Script)

Documentation / source-layout record: `central-api/`

The full `.gs` source is not yet mirrored in GitHub. Runtime source remains the Apps Script project.

When Central API changes:

1. obtain and verify the currently deployed GAS source
2. compare its file layout/checksums with `central-api/SOURCE_SHA256SUMS.txt` when applicable
3. apply and validate the change in the Apps Script source
4. update/create the Web App deployment as required
5. update the repository Central API guide/current-state documentation (and the full source mirror once established)
6. verify `doGet()` reports the expected app/schema information
7. test the affected action before publishing dependent Pages changes

Never commit `ACCESS_KEY` or other Script Property values.

## Cloudflare Worker

Development mirror: `cloudflare-worker/worker.js`

When Worker changes:

1. deploy Worker first if Pages/Central API depend on the new behavior
2. test a representative `?jobId=...` request
3. verify CORS for the GitHub Pages origin
4. verify image URL is absolute HTTP(S)
5. then deploy dependent Central API / Pages changes

## Multi-component order

Default dependency order:

```text
Cloudflare Worker -> Central API -> GitHub Pages
```

Only deploy the components that changed.

## Validation expectations

### Pages

- JavaScript syntax
- duplicate IDs
- changed feature smoke-test
- preserve key analysis/navigation features

### Central API

- syntax across all `.gs`
- action dispatch and response shape
- schema/protocol compatibility
- no secrets in source
- targeted create/update/viewer/sharing test as relevant

### Worker

- JavaScript syntax
- CORS
- cache behavior when changed
- extraction fallback behavior
- canonical image URL

## Runtime-vs-repository check

`docs/CURRENT_STATE.md` records the repository baseline. If an observed production behavior disagrees with the repository, verify actual deployed GAS/Worker versions before changing code to compensate for a stale deployment.
