"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const root=path.resolve(__dirname,"..");
const coreText=fs.readFileSync(path.join(root,"analysis-core.js"),"utf8");
const reportText=fs.readFileSync(path.join(root,"report.html"),"utf8");
const context=vm.createContext({window:{},URL,console});
vm.runInContext(coreText,context);
const core=context.window.ValidApplicationAnalysisCore;
const fixture=[
 {id:"A",ageBucket:"20代",isTarget:true,app:{"応募媒体":"Indeed","対応状況":"採用","応募年月":"26年10月"},job:{"Indeed求人タグコード":"101::102","メイン画像ファイル名":"a.jpg"},noteFirst:"週休2日",jobRefId:"J1"},
 {id:"B",ageBucket:"30代",isTarget:false,app:{"応募媒体":"Indeed","対応状況":"採用","応募年月":"26年11月"},job:{"Indeed求人タグコード":"101::101","メイン画像ファイル名":"a.jpg"},noteFirst:"週休2日",jobRefId:"J1"},
 {id:"C",ageBucket:"20代",isTarget:true,app:{"応募媒体":"AirWork","対応状況":"辞退","応募年月":"26年11月"},job:{"Indeed求人タグコード":"","メイン画像ファイル名":""},noteFirst:"未掲載",jobRefId:"J2"},
 {id:"D",ageBucket:"その他",isTarget:false,app:{"応募媒体":"AirWork","対応状況":"採用","応募年月":"26年11月"},job:{"Indeed求人タグコード":"102","メイン画像ファイル名":"b.jpg"},noteFirst:"日勤",jobRefId:"J3"}
];
const ctx={
 ageCols:["20代","30代","その他"],
 recordsAll:fixture,recordsMatched:fixture,recordsJobAvailable:fixture,
 basicRecordsMatched:fixture,basicRecordsJobAvailable:fixture,
 imageMap:{"a.jpg":"https://example.com/a.jpg"},tagMaster:{"101":"タグ1","102":"タグ2"},
 indeedTagLimit:10,topImageLimit:10,
 widths:{hourlySalary:50,dailySalary:1000,monthlySalary:50000,annualSalary:500000,hour:6,monthDay:7,tagCount:5,imageCount:1,text:300}
};
const ids=r=>Array.from(r,x=>x.id).sort().join(",");

test("basic age cross cells, row totals, column totals, grand totals and target totals match counts",()=>{
 const agg=core.aggregateCross(fixture,record=>({label:record.app["応募媒体"]}),ctx,{sort:"countDesc"});
 assert.equal(agg.baseTotal,4);
 for(const row of agg.groups){
  assert.equal(agg.drilldownRecords({rowKey:row.label}).length,row.total);
  assert.equal(agg.drilldownRecords({rowKey:row.label,targetOnly:true}).length,row.target);
  for(const age of agg.ageCols)assert.equal(
   agg.drilldownRecords({rowKey:row.label,columnLabel:age}).length,row.ageCounts[age]
  );
 }
 assert.equal(agg.drilldownRecords().length,agg.baseTotal);
 assert.equal(agg.drilldownRecords({targetOnly:true}).length,agg.baseTarget);
 assert.equal(agg.drilldownRecords({columnLabel:"20代"}).length,2);
 assert.equal(ids(agg.drilldownRecords({rowKey:"Indeed",columnLabel:"20代",targetOnly:true})),"A");
 assert.equal(agg.drilldownRecords({rowKey:"unknown"}).length,0);
});

test("basic comparison column supports month/media and multi-column recent totals",()=>{
 const axis={key:"month",axis:"応募年月",columnLabels:["26年10月","26年11月"]};
 const agg=core.aggregateCrossByColumnAxis(fixture,r=>({label:r.app["対応状況"]}),ctx,{sort:"countDesc"},axis);
 assert.equal(agg.baseTotal,4);
 for(const row of agg.groups){
  for(const label of agg.columnLabels){
   assert.equal(agg.drilldownRecords({rowKey:row.label,columnLabel:label}).length,row.columnCounts[label]);
  }
  assert.equal(agg.drilldownRecords({rowKey:row.label}).length,row.total);
  assert.equal(agg.drilldownRecords({rowKey:row.label,targetOnly:true}).length,row.target);
 }
 assert.equal(ids(agg.drilldownRecords({columnLabels:["26年11月"]})),"B,C,D");
 assert.equal(ids(agg.drilldownRecords({rowKey:"採用",columnLabels:["26年10月","26年11月"]})),"A,B,D");
 assert.equal(agg.drilldownRecords({columnLabels:["26年10月","26年11月"]}).length,agg.baseTotal);
 assert.equal(agg.drilldownRecords({targetOnly:true}).length,agg.baseTarget);
});

test("note first line detail uses same lazy matching and age filtering",()=>{
 const detail=core.aggregateNoteDetail(ctx,{key:"age"});
 assert.equal(detail.visible,true);
 const agg=detail.aggregate;
 for(const row of agg.groups){
  assert.equal(agg.drilldownRecords({rowKey:row.label}).length,row.total);
  assert.equal(agg.drilldownRecords({rowKey:row.label,targetOnly:true}).length,row.target);
 }
 assert.equal(ids(agg.drilldownRecords({rowKey:"週休2日",columnLabel:"20代"})),"A");
 assert.equal(agg.drilldownRecords().length,4);
});

