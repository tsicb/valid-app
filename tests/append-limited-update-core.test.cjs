"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const base=require("../central-api/append-merge-core.js");
const limited=require("../experimental/append-limited-update-core.cjs");

const A=["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ","応募日時","対応状況","応募識別キー","応募識別方式","応募媒体"];
const J=["求人参照ID","企業ID","仕事番号","仕事名","職種","給与金額MIN","求人分析情報ソース"];
const ds=(headers,rows=[])=>({headers:[...headers],rows:rows.map(row=>[...row])});
const identity=(name,method="PERSON_NAME")=>{
  const material=base.personMaterial(method,"C01","2026/11/05",name);
  const hash=crypto.createHmac("sha256","isolated-test-only").update(material).digest("hex");
  return base.personIdentityKey(hash);
};
const app=(name,options={})=>[
  options.id||"APP000001","C01",options.job||"J101",options.ref===undefined?"JOB000001":options.ref,
  options.flag===undefined?1:options.flag,options.date||"2026/11/05 10:00:00",
  options.status===undefined?"未対応":options.status,options.key||identity(name),
  options.mode||"PERSON_NAME",options.media||"Indeed"
];
const job=(options={})=>[
  options.ref||"JOB000001","C01",options.job||"J101",
  options.title===undefined?"倉庫スタッフ":options.title,
  options.role===undefined?"仕分け":options.role,
  options.price===undefined?"1200":options.price,
  options.source===undefined?"JOB_CSV":options.source
];
const wrap=(apps,jobs)=>({
  applicationIdentityVersion:"1",
  applicationData:ds(A,apps),
  jobAnalysisMaster:ds(J,jobs)
});
const payload=(apps,jobs)=>({
  applicationData:ds(A,apps),
  jobAnalysisMaster:ds(J,jobs)
});
const run=(old,apps,jobs,maxRows)=>limited.mergeLimited({
  mode:"APPEND",existing:old,incoming:payload(apps,jobs),maxRows
});
const val=(d,row,column)=>row[d.headers.indexOf(column)];
function unchangedCore(old,appRows,jobRows) {
  return base.merge({mode:"APPEND",existing:old,incoming:payload(appRows,jobRows)});
}

test("A01 same event status is updated while ID/job/timestamp/media stay unchanged",()=>{
  const old=wrap([app("山田")],[job()]);
  const incoming=[app("山田",{status:"面接確定",id:"APP007777",media:"AirWork"})];
  const before=structuredClone(old);
  const result=run(old,incoming,[job()]);
  const r=result.applicationData.rows[0];
  assert.equal(val(result.applicationData,r,"対応状況"),"面接確定");
  for(const field of ["レコードID","仕事番号","応募日時","応募媒体","応募識別キー","求人参照ID"]){
    assert.equal(val(result.applicationData,r,field),val(old.applicationData,old.applicationData.rows[0],field),field);
  }
  assert.equal(result.stats.statusUpdatedApplications,1);
  assert.equal(result.stats.addedApplications,0);
  assert.deepEqual(old,before);
});

test("A02 later non-progressive outcome such as 辞退 overrides 面接確定 for same event",()=>{
  const result=run(wrap([app("山田",{status:"面接確定"})],[job()]),[app("山田",{status:"辞退"})],[job()]);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"辞退");
  assert.equal(result.stats.statusUpdatedApplications,1);
});

test("A03/A04 blank status and unchanged status preserve the stored status",()=>{
  const old=wrap([app("山田",{status:"面接確定"})],[job()]);
  for(const status of ["","面接確定"]){
    const result=run(old,[app("山田",{status})],[job()]);
    assert.equal(result.stats.statusUpdatedApplications,0);
    assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"面接確定");
  }
});

test("timestamp separators/minute-only input normalize to same event",()=>{
  const result=run(wrap([app("山田",{date:"2026/11/05 10:00:00"})],[job()]),
    [app("山田",{date:"2026-11-05 10:00",status:"面接調整中"})],[job()]);
  assert.equal(result.stats.statusUpdatedApplications,1);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"面接調整中");
});

