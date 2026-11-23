"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const base=require("../central-api/append-merge-core.js");
const limited=require("../experimental/append-limited-update-core.cjs");
const bridge=require("../experimental/append-limited-update-sidecar.cjs");

const SECRET="synthetic-test-only-not-real-key";
const A=[
  "レコードID","企業ID","仕事番号","求人参照ID",
  "求人データ突合フラグ","応募日時","対応状況",
  "応募識別キー","応募識別方式","応募媒体"
];
const J=[
  "求人参照ID","企業ID","仕事番号","仕事名","職種",
  "給与金額MIN","求人分析情報ソース"
];
const dataset=(headers,rows=[])=>({headers:[...headers],rows:rows.map(row=>[...row])});
const personKey=(name,mode="PERSON_NAME")=>base.personIdentityKey(
  crypto.createHmac("sha256",SECRET).update(
    base.personMaterial(mode,"C01","2026/11/05",name)
  ).digest("hex")
);
const app=(name,opts={})=>[
  opts.id||"APP000001","C01",opts.job||"J101",
  opts.ref===undefined?"JOB000001":opts.ref,
  opts.flag===undefined?1:opts.flag,
  opts.date||"2026/11/05 10:00:00",
  opts.status===undefined?"未対応":opts.status,
  personKey(name), "PERSON_NAME", "Indeed"
];
const job=(opts={})=>[
  opts.ref||"JOB000001","C01",opts.job||"J101",
  opts.title||"倉庫スタッフ","物流",opts.price===undefined?"1200":opts.price,
  opts.source||"JOB_CSV"
];
const raw=(name,opts={})=>({
  "企業コード":"C01", "氏名":name,"応募者ID":"",
  "仕事番号":opts.job||"J101",
  "応募日時":opts.date||"2026/11/05 10:00:00",
  "対応状況":opts.status||"面接確定",
  "応募媒体":"Indeed",
  "仕事名":"応募者CSV上の求人"
});
const jobCsv=(opts={})=>({
  "企業ID":"C01","仕事番号":opts.job||"J101",
  "仕事名":opts.title||"新しい正式求人",
  "職種":"物流",
  "給与金額MIN":opts.price||"1450"
});
const source=(apps,jobs)=>({
  applicationIdentityVersion:"1",
  applicationData:dataset(A,apps),
  jobAnalysisMaster:dataset(J,jobs)
});
const uploaded=(apps,jobs)=>({
  applicationData:dataset(A,apps),
  jobAnalysisMaster:dataset(J,jobs)
});
const value=(ds,row,key)=>row[ds.headers.indexOf(key)];
const projectJob=(_app,job)=>({
  "仕事名":job["仕事名"],
  "職種":job["職種"],
  "給与金額MIN":job["給与金額MIN"]
});
const build=(discardedRows,jobRows=[])=>bridge.buildSidecar({
  discardedRows,jobRows,jobHeaders:J,
  projectJob,secret:SECRET,cryptoProvider:crypto.webcrypto
});
const run=(old,primary,candidates,primaryJobs=[])=>limited.mergeLimited({
  mode:"APPEND",existing:old,
  incoming:uploaded(primary,primaryJobs),candidates
});

test("sidecar maps discarded person rows to I1 HMAC without exposing names, IDs, or emails",async()=>{
  const row={...raw("架空花子"),"メールアドレス":"private@example.invalid","電話番号":"000000000"};
  const candidate=await build([row],[jobCsv()]);
  assert.deepEqual(candidate.applicationData.headers,bridge.APP_HEADERS);
  assert.equal(candidate.applicationData.rows.length,1);
  const r=candidate.applicationData.rows[0];
  assert.equal(value(candidate.applicationData,r,"応募識別キー"),personKey("架空花子"));
  assert.equal(value(candidate.applicationData,r,"応募識別方式"),"PERSON_NAME");
  assert.equal(value(candidate.applicationData,r,"求人データ突合フラグ"),1);
  assert.equal(value(candidate.jobAnalysisMaster,candidate.jobAnalysisMaster.rows[0],"求人分析情報ソース"),"JOB_CSV");
  const serialized=JSON.stringify(candidate);
  for(const secret of ["架空花子","private@example.invalid","000000000","応募者ID","メールアドレス","氏名"]){
    assert.ok(!serialized.includes(secret),"candidate serialization contains "+secret);
  }
});

