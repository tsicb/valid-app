"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const core = require("../central-api/append-merge-core.js");

const A = ["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ","応募日時","対応状況","応募識別キー","応募識別方式"];
const J = ["求人参照ID","企業ID","仕事番号","仕事名","職種","給与金額MIN","求人分析情報ソース"];
const secret = "fixed-test-key-only";
const sig = msg => crypto.createHmac("sha256",secret).update(msg).digest("hex");
const person = (id, c="C01", month="2026/10/01", mode="PERSON_NAME") =>
  core.personIdentityKey(sig(core.personMaterial(mode,c,month,id)));
const agg = (c,no,media,date,ordinal) =>
  core.aggregateIdentityKey(sig(core.aggregateMaterial(c,no,media,date)),ordinal);
const ds = (headers,rows=[]) => ({headers:headers.slice(),rows:rows.map(x=>x.slice())});
const app = (key,method="PERSON_NAME",company="C01",job="J001",ref="JOB000001",flag=1,date="2026/10/01",status="応募") =>
  ["APP000001",company,job,ref,flag,date,status,key,method];
const job = (no="J001",title="元の求人",price="1200",company="C01",ref="JOB000001",source="JOB_CSV") =>
  [ref,company,no,title,"仕分け",price,source];
const incoming = (apps,jobs) => ({applicationData:ds(A,apps),jobAnalysisMaster:ds(J,jobs)});
const wrap = (apps=[],jobs=[],version="1") => ({
  applicationIdentityVersion:version,applicationData:ds(A,apps),jobAnalysisMaster:ds(J,jobs)
});
const run = (mode, existing, apps, jobs) => core.merge({mode,existing,incoming:incoming(apps,jobs)});

function at(dataset, row, name) {return row[dataset.headers.indexOf(name)];}
function snapshot(result) {return {applicationIdentityVersion:result.applicationIdentityVersion,applicationData:result.applicationData,jobAnalysisMaster:result.jobAnalysisMaster};}

test("creates a fresh V1 DataStore through REPLACE without modifying input",()=>{
  const source=incoming([app(person("山田"))],[job()]);
  const before=structuredClone(source);
  const out=core.merge({mode:"REPLACE", incoming:source});
  assert.deepEqual(source,before);
  assert.equal(out.stats.finalApplications,1);
  assert.equal(out.stats.addedJobs,1);
  assert.equal(at(out.applicationData,out.applicationData.rows[0],"レコードID"),"APP000001");
  assert.equal(out.applicationIdentityVersion,"1");
});

test("APPEND is idempotent and preserves existing applications",()=>{
  const initial=run("REPLACE",null,[app(person("山田"),"PERSON_NAME","C01","J001","JOB000001",1,"2026/10/01","初回")],[job()]);
  const existing=snapshot(initial);
  const newApp=app(person("佐藤"),"PERSON_NAME","C01","J001","JOB000001",0,"2026/10/02","二回目");
  const first=run("APPEND",existing,[app(person("山田")),newApp],[job("J001","更新された求人","1600")]);
  assert.equal(first.stats.skippedAsExisting,1);
  assert.equal(first.stats.addedApplications,1);
  assert.equal(first.stats.finalApplications,2);
  assert.equal(at(first.applicationData,first.applicationData.rows[0],"対応状況"),"初回");
  assert.equal(at(first.applicationData,first.applicationData.rows[1],"レコードID"),"APP000002");
  assert.equal(at(first.applicationData,first.applicationData.rows[1],"求人データ突合フラグ"),0);
  const again=run("APPEND",snapshot(first),[app(person("山田")),newApp],[job()]);
  assert.equal(again.stats.addedApplications,0);
  assert.equal(again.stats.finalApplications,2);
});