test("A05 different job never overwrites status or shifts representative",()=>{
  const old=wrap([app("山田",{status:"面接確定"})],[job()]);
  const result=run(old,[app("山田",{job:"J202",date:"2026/11/18 12:00:00",ref:"JOB099999",status:"未対応"})],
    [job({job:"J202",ref:"JOB099999",price:"1700"})]);
  const r=result.applicationData.rows[0];
  assert.equal(val(result.applicationData,r,"対応状況"),"面接確定");
  assert.equal(val(result.applicationData,r,"仕事番号"),"J101");
  assert.equal(val(result.applicationData,r,"求人参照ID"),"JOB000001");
  assert.equal(result.stats.statusUpdateSkippedDifferentEvent,1);
  assert.equal(result.stats.addedJobs,0);
  assert.equal(result.stats.applicationsNewlyMatchedToJobCsv,0);
});

test("A06 different application time on same job does not overwrite status",()=>{
  const result=run(wrap([app("山田",{status:"面接確定"})],[job()]),
    [app("山田",{date:"2026/11/18 12:00:00",status:"未対応"})],[job()]);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"面接確定");
  assert.equal(result.stats.statusUpdateSkippedDifferentEvent,1);
});

test("A07 genuinely new person is added by baseline APPEND",()=>{
  const old=wrap([app("山田")],[job()]);
  const result=run(old,[app("佐藤",{status:"未対応",id:"APP000001"})],[job()]);
  assert.equal(result.stats.addedApplications,1);
  assert.equal(result.applicationData.rows.length,2);
  assert.equal(val(result.applicationData,result.applicationData.rows[1],"レコードID"),"APP000002");
});

test("A08 previously missing master gets JOB_CSV from a proven same-job JOIN",()=>{
  const old=wrap([app("山田",{ref:"",flag:0})],[]);
  const result=run(old,[app("山田",{ref:"JOB009999",flag:1})],
    [job({ref:"JOB009999",title:"現場スタッフ",price:"1350"})]);
  assert.equal(result.stats.jobAddedForExistingApplications,1);
  assert.equal(result.stats.addedJobs,1);
  assert.equal(result.stats.finalJobs,1);
  assert.equal(result.stats.applicationsNewlyMatchedToJobCsv,1);
  const r=result.applicationData.rows[0], j=result.jobAnalysisMaster.rows[0];
  assert.equal(val(result.applicationData,r,"求人参照ID"),"JOB000001");
  assert.equal(val(result.applicationData,r,"求人データ突合フラグ"),1);
  assert.equal(val(result.jobAnalysisMaster,j,"給与金額MIN"),"1350");
  assert.equal(val(result.jobAnalysisMaster,j,"求人分析情報ソース"),"JOB_CSV");
  assert.equal(val(result.applicationData,r,"レコードID"),"APP000001");
});

test("A09 APPLICATION_EMBEDDED master is promoted under same stable JOB ID",()=>{
  const old=wrap([app("山田",{flag:0})],
    [job({source:"APPLICATION_EMBEDDED",title:"応募時の仕事名",price:""})]);
  const result=run(old,[app("山田",{ref:"JOB008888",flag:1})],
    [job({ref:"JOB008888",title:"正式求人名",price:"1350",source:"JOB_CSV"})]);
  const j=result.jobAnalysisMaster.rows[0], a=result.applicationData.rows[0];
  assert.equal(val(result.jobAnalysisMaster,j,"求人参照ID"),"JOB000001");
  assert.equal(val(result.jobAnalysisMaster,j,"仕事名"),"正式求人名");
  assert.equal(val(result.jobAnalysisMaster,j,"給与金額MIN"),"1350");
  assert.equal(val(result.jobAnalysisMaster,j,"求人分析情報ソース"),"JOB_CSV");
  assert.equal(val(result.applicationData,a,"求人データ突合フラグ"),1);
  assert.equal(result.stats.jobPromotedToCsv,1);
  assert.equal(result.stats.addedJobs,0);
});

test("A10 existing JOB_CSV salary/title stay frozen even if incoming revised",()=>{
  const old=wrap([app("山田",{status:"未対応"})],[job({price:"1200",title:"元の求人"})]);
  const result=run(old,[app("山田",{status:"面接確定",ref:"JOB000989",flag:1})],
    [job({ref:"JOB000989",price:"1350",title:"改稿求人"})]);
  const j=result.jobAnalysisMaster.rows[0], a=result.applicationData.rows[0];
  assert.equal(val(result.jobAnalysisMaster,j,"給与金額MIN"),"1200");
  assert.equal(val(result.jobAnalysisMaster,j,"仕事名"),"元の求人");
  assert.equal(val(result.applicationData,a,"対応状況"),"面接確定");
  assert.equal(result.stats.jobPromotedToCsv,0);
});

