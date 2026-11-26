"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const realIdentity=require("../append-identity-v1.js");
const sidecar=require("../limited-append-candidates-v1.js");

const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const SECRET="qa-only-pages-no-prod-secret";
const APPS=["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ","応募日時","対応状況","応募識別キー","応募識別方式"];
const JOBS=["求人参照ID","求人分析情報ソース","企業ID","仕事番号","仕事名","給与金額MIN"];
const projectJob=(meta,ref)=>({
 "求人参照ID":ref,"求人分析情報ソース":meta.source,
 ...meta.values
});
function cut(a,b) {
 const first=html.indexOf(a),last=html.indexOf(b,first+a.length);
 assert.ok(first>0 && last>first,"index.html missing "+a);
 return html.slice(first,last);
}
const company=r=>String(r?.["企業コード"]||r?.["企業ID"]||"").trim().toUpperCase();
const normalizedJobNo=r=>String(r||"").trim().toUpperCase().replace(/_[0-9]{3,8}$|§.*/g,"");
const formatDate=value=>String(value||"").trim().replace(/-/g,"/");
const buildJobMeta=(raw,job,isMatched)=>isMatched?{
 source:"JOB_CSV",
 values:{
  "企業ID":company(raw),"仕事番号":raw["仕事番号"],
  "仕事名":job["仕事名"],"給与金額MIN":job["給与金額MIN"]
 }
}:null;
function row(who,job="J101",status="未対応",date="2026/11/05 10:00:00") {
 const r={
  "企業コード":"C01","仕事番号":job,"対応状況":status,"応募日時":date,
  "仕事名":"倉庫スタッフ","応募媒体":"Indeed"
 };
 Object.defineProperty(r,"__vaaIdentityRaw",{enumerable:false,
  value:{name:who,applicantId:""}});
 return r;
}
function raw(who,job="J101",status="面接確定",date="2026/11/05 10:00:00") {
 return {"企業コード":"C01","氏名":who,"応募者ID":"",
  "仕事番号":job,"応募日時":date,"対応状況":status,
  "仕事名":"倉庫スタッフ","応募媒体":"Indeed"};
}
function context(options={}) {
 const globalFinalData=options.globalFinalData||[row("架空花子","J202","未対応","2026/11/18 10:00:00")];
 const ctx={
  URL,console,globalFinalData,
  globalDuplicateData:options.globalDuplicateData||[raw("架空花子","J101","面接確定")],
  globalJobSnapshot:options.globalJobSnapshot||[
   {"企業ID":"C01","仕事番号":"J101","仕事名":"正式求人名","給与金額MIN":"1350"}
  ],
  globalLimitedAppendCapabilityEnabled:options.enabled===undefined?true:options.enabled,
  globalLastUpdateStrategy:options.strategy||"APPEND",
  globalLimitedAppendCandidates:null,
  globalDuplicateCount:0,globalJoinCount:0,
  VAAClientIdentity:{assign:(rows,secret)=>realIdentity.assign(rows,secret,crypto.webcrypto)},
  VAALimitedAppendCandidates:{build:o=>sidecar.build({...o,cryptoProvider:crypto.webcrypto})},
  vaaFetchIdentitySecret:async()=>SECRET,
  getEnterpriseIdFromRow:company,preprocessKey:normalizedJobNo,formatDateTime:formatDate,
  buildJobAnalysisMeta:buildJobMeta,buildJobRecordFromJoinedRow:(r,ref)=>projectJob(r.__jobAnalysisMeta,ref),
  JOB_ANALYSIS_HEADERS:JOBS
 };
 vm.createContext(ctx);
 vm.runInContext(
  cut("async function vaaApplyApplicationIdentities(", "function vaaAwaitUpdateConfirmation("),
  ctx,{filename:"Pages:vaaApplyApplicationIdentities"}
 );
 return ctx;
}

test("Pages loads a browser candidate module after canonical HMAC identity module",()=>{
 const a=html.indexOf('<script src="./append-identity-v1.js"></script>');
 const b=html.indexOf('<script src="./limited-append-candidates-v1.js"></script>');
 assert.ok(a>0&&b>a);
 assert.equal(typeof sidecar.build,"function");
});

