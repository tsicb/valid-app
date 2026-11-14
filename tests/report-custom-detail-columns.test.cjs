"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../report.html"), "utf8");
const headings = [
  "仕事番号", "応募日時", "対応状況", "仕事名", "勤務都道府県",
  "年代", "性別", "応募媒体", "下限給与"
];
const htmlEscape = value => String(value ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#039;");

const start = html.indexOf("function customDetailDateTime(");
const end = html.indexOf("function openCustomDetailModal(", start);
assert.ok(start >= 0 && end > start, "drilldown helper functions are present");
const drilldownSource = html.slice(start, end);

function makeContext() {
  const nodes = {
    "#customDetailRows":{innerHTML:""},
    "#customDetailPageSummary":{textContent:""},
    '[data-custom-detail-page="-1"]':{disabled:false},
    '[data-custom-detail-page="1"]':{disabled:false}
  };
  const modal = {querySelector:key=>{
    assert.ok(nodes[key], "unexpected selector " + key);
    return nodes[key];
  }};
  const context=vm.createContext({
    escapeHtml:htmlEscape,
    ensureCustomDetailModal:()=>modal
  });
  vm.runInContext("const CUSTOM_DETAIL_PAGE_SIZE = 50; let customDetailState;\n"+drilldownSource, context);
  return {context,nodes, setState:records=>vm.runInContext("customDetailState = {records:__records,page:0}", context)};
}

test("the detail header displays the nine business columns in exactly the requested order",()=>{
  const block=html.match(/<div class="custom-detail-data-wrap"><table[\s\S]*?<tbody id="customDetailRows"/);
  assert.ok(block);
  const actual=[...block[0].matchAll(/<th>([^<]+)<\/th>/g)].map(x=>x[1]);
  assert.deepEqual(actual, headings);
  assert.doesNotMatch(block[0],/レコードID|データ種別/);
  assert.match(html,/\.custom-detail-data \{ width:100%; min-width:1160px/);
});

test("actual application timestamps include the original time without shifting timezone",()=>{
  const {context:c}=makeContext();
  assert.equal(c.customDetailDateTime({"応募日時":"2026-11-12 14:35:20","応募識別方式":"PERSON_ID"}),"2026/11/12 14:35:20");
  assert.equal(c.customDetailDateTime({"応募日時":"2026/11/12 9:07","応募識別方式":"PERSON_NAME"}),"2026/11/12 09:07");
  assert.equal(c.customDetailDateTime({"応募日時":"2026-11-13T00:18:02","応募識別方式":"PERSON_ID"}),"2026/11/13 00:18:02");
  assert.equal(c.customDetailDateTime({"応募日時":"2026-11-12","応募識別方式":"PERSON_ID"}),"2026/11/12（時刻不明）");
  assert.equal(c.customDetailDateTime({"応募日時":""}),"—");
});

test("daily aggregates never claim to have a real application clock time",()=>{
  const {context:c}=makeContext();
  assert.equal(c.customDetailDateTime({"応募日時":"2026-11-12 00:00:00","応募識別方式":"AGG_DAILY"}),"2026/11/12（時刻不明）");
  assert.equal(c.customDetailDateTime({"応募日時":"2026/11/12 18:34:00","応募識別方式":"AGG_DAILY"}),"2026/11/12（時刻不明）");
  assert.match(html,/日別集計データには個々の応募時刻がない/);
});

test("minimum pay is shown with its unit and thousands separators, and missing information is blanked",()=>{
  const {context:c}=makeContext();
  assert.equal(c.customDetailMinSalary({"給与区分":"時給","給与金額MIN":"1,230"}),"時給 1,230円");
  assert.equal(c.customDetailMinSalary({"給与区分":"日給","給与金額MIN":10000}),"日給 10,000円");
  assert.equal(c.customDetailMinSalary({"給与区分":"月給","給与金額MIN":250000}),"月給 250,000円");
  assert.equal(c.customDetailMinSalary({"給与区分":"年収","給与金額MIN":"4000000"}),"年収 4,000,000円");
  assert.equal(c.customDetailMinSalary({"給与区分":"時給","給与金額MIN":0}),"—");
  assert.equal(c.customDetailMinSalary({"給与区分":"月給","給与金額MIN":""}),"—");
  assert.equal(c.customDetailMinSalary({"給与金額MIN":"1200"}),"—");
  assert.equal(c.customDetailMinSalary({}),"—");
  assert.equal(c.customDetailMinSalary(null),"—");
  assert.equal(c.customDetailMinSalary({"給与区分":"時給","給与金額MIN":"不明"}),"—");
});

test("detail rows are 9 columns, use job prefecture, gender and salary, and HTML-escape source values",()=>{
  const {context:c,nodes}=makeContext();
  c.__records=[{
    app:{"レコードID":"PRIVATE123","応募日時":"2026-11-12 14:35:20","応募識別方式":"PERSON_ID",
      "仕事番号":"JOB001","対応状況":"<対応待ち>","性別":"女性","応募媒体":"Indeed"},
    job:{"仕事名":"事務 <script>alert(1)</script>","勤務地都道府県":"東京都","給与区分":"時給","給与金額MIN":"1300"},
    ageBucket:"20代"
  }];
  vm.runInContext("customDetailState = {records:__records,page:0}; renderCustomDetailPage();",c);
  const row=nodes["#customDetailRows"].innerHTML;
  assert.equal((row.match(/<td>/g)||[]).length,9);
  assert.match(row,/JOB001/);
  assert.match(row,/2026\/11\/12 14:35:20/);
  assert.match(row,/&lt;対応待ち&gt;/);
  assert.match(row,/東京都/);
  assert.match(row,/20代/);
  assert.match(row,/女性/);
  assert.match(row,/Indeed/);
  assert.match(row,/時給 1,300円/);
  assert.match(row,/&lt;script&gt;/);
  assert.doesNotMatch(row,/PRIVATE123|PERSON_ID|<script>/);
  assert.equal(nodes["#customDetailPageSummary"].textContent,"1件中 1～1件を表示");
});

test("old records and missing joined jobs retain nine readable columns",()=>{
  const {context:c,nodes}=makeContext();
  c.__records=[{
    app:{"仕事番号":"OLD001","応募日時":"2025-02-01 00:00:00","応募識別方式":"AGG_DAILY","応募媒体":"AirWork"},
    job:null,ageBucket:"その他"
  }];
  vm.runInContext("customDetailState = {records:__records,page:0}; renderCustomDetailPage();",c);
  const row=nodes["#customDetailRows"].innerHTML;
  assert.equal((row.match(/<td>/g)||[]).length,9);
  assert.match(row,/2025\/02\/01（時刻不明）/);
  assert.match(row,/その他/);
  assert.match(row,/AirWork/);
  assert.ok((row.match(/—/g)||[]).length>=4);
});

test("pagination still limits detail rows to 50 and allows following pages",()=>{
  const {context:c,nodes}=makeContext();
  c.__records=Array.from({length:51},(_,i)=>({
    app:{"仕事番号":"JOB"+String(i+1).padStart(3,"0"),"応募日時":"2026-11-12 10:10:10"},
    job:{"仕事名":"staff","勤務地都道府県":"埼玉県"},
    ageBucket:"30代"
  }));
  vm.runInContext("customDetailState = {records:__records,page:0}; renderCustomDetailPage();",c);
  assert.equal((nodes["#customDetailRows"].innerHTML.match(/<tr>/g)||[]).length,50);
  assert.equal(nodes["#customDetailPageSummary"].textContent,"51件中 1～50件を表示");
  assert.equal(nodes['[data-custom-detail-page="1"]'].disabled,false);
  vm.runInContext("customDetailState.page=1; renderCustomDetailPage();",c);
  assert.equal((nodes["#customDetailRows"].innerHTML.match(/<tr>/g)||[]).length,1);
  assert.equal(nodes["#customDetailPageSummary"].textContent,"51件中 51～51件を表示");
  assert.equal(nodes['[data-custom-detail-page="1"]'].disabled,true);
});

test("all inline JavaScript stays syntactically valid and modal integration is unchanged",()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for(const part of scripts)if(part[1].trim())assert.doesNotThrow(()=>new vm.Script(part[1]));
  assert.match(html,/function openCustomDetailModal\(/);
  assert.match(html,/currentCustomCore\.customDrilldownRecords/);
  assert.match(html,/function closeCustomDetailModal\(/);
  assert.match(html,/const CUSTOM_DETAIL_PAGE_SIZE = 50/);
});