test("A11 missing new job CSV never resets the existing match or master",()=>{
  const old=wrap([app("山田",{flag:1,status:"面接確定"})],[job({price:"1200"})]);
  const result=run(old,[app("山田",{flag:0,ref:"",status:"辞退"})],[]);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"求人データ突合フラグ"),1);
  assert.equal(val(result.jobAnalysisMaster,result.jobAnalysisMaster.rows[0],"給与金額MIN"),"1200");
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"辞退");
});

test("same job can be enriched even if incoming is another application date; status remains untouched",()=>{
  const old=wrap([app("山田",{flag:0,ref:"",status:"内定"})],[]);
  const result=run(old,[app("山田",{date:"2026/11/20 10:00:00",status:"未対応",ref:"JOB001230",flag:1})],
    [job({ref:"JOB001230",source:"JOB_CSV"})]);
  assert.equal(result.stats.statusUpdatedApplications,0);
  assert.equal(result.stats.statusUpdateSkippedDifferentEvent,1);
  assert.equal(result.stats.jobAddedForExistingApplications,1);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"内定");
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"求人データ突合フラグ"),1);
});

test("prior JOB_CSV master can fulfill a formerly flag-0 application without overwriting attributes",()=>{
  const old=wrap([app("山田",{flag:0})],[job({price:"1200"})]);
  const result=run(old,[app("山田",{ref:"JOB002222",flag:1})],
    [job({ref:"JOB002222",price:"1300"})]);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"求人データ突合フラグ"),1);
  assert.equal(val(result.jobAnalysisMaster,result.jobAnalysisMaster.rows[0],"給与金額MIN"),"1200");
  assert.equal(result.stats.applicationsNewlyMatchedToJobCsv,1);
});

test("JOB_CSV without actual JOIN proof (flag 0) cannot update the matched flag or master",()=>{
  const old=wrap([app("山田",{ref:"",flag:0})],[]);
  const result=run(old,[app("山田",{ref:"JOB003333",flag:0})],
    [job({ref:"JOB003333",source:"JOB_CSV"})]);
  assert.equal(result.jobAnalysisMaster.rows.length,0);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"求人データ突合フラグ"),0);
});

test("an application-derived candidate is not treated as a JOB_CSV proof",()=>{
  const old=wrap([app("山田",{ref:"",flag:0})],[]);
  const result=run(old,[app("山田",{ref:"JOB003333",flag:1})],
    [job({ref:"JOB003333",source:"APPLICATION_EMBEDDED"})]);
  assert.equal(result.jobAnalysisMaster.rows.length,0);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"求人データ突合フラグ"),0);
});

test("incorrect provisional job ref is rejected even when baseline would skip duplicate person",()=>{
  const old=wrap([app("山田",{ref:"",flag:0})],[]);
  assert.throws(()=>run(old,[app("山田",{ref:"JOB004444",flag:1})],
    [job({ref:"JOB004444",job:"J999",source:"JOB_CSV"})]),{code:"JOB_REF_MISMATCH"});
});

test("A13 identical status duplicates do not create extra applications or extra status updates",()=>{
  const old=wrap([app("山田",{status:"面接確定"})],[job()]);
  const same=app("山田",{status:"面接確定"});
  const result=run(old,[same,same],[job()]);
  assert.equal(result.stats.duplicateWithinUpload,1);
  assert.equal(result.stats.statusUpdatedApplications,0);
  assert.equal(result.applicationData.rows.length,1);
});

test("A14 conflicting statuses for same person/event skip automatic status update",()=>{
  const old=wrap([app("山田",{status:"未対応"})],[job()]);
  const result=run(old,[app("山田",{status:"面接確定"}),app("山田",{status:"辞退"})],[job()]);
  assert.equal(result.stats.statusUpdateSkippedAmbiguous,1);
  assert.equal(result.stats.statusUpdatedApplications,0);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"未対応");
});

test("A16 date-only old/new CSV cannot prove the same event; no status update",()=>{
  const old=wrap([app("山田",{date:"2026/11/05",status:"未対応"})],[job()]);
  const result=run(old,[app("山田",{date:"2026/11/05",status:"面接確定"})],[job()]);
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"対応状況"),"未対応");
  assert.equal(result.stats.statusUpdateSkippedDifferentEvent,1);
});

