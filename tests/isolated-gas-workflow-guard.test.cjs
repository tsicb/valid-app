"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const workflow=fs.readFileSync(path.join(__dirname,"../.github/workflows/isolated-gas-smoke-sync.yml"),"utf8");
test("manual isolated GAS sync rejects production Script ID and requires explicit confirmation",()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/TEST_ONLY/);
  assert.match(workflow,/if \[ "\$\{TEST_SCRIPT_ID\}" = "\$\{PRODUCTION_SCRIPT_ID\}" \]/);
  assert.match(workflow,/refs\/heads\/feature\/incremental-update-pages/);
  assert.match(workflow,/secrets\.GAS_SCRIPT_ID/);
  assert.match(workflow,/secrets\.CLASPRC_JSON/);
  assert.ok(workflow.indexOf("Refusing to modify the production GAS") < workflow.indexOf("clasp push --force"));
});
test("test-only workflow never automatically deploys a Web App",()=>{
  assert.match(workflow,/script\/stage-append-test-gas|scripts\/stage-append-test-gas/);
  assert.match(workflow,/node --test tests\/\*\.test\.cjs/);
  assert.match(workflow,/sha256sum -c SOURCE_SHA256SUMS\.txt/);
  assert.match(workflow,/clasp pull/);
  assert.equal((workflow.match(/clasp push --force/g)||[]).length,1);
  assert.doesNotMatch(workflow,/\bclasp deploy\b/);
  assert.doesNotMatch(workflow,/\bclasp version\b/);
});
