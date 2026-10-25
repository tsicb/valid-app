"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const repo=path.resolve(__dirname,"..");
const code=fs.readFileSync(path.join(repo,"scripts/legacy-migration-test-page.mjs"),"utf8");
const load=()=>import("../scripts/legacy-migration-test-page.mjs");
const input=()=>({
  operationMode:"create", updateProtocol:"IDENTITY_V1",
  updateStrategy:"",requestId:"test-only",accessKey:"fake",
  datasets:{
    applicationData:{
      headers:["レコードID","企業ID","応募識別キー","応募識別方式","仕事番号"],
      rows:[
        ["APP000001","DEMO001","I1:"+ "f".repeat(64),"PERSON_NAME","J1"],
        ["APP000002","DEMO001","G1:"+ "d".repeat(64)+":000001","AGG_DAILY","J2"]
      ]
    },
    jobAnalysisMaster:{headers:["求人参照ID","仕事番号"],rows:[["JOB000001","J1"]]},
    inputFiles:{
      headers:["種別","ファイル名","読込行数","文字コード"],
      rows:[
        ["応募CSV","01_初回応募.csv",7,"UTF-8"],
        ["求人CSV","01_初回求人.csv",1,"UTF-8"]
      ]
    }
  }
});
test("migration fixture strips identity columns/protocol, leaving other fields in order",async()=>{
  const {toLegacyCreatePayload}=await load();
  const initial=input();
  const saved=JSON.stringify(initial);
  const legacy=toLegacyCreatePayload(initial);
  assert.equal(legacy.updateProtocol,"");
  assert.equal(legacy.updateStrategy,"");
  assert.deepEqual(legacy.datasets.applicationData.headers,["レコードID","企業ID","仕事番号"]);
  assert.deepEqual(legacy.datasets.applicationData.rows,[
    ["APP000001","DEMO001","J1"],["APP000002","DEMO001","J2"]
  ]);
  assert.deepEqual(legacy.datasets.jobAnalysisMaster,initial.datasets.jobAnalysisMaster);
  assert.equal(JSON.stringify(initial),saved,"never mutate normal fixture input");
});
test("migration fixture refuses UPDATE and malformed rows, before any save",async()=>{
  const {toLegacyCreatePayload}=await load();
  assert.throws(()=>toLegacyCreatePayload({...input(),operationMode:"update"}),/新規作成のみ/);
  const wrong=input();wrong.datasets.applicationData.rows[0]=["APP1"];
  assert.throws(()=>toLegacyCreatePayload(wrong),/列数が不正/);
});
test("migration fixture rejects production/non-fixture CSV file names",async()=>{
  const {toLegacyCreatePayload}=await load();
  const invalid=input();
  invalid.datasets.inputFiles.rows[0][1]="company_real_applicants.csv";
  assert.throws(()=>toLegacyCreatePayload(invalid),/samples内の01_/);
  const extra=input();
  extra.datasets.inputFiles.rows.push(["応募CSV","03_日次数減少応募.csv",3,"UTF-8"]);
  assert.throws(()=>toLegacyCreatePayload(extra),/samples内の01_/);
});

test("generated legacy page has conspicuous test banner and injects payload override",async()=>{
  const {buildLegacyTestHtml}=await load();
  const html=fs.readFileSync(path.join(repo,"index.html"),"utf8");
  const generated=buildLegacyTestHtml(html);
  assert.match(generated,/LEGACY_SMOKE_FIXTURE/);
  assert.match(generated,/旧形式移行テスト専用/);
  assert.match(generated,/\["localhost","127\.0\.0\.1"\]/);
  assert.match(generated,/function buildSheetsPayloadV3Modern\(/);
  assert.match(generated,/return toLegacyCreatePayload\(buildSheetsPayloadV3Modern\(\.\.\.args\)\)/);
  assert.match(generated,/stopImmediatePropagation/);
  assert.equal((generated.match(/function buildSheetsPayloadV3\(/g)||[]).length,1);
  assert.ok(!html.includes("LEGACY_SMOKE_FIXTURE"));
  assert.throws(()=>buildLegacyTestHtml(generated));
  const scripts=[...generated.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  for(const part of scripts)if(part[1].trim())new vm.Script(part[1]);
});
test("migration page generator is test-only and never part of production Pages source",()=>{
  assert.ok(!fs.readFileSync(path.join(repo,"index.html"),"utf8").includes("legacy-create.html"));
  assert.match(code,/operationMode !== "create"/);
  assert.match(fs.readFileSync(path.join(repo,"scripts/build-append-smoke-site.mjs"),"utf8"),
    /writeFileSync\(join\(out,"legacy-create\.html"\),buildLegacyTestHtml/);
});
