"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {classify,createSummary,fingerprintHistoricalSource}=
  require("../scripts/diagnose-central-api-drift.cjs");
test("identical and CRLF are equal after EOL normalization",()=>{
  assert.equal(classify("a\nb\n","a\r\nb\r\n").category,
    "IDENTICAL_AFTER_EOL_NORMALIZATION");
});
test("BOM differences are classified without printing source",()=>{
  assert.equal(classify("a\nb","\uFEFFa\nb").category,"BOM_ONLY");
});
test("trailing whitespace-only changes are distinct from code changes",()=>{
  assert.equal(classify("a\nb\n","a \nb\t\n").category,
    "LINE_END_WHITESPACE_ONLY");
});
test("final blank lines and whitespace are separated from content",()=>{
  assert.equal(classify("a\nb\n","a \nb\n\n").category,
    "FINAL_BLANK_LINES_AND_WHITESPACE_ONLY");
});
test("changed string literal is treated as content drift",()=>{
  const a='const secret = "PLACEHOLDER_TOKEN_111";\n';
  const b='const secret = "PLACEHOLDER_TOKEN_222";\n';
  const result=classify(a,b),report=createSummary(result);
  assert.equal(result.category,"CONTENT_DIFFERENCE_REVIEW_REQUIRED");
  assert.equal(result.firstMismatchLine,1);
  assert.equal(report.includes("PLACEHOLDER_TOKEN_"),false);
  assert.equal(report.includes("const secret"),false);
});
test("no source fragments are included for unrelated logic change",()=>{
  const a='function x(){return "SYNTHETIC_PRIVATE_MARKER_A";}\n';
  const b='function x(){return "SYNTHETIC_PRIVATE_MARKER_B";}\n';
  const report=createSummary(classify(a,b));
  for(const secret of ["SYNTHETIC_PRIVATE_MARKER_A","SYNTHETIC_PRIVATE_MARKER_B",
                       "function x","return"]){
    assert.equal(report.includes(secret),false);
  }
});

test("same 337 lines and 13190 characters are never sufficient proof",()=>{
  const old="A".repeat(13189)+"\n";
  const fake="B"+old.slice(1);
  assert.equal(old.split("\n").length,2);
  assert.equal(old.length,fake.length);
  assert.equal(fingerprintHistoricalSource(fake,old),
    "DOES_NOT_MATCH_KNOWN_2026_11_19_REVISION");
});
test("pinned Git historic snapshot is exact after newline normalization",()=>{
  const old="function x(){return true;}\n";
  assert.equal(fingerprintHistoricalSource(old.replace(/\n/g,"\r\n"),old),
    "MATCHES_2026_11_19_GITHUB_REVISION");
  const report=createSummary({...classify(old,old),
    historicalVersion:fingerprintHistoricalSource(old,old)});
  assert.equal(report.includes("MATCHES_2026_11_19_GITHUB_REVISION"),true);
  assert.equal(report.includes("function x"),false);
});
