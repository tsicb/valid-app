"use strict";

/**
 * Isolation-only browser adapter: convert only discarded person rows into
 * pseudonymous UPDATE CANDIDATES. Do not add them to applicationData; do not
 * store the sidecar in DataStore. No code in index.html calls this module yet.
 *
 * Incoming raw application rows are already canonicalized by Pages' CSV_A/B
 * adapter. JOB_CSV candidates are projected by a caller-supplied mapper,
 * which must return ONLY allowed job-analysis columns.
 */
const clientIdentity = require("../append-identity-v1.js");
const mergeCore = require("../central-api/append-merge-core.js");

const APP_HEADERS = [
  "応募識別キー","応募識別方式","企業ID","仕事番号","応募日時",
  "対応状況","求人参照ID","求人データ突合フラグ"
];

function s(v) { return v===undefined||v===null?"":String(v).trim(); }
function company(row) { return s(row["企業コード"]||row["企業ID"]).toUpperCase(); }
function person(row) { return s(row["応募者ID"])||s(row["氏名"]); }
function date(value) {
  const str=s(value), a=str.split(/[ T]/);
  if(a.length<2) return str;
  const sep=a[0].replace(/-/g,"/"), time=a[1].split(":");
  if(time.length<2) return str;
  const fields=sep.split("/");
  if(fields.length!==3) return str;
  return [fields[0],fields[1].padStart(2,"0"),fields[2].padStart(2,"0")].join("/")+
    " "+time[0].padStart(2,"0")+":"+time[1].padStart(2,"0")+":"+
    (time[2]||"00").padStart(2,"0");
}
function key(row) { return mergeCore.jobKey(company(row),s(row["仕事番号"])); }
function fail(code,message) {
  const e=new Error(code+": "+message);e.code=code;throw e;
}

async function buildSidecar(input) {
  const discardedRows=Array.isArray(input.discardedRows)?input.discardedRows:[];
  const jobRows=Array.isArray(input.jobRows)?input.jobRows:[];
  const headers=Array.isArray(input.jobHeaders)?input.jobHeaders.slice():[];
  const projectJob=input.projectJob;
  const candidates=discardedRows.filter(row=>person(row));
  if(candidates.length>100000) fail("TOO_MANY_UPDATE_CANDIDATES","候補件数が上限を超えました");
  const temporary=candidates.map(row=>{
    const safe={
      "企業コード":company(row),
      "仕事番号":s(row["仕事番号"]),
      "応募日時":date(row["応募日時"]),
      "応募媒体":s(row["応募媒体"]),
      "仕事名":s(row["仕事名"]),
      "対応状況":s(row["対応状況"])
    };
    Object.defineProperty(safe,"__vaaIdentityRaw",{
      enumerable:false,
      value:{applicantId:s(row["応募者ID"]),name:s(row["氏名"])}
    });
    return safe;
  });
  if(temporary.length) await clientIdentity.assign(temporary,input.secret);
  const firstJobs=new Map();
  jobRows.forEach(row=>{
    const k=key(row);
    if(k&&!firstJobs.has(k)) firstJobs.set(k,row);
  });
  const jobHeaders=["求人参照ID","企業ID","仕事番号","求人分析情報ソース",
    ...headers.filter(h=>!["求人参照ID","企業ID","仕事番号","求人分析情報ソース"].includes(h))];
  const jobByKey=new Map();
  const jobOut=[];
  const appOut=[];
  const allowed=new Set(jobHeaders);
  candidates.forEach((raw,i)=>{
    const row=temporary[i];
    const id=row.__vaaIdentity;
    if(!id || !["PERSON_ID","PERSON_NAME"].includes(id.mode) || !id.key) return;
    const k=key(raw);
    const job=firstJobs.get(k);
    let ref="";
    if(job&&typeof projectJob==="function"&&k){
      if(!jobByKey.has(k)) {
        const values=projectJob(raw,job)||{};
        // Only caller-declared, analysis-safe fields; never forward raw
        // applicant or job CSV data wholesale.
        const safe={};
        jobHeaders.forEach(h=>{if(h in values) safe[h]=values[h];});
        safe["企業ID"]=company(raw);
        safe["仕事番号"]=s(raw["仕事番号"]);
        safe["求人分析情報ソース"]="JOB_CSV";
        safe["求人参照ID"]="UC"+String(jobByKey.size+1).padStart(6,"0");
        for(const h of Object.keys(safe)) {
          if(!allowed.has(h)) fail("INVALID_UPDATE_JOB_HEADER","求人情報の列が不正です");
        }
        jobByKey.set(k,safe);
        jobOut.push(jobHeaders.map(h=>safe[h]===undefined?"":safe[h]));
      }
      ref=jobByKey.get(k)["求人参照ID"];
    }
    appOut.push([
      id.key,id.mode,company(raw),s(raw["仕事番号"]),
      row["応募日時"],s(raw["対応状況"]),ref,ref?1:0
    ]);
  });
  // The result contains no raw person name / applicant ID / contact detail.
  return {
    applicationData:{headers:APP_HEADERS,rows:appOut},
    jobAnalysisMaster:{headers:jobHeaders,rows:jobOut}
  };
}

module.exports={buildSidecar,APP_HEADERS};