test("A17 ID and NAME identity modes do not cross-join",()=>{
  const old=wrap([app("山田",{key:identity("PERSON001","PERSON_ID"),mode:"PERSON_ID"})],[job()]);
  const result=run(old,[app("山田",{status:"面接確定"})],[job()]);
  assert.equal(result.stats.addedApplications,1);
  assert.equal(result.stats.statusUpdatedApplications,0);
});

test("AGG_DAILY rows keep existing snapshot/add/decrease behavior",()=>{
  const agg=(i)=>{
    const hash=crypto.createHmac("sha256","isolated-test-only")
      .update(base.aggregateMaterial("C01","J101","AirWork","2026/11/05")).digest("hex");
    return app("aggregate",{key:base.aggregateIdentityKey(hash,i),mode:"AGG_DAILY",flag:0,status:"AirWork（状況未取得）"});
  };
  const old=wrap([agg(1),agg(2),agg(3)],[job()]);
  old.applicationData.rows.forEach((r,i)=>r[0]="APP"+String(i+1).padStart(6,"0"));
  const result=run(old,[agg(1),agg(2)],[job()]);
  assert.equal(result.applicationData.rows.length,3);
  assert.equal(result.stats.addedApplications,0);
  assert.equal(result.stats.aggregateDecreases.length,1);
  assert.equal(result.stats.statusUpdatedApplications,0);
  assert.equal(result.stats.applicationsNewlyMatchedToJobCsv,0);
});

test("legacy master with missing source column stays frozen, not misclassified as embedded",()=>{
  const old=wrap([app("山田",{flag:0})],[job({price:"1200"})]);
  old.jobAnalysisMaster.headers.pop();
  old.jobAnalysisMaster.rows[0].pop();
  const result=run(old,[app("山田",{ref:"JOB001111",flag:1})],
    [job({ref:"JOB001111",price:"1450"})]);
  assert.equal(val(result.jobAnalysisMaster,result.jobAnalysisMaster.rows[0],"給与金額MIN"),"1200");
  assert.equal(val(result.applicationData,result.applicationData.rows[0],"求人データ突合フラグ"),1);
});

test("a missing master added for existing applicant still obeys total job-row limit",()=>{
  const old=wrap([app("山田",{ref:"",flag:0})],[job({job:"UNRELATED"})]);
  assert.throws(()=>run(old,[app("山田",{ref:"JOB005555",flag:1})],
    [job({ref:"JOB005555"})],1),{code:"ROW_LIMIT"});
});

test("second upload of same file is idempotent for application and job datasets",()=>{
  const old=wrap([app("山田",{flag:0,ref:"",status:"未対応"})],[]);
  const newApps=[app("山田",{status:"面接確定",flag:1,ref:"JOB005555"})];
  const newJobs=[job({ref:"JOB005555",price:"1350"})];
  const one=run(old,newApps,newJobs);
  const two=run({
    applicationIdentityVersion:one.applicationIdentityVersion,
    applicationData:one.applicationData,jobAnalysisMaster:one.jobAnalysisMaster
  },newApps,newJobs);
  assert.deepEqual(two.applicationData,one.applicationData);
  assert.deepEqual(two.jobAnalysisMaster,one.jobAnalysisMaster);
  assert.equal(two.stats.statusUpdatedApplications,0);
  assert.equal(two.stats.applicationsNewlyMatchedToJobCsv,0);
  assert.equal(two.stats.jobAddedForExistingApplications,0);
});

test("existing baseline merge remains unchanged and REPLACE passes through without enrichment",()=>{
  const old=wrap([app("山田",{status:"未対応"})],[job()]);
  const newer=[app("山田",{status:"面接確定"})];
  const baseline=unchangedCore(old,newer,[job()]);
  assert.equal(val(baseline.applicationData,baseline.applicationData.rows[0],"対応状況"),"未対応");
  const source=payload(newer,[job()]);
  const viaLimited=limited.mergeLimited({mode:"REPLACE",incoming:source});
  const viaOriginal=base.merge({mode:"REPLACE",incoming:source});
  assert.deepEqual(viaLimited,viaOriginal);
  assert.equal(val(viaLimited.applicationData,viaLimited.applicationData.rows[0],"対応状況"),"面接確定");
});

test("date parser rejects impossible/incomplete time without inventing update certainty",()=>{
  for(const dt of ["2026/11/05","2026/02/30 10:00:00","2026/11/05 24:00:00","2026/11/05 10:99:00"]){
    assert.equal(limited.exactTime(dt),"");
  }
  assert.equal(limited.exactTime("2026-11-05 09:02"),"2026-11-05T09:02:00");
});