test("candidate from ignored later CSV line updates the SAME saved event despite earlier different job",async()=>{
  const old=source([app("架空花子",{job:"J101",ref:"",flag:0,status:"未対応"})],[]);
  const primary=[app("架空花子",{job:"J202",date:"2026/11/18 10:00:00",ref:"",flag:0,status:"未対応"})];
  const extra=await build([raw("架空花子",{job:"J101",status:"面接確定"})],
    [jobCsv({job:"J101",title:"求人J101",price:"1450"})]);
  const r=run(old,primary,extra);
  assert.equal(r.stats.addedApplications,0);
  assert.equal(r.stats.statusUpdatedApplications,1);
  assert.equal(r.stats.updatedFromSupplementalCandidates,1);
  assert.equal(r.stats.applicationsNewlyMatchedToJobCsv,1);
  assert.equal(r.stats.jobAddedForExistingApplications,1);
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"対応状況"),"面接確定");
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"仕事番号"),"J101");
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"応募日時"),"2026/11/05 10:00:00");
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"レコードID"),"APP000001");
  assert.equal(value(r.jobAnalysisMaster,r.jobAnalysisMaster.rows[0],"給与金額MIN"),"1450");
  assert.equal(r.applicationData.rows.length,1);
});

test("extra candidate on another job cannot update representative status or attach a different salary",async()=>{
  const old=source([app("架空花子",{status:"内定"})],[job()]);
  const primary=[app("架空花子",{job:"J202",date:"2026/11/18 10:00:00",ref:"",flag:0,status:"未対応"})];
  const extra=await build([raw("架空花子",{job:"J202",date:"2026/11/20 12:00:00",status:"辞退"})],
    [jobCsv({job:"J202",price:"9999"})]);
  const r=run(old,primary,extra);
  assert.equal(r.stats.statusUpdatedApplications,0);
  assert.equal(r.stats.jobPromotedToCsv,0);
  assert.equal(value(r.jobAnalysisMaster,r.jobAnalysisMaster.rows[0],"給与金額MIN"),"1200");
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"対応状況"),"内定");
});

test("sidecar does not turn a group of duplicate rows into extra persisted applications",async()=>{
  const old=source([app("架空花子",{status:"未対応"})],[job()]);
  const primary=[app("架空花子",{status:"未対応"})];
  const extra=await build([
    raw("架空花子",{job:"J202",date:"2026/11/06 13:00:00"}),
    raw("架空花子",{job:"J101",status:"面接確定"})
  ],[jobCsv({job:"J101"})]);
  const r=run(old,primary,extra);
  assert.equal(r.stats.finalApplications,1);
  assert.equal(r.applicationData.rows.length,1);
  assert.equal(r.stats.addedApplications,0);
});

test("two different statuses for the identical event trigger ambiguity, even when one was previously discarded",async()=>{
  const old=source([app("架空花子",{status:"未対応"})],[job()]);
  const primary=[app("架空花子",{status:"面接確定"})];
  const extra=await build([raw("架空花子",{status:"辞退"})]);
  const r=run(old,primary,extra);
  assert.equal(r.stats.statusUpdateSkippedAmbiguous,1);
  assert.equal(r.stats.statusUpdatedApplications,0);
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"対応状況"),"未対応");
});

test("a candidate with no matching job CSV cannot falsely claim JOIN or change job master",async()=>{
  const old=source([app("架空花子",{flag:0,ref:""})],[]);
  const primary=[app("架空花子",{job:"J202",date:"2026/11/18 10:00:00",flag:0,ref:""})];
  const extra=await build([raw("架空花子",{status:"面接確定"})],[]);
  const r=run(old,primary,extra);
  assert.equal(r.stats.statusUpdatedApplications,1);
  assert.equal(r.stats.applicationsNewlyMatchedToJobCsv,0);
  assert.equal(r.jobAnalysisMaster.rows.length,0);
  assert.equal(value(r.applicationData,r.applicationData.rows[0],"求人データ突合フラグ"),0);
});

