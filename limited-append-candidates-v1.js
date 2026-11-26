/**
 * Browser-only, opt-in update evidence for limited APPEND (V1).
 *
 * Discarded same-month person rows are candidates to UPDATE a previously
 * saved representative; they must NOT be appended to applicationData.
 * Never export raw names, applicant IDs or contacts. No storage/network I/O.
 */
var VAALimitedAppendCandidates = (function () {
  "use strict";
  const identityApi = typeof VAAClientIdentity !== "undefined"
    ? VAAClientIdentity
    : (typeof module !== "undefined" ? require("./append-identity-v1.js") : null);
  const APP_HEADERS = [
    "応募識別キー", "応募識別方式", "企業ID", "仕事番号",
    "応募日時", "対応状況", "求人参照ID", "求人データ突合フラグ"
  ];
  const REQUIRED_JOB_HEADERS = ["求人参照ID", "企業ID", "仕事番号", "求人分析情報ソース"];
  function str(v) { return v===undefined||v===null?"":String(v).trim(); }
  function isPerson(mode) { return mode==="PERSON_ID"||mode==="PERSON_NAME"; }

  async function build(options) {
    const o=options||{};
    const rawRows=Array.isArray(o.discardedRawRows)?o.discardedRawRows:[];
    const joinedRows=Array.isArray(o.discardedJoinedRows)?o.discardedJoinedRows:[];
    const main=Array.isArray(o.primaryRows)?o.primaryRows:[];
    const jobRows=Array.isArray(o.jobRows)?o.jobRows:[];
    const jobHeaders=Array.isArray(o.jobHeaders)?o.jobHeaders.slice():[];
    const empty={
      applicationData:{headers:APP_HEADERS.slice(),rows:[]},
      jobAnalysisMaster:{headers:jobHeaders,rows:[]}
    };
    if(!rawRows.length && !joinedRows.length)return empty;
    if(rawRows.length+joinedRows.length>100000)
      throw new Error("限定更新の候補件数が上限を超えています。");
    if(!identityApi || typeof o.getCompany!=="function" ||
       typeof o.jobNo!=="function" ||
       typeof o.formatDate!=="function" ||
       typeof o.buildJobMeta!=="function" ||
       typeof o.buildJobRecord!=="function" ||
       !REQUIRED_JOB_HEADERS.every(h=>jobHeaders.includes(h))) {
      throw new Error("限定更新の準備に必要な処理が見つかりません。");
    }

    const c=row=>str(o.getCompany(row)).toUpperCase();
    const jobKey=row=>{
      const company=c(row),job=str(o.jobNo(row?.["仕事番号"]));
      return company&&job ? JSON.stringify([company,job]) : "";
    };
    const primaryIds=new Set(main.map(row=>row?.__vaaIdentity?.key).filter(Boolean));
    const jobByKey=new Map();
    jobRows.forEach(row=>{
      const key=jobKey(row);
      if(key&&!jobByKey.has(key))jobByKey.set(key,row);
    });
    const temp=rawRows.filter(row=>str(row["氏名"])||str(row["応募者ID"])).map(row=>{
      const reduced={
        "企業コード":c(row), "仕事番号":str(row["仕事番号"]),
        "応募日時":o.formatDate(row["応募日時"]),
        "対応状況":str(row["対応状況"]),
        "応募媒体":str(row["応募媒体"]),
        "仕事名":str(row["仕事名"])
      };
      Object.defineProperty(reduced,"__vaaIdentityRaw",{
        enumerable:false,configurable:true,
        value:{name:str(row["氏名"]),applicantId:str(row["応募者ID"])}
      });
      return {raw:row,reduced};
    });
    if(temp.length)await identityApi.assign(temp.map(item=>item.reduced),o.secret,o.cryptoProvider);

    const apps=[],jobs=[],chosenJobByKey=new Map();
    function append(row,identity,meta) {
      if(!identity?.key || !isPerson(identity.mode) || !primaryIds.has(identity.key))return;
      const key=jobKey(row);
      let ref="";
      if(key && meta?.source==="JOB_CSV") {
        if(!chosenJobByKey.has(key)){
          const next="UC"+String(chosenJobByKey.size+1).padStart(6,"0");
          const result=o.buildJobRecord(meta,next);
          // Object projection ensures only declared JOB_ANALYSIS_HEADERS are sent.
          const jobRecord=jobHeaders.map(h=>h==="求人参照ID"?next:(result[h]??""));
          const item={ref:next};
          chosenJobByKey.set(key,item);
          jobs.push(jobRecord);
        }
        ref=chosenJobByKey.get(key).ref;
      }
      apps.push([
        identity.key,identity.mode,c(row),str(row["仕事番号"]),
        o.formatDate(row["応募日時"]),str(row["対応状況"]),ref,ref?1:0
      ]);
    }
    temp.forEach(({raw,reduced})=>{
      const identity=reduced.__vaaIdentity;
      const match=jobByKey.get(jobKey(raw));
      const meta=match?o.buildJobMeta(raw,match,true):null;
      append(raw,identity,meta);
    });
    joinedRows.forEach(row=>{
      append(row,row.__vaaIdentity,row.__jobAnalysisMeta);
    });
    return {
      applicationData:{headers:APP_HEADERS.slice(),rows:apps},
      jobAnalysisMaster:{headers:jobHeaders,rows:jobs}
    };
  }
  return {build,APP_HEADERS};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=VAALimitedAppendCandidates;
