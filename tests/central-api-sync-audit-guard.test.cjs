"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const workflow=fs.readFileSync(path.join(__dirname,"../.github/workflows/central-api-sync.yml"),"utf8");

test("manual-only workflow supports read-only AUDIT and explicit SYNC",()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/case "\$\{\{ inputs\.confirm \}\}" in/);
  assert.match(workflow,/AUDIT\|SYNC/);
  assert.match(workflow,/Audit remote GAS script names and source drift \(NO PUSH\)/);
  assert.match(workflow,/id: gas_audit/);
});
test("audit source JS parses, only reports hashed source differences",()=>{
  const start="          node <<'NODE'\n";
  const pos=workflow.indexOf(start,workflow.indexOf("Audit remote GAS script names"));
  assert.ok(pos>0);
  const end=workflow.indexOf("\n          NODE",pos+start.length);
  assert.ok(end>pos);
  const script=workflow.slice(pos+start.length,end).split("\n").map(x=>x.slice(10)).join("\n");
  new vm.Script(script);
  assert.match(script,/crypto\.createHash\('sha256'\)/);
  assert.doesNotMatch(script,/process\.stdout\.write\([^)]*(?:normalize|readFileSync)/);
  assert.match(script,/extra_count/);
});
test("AUDIT cannot reach any source replacement or GAS write/deploy steps",()=>{
  const guarded=[
    "Replace only server-side GAS source in staging",
    "Show clasp push status",
    "Push GitHub Central API source to GAS"
  ];
  for(const name of guarded){
    const start=workflow.indexOf("      - name: "+name);
    assert.ok(start>=0);
    const segment=workflow.slice(start,start+180);
    assert.match(segment,/if: \$\{\{ inputs\.confirm == 'SYNC' \}\}/);
  }
  assert.match(workflow,/if \[ "\$\{\{ steps\.gas_audit\.outputs\.extra_count \}\}" != "0" \]; then/);
  assert.match(workflow,/clasp push --force/);
  assert.match(workflow,/clasp pull/);
});
test("unexpected live QA scripts fail before replacement and push",()=>{
  const gate=workflow.indexOf("Block SYNC if live GAS has unexpected scripts");
  const replace=workflow.indexOf("Replace only server-side GAS source in staging");
  const push=workflow.indexOf("Push GitHub Central API source to GAS");
  assert.ok(gate<replace && replace<push);
  assert.match(workflow,/unexpected remote GAS source files would be deleted/);
});

test("single-step SYNC is blocked before write on missing scripts or unrelated source drift",()=>{
  const read=workflow.indexOf("Audit remote GAS script names and source drift (NO PUSH)");
  const block=workflow.indexOf("Block SYNC if GAS has missing or unapproved source drift");
  const pin=workflow.indexOf("Guard file 25 against unrecognized live source before SYNC");
  const push=workflow.indexOf("Push GitHub Central API source to GAS");
  assert.ok(read>=0 && block>read && pin>block && push>pin);
  assert.match(workflow,/new_count=' \+ add\.length/);
  assert.match(workflow,/unexpected_change_count=' \+ unexpectedDrift\.length/);
  assert.match(workflow,/change\.filter\(name => name !== allowedFile25\)/);
  assert.match(workflow,/steps\.gas_audit\.outputs\.new_count/);
  assert.match(workflow,/steps\.gas_audit\.outputs\.unexpected_change_count/);
  assert.match(workflow,/SYNC blocked: source drift outside approved file25/);
});
