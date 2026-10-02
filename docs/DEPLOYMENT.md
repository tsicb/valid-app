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

Canonical source: `central-api/*.gs`

### Validation

`.github/workflows/central-api-check.yml` validates:

- JavaScript syntax of all `.gs`
- `SOURCE_SHA256SUMS.txt`

It runs for relevant pushes/PRs and can also be started manually.

### GitHub -> GAS source sync

`.github/workflows/central-api-sync.yml` is a manual workflow.

It:

1. requires explicit `SYNC` confirmation
2. validates syntax and checksums
3. authenticates with clasp
4. pulls the current GAS project into temporary staging
5. preserves the live `appsscript.json` and non-server files
6. replaces staged server-side scripts with GitHub `central-api/*.gs`
7. runs `clasp push --force`

Required repository secrets:

- `CLASPRC_JSON`
- `GAS_SCRIPT_ID`

See `docs/GAS_ACTIONS_SETUP.md`.

### Web App deployment

The source-sync workflow does **not** create an Apps Script version and does **not** redeploy the versioned Web App.

For now:

1. update source in GitHub
2. run the sync workflow
3. verify source/runtime
4. manually update the Web App deployment when the change should go live

A separate deployment workflow can be added later with its own confirmation/approval boundary.

Never commit `ACCESS_KEY`, clasp OAuth credentials, or other Script Property values.

## Cloudflare Worker

Development source: `cloudflare-worker/worker.js`

When Worker changes:

1. deploy Worker first if Pages/Central API depend on the new behavior
2. test a representative `?jobId=...` request
3. verify CORS for the GitHub Pages origin
4. verify image URL is absolute HTTP(S)
5. then deploy dependent Central API / Pages changes

## Multi-component order

Default dependency order:

```text
Cloudflare Worker -> Central API source sync/deploy -> GitHub Pages
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
- checksum manifest
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
