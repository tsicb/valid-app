"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(
  path.join(__dirname,"../.github/workflows/isolated-main-gas-qa-sync.yml"),"utf8"
);

test("current main QA workflow is manual, commit-pinned and explicitly isolated",()=>{
  assert.match(source,/workflow_dispatch:/);
  assert.match(source,/expected_sha:/);
  assert.match(source,/TEST_ONLY/);
  assert.match(source,/refs\/heads\/main/);
  assert.match(source,/GITHUB_SHA/);
  assert.match(source,/EXPECTED_SHA/);
  assert.match(source,/\[ "\$\{GITHUB_SHA\}" != "\$\{EXPECTED_SHA\}" \]/);
  assert.match(source,/\[ "\$\{TEST_SCRIPT_ID\}" = "\$\{PRODUCTION_SCRIPT_ID\}" \]/);
  assert.match(source,/PRODUCTION_SCRIPT_ID: \$\{\{ secrets\.GAS_SCRIPT_ID \}\}/);
  assert.match(source,/CLASPRC_JSON: \$\{\{ secrets\.CLASPRC_JSON \}\}/);
  assert.match(source,/TEST_ROOT_FOLDER_ID/);
  assert.match(source,/TEST_OUTPUT_FOLDER_ID/);
  assert.match(source,/stage-append-test-gas\.mjs/);
  assert.doesNotMatch(source,/refs\/heads\/feature\/incremental-update-pages/);
});

test("isolated QA workflow validates source and folder substitutions before one test-only push",()=>{
  const actions=[
    "Require explicit isolation confirmation",
    "Checkout pinned main source",
    "Run pre-sync regression tests and syntax checks",
    "Verify exact canonical Central API checksums",
    "Bind temporary clasp config to TEST script only",
    "Pull TEST project to preserve appsscript manifest",
    "Stage canonical source with test-only Drive folders",
    "Push source to TEST GAS only (no deployment)"
  ];
  let prev=-1;
  for(const name of actions){
    const pos=source.indexOf(name);
    assert.ok(pos>prev,name+" must exist after previous guarded stage");
    prev=pos;
  }
  assert.match(source,/node --test tests\/\*\.test\.cjs/);
  assert.match(source,/sha256sum -c SOURCE_SHA256SUMS\.txt/);
  assert.match(source,/if grep -Fq "\$\{PRODUCTION_SCRIPT_ID\}" \.clasp\.json;/);
  assert.match(source,/Production Drive folder IDs remain in the staged config/);
  assert.equal((source.match(/clasp push --force/g)||[]).length,1);
  assert.doesNotMatch(source,/\bclasp deploy\b|\bclasp version\b/);
  assert.doesNotMatch(source,/on:\s*\n\s*push:/);
  assert.doesNotMatch(source,/on:\s*\n\s*schedule:/);
});
