"use strict";

/**
 * Isolated high-fidelity CSV -> identity -> limited GAS plan -> Viewer QA.
 * Every CSV contains fictitious candidates; NO network, Sheets, GAS writes,
 * keys, credentials, or production customer data are used.
 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const client=require("../append-identity-v1.js");
const gas=require("../central-api/append-merge-core.js");
const candidateBuilder=require("../limited-append-candidates-v1.js");

const ROOT=path.join(__dirname,"..");
const SECRET="fictional-fixture-hmac-only";
const COMPANY="DEMO001";
const APP_HEADERS=[
  "レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ",
  "応募日時","対応状況","応募識別キー","応募識別方式","応募媒体","年齢"
];
const JOB_HEADERS=[
  "求人参照ID","企業ID","仕事番号","仕事名","職種","給与金額MIN","求人分析情報ソース"
];
const val=(d,row,h)=>row[d.headers.indexOf(h)];
const ds=(headers,rows)=>({headers:[...headers],rows:rows.map(r=>[...r])});
const company=row=>String(row["企業コード"]||row["企業ID"]||"").trim().toUpperCase();

function parseCsv(file){
  const str=fs.readFileSync(path.join(ROOT,"tests/fixtures/append-smoke",file),"utf8").trim();
  const all=str.split(/\r?\n/).map(l=>l.split(","));
  const headers=all.shift();
  return {
    headers,
    rows:all.map(columns=>Object.fromEntries(headers.map((h,i)=>[h,columns[i]||""])))
  };
}

function makeNormalizer(){
  const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
  const labels=[
    ["function cleanCsvHeader(", "async function detectCsvEncoding("],
    ["function firstNonEmptyCsvValue(", "function normalizeApplicationGender("],
    ["function normalizeApplicationGender(", "function detectApplicationCsvFormat("],
    ["function detectApplicationCsvFormat(", "function validateFixedCsvFormat("],
    ["function validateFixedCsvFormat(", "async function parseCSV("]
  ];
  const chunks=labels.map(([a,b])=>{
    const start=html.indexOf(a),end=html.indexOf(b,start+a.length);
    assert.ok(start>0&&end>start,"actual Pages normalizer exists");
    return html.slice(start,end);
  });
  const context={console};
  vm.createContext(context);
  vm.runInContext(chunks.join("\n"),context);
  return context;
}
const normalize=makeNormalizer();
function appsFromCsv(file) {
  const p=parseCsv(file);
  return normalize.normalizeApplicationCsv(p.rows,p.headers).rows;
}
async function addIdentity(rows,sourceFileIndex=0) {
  rows.forEach(row=>{
    if(Object.hasOwn(row,"__vaaIdentityRaw"))return;
    Object.defineProperty(row,"__vaaIdentityRaw",{
      enumerable:false,
      value:{
        applicantId:row["応募者ID"]||"",name:row["氏名"]||"",
        inputFileIndex:sourceFileIndex
      }
    });
  });
  await client.assign(rows,SECRET,crypto.webcrypto);
  return rows;
}
function jobSource(rows,jobCsvRows=[]) {
  const master=new Map();
  for(const row of jobCsvRows) {
    const key=gas.jobKey(company(row),row["仕事番号"]);
    if(key && !master.has(key))master.set(key,row);
  }
  const byKey=new Map();
  const jobs=[];
  const apps=[];
  for(const row of rows) {
    const key=gas.jobKey(company(row),row["仕事番号"]);
    const matched=master.get(key);
    let reference=byKey.get(key);
    if(!reference&&key) {
      reference="JOB"+String(jobs.length+1).padStart(6,"0");
      byKey.set(key,reference);
      jobs.push([
        reference, company(row),row["仕事番号"],
        matched?.["仕事名"]||row["仕事名"]||"",
        matched?.["職種"]||"",
        matched?.["給与金額MIN"]||"",
        matched?"JOB_CSV":"APPLICATION_EMBEDDED"
      ]);
    }
    apps.push([
      "APP"+String(apps.length+1).padStart(6,"0"),
      company(row),row["仕事番号"],reference||"",
      matched?1:0,row["応募日時"],row["対応状況"],
      row.__vaaIdentity.key,row.__vaaIdentity.mode,
      row["応募媒体"],row["年齢"]||""
    ]);
  }
  return {
    applicationData:ds(APP_HEADERS,apps),
    jobAnalysisMaster:ds(JOB_HEADERS,jobs)
  };
}
function fixtureJobs(filename){
  return filename?parseCsv(filename).rows:[];
}
function makeGAS(){
  const ctx={
    VAAAppendMergeCore:gas,
    API_CONFIG:{MAX_DATASET_ROWS:100000},
    vaaLimitedAppendEnabled_:()=>true,
    normalizeString_:v=>v==null?"":String(v).trim()
  };
  vm.createContext(ctx);
  for(const name of ["26_Limited_Append.gs","12_Append_DataStore.gs"]){
    vm.runInContext(fs.readFileSync(path.join(ROOT,"central-api",name),"utf8"),ctx);
  }
  return ctx;
}
function newPayload(data,candidates=null) {
  const obj={datasets:data};
  if(candidates){
    obj.limitedAppendProtocol="LIMITED_APPEND_V1";
    obj.limitedAppendCandidates=candidates;
  }
  return obj;
}
function merge(ctx,mode,current,payload){
  const plan=ctx.vaaBuildAppendStorePlan_(
    payload,current?{
      applicationIdentityVersion:current.applicationIdentityVersion,
      datasets:{
        applicationData:current.datasets.applicationData,
        jobAnalysisMaster:current.datasets.jobAnalysisMaster
      }
    }:null,mode
  );
  const updated={
    applicationIdentityVersion:plan.applicationIdentityVersion,
    datasets:{
      applicationData:plan.datasets.applicationData,
      jobAnalysisMaster:plan.datasets.jobAnalysisMaster
    }
  };
  return {updated,plan};
}
function makeViewer(){
  const js=fs.readFileSync(path.join(ROOT,"analysis-core.js"),"utf8");
  const context={window:{},Date,Intl,Number,Map,Set};
  vm.createContext(context);
  vm.runInContext(js,context);
  return context.window.ValidApplicationAnalysisCore;
}
const viewer=makeViewer();
function view(updated){
  return viewer.buildViewerContext({
    datasets:{
      applicationData:updated.datasets.applicationData,
      jobAnalysisMaster:updated.datasets.jobAnalysisMaster
    },settings:{}
  });
}
const items=updated=>updated.datasets.applicationData.rows.map(r=>({
  row:r,
  status:val(updated.datasets.applicationData,r,"対応状況"),
  job:val(updated.datasets.applicationData,r,"仕事番号")
}));
const getJob=updated=>updated.datasets.jobAnalysisMaster.rows.find(
  r=>val(updated.datasets.jobAnalysisMaster,r,"仕事番号")==="DEMO_JOB"
);

test("real synthetic CSV cycle: create 7 → limited append 10, status updates and salary stays original",async()=>{
  const g=makeGAS();
  const initialRows=await addIdentity(appsFromCsv("01_初回応募.csv"));
  const first=merge(g,"REPLACE",null,newPayload(jobSource(initialRows,fixtureJobs("01_初回求人.csv"))));
  assert.equal(first.plan.stats.finalApplications,7);
  assert.equal(view(first.updated).recordsAll.length,7);
  assert.equal(view(first.updated).recordsMatched.length,2);

  const beforeJobId=val(first.updated.datasets.jobAnalysisMaster,getJob(first.updated),"求人参照ID");
  const beforeFirstId=val(first.updated.datasets.applicationData,
    first.updated.datasets.applicationData.rows[0],"レコードID");
  const incomingRows=await addIdentity(appsFromCsv("02_重複追加応募.csv"));
  const upload=jobSource(incomingRows,fixtureJobs("02_改稿求人.csv"));
  const second=merge(g,"APPEND",first.updated,newPayload(upload,{
    applicationData:{headers:["応募識別キー","応募識別方式","企業ID","仕事番号",
      "応募日時","対応状況","求人参照ID","求人データ突合フラグ"],rows:[]},
    jobAnalysisMaster:{headers:JOB_HEADERS,rows:[]}
  }));
  assert.equal(second.plan.stats.finalApplications,10);
  assert.equal(second.plan.stats.addedApplications,3);
  assert.equal(second.plan.stats.statusUpdatedApplications,1);
  assert.equal(second.updated.datasets.applicationData.rows.length,10);
  assert.equal(view(second.updated).recordsAll.length,10);
  assert.equal(view(second.updated).recordsMatched.length,3);
  assert.equal(items(second.updated)[0].status,"選考辞退");
  assert.equal(val(second.updated.datasets.applicationData,
    second.updated.datasets.applicationData.rows[0],"レコードID"),beforeFirstId);
  assert.equal(val(second.updated.datasets.jobAnalysisMaster,getJob(second.updated),"給与金額MIN"),"1200");
  assert.equal(val(second.updated.datasets.jobAnalysisMaster,getJob(second.updated),"求人参照ID"),beforeJobId);
  assert.equal(second.plan.payload.limitedAppendCandidates,undefined);

  const third=merge(g,"APPEND",second.updated,newPayload(upload));
  assert.equal(third.plan.stats.finalApplications,10);
  assert.equal(third.plan.stats.addedApplications,0);
  assert.equal(third.plan.stats.statusUpdatedApplications,0);
  assert.equal(view(third.updated).recordsAll.length,10);
  assert.equal(items(third.updated)[0].status,"選考辞退");

  const decreasing=await addIdentity(appsFromCsv("03_日次数減少応募.csv"));
  const fourth=merge(g,"APPEND",third.updated,newPayload(jobSource(decreasing)));
  assert.equal(fourth.plan.stats.finalApplications,10);
  assert.equal(fourth.plan.stats.aggregateDecreases.length,1);
  assert.deepEqual([
    fourth.plan.stats.aggregateDecreases[0].saved,
    fourth.plan.stats.aggregateDecreases[0].incoming
  ],[7,3]);
});

test("real synthetic CSV: no job at first, later matched row discarded because other job comes first",async()=>{
  const g=makeGAS();
  const start=await addIdentity(appsFromCsv("06_未突合初回応募.csv"));
  const initial=merge(g,"REPLACE",null,newPayload(jobSource(start)));
  const oldRecord=initial.updated.datasets.applicationData.rows[0];
  const appId=val(initial.updated.datasets.applicationData,oldRecord,"レコードID");
  const jobRef=val(initial.updated.datasets.applicationData,oldRecord,"求人参照ID");
  assert.equal(view(initial.updated).recordsAll.length,1);
  assert.equal(view(initial.updated).recordsMatched.length,0);
  assert.equal(val(initial.updated.datasets.jobAnalysisMaster,
    initial.updated.datasets.jobAnalysisMaster.rows[0],"求人分析情報ソース"),"APPLICATION_EMBEDDED");

  const allRows=appsFromCsv("08_別求人先行・更新候補後続.csv");
  const [main,discarded]=allRows;
  await addIdentity([main]);
  const added=jobSource([main]);
  const delayed=fixtureJobs("07_後日補完求人.csv");
  const sidecar=await candidateBuilder.build({
    discardedRawRows:[discarded],
    discardedJoinedRows:[],
    primaryRows:[main],
    jobRows:delayed,
    jobHeaders:JOB_HEADERS,
    secret:SECRET,
    cryptoProvider:crypto.webcrypto,
    getCompany:company,
    jobNo:gas.normalizeJobNo,
    formatDate:x=>x,
    buildJobMeta:(app,job)=>({
      source:"JOB_CSV",
      values:{
        "企業ID":company(app),
        "仕事番号":app["仕事番号"],
        "仕事名":job["仕事名"],
        "職種":job["職種"],
        "給与金額MIN":job["給与金額MIN"]
      }
    }),
    buildJobRecord:(meta,ref)=>({"求人参照ID":ref,
      "求人分析情報ソース":meta.source,...meta.values})
  });
  assert.equal(sidecar.applicationData.rows.length,1);
  assert.equal(sidecar.jobAnalysisMaster.rows.length,1);
  assert.ok(!JSON.stringify(sidecar).includes("架空戊"));
  const newer=merge(g,"APPEND",initial.updated,newPayload(added,sidecar));
  assert.equal(newer.plan.stats.finalApplications,1);
  assert.equal(newer.plan.stats.statusUpdatedApplications,1);
  assert.equal(newer.plan.stats.updatedFromSupplementalCandidates,1);
  assert.equal(newer.plan.stats.jobPromotedToCsv,1);
  assert.equal(newer.plan.stats.applicationsNewlyMatchedToJobCsv,1);
  assert.equal(view(newer.updated).recordsAll.length,1);
  assert.equal(view(newer.updated).recordsMatched.length,1);
  const record=newer.updated.datasets.applicationData.rows[0];
  assert.equal(val(newer.updated.datasets.applicationData,record,"レコードID"),appId);
  assert.equal(val(newer.updated.datasets.applicationData,record,"仕事番号"),"DEMO_UNJOINED");
  assert.equal(val(newer.updated.datasets.applicationData,record,"求人参照ID"),jobRef);
  assert.equal(val(newer.updated.datasets.applicationData,record,"対応状況"),"面接確定");
  assert.equal(val(newer.updated.datasets.jobAnalysisMaster,
    newer.updated.datasets.jobAnalysisMaster.rows[0],"給与金額MIN"),"1350");
  assert.equal(val(newer.updated.datasets.jobAnalysisMaster,
    newer.updated.datasets.jobAnalysisMaster.rows[0],"求人分析情報ソース"),"JOB_CSV");
  assert.equal(Object.hasOwn(newer.plan.payload,"limitedAppendCandidates"),false);

  const again=merge(g,"APPEND",newer.updated,newPayload(added,sidecar));
  assert.equal(again.plan.stats.finalApplications,1);
  assert.equal(again.plan.stats.statusUpdatedApplications,0);
  assert.equal(again.plan.stats.applicationsNewlyMatchedToJobCsv,0);
  assert.equal(view(again.updated).recordsMatched.length,1);
});

test("real fixture CSV_B distinguishes PERSON_ID and does not treat later application as same event",async()=>{
  const rows=appsFromCsv("05_CSV_B形式.csv");
  assert.equal(rows.length,2);
  await addIdentity(rows);
  assert.equal(rows[0].__vaaIdentity.mode,"PERSON_ID");
  assert.equal(rows[0].__vaaIdentity.key,rows[1].__vaaIdentity.key);
  const g=makeGAS();
  const first=merge(g,"REPLACE",null,newPayload(jobSource([rows[0]])));
  rows[1]["対応状況"]="面接確定";
  const second=merge(g,"APPEND",first.updated,newPayload(jobSource([rows[1]])));
  assert.equal(second.plan.stats.addedApplications,0);
  assert.equal(second.plan.stats.statusUpdatedApplications,0);
  assert.equal(second.plan.stats.statusUpdateSkippedDifferentEvent,1);
  assert.equal(view(second.updated).recordsAll.length,1);
});
