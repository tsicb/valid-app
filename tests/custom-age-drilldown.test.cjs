"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname,"..");
const source = fs.readFileSync(path.join(root,"analysis-core.js"),"utf8");
const report = fs.readFileSync(path.join(root,"report.html"),"utf8");
const gas = fs.readFileSync(path.join(root,"central-api/03_Workbook.gs"),"utf8");
const context = vm.createContext({window:{},URL,console});
vm.runInContext(source,context,{filename:"analysis-core.js"});
const core = context.window.ValidApplicationAnalysisCore;

function makeRecord(id, age, media, status, jobName, {matched=true,jobAvailable=true,month="2026-10",method="PERSON_ID"}={}) {
    const app={"レコードID":id,"年齢":age,"応募媒体":media,"応募年月":month,
        "応募日時":`2026-10-${id.slice(-2)} 12:00:00`,"対応状況":status,
        "仕事番号":jobName||"X", "応募識別方式":method};
    const job=jobAvailable?{"職種":jobName,"仕事名":jobName+"スタッフ"}:null;
    return {app,job,age,appDate:new Date(2026,9,Number(id.slice(-2))),matched,jobAvailable,
        ageBucket:core.ageBucket(age,"年代"),enterpriseLabel:"テスト",kwSingle:"",kwFull:"",noteFirst:""};
}
function makeContext(records) {
    const caps={"年代":{available:true},"応募媒体":{available:true},"応募年月":{available:true},"対応状況":{available:true},"職種":{available:true}};
    return {recordsAll:records,recordsJobAvailable:records.filter(r=>r.jobAvailable),
        recordsMatched:records.filter(r=>r.matched&&r.jobAvailable),
        ageCols:core.ageBuckets("年代"),ageMode:"年代",
        sourceCapabilities:caps,widths:{monthDay:7,hour:6,tagCount:5,imageCount:1,text:300,
            hourlySalary:50,dailySalary:1000,monthlySalary:50000,annualSalary:500000}};
}
const records=[
    makeRecord("R01",24,"Indeed","未対応","事務"),
    makeRecord("R02",27,"Indeed","対応済","事務"),
    makeRecord("R03",31,"Indeed","対応済","事務",{matched:false}),
    makeRecord("R04",29,"天職市場","未対応","事務",{matched:false,jobAvailable:false,method:"AGG_DAILY"}),
    makeRecord("R05",23,"Indeed","未対応","技術")
];

test("年代 is an application-scope axis and follows display-setting age ON/OFF",()=>{
    const c=makeContext(records);
    assert.equal(core.customAxisDataScope("年代"),"application");
    assert.ok(core.customAxisOptions(c,[]).includes("年代"));
    assert.ok(!core.customAxisOptions(c,[{id:"age",visible:false}]).includes("年代"));
    c.sourceCapabilities["年代"]={available:false};
    assert.ok(!core.customAxisOptions(c,[]).includes("年代"));
    assert.match(gas,/\['年代', 'age'\]/);
});

test("age-band source availability requires the numeric age column, not merely legacy labels",()=>{
    const base={apps:[{"年代":"20代"}],jobs:[],keywordMaster:[],
        enterpriseInfo:{hasAnyDisplayName:false}};
    assert.equal(core.buildAnalysisSourceCapabilities({...base,applicationHeaders:["年代"]})["年代"].available,false);
    assert.equal(core.buildAnalysisSourceCapabilities({...base,applicationHeaders:["年齢","年代"]})["年代"].available,true);
});

