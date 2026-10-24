"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const snippets=[
  ["function cleanCsvHeader(", "async function detectCsvEncoding("],
  ["function firstNonEmptyCsvValue(", "function normalizeApplicationGender("],
  ["function normalizeApplicationGender(", "function detectApplicationCsvFormat("],
  ["function detectApplicationCsvFormat(", "function validateFixedCsvFormat("],
  ["function validateFixedCsvFormat(", "async function parseCSV("]
].map(([first,last])=>{
  const begin=html.indexOf(first),end=html.indexOf(last,begin+first.length);
  if(begin<0||end<=begin)throw Error("Pages CSV function anchors changed: "+first);
  return html.slice(begin,end);
});
const ctx={console};vm.createContext(ctx);
vm.runInContext(snippets.join("\n"),ctx,{filename:"index-csv-normalization.js"});
const fixture=n=>fs.readFileSync(
  path.join(root,"tests/fixtures/append-smoke",n),"utf8"
).trim().split(/\r?\n/).map(x=>x.split(","));
const parse=n=>{
  const all=fixture(n);
  const headers=all[0];
  const rows=all.slice(1).map(cells=>Object.fromEntries(headers.map((h,i)=>[h,cells[i]||""])));
  return {headers,rows};
};
test("actual Pages CSV_A normalizer accepts initial, overlap, decrease and replace fixtures",()=>{
  const cases=[
    ["01_初回応募.csv",7],
    ["02_重複追加応募.csv",9],
    ["03_日次数減少応募.csv",3],
    ["04_全件入れ替え応募.csv",4]
  ];
  for(const [name,expected] of cases){
    const data=parse(name);
    const out=ctx.normalizeApplicationCsv(data.rows,data.headers);
    assert.equal(out.format,"A");
    assert.equal(out.rows.length,expected);
    assert.doesNotThrow(()=>ctx.validateFixedCsvFormat("application",out.fields,name));
    assert.ok(out.rows.every(r=>r["企業コード"]==="DEMO001"));
    assert.ok(out.rows.every(r=>r["仕事番号"]==="DEMO_JOB"||r["仕事番号"]==="AIRWORK_ONLY"));
  }
});
test("AirWork CSV pseudo rows keep all 3 exact markers after actual Pages normalization",()=>{
  const raw=parse("01_初回応募.csv");
  const out=ctx.normalizeApplicationCsv(raw.rows,raw.headers);
  const air=out.rows.filter(r=>r["応募媒体"]==="AirWork");
  assert.equal(air.length,5);
  for(const row of air){
    assert.equal(row["氏名"],"");
    assert.equal(row["仕事名"],"AirWork（応募実績）");
    assert.equal(row["対応状況"],"AirWork（状況未取得）");
    assert.equal(row["応募日時"],"2026/10/01");
  }
});
test("real Pages CSV_B alias normalization retains applicant ID and company ID",()=>{
  const raw=parse("05_CSV_B形式.csv");
  const out=ctx.normalizeApplicationCsv(raw.rows,raw.headers);
  assert.equal(out.format,"B");
  assert.equal(out.rows.length,2);
  assert.doesNotThrow(()=>ctx.validateFixedCsvFormat("application",out.fields,"CSV_B"));
  assert.equal(out.rows[0]["企業コード"],"DEMO001");
  assert.equal(out.rows[0]["仕事番号"],"DEMO_JOB");
  assert.equal(out.rows[0]["応募者ID"],"PERSON0001");
  assert.equal(out.rows[0]["氏名"],"架空丁");
  assert.equal(out.rows[0]["応募日時"],"2026/10/04 10:00:00");
});
test("real Pages job CSV validator accepts 3 synthetic job revisions",()=>{
  for(const file of ["01_初回求人.csv","02_改稿求人.csv","04_入れ替え求人.csv"]){
    const d=parse(file);
    assert.doesNotThrow(()=>ctx.validateFixedCsvFormat("job",d.headers,file));
    assert.equal(d.rows[0]["企業ID"],"DEMO001");
  }
});
