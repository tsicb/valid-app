"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {verifyLegacyBeforeSync,verifyPulledAgainstGit,summary}
  =require("../scripts/verify-central-api-sync.cjs");

test("legacy preflight accepts only exact current, previous production or pinned historic",()=>{
  const current="const mode='CURRENT';\n";
  const old="const mode='OLD';\n";
  const prior="const mode='PREVIOUS_VERIFIED_SYNC';\n";
  assert.equal(verifyLegacyBeforeSync(current,current.replace(/\n/g,"\r\n"),old,prior),
    "ALREADY_CURRENT");
  assert.equal(verifyLegacyBeforeSync(current,prior.replace(/\n/g,"\r\n"),old,prior),
    "PINNED_PREVIOUS_PRODUCTION_SOURCE");
  assert.equal(verifyLegacyBeforeSync(current,old,old,prior),
    "PINNED_2026_11_19_REVISION");
  assert.equal(verifyLegacyBeforeSync(current,"const mode='UNKNOWN';\n",old,prior),
    "UNRECOGNIZED_SOURCE_BLOCK_SYNC");
});
test("similar length or cosmetic matching does not authorize unknown version",()=>{
  assert.equal(verifyLegacyBeforeSync("abc","abd","abe","abf"),
    "UNRECOGNIZED_SOURCE_BLOCK_SYNC");
  // A close but not exact revision cannot bypass the independent source fence.
  assert.equal(verifyLegacyBeforeSync(
    "const x=1;","const x=3;","const x=2;","const x=4;"),
    "UNRECOGNIZED_SOURCE_BLOCK_SYNC");
});
function withTree(filesGit,filesGAS,check){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vaa-sync-"));
  const g=path.join(root,"git"),r=path.join(root,"remote");
  fs.mkdirSync(g);fs.mkdirSync(r);
  try{
    for(const [name,body] of Object.entries(filesGit))
      fs.writeFileSync(path.join(g,name),body);
    for(const [name,body] of Object.entries(filesGAS))
      fs.writeFileSync(path.join(r,name),body);
    check(verifyPulledAgainstGit(g,r));
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
}
test("post-push readback accepts exact canonical files after EOL normalization",()=>{
  withTree({"24_File.gs":"abc\n","25_File.gs":"def\n"},
    {"24_File.gs":"abc\r\n","25_File.js":"def\n"},
    x=>{
      assert.equal(x.ok,true);
      assert.equal(x.expectedCount,2);
      assert.equal(x.remoteCount,2);
      assert.equal(x.changed.length,0);
    });
});
test("silent reversion of file 25 fails post-push check",()=>{
  withTree({"24_File.gs":"new\n","25_File.gs":"new\n"},
    {"24_File.gs":"new\n","25_File.gs":"old\n"},
    x=>{
      assert.equal(x.ok,false);
      assert.deepEqual(x.changed,["25_File"]);
      assert.match(summary(x),/FAIL_CLOSED_REMOTE_MISMATCH/);
    });
});
test("missing, extra and duplicate remote scripts fail closed",()=>{
  withTree({"24_File.gs":"new"}, {"OTHER.gs":"x"}, x=>{
    assert.equal(x.ok,false);
    assert.deepEqual(x.missing,["24_File"]);
    assert.deepEqual(x.extra,["OTHER"]);
  });
  assert.throws(()=>withTree({"24_File.gs":"same"},
    {"24_File.gs":"same","24_File.js":"same"},()=>{}),
    /DUPLICATE_SCRIPT_BASENAME/);
});
test("postflight summary never includes source payload",()=>{
  withTree({"25_File.gs":"SECRET_DATA_IN_THIS_SOURCE"},
    {"25_File.gs":"PRIVATE_CHANGED_DATA"},x=>{
      const message=summary(x);
      assert.equal(message.includes("SECRET_DATA_IN_THIS_SOURCE"),false);
      assert.equal(message.includes("PRIVATE_CHANGED_DATA"),false);
      assert.equal(message.includes("25_File.gs"),true);
    });
});