test("overlapping exports keep 1000 existing rows, exclude 800, and append 200",()=>{
  const existingApps=Array.from({length:1000},(_,i)=>app(person("name"+i)));
  const existing=wrap(existingApps,[job()]);
  const inputApps=Array.from({length:1000},(_,i)=>app(person("name"+(i+200))));
  // Populate unique legacy-friendly stable IDs to avoid corrupt fixture.
  existingApps.forEach((row,i)=>row[0]="APP"+String(i+1).padStart(6,"0"));
  const out=run("APPEND",existing,inputApps,[job()]);
  assert.equal(out.stats.skippedAsExisting,800);
  assert.equal(out.stats.addedApplications,200);
  assert.equal(out.stats.finalApplications,1200);
  assert.equal(at(out.applicationData,out.applicationData.rows[1199],"レコードID"),"APP001200");
});

test("identity material normalizes company, month and Unicode spacing",()=>{
  const x=core.personMaterial("PERSON_NAME"," c01 ","2026/10/01"," ＡＢＣ　太郎 ");
  const y=core.personMaterial("PERSON_NAME","C01","2026-10-28","ABC 太郎");
  assert.equal(x,y);
  assert.notEqual(x,core.personMaterial("PERSON_NAME","C02","2026/10/01","ABC 太郎"));
  assert.notEqual(x,core.personMaterial("PERSON_NAME","C01","2026/11/01","ABC 太郎"));
  assert.notEqual(x,core.personMaterial("PERSON_ID","C01","2026/10/01","ABC 太郎"));
});

test("CSV_B person IDs are person-scoped and month-scoped",()=>{
  const x=person("applicant-17","C01","2026/10/01","PERSON_ID");
  assert.equal(x,person("applicant-17","C01","2026/10/23","PERSON_ID"));
  assert.notEqual(x,person("applicant-17","C01","2026/11/01","PERSON_ID"));
  assert.notEqual(x,person("applicant-17","C02","2026/10/01","PERSON_ID"));
  assert.notEqual(x,person("applicant-17","C01","2026/10/01","PERSON_NAME"));
});

test("job master is first-save wins and references stay stable",()=>{
  const saved=wrap([app(person("山田"))],[job("J001","旧仕事名","1200")]);
  const next=run("APPEND",saved,[
    app(person("佐藤"),"PERSON_NAME","C01","J001","JOB000008",0),
    app(person("鈴木"),"PERSON_NAME","C01","J002","JOB000009",1),
  ],[job("J001","新仕事名","1500","C01","JOB000008"),job("J002","新求人","1400","C01","JOB000009")]);
  assert.equal(next.stats.addedJobs,1);
  assert.equal(next.jobAnalysisMaster.rows.length,2);
  assert.equal(at(next.jobAnalysisMaster,next.jobAnalysisMaster.rows[0],"仕事名"),"旧仕事名");
  assert.equal(at(next.jobAnalysisMaster,next.jobAnalysisMaster.rows[0],"給与金額MIN"),"1200");
  assert.equal(at(next.applicationData,next.applicationData.rows[1],"求人参照ID"),"JOB000001");
  assert.equal(at(next.applicationData,next.applicationData.rows[2],"求人参照ID"),"JOB000002");
  assert.equal(at(next.applicationData,next.applicationData.rows[1],"求人データ突合フラグ"),0);
  assert.equal(at(next.applicationData,next.applicationData.rows[0],"求人参照ID"),"JOB000001");
});

test("company key and job suffix normalization align with Pages preprocessKey",()=>{
  assert.equal(core.normalizeJobNo("abc_123"),"ABC");
  assert.equal(core.normalizeJobNo("abc_12"),"ABC_12");
  assert.equal(core.normalizeJobNo("abc§X"),"ABC");
  assert.equal(core.jobKey(" c01 ","ab_0123"),core.jobKey("C01","AB"));
  const saved=wrap([app(person("山田"))],[job("J001","old","1200","C01")]);
  const out=run("APPEND",saved,[app(person("佐藤"),"PERSON_NAME","C01","j001_001","JOB005000")],[job("j001_001","new","1300","C01","JOB005000")]);
  assert.equal(out.stats.addedJobs,0);
  assert.equal(at(out.applicationData,out.applicationData.rows[1],"求人参照ID"),"JOB000001");
});

