"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const sync=fs.readFileSync(path.join(root,".github/workflows/isolated-main-gas-qa-sync.yml"),"utf8");
const preview=fs.readFileSync(path.join(root,".github/workflows/build-isolated-pages-preview.yml"),"utf8");

test("pinned limited-APPEND branch is allowed only on manual isolated TEST GAS workflow",()=>{
  assert.match(sync,/workflow_dispatch:/);
  assert.match(sync,/refs\/heads\/feature\/append-limited-update-core-v1/);
  assert.match(sync,/refs\/heads\/main/);
  assert.match(sync,/expected_sha:/);
  assert.match(sync,/EXPECTED_SHA/);
  assert.match(sync,/GITHUB_SHA/);
  assert.match(sync,/TEST_ONLY/);
  assert.match(sync,/PRODUCTION_SCRIPT_ID/);
  assert.match(sync,/\[ "\$\{TEST_SCRIPT_ID\}" = "\$\{PRODUCTION_SCRIPT_ID\}" \]/);
  assert.match(sync,/TEST_ROOT_FOLDER_ID/);
  assert.match(sync,/TEST_OUTPUT_FOLDER_ID/);
  assert.equal((sync.match(/clasp push --force/g)||[]).length,1);
  assert.doesNotMatch(sync,/on:\s*\n\s*push:/);
  assert.doesNotMatch(sync,/\bclasp deploy\b|\bclasp version\b/);
});

test("limited-APPEND QA refuses to overwrite historical test GAS scripts",()=>{
  assert.match(sync,/name: Fail closed before overwriting pre-existing TEST QA scripts/);
  assert.match(sync,/github\.ref == 'refs\/heads\/feature\/append-limited-update-core-v1'/);
  assert.match(sync,/scripts\.length>1/);
  assert.match(sync,/Code\.gs/);
  assert.match(sync,/Code\.js/);
  assert.match(sync,/default empty template/);
  assert.match(sync,/NEW blank TEST Script project/);
  const pull=sync.indexOf("Pull TEST project to preserve appsscript manifest");
  const reject=sync.indexOf("Fail closed before overwriting pre-existing TEST QA scripts");
  const stage=sync.indexOf("Stage canonical source with test-only Drive folders");
  const push=sync.indexOf("Push source to TEST GAS only (no deployment)");
  assert.ok(pull>=0&&reject>pull&&stage>reject&&push>stage);
});

test("isolated Pages preview demands matching TEST folder IDs and active limited APPEND capability",()=>{
  assert.match(preview,/refs\/heads\/feature\/append-limited-update-core-v1/);
  assert.match(preview,/capability\?\.limitedAppend\?\.protocol !== 'LIMITED_APPEND_V1'/);
  assert.match(preview,/capability\?\.limitedAppend\?\.enabled !== true/);
  assert.match(preview,/data\.rootFolderId !== process\.env\.EXPECTED_TEST_ROOT/);
  assert.match(preview,/data\.sheetOutputFolderId !== process\.env\.EXPECTED_TEST_OUTPUT/);
  assert.match(preview,/TEST_ONLY/);
  assert.match(preview,/07_後日補完求人\.csv/);
  assert.match(preview,/08_別求人先行・更新候補後続\.csv/);
  assert.match(preview,/tests\/fixtures\/append-smoke\/\*\.csv/);
  assert.match(preview,/actions\/upload-artifact@v4/);
  assert.doesNotMatch(preview,/\bclasp push\b|\bclasp deploy\b/);
});