test("actual Pages HMAC-save path keeps only representative as application and carries discarded row in sidecar",async()=>{
 const ctx=context();
 const s=await ctx.vaaApplyApplicationIdentities("test-auth");
 assert.equal(s.total,1);
 assert.equal(ctx.globalFinalData.length,1);
 assert.equal(ctx.globalFinalData[0]["仕事番号"],"J202");
 assert.equal(ctx.globalLimitedAppendCandidates.applicationData.rows.length,1);
 assert.equal(ctx.globalLimitedAppendCandidates.jobAnalysisMaster.rows.length,1);
 const app=ctx.globalLimitedAppendCandidates.applicationData;
 const i=k=>app.headers.indexOf(k);
 assert.match(app.rows[0][i("応募識別キー")],/^I1:[a-f0-9]{64}$/);
 assert.equal(app.rows[0][i("仕事番号")],"J101");
 assert.equal(app.rows[0][i("対応状況")],"面接確定");
 assert.equal(app.rows[0][i("求人データ突合フラグ")],1);
 const text=JSON.stringify(ctx.globalLimitedAppendCandidates);
 for(const pii of ["架空花子","氏名","メールアドレス","応募者ID"])
  assert.ok(!text.includes(pii),"no PII in sidecar: "+pii);
});

test("actual Pages keeps old identity behavior and creates no candidate when capability OFF",async()=>{
 const ctx=context({enabled:false});
 await ctx.vaaApplyApplicationIdentities("test-auth");
 assert.equal(ctx.globalFinalData.length,1);
 assert.equal(ctx.globalLimitedAppendCandidates,null);
});

test("actual Pages keeps CREATE/REPLACE behavior even if capability is advertised",async()=>{
 const ctx=context({strategy:"REPLACE"});
 await ctx.vaaApplyApplicationIdentities("test-auth");
 assert.equal(ctx.globalLimitedAppendCandidates,null);
});

test("second post-HMAC dedupe provides a joined candidate even without first-stage discarded rows",async()=>{
 const first=row("架空花子","J202","未対応","2026/11/18 10:00:00");
 const second=row("架空花子","J101","内定","2026/11/05 10:00:00");
 Object.defineProperty(second,"__jobAnalysisMeta",{
  enumerable:false,value:buildJobMeta(
   {"企業コード":"C01","仕事番号":"J101"},
   {"仕事名":"正式求人名","給与金額MIN":"1350"},true)
 });
 const ctx=context({
  globalFinalData:[first,second],globalDuplicateData:[],globalJobSnapshot:[]
 });
 const stats=await ctx.vaaApplyApplicationIdentities("test-auth");
 assert.equal(stats.duplicateWithinUpload,1);
 assert.equal(ctx.globalFinalData.length,1);
 assert.equal(ctx.globalLimitedAppendCandidates.applicationData.rows.length,1);
 assert.equal(ctx.globalLimitedAppendCandidates.jobAnalysisMaster.rows.length,1);
 const app=ctx.globalLimitedAppendCandidates.applicationData;
 assert.equal(app.rows[0][app.headers.indexOf("対応状況")],"内定");
});