test("unmatched job remains unmatched, even if existing JOB_CSV master has the key",()=>{
  const out=run("APPEND",wrap([app(person("山田"))],[job()]),[
    app(person("佐藤"),"PERSON_NAME","C01","J001","",0)
  ],[]);
  assert.equal(at(out.applicationData,out.applicationData.rows[1],"求人参照ID"),"JOB000001");
  assert.equal(at(out.applicationData,out.applicationData.rows[1],"求人データ突合フラグ"),0);
});

test("unused new job is not appended when all incoming applications were duplicates",()=>{
  const saved=wrap([app(person("山田"))],[job()]);
  const out=run("APPEND",saved,[app(person("山田"),"PERSON_NAME","C01","J002","JOB000099")],[job("J002","new","1400","C01","JOB000099")]);
  assert.equal(out.stats.addedApplications,0);
  assert.equal(out.stats.addedJobs,0);
});

test("aggregate snapshots 5 -> 7 -> 7 -> 3 add only 5,2,0,0",()=>{
  const mk = n => Array.from({length:n},(_,i)=>
    app(agg("C01","AIRWORK_ONLY","AirWork","2026/10/01",i+1),"AGG_DAILY","C01","AIRWORK_ONLY","JOB000001",0,"2026/10/01","AirWork（状況未取得）"));
  const j=job("AIRWORK_ONLY","AirWork（応募実績）","","C01","JOB000001","APPLICATION_EMBEDDED");
  const first=run("REPLACE",null,mk(5),[j]);
  const second=run("APPEND",snapshot(first),mk(7),[j]);
  const third=run("APPEND",snapshot(second),mk(7),[j]);
  const fourth=run("APPEND",snapshot(third),mk(3),[j]);
  assert.deepEqual([first.stats.addedApplications,second.stats.addedApplications,third.stats.addedApplications,fourth.stats.addedApplications],[5,2,0,0]);
  assert.equal(fourth.stats.finalApplications,7);
  assert.equal(fourth.stats.aggregateDecreases.length,1);
  assert.deepEqual([fourth.stats.aggregateDecreases[0].saved,fourth.stats.aggregateDecreases[0].incoming],[7,3]);
});

test("aggregate key differs across company, day, job, media",()=>{
  const base=agg("C01","AIRWORK_ONLY","AirWork","2026/10/01",1);
  assert.notEqual(base,agg("C02","AIRWORK_ONLY","AirWork","2026/10/01",1));
  assert.notEqual(base,agg("C01","J001","AirWork","2026/10/01",1));
  assert.notEqual(base,agg("C01","AIRWORK_ONLY","Indeed","2026/10/01",1));
  assert.notEqual(base,agg("C01","AIRWORK_ONLY","AirWork","2026/10/02",1));
});

test("aggregate rows require full numbered snapshot, not a partial delta",()=>{
  const bad=app(agg("C01","AIRWORK_ONLY","AirWork","2026/10/01",2),"AGG_DAILY");
  assert.throws(()=>run("REPLACE",null,[bad],[job()]),{code:"AGGREGATE_SEQUENCE_GAP"});
  const duplicated=[bad,bad.slice()];
  assert.throws(()=>run("REPLACE",null,duplicated,[job()]),{code:"DUPLICATE_AGGREGATE"});
});

test("same identified person twice in the upload is only stored once",()=>{
  const key=person("山田");
  const out=run("REPLACE",null,[app(key),app(key)],[job()]);
  assert.equal(out.stats.duplicateWithinUpload,1);
  assert.equal(out.stats.addedApplications,1);
});

