"use strict";
/**
 * Synthetic cross-layer regression; no real applicants, Sheets or Drive.
 * Browser identity generator -> normalized datasets -> GAS merge core.
 * Store pointer / file I/O is tested separately in append-datastore.test.cjs.
 */
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const client=require("../append-identity-v1.js");
const gas=require("../central-api/append-merge-core.js");

const A=["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ",
  "応募日時","対応状況","応募識別キー","応募識別方式","応募数"];
const J=["求人参照ID","企業ID","仕事番号","仕事名","給与金額MIN"];
const SECRET="synthetic-integration-key-do-not-use-in-production";
const company="DEMO001";
const jobId="DEMO_JOB";
const aggId="DEMO_AIRWORK";

function demoRow({name="",date="2026/10/01",job=jobId,media="Indeed",
    status="未対応",ref="JOB000001",matched=1,title="倉庫スタッフ"}={}){
  const row={
    "企業コード":company,"応募日時":date,"仕事番号":job,
    "応募媒体":media,"対応状況":status,"仕事名":title,
    "求人参照ID":ref,"求人データ突合フラグ":matched,
  };
  Object.defineProperty(row,"__vaaIdentityRaw",{
    value:{name,applicantId:"",inputFileIndex:0},
    enumerable:false,configurable:true
  });
  return row;
}
function named(name,opts={}){return demoRow({name,...opts});}
function air(date="2026/10/01"){
  return demoRow({name:"",date,job:aggId,media:"AirWork",
    status:"AirWork（状況未取得）",title:"AirWork（応募実績）",
    ref:"JOB000002",matched:0});
}
function snapshot(rows,jobRows){
  return {
    applicationData:{headers:A.slice(),rows:rows.map((r,i)=>
      ["APP"+String(i+1).padStart(6,"0"),
        r["企業コード"],r["仕事番号"],r["求人参照ID"],
        r["求人データ突合フラグ"],r["応募日時"],
        r["対応状況"],r.__vaaIdentity.key,r.__vaaIdentity.mode,1])},
    jobAnalysisMaster:{headers:J.slice(),rows:jobRows.map(r=>r.slice())}
  };
}
async function prepare(rows,jobRows) {
  await client.assign(rows,SECRET,crypto.webcrypto);
  return snapshot(rows,jobRows);
}
function next(mode,incoming,previous=null){
  const merged=gas.merge({mode,incoming,existing:previous});
  return {
    applicationIdentityVersion:merged.applicationIdentityVersion,
    applicationData:merged.applicationData,
    jobAnalysisMaster:merged.jobAnalysisMaster,
    stats:merged.stats
  };
}
function val(dataset,row,header){return row[dataset.headers.indexOf(header)];}
const job=(title="元の求人",pay="1200")=>["JOB000001",company,jobId,title,pay];
const airJob=()=>["JOB000002",company,aggId,"AirWork（応募実績）",""];

test("synthetic CREATE→APPEND→retry→decrease→REPLACE entire lifecycle",async()=>{
  // Initial creation: 2 named applicants + 5 accumulated AirWork applicants.
  const start=await prepare(
    [named("架空応募者甲",{status:"未対応"}),
      named("架空応募者乙",{date:"2026/10/02",status:"面接済み"}),
      ...Array.from({length:5},()=>air())],
    [job(),airJob()]
  );
  const created=next("REPLACE",start);
  assert.equal(created.stats.finalApplications,7);
  assert.equal(created.stats.finalJobs,2);
  assert.equal(created.applicationIdentityVersion,"1");

  // Later export repeats existing rows and adds 1 person, 2 extra AirWork.
  // The new job CSV has updated pay/name: APPEND must not touch originals.
  const update=await prepare(
    [named("架空応募者甲",{status:"選考辞退"}),
      named("架空応募者丙",{date:"2026/10/03"}),
      ...Array.from({length:7},()=>air())],
    [job("新しい求人タイトル","1500"),airJob()]
  );
  const appended=next("APPEND",update,created);
  assert.equal(appended.stats.oldApplications,7);
  assert.equal(appended.stats.uploadedApplications,9);
  assert.equal(appended.stats.skippedAsExisting,6);
  assert.equal(appended.stats.addedApplications,3);
  assert.equal(appended.stats.finalApplications,10);
  assert.equal(val(appended.jobAnalysisMaster,appended.jobAnalysisMaster.rows[0],"給与金額MIN"),"1200");
  assert.equal(val(appended.jobAnalysisMaster,appended.jobAnalysisMaster.rows[0],"仕事名"),"元の求人");
  assert.equal(val(appended.applicationData,appended.applicationData.rows[0],"対応状況"),"未対応");
  assert.equal(val(appended.applicationData,appended.applicationData.rows[7],"レコードID"),"APP000008");
  assert.equal(val(appended.applicationData,appended.applicationData.rows[7],"求人参照ID"),"JOB000001");

  const again=next("APPEND",update,appended);
  assert.equal(again.stats.skippedAsExisting,9);
  assert.equal(again.stats.addedApplications,0);
  assert.equal(again.stats.finalApplications,10);

  // A later aggregate snapshot reports only 3 that day: keep all 7 saved.
  const decreased=await prepare(
    [...Array.from({length:3},()=>air())],[airJob()]
  );
  const afterDecrease=next("APPEND",decreased,again);
  assert.equal(afterDecrease.stats.addedApplications,0);
  assert.equal(afterDecrease.stats.finalApplications,10);
  assert.equal(afterDecrease.stats.aggregateDecreases.length,1);
  assert.deepEqual(
    [afterDecrease.stats.aggregateDecreases[0].saved,
      afterDecrease.stats.aggregateDecreases[0].incoming],
    [7,3]
  );

  // Explicit full replacement resets history to the chosen CSV.
  const full=await prepare(
    [named("架空応募者丙",{date:"2026/10/03"}),
      ...Array.from({length:3},()=>air())],
    [job("正式訂正後の求人","1600"),airJob()]
  );
  const replaced=next("REPLACE",full,afterDecrease);
  assert.equal(replaced.stats.finalApplications,4);
  assert.equal(replaced.stats.finalJobs,2);
  assert.equal(val(replaced.jobAnalysisMaster,replaced.jobAnalysisMaster.rows[0],"給与金額MIN"),"1600");
  const afterReplace=next("APPEND",full,replaced);
  assert.equal(afterReplace.stats.addedApplications,0);
});

test("synthetic browser identity keys do not allow names to reach normalized JSON",async()=>{
  const rows=[named("架空の個人情報A"),air()];
  const model=await prepare(rows,[job(),airJob()]);
  const serialized=JSON.stringify(model);
  assert.equal(serialized.includes("架空の個人情報A"),false);
  assert.equal(serialized.includes(SECRET),false);
  assert.equal(model.applicationData.rows.length,2);
  assert.match(val(model.applicationData,model.applicationData.rows[0],"応募識別キー"),/^I1:[a-f0-9]{64}$/);
  assert.match(val(model.applicationData,model.applicationData.rows[1],"応募識別キー"),/^G1:[a-f0-9]{64}:000001$/);
});