test("clickable count markup escapes aggregate labels and leaves empty cells as text",()=>{
    const start=report.indexOf("const CUSTOM_DETAIL_PAGE_SIZE = 50;");
    const end=report.indexOf("function ensureCustomDetailModal()",start);
    assert.ok(start>=0&&end>start);
    const ctx=vm.createContext({currentCustomCore:{formatNumber:n=>n.toLocaleString("ja-JP")},
        escapeHtml:s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")});
    vm.runInContext(report.slice(start,end),ctx);
    assert.equal(ctx.customDetailCountHtml(0,"cell","x","y"),"0");
    const markup=ctx.customDetailCountHtml(10,"cell",'<script>alert("X")</script>',"A&B");
    assert.match(markup,/data-custom-detail-kind="cell"/);
    assert.match(markup,/&lt;script&gt;/);
    assert.match(markup,/A&amp;B/);
    assert.doesNotMatch(markup,/<script>/);
});

test("年代 follows existing standard/5-years-shift classification and sort",()=>{
    assert.equal(core.ageBucket(24,"年代"),"20代");
    assert.equal(core.ageBucket(24,"年代（5歳ずらし）"),"15-25歳");
    assert.equal(core.ageBucket(27,"年代（5歳ずらし）"),"26-35歳");
    const c=makeContext(records);
    assert.equal(core.customAxisValue(records[0],"年代",c).label,"20代");
    assert.ok(core.customAxisValue(records[0],"年代",c).sortValue <
        core.customAxisValue(records[2],"年代",c).sortValue);
    const unknown=makeRecord("R06",null,"Indeed","未対応","事務");
    unknown.ageBucket="その他";
    assert.equal(core.customAxisValue(unknown,"年代",c).label,"その他");
});

test("all custom pivot leaf cells and row/column/grand totals drill down to exact counted records",()=>{
    const c=makeContext(records);
    const agg=core.aggregateCustom(c,{rowAxes:["職種","年代"],colAxis:"応募媒体"});
    assert.equal(agg.ok,true);
    assert.equal(agg.applicationCount,4,"jobAnalysis scope excludes unmatched-job record");
    let allCells=0;
    for(const entry of agg.rowEntries){
        const byCol=agg.matrix.get(entry.key);
        let rowTotal=0;
        for(const colLabel of agg.colLabels){
            const count=byCol.get(colLabel)||0;
            const ids=core.customDrilldownRecords(agg,{kind:"cell",rowKey:entry.key,colLabel});
            assert.equal(ids.length,count);
            rowTotal+=ids.length;
            allCells+=ids.length;
        }
        assert.equal(rowTotal,agg.rowTotals.get(entry.key));
        assert.equal(core.customDrilldownRecords(agg,{kind:"row",rowKey:entry.key}).length,rowTotal);
    }
    for(const colLabel of agg.colLabels){
        assert.equal(core.customDrilldownRecords(agg,{kind:"column",colLabel}).length,agg.colTotals.get(colLabel));
    }
    assert.equal(allCells,4);
    assert.equal(core.customDrilldownRecords(agg,{kind:"grand"}).length,4);
    const k=JSON.stringify(["事務","20代"]);
    assert.deepEqual(Array.from(core.customDrilldownRecords(agg,{kind:"cell",rowKey:k,colLabel:"Indeed"}).map(r=>r.app["レコードID"])),["R01","R02"]);
    assert.equal(core.customDrilldownRecords(agg,{kind:"cell",rowKey:"invalid",colLabel:"Indeed"}).length,0);
});

test("application-only age analysis includes unmatched and daily-aggregate rows, and respects every cell count",()=>{
    const agg=core.aggregateCustom(makeContext(records),{rowAxes:["年代","応募媒体"],colAxis:"対応状況"});
    assert.equal(agg.ok,true);
    assert.equal(agg.applicationCount,5);
    const all=core.customDrilldownRecords(agg,{kind:"grand"});
    assert.equal(all.length,5);
    assert.equal(all.filter(r=>r.app["応募識別方式"]==="AGG_DAILY").length,1);
    assert.equal(core.customDrilldownRecords(agg,{kind:"cell",rowKey:JSON.stringify(["20代","天職市場"]),colLabel:"未対応"}).length,1);
    assert.equal(core.aggregateCustom(makeContext(records),{rowAxes:["年代"],colAxis:"年代"}).reason,"DUPLICATE_AXIS");
});

test("row-level detail is restricted by the exact job CSV scope used for the matrix",()=>{
    const agg=core.aggregateCustom(makeContext(records),{rowAxes:["年代"],colAxis:"メイン画像有無"});
    assert.equal(agg.ok,true);
    assert.equal(agg.applicationCount,3,"jobCsv-only axes retain matched records even for missing images");
    assert.equal(core.customDrilldownRecords(agg,{kind:"grand"}).length,3);
    const unmatched=core.aggregateCustom(makeContext(records),{rowAxes:["年代"],colAxis:"職種"});
    assert.equal(unmatched.applicationCount,4,"jobAnalysis scope matches recorded jobs only");
    assert.equal(core.customDrilldownRecords(unmatched,{kind:"grand"}).length,4);
});

test("invalid and empty drilldown selections never leak unrelated rows",()=>{
    const agg=core.aggregateCustom(makeContext(records),{rowAxes:["年代"],colAxis:"応募媒体"});
    assert.equal(core.customDrilldownRecords(agg,{kind:"unknown"}).length,0);
    assert.equal(core.customDrilldownRecords({ok:false},{kind:"grand"}).length,0);
    assert.equal(core.customDrilldownRecords(agg,{kind:"column",colLabel:"NO SUCH"}).length,0);
});

test("report offers clickable leaf/totals and accessible paged modal while avoiding raw PII fields",()=>{
    assert.match(report,/function customDetailCountHtml\(/);
    assert.match(report,/customDetailCountHtml\(rowMap\.get\(colLabel\)\|\|0,"cell"/);
    assert.match(report,/customDetailCountHtml\(result\.rowTotals\.get\(entry\.key\)\|\|0,"row"/);
    assert.match(report,/customDetailCountHtml\(result\.colTotals\.get\(colLabel\) \|\| 0,"column"/);
    assert.match(report,/customDetailCountHtml\(result\.applicationCount,"grand"\)/);
    assert.match(report,/aria-modal", "true"/);
    assert.match(report,/const CUSTOM_DETAIL_PAGE_SIZE = 50/);
    const detailCode=report.slice(report.indexOf("function renderCustomDetailPage()"),report.indexOf("function bindCustomResultDrilldown("));
    assert.doesNotMatch(detailCode,/app\["(?:氏名|電話番号|メールアドレス|応募識別キー|詳細住所)"\]/);
    assert.match(detailCode,/escapeHtml\(/);
});

test("all inline scripts remain valid JavaScript and no duplicate static HTML IDs introduced",()=>{
    const scripts=[...report.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length);
    for(const script of scripts)if(script[1].trim())assert.doesNotThrow(()=>new vm.Script(script[1]));
    assert.equal((report.match(/id="customResult"/g)||[]).length,1);
});
