# GitHub Actions -> Google Apps Script source sync

This repository can update the standalone Central API Apps Script project from GitHub Actions.

The workflow is intentionally **manual** and updates **source code only**. It does not redeploy the Web App.

## What the workflow does

`.github/workflows/central-api-sync.yml`:

1. requires the operator to type `SYNC`
2. validates all `central-api/*.gs` files
3. verifies `central-api/SOURCE_SHA256SUMS.txt`
4. authenticates to Apps Script with clasp
5. pulls the current GAS project into a temporary staging directory
6. preserves the live `appsscript.json` and any non-server-side files
7. replaces staged `.gs/.js` server files with GitHub `central-api/*.gs`
8. executes `clasp push --force`

The temporary pull is important: the repository does not need to guess or recreate the live Apps Script manifest.

## One-time setup

### 1. Enable Apps Script API for the Google account

In the Google Apps Script user settings, enable the **Google Apps Script API**.

### 2. Create clasp OAuth credentials on a trusted local PC

With Node.js installed:

```bash
npx @google/clasp@3.3.0 login
```

Complete Google OAuth in the browser.

clasp creates:

```text
~/.clasprc.json
```

On Windows this is normally under the current user's home directory, for example:

```text
C:\Users\<user>\.clasprc.json
```

Treat this file as a password-equivalent secret because it contains a refresh token.

### 3. Get the Apps Script project Script ID

Open the standalone Central API Apps Script project:

**Project Settings -> IDs -> Script ID**

Copy the Script ID.

### 4. Add two GitHub Actions repository secrets

In:

**valid-app -> Settings -> Secrets and variables -> Actions**

create:

#### `CLASPRC_JSON`

Paste the complete contents of the local `.clasprc.json`.

#### `GAS_SCRIPT_ID`

Paste the Central API Apps Script **Script ID**.

Do not commit either value to the repository.

## Running the sync

Open:

**GitHub -> valid-app -> Actions -> Central API sync to GAS -> Run workflow**

Enter:

```text
SYNC
```

and run the workflow.

A successful run means the Apps Script editor source has been synchronized to the GitHub `central-api/*.gs` source.

## Important: source sync is not Web App deployment

`clasp push` replaces the Apps Script project's source content.

It does **not** automatically move an existing versioned Web App deployment to a new version.

For now, after a Central API code change:

1. sync GitHub -> GAS with this workflow
2. verify the source/runtime as needed
3. update the Web App deployment manually when the change should go live

A separate, explicitly approved deployment workflow can be added later.

## Source-of-truth rule

Once this workflow is configured:

- edit Central API in GitHub first
- validate/commit it
- run the sync workflow
- avoid standalone edits in the Apps Script editor

If an emergency edit is made directly in Apps Script, reconcile that change back into GitHub before the next sync. Otherwise the next sync will overwrite it.

## Authentication troubleshooting

### Apps Script API disabled

Enable the Apps Script API in the Google Apps Script user settings for the OAuth account.

### 401 / authorization error

Run clasp login again on the trusted PC:

```bash
npx @google/clasp@3.3.0 login
```

Then replace the GitHub `CLASPRC_JSON` secret with the new file contents.

### Wrong project updated

Check the `GAS_SCRIPT_ID` repository secret against the Script ID shown in Apps Script Project Settings.

## Credential rotation

The clasp refresh token should be treated as a long-lived credential. Rotate it when access changes, after a suspected leak, or periodically according to your operational policy.