test("actual buildSheetsPayloadV3 sends optional sidecar for APPEND only",()=>{
 const js=cut("function buildSheetsPayloadV3(", "/**\n * Obtain session HMAC key");
 const ctx={
  URL,window:{location:{href:"https://example.test/index.html"}},
  SHEETS_SCHEMA_VERSION:"3.0",SHEETS_APP_VERSION:"qa",
  COMMON_MASTER_VERSION:"qa",globalLastUpdateStrategy:"APPEND",
  globalLimitedAppendCapabilityEnabled:true,
  globalLimitedAppendCandidates:{applicationData:{headers:[],rows:[]},
    jobAnalysisMaster:{headers:[],rows:[]}},
  normalizeString:x=>String(x||"").trim(),
  buildNormalizedSheetsModel:()=>({
    applicationData:{headers:APPS,rows:[]},
    jobAnalysisMaster:{headers:JOBS,rows:[]}
  }),
  makeRequestId:()=>"qa1",
  document:{getElementById:()=>({value:"qa"})},
  normalizeCompanyDisplayNameForUi:x=>x,
  getSelectedCreateOutputFolderId:()=>"QA_ONLY",
  getSelectedCreateOutputFolderName:()=>"QA_ONLY",
  buildProcessInfoDataset:()=>({headers:[],rows:[]}),
  buildInputFilesDataset:()=>({headers:[],rows:[]}),
  buildImageMasterInitialDataset:()=>({headers:[],rows:[]})
 };
 vm.createContext(ctx);vm.runInContext(js,ctx);
 const app=ctx.buildSheetsPayloadV3("","qa1","https://docs.google.com/spreadsheets/d/QATEST");
 assert.equal(app.limitedAppendProtocol,"LIMITED_APPEND_V1");
 assert.equal(app.limitedAppendCandidates.applicationData.rows.length,0);
 ctx.globalLimitedAppendCapabilityEnabled=false;
 const legacy=ctx.buildSheetsPayloadV3("","qa1","https://docs.google.com/spreadsheets/d/QATEST");
 assert.equal(Object.hasOwn(legacy,"limitedAppendProtocol"),false);
 assert.equal(Object.hasOwn(legacy,"limitedAppendCandidates"),false);
 ctx.globalLimitedAppendCapabilityEnabled=true;
 ctx.globalLastUpdateStrategy="REPLACE";
 const replacement=ctx.buildSheetsPayloadV3("","qa1","https://docs.google.com/spreadsheets/d/QATEST");
 assert.equal(Object.hasOwn(replacement,"limitedAppendProtocol"),false);
 ctx.globalLastUpdateStrategy="APPEND";
 const created=ctx.buildSheetsPayloadV3("","qa1","");
 assert.equal(Object.hasOwn(created,"limitedAppendProtocol"),false);
});


test("pre-confirm advisory recognizes a real JOB_CSV match on a discarded person row",()=>{
  const src=cut("function vaaCountPotentialDiscardedJobCsvMatches(",
    "async function vaaApplyApplicationIdentities(");
  const ctx={
    Map,console,
    getEnterpriseIdFromRow:r=>String(r["企業コード"]||r["企業ID"]||""),
    preprocessKey:v=>String(v||"").trim().toUpperCase(),
    globalJoinCount:0,
    globalLimitedAppendCapabilityEnabled:true,
    globalLastUpdateStrategy:"APPEND",
    globalLimitedAppendCandidates:null
  };
  vm.createContext(ctx);vm.runInContext(src,ctx);
  const byJob=new Map([["C01_J101",{source:"JOB_CSV"}]]);
  assert.equal(ctx.vaaCountPotentialDiscardedJobCsvMatches([
    {"企業コード":"C01","仕事番号":"J101","氏名":"架空花子"},
    {"企業コード":"C01","仕事番号":"J999","氏名":"架空太郎"}
  ],byJob),1);
  assert.equal(ctx.vaaHasEffectiveJobCsvMatchForUpdate(),false);
  ctx.globalLimitedAppendCandidates={
    jobAnalysisMaster:{headers:["求人参照ID"],rows:[["UC000001"]]}
  };
  assert.equal(ctx.vaaHasEffectiveJobCsvMatchForUpdate(),true);
  ctx.globalLastUpdateStrategy="REPLACE";
  assert.equal(ctx.vaaHasEffectiveJobCsvMatchForUpdate(),false);
  ctx.globalLastUpdateStrategy="APPEND";
  ctx.globalLimitedAppendCapabilityEnabled=false;
  assert.equal(ctx.vaaHasEffectiveJobCsvMatchForUpdate(),false);
});

test("job-not-found warning remains for truly unmatched CSV, but not a real discarded-row candidate",()=>{
  assert.match(html,/globalLimitedAppendPotentialJobMatchCount === 0;/);
  assert.match(html,/!vaaHasEffectiveJobCsvMatchForUpdate\(\)/);
  assert.match(html,/globalLimitedAppendPotentialJobMatchCount\.toLocaleString\(\)/);
  assert.match(html,/globalLimitedAppendPotentialJobMatchCount = 0;/);
});
