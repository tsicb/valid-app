"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {classifyGateway,inspectGateway,report}=require("../scripts/diagnose-central-api-gateway24.cjs");
const OLD="function previouslyExisting(){return 1;}\n";
const NEW=OLD+"function newCanary(){return 2;}\n";
test("read-only file24 classifier confirms GitHub current source",()=>{
  assert.equal(classifyGateway({current:NEW,remote:NEW,pinned:OLD}),
    "CURRENT_GITHUB_SOURCE");
});
test("read-only file24 classifier identifies pre-canary version",()=>{
  assert.equal(classifyGateway({current:NEW,remote:OLD,pinned:OLD}),
    "PINNED_PRE_CANARY_GITHUB_SOURCE");
});
test("pre-canary source plus appended one-time helper requires preservation",()=>{
  assert.equal(classifyGateway({current:NEW,remote:OLD+
    "function localWrapper(){return 3;}\n",pinned:OLD}),
    "PINNED_PRE_CANARY_WITH_APPENDED_CODE");
});
test("inline patch or unknown source is not assumed to be append-only",()=>{
  for(const remote of ["function previouslyExisting(){return 9;}\n",
    "function extraBefore(){}\n"+OLD,
    OLD.replace("1","4")+"function localWrapper(){}\n"]) {
    assert.equal(classifyGateway({current:NEW,remote,pinned:OLD}),
      "UNKNOWN_REMOTE_CHANGES_REVIEW_REQUIRED");
  }
});
test("normalized line endings do not masquerade as source edits",()=>{
  assert.equal(classifyGateway({current:NEW,remote:OLD.replace(/\n/g,"\r\n"),
    pinned:OLD}),"PINNED_PRE_CANARY_GITHUB_SOURCE");
});
test("metadata summary does not leak text from either source",()=>{
  const privateSnippet="SYNTHETIC_SECRET_MARKER_123";
  const v=inspectGateway({current:NEW,remote:OLD+privateSnippet,
    pinned:OLD,temporaryScriptFound:true});
  const t=report(v);
  assert.ok(t.includes("PINNED_PRE_CANARY_WITH_APPENDED_CODE"));
  assert.ok(t.includes("Temporary 99_Canary_Properties_OneTime script present: true"));
  for(const sensitive of [privateSnippet,OLD,NEW,"function localWrapper(){}"])
    assert.equal(t.includes(sensitive),false);
});
