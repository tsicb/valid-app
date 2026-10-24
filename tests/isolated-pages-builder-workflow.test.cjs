"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const workflow=fs.readFileSync(path.join(__dirname,"../.github/workflows/build-isolated-pages-preview.yml"),"utf8");
test("manual bundle builder requires the feature branch, explicit consent and TEST URL",()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/test_api_url:/);
  assert.match(workflow,/TEST_ONLY/);
  assert.match(workflow,/refs\/heads\/feature\/incremental-update-pages/);
  assert.match(workflow,/script\.google\.com/);
  assert.match(workflow,/test_api_url/);
});
test("GET preflight validates API capability AND both test folder IDs before artifact creation",()=>{
  assert.match(workflow,/EXPECTED_TEST_ROOT: 1ZZs2xDXlgaKKtBr1ZbZuMnSR2RpEzJKU/);
  assert.match(workflow,/EXPECTED_TEST_OUTPUT: 1WAcEG1AIrLvfwMYahgCLArmm9a0pcOu7/);
  assert.match(workflow,/capability\.updateStrategies\.includes\('APPEND'\)/);
  assert.match(workflow,/capability\.updateStrategies\.includes\('REPLACE'\)/);
  assert.match(workflow,/data\.rootFolderId !== process\.env\.EXPECTED_TEST_ROOT/);
  assert.match(workflow,/data\.sheetOutputFolderId !== process\.env\.EXPECTED_TEST_OUTPUT/);
  assert.ok(workflow.indexOf("Probe deployed TEST Apps Script") < workflow.indexOf("Generate localhost browser test site"));
});
test("bundle retains fake CSV and starts a localhost site; does not deploy",()=>{
  assert.match(workflow,/actions\/upload-artifact@v4/);
  // The generated .smoke-pages directory must be copied to a visible
  // artifact directory because upload-artifact v4 ignores hidden paths.
  assert.match(workflow,/cp -a \.smoke-pages\/\. isolated-pages-artifact\//);
  assert.match(workflow,/path: isolated-pages-artifact\//);
  assert.ok(workflow.indexOf("Stage visible artifact folder for upload") <
    workflow.indexOf("Upload private test bundle artifact"));
  assert.match(workflow,/test -s isolated-pages-artifact\/index\.html/);
  assert.match(workflow,/test -s isolated-pages-artifact\/START_TEST_WINDOWS\.cmd/);
  assert.match(workflow,/tests\/fixtures\/append-smoke\/\*\.csv/);
  assert.match(workflow,/START_TEST_WINDOWS\.cmd/);
  assert.match(workflow,/serve_isolated_test\.py/);
  assert.match(workflow,/SMOKE_TEST_API_URL\.txt/);
  assert.match(workflow,/test -s isolated-pages-artifact\/serve_isolated_test\.py/);
  assert.match(workflow,/python serve_isolated_test\.py/);
  assert.doesNotMatch(workflow,/^\s+py -m http\.server 8765$/m);
  assert.match(workflow,/localhost:8765/);
  assert.doesNotMatch(workflow,/\bclasp push\b|\bclasp deploy\b/);
  assert.doesNotMatch(workflow,/actions\/deploy-pages/);
});