test("append never silently accepts an unidentifiable application",()=>{
  const old=wrap([app(person("山田"))],[job()]);
  assert.throws(()=>run("APPEND",old,[app("","UNIDENTIFIED")],[job()]),{code:"UNIDENTIFIED_APPEND"});
  assert.doesNotThrow(()=>run("REPLACE",null,[app("","UNIDENTIFIED")],[job()]));
});

test("migration is required for old DataStore before APPEND",()=>{
  const old=wrap([app(person("山田"))],[job()],"");
  assert.throws(()=>run("APPEND",old,[app(person("佐藤"))],[job()]),{code:"MIGRATION_REQUIRED"});
  assert.doesNotThrow(()=>run("REPLACE",old,[app(person("佐藤"))],[job()]));
});

test("accepts header order changes and retains extra historical columns",()=>{
  const original=wrap([app(person("山田"))],[job()]);
  original.applicationData.headers.push("過去属性");
  original.applicationData.rows[0].push("残す値");
  const out=run("APPEND",original,[app(person("佐藤"))],[job()]);
  assert.equal(at(out.applicationData,out.applicationData.rows[0],"過去属性"),"残す値");
  assert.equal(at(out.applicationData,out.applicationData.rows[1],"過去属性"),"");
});

test("collision of stored identity or job key causes error instead of corrupt merge",()=>{
  const bad=wrap([app(person("山田")),app(person("山田"))],[job()]);
  bad.applicationData.rows[1][0]="APP000002";
  assert.throws(()=>run("APPEND",bad,[app(person("佐藤"))],[job()]),{code:"DUPLICATE_EXISTING_IDENTITY"});
  const jobBad=wrap([app(person("山田"))],[job(),job("J001","duplicate","1200","C01","JOB000002")]);
  assert.throws(()=>run("APPEND",jobBad,[app(person("佐藤"))],[job()]),{code:"DUPLICATE_JOB_KEY"});
});

test("an incoming job reference cannot point to a different job",()=>{
  const incomingJobs=[job("J002","new","1400","C01","JOB000099")];
  assert.throws(()=>run("REPLACE",null,[app(person("山田"),"PERSON_NAME","C01","J001","JOB000099")],incomingJobs),{code:"JOB_REF_MISMATCH"});
});

test("a missing job candidate does not invent job attributes",()=>{
  const out=run("REPLACE",null,[app(person("山田"),"PERSON_NAME","C01","J001","")],[]);
  assert.equal(out.jobAnalysisMaster.rows.length,0);
  assert.equal(at(out.applicationData,out.applicationData.rows[0],"求人参照ID"),"");
});

test("counts and row limits are validated",()=>{
  assert.throws(()=>core.merge({mode:"APPEND",incoming:incoming([],[])}),{code:"MIGRATION_REQUIRED"});
  assert.throws(()=>core.merge({mode:"BAD",incoming:incoming([],[])}),{code:"INVALID_STRATEGY"});
  assert.throws(()=>core.merge({mode:"REPLACE",incoming:incoming([app(person("山田"))],[job()]),maxRows:0}),{code:"INVALID_LIMIT"});
  assert.throws(()=>core.merge({mode:"REPLACE",incoming:incoming([app(person("山田")),app(person("佐藤"))],[job()]),maxRows:1}),{code:"ROW_LIMIT"});
});

test("rejects invented or malformed identifiers",()=>{
  assert.throws(()=>core.personMaterial("PERSON_NAME","C01","2026/02/29","佐藤"),{code:"INVALID_DATE"});
  assert.throws(()=>core.personIdentityKey("short"),{code:"INVALID_HASH"});
  assert.throws(()=>core.aggregateIdentityKey("f".repeat(64),0),{code:"INVALID_ORDINAL"});
  assert.throws(()=>run("REPLACE",null,[app("I1:abc")],[job()]),{code:"INVALID_IDENTITY_KEY"});
});
