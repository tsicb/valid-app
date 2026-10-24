"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const root=path.join(__dirname,"..");
const stage=path.join(root,".gas-test");
const script=path.join(root,"scripts/stage-append-test-gas.mjs");
const prodRoot="1pczMllofAeCpPsMKmaU0fDDUUXgkXy8f";
const prodOutput="1izieBYn1U40y0sMkK2H5WzoILA1blYNb";
const testRoot="TESTROOTFOLDER0123456789ABC";
const testOutput="TESTOUTPUTFOLDER0123456789ABC";
const run=(a,b)=>spawnSync(process.execPath,[script,a,b],{cwd:root,encoding:"utf8"});
test("test-GAS source stager rejects production folder IDs and missing clasp pull",()=>{
  const fail=run(prodRoot,prodOutput);
  assert.notEqual(fail.status,0);
  assert.match(fail.stderr,/本番ID/);
  const missing=run(testRoot,testOutput);
  assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/appsscript.json/);
});
test("test-GAS stager replaces only staged config, preserves manifest and original config",()=>{
  const original=fs.readFileSync(path.join(root,"central-api/00_Config.gs"),"utf8");
  fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(path.join(stage,"appsscript.json"),'{"timeZone":"Asia/Tokyo"}\n');
  fs.writeFileSync(path.join(stage,"old-source.gs"),"outdated");
  try{
    const res=run(testRoot,testOutput);
    assert.equal(res.status,0,res.stderr);
    const configured=fs.readFileSync(path.join(stage,"00_Config.gs"),"utf8");
    assert.ok(configured.includes("ROOT_FOLDER_ID: '"+testRoot+"'"));
    assert.ok(configured.includes("SHEET_OUTPUT_FOLDER_ID: '"+testOutput+"'"));
    assert.ok(!configured.includes(prodRoot));
    assert.ok(!configured.includes(prodOutput));
    assert.equal(fs.existsSync(path.join(stage,"old-source.gs")),false);
    assert.equal(fs.readFileSync(path.join(stage,"appsscript.json"),"utf8"),'{"timeZone":"Asia/Tokyo"}\n');
    assert.equal(fs.readFileSync(path.join(root,"central-api/00_Config.gs"),"utf8"),original);
    assert.ok(fs.existsSync(path.join(stage,"14_Append_Identity.gs")));
  }finally{
    fs.rmSync(stage,{force:true,recursive:true});
  }
});