test("Indeed tag detail matches counted applications, with multi-tag overlap and no-tag rows",()=>{
 const detail=core.aggregateIndeedTags(ctx,{key:"age"});
 assert.equal(detail.visible,true);
 const a=detail.rows.find(r=>r.key==="101");
 const b=detail.rows.find(r=>r.key==="102");
 const none=detail.rows.find(r=>r.key==="__NO_TAG__");
 assert.ok(a&&b&&none);
 assert.equal(a.total,2);assert.equal(b.total,2);assert.equal(none.total,1);
 assert.equal(ids(detail.drilldownRecords({rowKey:"101"})),"A,B");
 assert.equal(ids(detail.drilldownRecords({rowKey:"102"})),"A,D");
 assert.equal(ids(detail.drilldownRecords({rowKey:"__NO_TAG__"})),"C");
 for(const row of detail.rows){
   assert.equal(detail.drilldownRecords({rowKey:row.key}).length,row.total);
   assert.equal(detail.drilldownRecords({rowKey:row.key,targetOnly:true}).length,row.target);
   for(const age of detail.ageCols)assert.equal(detail.drilldownRecords({rowKey:row.key,columnLabel:age}).length,row.ageCounts[age]);
 }
 assert.equal(detail.drilldownRecords().length,detail.baseTotal);
 assert.ok(a.total+b.total+none.total>detail.baseTotal,"tag overlap is not deduplicated across groups");
});

test("TOP image detail matches image filename keys and missing-image bucket",()=>{
 const detail=core.aggregateTopImages(ctx,{key:"age"});
 assert.equal(detail.visible,true);
 const a=detail.rows.find(r=>r.key==="a.jpg");
 const empty=detail.rows.find(r=>r.key==="__NO_IMAGE__");
 assert.ok(a&&empty);
 assert.equal(ids(detail.drilldownRecords({rowKey:a.key})),"A,B");
 assert.equal(ids(detail.drilldownRecords({rowKey:empty.key})),"C");
 for(const row of detail.rows){
  assert.equal(detail.drilldownRecords({rowKey:row.key}).length,row.total);
  assert.equal(detail.drilldownRecords({rowKey:row.key,targetOnly:true}).length,row.target);
  for(const age of detail.ageCols)assert.equal(detail.drilldownRecords({rowKey:row.key,columnLabel:age}).length,row.ageCounts[age]);
 }
 assert.equal(detail.drilldownRecords().length,detail.baseTotal);
});

test("unknown row / missing column never returns unrelated applicant records",()=>{
 const agg=core.aggregateCross(fixture, r=>({label:r.app["対応状況"]}),ctx);
 assert.equal(agg.drilldownRecords({rowKey:"missing"}).length,0);
 assert.equal(agg.drilldownRecords({columnLabel:"missing"}).length,0);
 assert.equal(agg.drilldownRecords({columnLabels:[]}).length,0);
});

test("shared count renderer escapes attrs and ignores zero/noninteger values",()=>{
 const start=reportText.indexOf("function analysisDetailCountHtml(");
 const end=reportText.indexOf("function openAnalysisRecordDetails(",start);
 assert.ok(start>=0&&end>start);
 const h=v=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
 const ctx=vm.createContext({escapeHtml:h});
 vm.runInContext(reportText.slice(start,end),ctx);
 assert.equal(ctx.analysisDetailCountHtml(0,"media"),"0");
 assert.equal(ctx.analysisDetailCountHtml(1.5,"media"),"1.5");
 const rendered=ctx.analysisDetailCountHtml(12,"media",{rowKey:'<img src=x>',columnLabels:["20代","30代"],targetOnly:true});
 assert.match(rendered,/data-analysis-detail-source="media"/);
 assert.match(rendered,/&lt;img src=x&gt;/);
 assert.match(rendered,/data-detail-target="1"/);
 assert.match(rendered,/data-detail-column-labels=/);
 assert.match(rendered,/data-detail-expected="12"/);
 assert.doesNotMatch(rendered,/<img/);
});

test("HTML integration has basic/distribution/note/age/tag/image click sites without forecast or percentage links",()=>{
 assert.match(reportText,/function bindReportAnalysisDetailClicks\(/);
 assert.match(reportText,/currentReportDetailResult = result/);
 assert.match(reportText,/analysisDetailCountHtml\(row.count,"age-rows"/);
 for(const s of ["function renderCrossTable(", "function renderBasicDistributionTable(", "function renderStandaloneCross(","function renderIndeedTagDetail(","function renderTopImageDetail("]){
  const start=reportText.indexOf(s);
  const end=reportText.indexOf("\nfunction ",start+s.length);
  assert.ok(start>=0&&end>start,s+" exists");
  assert.match(reportText.slice(start,end),/analysisDetailCountHtml\(/,s+" includes clickable counts");
 }
 assert.match(reportText,/showApplicantRecordDetails\(records,/);
 assert.match(reportText,/function openCustomDetailModal\(/);
 assert.doesNotMatch(reportText,/analysisDetailCountHtml\(agg\.forecast/);
 assert.doesNotMatch(reportText,/analysisDetailCountHtml\(row\.jobCount/);
});

test("all inline report scripts remain syntactically valid",()=>{
 const scripts=[...reportText.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length>0);
 for(const script of scripts)if(script[1].trim())assert.doesNotThrow(()=>new vm.Script(script[1]));
});
