"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const workflow=fs.readFileSync(path.join(__dirname,
  "../.github/workflows/central-api-sync.yml"),"utf8");
const status=fs.readFileSync(path.join(__dirname,
  "../docs/CURRENT_STATE.md"),"utf8");

test("preflight guard executes after remote pull/audit but before staging/push",()=>{
  const i=fragment=>workflow.indexOf(fragment);
  assert.ok(i("Pull current GAS project into staging")>=0);
  assert.ok(i("Guard file 25 against unrecognized live source before SYNC")>
    i("Block SYNC if live GAS has unexpected scripts"));
  assert.ok(i("Guard file 25 against unrecognized live source before SYNC")<
    i("Replace only server-side GAS source in staging"));
  assert.ok(i("verify-central-api-sync.cjs preflight")<
    i("clasp push --force"));
});
test("postflight performs fresh pull and source verification after push",()=>{
  const p=workflow.indexOf("Push GitHub Central API source to GAS");
  const r=workflow.indexOf("Verify GAS source by independent remote pull after push");
  const s=workflow.indexOf("Sync summary");
  assert.ok(p>=0&&r>p&&s>r);
  assert.match(workflow.slice(r,s),/clasp pull/);
  assert.match(workflow.slice(r,s),/verify-central-api-sync\.cjs postflight/);
  assert.match(workflow.slice(r,s),/test -f \.gas-stage\/appsscript\.json/);
});
test("pinned history and synchronization are explicit and separately gated",()=>{
  assert.match(workflow,/0c4be7c5e9e3eb39eafcd341618dacb79797dd36/);
  assert.match(workflow,/7a34bb4cf3cc45774dd15957888cbdaef7223c09/);
  assert.match(workflow,/VAA_PREVIOUS_PRODUCTION_FILE25=/);
  assert.match(workflow,/verify-central-api-sync.cjs preflight/);
  assert.match(workflow,/confirm.*'SYNC'/);
  assert.match(workflow,/inputs\.confirm == 'SYNC'/);
  assert.doesNotMatch(workflow,/script\.google\.com\/macros\//);
  assert.doesNotMatch(workflow,/VAA_PROD_READY_RETIRE_MODE=/);
});
test("current state markdown has only one top-level title after repair",()=>{
  assert.equal((status.match(/^# Current State$/gm)||[]).length,1);
  assert.match(status,/MATCHES_2026_11_19_GITHUB_REVISION/);
  assert.match(status,/PR #55/);
  assert.match(status,/PR #56/);
  assert.match(status,/PR #57/);
});
