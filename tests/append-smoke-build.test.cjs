"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const root=path.join(__dirname,"..");
const script=path.join(root,"scripts/build-append-smoke-site.mjs");
const out=path.join(root,".smoke-pages");
const PROD="https://script.google.com/macros/s/AKfycbwS_-ptDyhVk5yrNtRB8I32WUJen-xdjKUtp-Rf7Dbdhhg4V9Vw3gneD9K7ErZgP_Y/exec";
const TEST="https://script.google.com/macros/s/TEST_DEPLOYMENT_FOR_SMOKE_ONLY/exec";
function run(url) {return spawnSync(process.execPath,[script,url],{cwd:root,encoding:"utf8"});}
test("local smoke builder explicitly rejects production API and unknown domains",()=>{
  const original=run(PROD);
  assert.notEqual(original.status,0);
  assert.match(original.stderr,/本番GAS/);
  const unknown=run("https://example.com/api");
  assert.notEqual(unknown.status,0);
  assert.match(unknown.stderr,/テスト用Web App/);
});
test("local smoke builder switches both Pages entrypoints without modifying tracked Pages",()=>{
  const beforeIndex=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const beforeReport=fs.readFileSync(path.join(root,"report.html"),"utf8");
  try {
    const task=run(TEST);
    assert.equal(task.status,0,task.stderr);
    for(const name of ["index.html","report.html"]){
      const content=fs.readFileSync(path.join(out,name),"utf8");
      assert.ok(content.includes("http://localhost:8765/__test_api__"),name);
      assert.ok(!content.includes(TEST),name);
      assert.ok(!content.includes(PROD),name);
    }
    assert.equal(
      fs.readFileSync(path.join(out,"SMOKE_TEST_API_URL.txt"),"utf8").trim(),TEST
    );
    assert.ok(fs.readFileSync(path.join(out,"serve_isolated_test.py"),"utf8")
      .includes("127.0.0.1"));
    for(const name of ["append-identity-v1.js","analysis-core.js","common-masters-v1.js",
        "assets/favicon-index.svg","assets/favicon-report.svg"]){
      assert.ok(fs.existsSync(path.join(out,name)),name);
    }
    assert.equal(fs.readFileSync(path.join(root,"index.html"),"utf8"),beforeIndex);
    assert.equal(fs.readFileSync(path.join(root,"report.html"),"utf8"),beforeReport);
  }finally {
    fs.rmSync(out,{recursive:true,force:true});
  }
});
