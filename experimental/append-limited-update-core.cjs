"use strict";

/**
 * Isolation-only candidate for APPEND limited updates (2026-11-23).
 * NOT invoked by GAS, index.html, CREATE, REPLACE, or production.
 *
 * Reuses the existing canonical pure merge for validation and base merging,
 * then changes ONLY an existing PERSON_ID/PERSON_NAME application's status
 * (when company + normalized job + exact application timestamp agree) and
 * fills its missing JOB_CSV information (same company + normalized job).
 * The source datasets and the existing merge() implementation are untouched.
 */
const base = require("../central-api/append-merge-core.js");

function str(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
function ds(data) {
  return { headers:data.headers, rows:data.rows,
    index:new Map(data.headers.map((h,i)=>[h,i])) };
}
function get(d,row,column) {
  return d.index.has(column) ? row[d.index.get(column)] : "";
}
function set(d,row,column,value) {
  if (d.index.has(column)) row[d.index.get(column)] = value;
}
function key(d,row) {
  return base.jobKey(get(d,row,"企業ID"),get(d,row,"仕事番号"));
}
function exactTime(raw) {
  const match=str(raw).match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return "";
  const [,year,month,day,hour,minute,second="0"]=match;
  const y=Number(year), mo=Number(month), d=Number(day),
    h=Number(hour), min=Number(minute), sec=Number(second);
  const dt=new Date(Date.UTC(y,mo-1,d));
  if (dt.getUTCFullYear()!==y || dt.getUTCMonth()+1!==mo ||
      dt.getUTCDate()!==d || h>23 || min>59 || sec>59) return "";
  return [String(y).padStart(4,"0"),String(mo).padStart(2,"0"),
    String(d).padStart(2,"0")].join("-") + "T" +
    [h,min,sec].map(n=>String(n).padStart(2,"0")).join(":");
}
function isPerson(mode) {
  return mode==="PERSON_ID" || mode==="PERSON_NAME";
}
function invalidRef() {
  const e=new Error("JOB_REF_MISMATCH: duplicate application's provisional job reference disagrees with its job");
  e.code="JOB_REF_MISMATCH";
  throw e;
}
function allocateJobId(rows,jobs) {
  const ids=new Set(rows.map(r=>str(get(jobs,r,"求人参照ID"))));
  let max=0;
  ids.forEach(id=>{
    const m=id.match(/^JOB(\d+)$/);
    if(m) max=Math.max(max,Number(m[1]));
  });
  return ()=>{
    let id;
    do { id="JOB"+String(++max).padStart(6,"0"); } while(ids.has(id));
    ids.add(id);
    return id;
  };
}

function mergeLimited(input) {
  // Pre-existing engine does all baseline validation, idempotency checks,
  // AGG_DAILY handling, and ordinary addition unchanged.
  const result=base.merge(input);
  if (input.mode!=="APPEND") return result;

  const old=ds(input.existing.applicationData);
  const inc=ds(input.incoming.applicationData);
  const incJobs=ds(input.incoming.jobAnalysisMaster);
  const apps=ds(result.applicationData);
  const jobs=ds(result.jobAnalysisMaster);

  const existingByIdentity=new Map();
  old.rows.forEach((row,index)=>{
    if(isPerson(str(get(old,row,"応募識別方式"))))
      existingByIdentity.set(str(get(old,row,"応募識別キー")),{row,index});
  });
  const incomingByIdentity=new Map();
  inc.rows.forEach(row=>{
    if(!isPerson(str(get(inc,row,"応募識別方式")))) return;
    const identity=str(get(inc,row,"応募識別キー"));
    if(!existingByIdentity.has(identity)) return;
    if(!incomingByIdentity.has(identity)) incomingByIdentity.set(identity,[]);
    incomingByIdentity.get(identity).push(row);
  });

  const byJobKey=new Map();
  jobs.rows.forEach(row=>{if(key(jobs,row)) byJobKey.set(key(jobs,row),row);});
  const byProvisionalRef=new Map();
  incJobs.rows.forEach(row=>byProvisionalRef.set(str(get(incJobs,row,"求人参照ID")),row));
  const nextJobId=allocateJobId(jobs.rows,jobs);

  const counters={
    statusUpdatedApplications:0,
    statusUpdateSkippedDifferentEvent:0,
    statusUpdateSkippedAmbiguous:0,
    jobPromotedToCsv:0,
    jobAddedForExistingApplications:0,
    applicationsNewlyMatchedToJobCsv:0
  };

  incomingByIdentity.forEach((group,identity)=>{
    // The current browser drops later same-person rows before JOIN:
    // do not act as if those later rows were available to GAS.
    const candidate=group[0];
    const saved=existingByIdentity.get(identity);
    const oldRow=saved.row;
    const outRow=apps.rows[saved.index];
    const savedKey=key(old,oldRow), candidateKey=key(inc,candidate);
    const sameJob=!!savedKey && savedKey===candidateKey;
    const before=exactTime(get(old,oldRow,"応募日時"));
    const incomingTime=exactTime(get(inc,candidate,"応募日時"));
    if(sameJob && before && before===incomingTime) {
      const statuses=new Set(group
        .filter(row=>key(inc,row)===savedKey &&
          exactTime(get(inc,row,"応募日時"))===before)
        .map(row=>str(get(inc,row,"対応状況")))
        .filter(Boolean));
      if(statuses.size>1) {
        counters.statusUpdateSkippedAmbiguous++;
      } else if(statuses.size===1 && apps.index.has("対応状況")) {
        const value=[...statuses][0];
        if(str(get(apps,outRow,"対応状況"))!==value) {
          set(apps,outRow,"対応状況",value);
          counters.statusUpdatedApplications++;
        }
      }
    } else {
      counters.statusUpdateSkippedDifferentEvent++;
    }

    // Job enrichment is independent of status update, but must be for
    // the SAME job as the stored representative (never another job).
    if(!sameJob || str(get(inc,candidate,"求人データ突合フラグ"))!=="1") return;
    const provisionalRef=str(get(inc,candidate,"求人参照ID"));
    if(!provisionalRef) return;
    const jobCandidate=byProvisionalRef.get(provisionalRef);
    if(!jobCandidate) return;
    if(key(incJobs,jobCandidate)!==savedKey) invalidRef();
    if(str(get(incJobs,jobCandidate,"求人分析情報ソース"))!=="JOB_CSV") return;

    let outJob=byJobKey.get(savedKey);
    if(!outJob) {
      outJob=jobs.headers.map(column=>get(incJobs,jobCandidate,column));
      set(jobs,outJob,"求人参照ID",nextJobId());
      jobs.rows.push(outJob);
      byJobKey.set(savedKey,outJob);
      counters.jobAddedForExistingApplications++;
    } else if(str(get(jobs,outJob,"求人分析情報ソース"))==="APPLICATION_EMBEDDED") {
      jobs.headers.forEach(column=>{
        if(["求人参照ID","企業ID","仕事番号"].includes(column)) return;
        const val=get(incJobs,jobCandidate,column);
        if(str(val)) set(jobs,outJob,column,val);
      });
      set(jobs,outJob,"求人分析情報ソース","JOB_CSV");
      counters.jobPromotedToCsv++;
    }
    // Existing JOB_CSV, including legacy blank-source master, is immutable.
    set(apps,outRow,"求人参照ID",get(jobs,outJob,"求人参照ID"));
    if(str(get(apps,outRow,"求人データ突合フラグ"))!=="1") {
      set(apps,outRow,"求人データ突合フラグ",1);
      counters.applicationsNewlyMatchedToJobCsv++;
    }
  });

  const maxRows=input.maxRows===undefined?100000:input.maxRows;
  if(jobs.rows.length>maxRows) {
    const e=new Error("ROW_LIMIT: enriched job master exceeds limit");
    e.code="ROW_LIMIT";
    throw e;
  }
  result.stats={...result.stats,...counters,
    addedJobs:result.stats.addedJobs+counters.jobAddedForExistingApplications,
    finalJobs:jobs.rows.length};
  return result;
}
module.exports={mergeLimited,exactTime};