test("empty and AGG_DAILY-like personless discarded rows produce no candidate",async()=>{
  const result=await build([
    {"企業コード":"C01","氏名":"","応募者ID":"","仕事番号":"AIRWORK_ONLY",
      "応募日時":"2026/11/05","応募媒体":"AirWork",
      "仕事名":"AirWork（応募実績）","対応状況":"AirWork（状況未取得）"}
  ],[jobCsv()]);
  assert.equal(result.applicationData.rows.length,0);
  assert.equal(result.jobAnalysisMaster.rows.length,0);
});

test("the auxiliary dataset cannot target an applicant absent from ordinary incoming applicationData",async()=>{
  const old=source([app("架空花子")],[job()]);
  const primary=[app("架空花子")];
  const extra=await build([raw("架空太郎")]);
  assert.throws(()=>run(old,primary,extra),{code:"INVALID_UPDATE_CANDIDATES"});
});

test("the auxiliary dataset cannot counterfeit a company or identity mode",async()=>{
  const old=source([app("架空花子")],[job()]);
  const primary=[app("架空花子")];
  const extra=await build([raw("架空花子")]);
  extra.applicationData.rows[0][2]="C02";
  assert.throws(()=>run(old,primary,extra),{code:"INVALID_UPDATE_CANDIDATES"});
});

test("the auxiliary dataset cannot forge job ref for another job",async()=>{
  const old=source([app("架空花子",{ref:"",flag:0})],[]);
  const primary=[app("架空花子",{flag:0,ref:""})];
  const extra=await build([raw("架空花子")],[jobCsv()]);
  extra.jobAnalysisMaster.rows[0][2]="J999";
  assert.throws(()=>run(old,primary,extra),{code:"JOB_REF_MISMATCH"});
});

test("replaying a full CSV with the same sidecar is idempotent",async()=>{
  const old=source([app("架空花子",{ref:"",flag:0,status:"未対応"})],[]);
  const primary=[app("架空花子",{job:"J202",date:"2026/11/18 10:00:00",flag:0,ref:""})];
  const extra=await build([raw("架空花子",{status:"内定"})],[jobCsv({price:"1500"})]);
  const first=run(old,primary,extra);
  const second=run({
    applicationIdentityVersion:"1",applicationData:first.applicationData,
    jobAnalysisMaster:first.jobAnalysisMaster
  },primary,extra);
  assert.deepEqual(first.applicationData,second.applicationData);
  assert.deepEqual(first.jobAnalysisMaster,second.jobAnalysisMaster);
  assert.equal(second.stats.statusUpdatedApplications,0);
  assert.equal(second.stats.applicationsNewlyMatchedToJobCsv,0);
});

test("real Pages CSV_B normalizer can be used before building pseudonymous sidecar",async()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const labels=[
    ["function cleanCsvHeader(", "async function detectCsvEncoding("],
    ["function firstNonEmptyCsvValue(", "function normalizeApplicationGender("],
    ["function normalizeApplicationGender(", "function detectApplicationCsvFormat("],
    ["function detectApplicationCsvFormat(", "function validateFixedCsvFormat("],
    ["function validateFixedCsvFormat(", "async function parseCSV("]
  ];
  const fragments=labels.map(([first,last])=>{
    const begin=html.indexOf(first),end=html.indexOf(last,begin+first.length);
    assert.ok(begin>0&&end>begin,"actual Pages normalizer anchors exist");
    return html.slice(begin,end);
  });
  const context={console};vm.createContext(context);
  vm.runInContext(fragments.join("\n"),context);
  // CSV_B's 実際のヘッダーaliasを利用し、個人識別の元値は
  // ブラウザ内でのみ消費することを検証する。
  const rawRow={
    "応募先企業ID":"C01","応募者名":"架空花子",
    "応募日":"2026/11/05 10:00:00","応募者対応ステータス（企業）":"面接確定",
    "お仕事NO":"J101","応募媒体名":"Indeed"
  };
  const canonical=context.normalizeApplicationCsv([rawRow],Object.keys(rawRow));
  assert.equal(canonical.rows.length,1);
  const result=await build(canonical.rows,[jobCsv()]);
  assert.equal(result.applicationData.rows.length,1);
  assert.equal(value(result.applicationData,result.applicationData.rows[0],"応募識別キー"),personKey("架空花子"));
  assert.equal(value(result.applicationData,result.applicationData.rows[0],"応募日時"),"2026/11/05 10:00:00");
});
