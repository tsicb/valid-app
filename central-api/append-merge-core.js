/**
 * valid-app incremental-update merge engine (pure, no I/O).
 * Stage 1: intentionally NOT imported by index.html or GAS runtime yet.
 * Inputs are normalized applicationData/jobAnalysisMaster datasets with
 * already-generated identity keys. See docs/APPEND_UPDATE_IMPLEMENTATION_PLAN_V1.md.
 */
var VAAAppendMergeCore = (function () {
  "use strict";

  var VERSION = "1";
  var IDENTITY_HEADERS = ["応募識別キー", "応募識別方式"];
  var PERSON_MODES = ["PERSON_ID", "PERSON_NAME"];
  var AGG_KEY = /^G1:([0-9a-f]{64}):([0-9]{6,8})$/;
  var PERSON_KEY = /^I1:[0-9a-f]{64}$/;

  function error(code, detail) {
    var ex = new Error(code + ": " + detail);
    ex.code = code;
    throw ex;
  }
  function str(v) { return v === undefined || v === null ? "" : String(v).trim(); }
  function personPart(v) { return str(v).normalize("NFKC").replace(/[\s\u3000]+/g, " "); }
  function enterprise(v) { return str(v).toUpperCase(); }
  function normalizeJobNo(v) {
    return str(v).toUpperCase().replace(/_[0-9]{3,8}$|§.*/g, "");
  }
  function jobKey(company, number) {
    var c = enterprise(company), n = normalizeJobNo(number);
    return c && n ? JSON.stringify([c, n]) : "";
  }
  function checkDate(y, m, d) {
    var utc = new Date(Date.UTC(y, m - 1, d));
    return utc.getUTCFullYear() === y &&
      utc.getUTCMonth() + 1 === m && utc.getUTCDate() === d;
  }
  function dateParts(v) {
    var match = str(v).match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T].*)?$/);
    if (!match) error("INVALID_DATE", "応募日時を年月日に変換できません");
    var y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    if (!checkDate(y, m, d)) error("INVALID_DATE", "存在しない応募日です");
    var month = String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0");
    return {month: month, date: month + "-" + String(d).padStart(2, "0")};
  }
  function personMaterial(method, company, appliedAt, sourcePersonValue) {
    if (PERSON_MODES.indexOf(method) < 0) error("INVALID_IDENTITY_MODE", "人物識別方法が不正です");
    var c = enterprise(company);
    var v = personPart(sourcePersonValue);
    if (!c || !v) error("IDENTITY_MISSING", "企業ID・人物識別情報が必要です");
    return JSON.stringify(["PERSON_V1", method, c, dateParts(appliedAt).month, v]);
  }
  function aggregateMaterial(company, jobNo, media, appliedAt) {
    var c = enterprise(company), n = normalizeJobNo(jobNo), medium = str(media);
    if (!c || !n || !medium) error("AGGREGATE_MISSING", "集計キーに企業ID・仕事番号・媒体が必要です");
    return JSON.stringify(["AGG_DAILY_V1", c, n, medium, dateParts(appliedAt).date]);
  }
  function personIdentityKey(hmacHex) {
    if (!/^[0-9a-f]{64}$/i.test(str(hmacHex))) error("INVALID_HASH", "人物用HMACは64桁の16進数で指定してください");
    return "I1:" + str(hmacHex).toLowerCase();
  }
  function aggregateIdentityKey(groupHmacHex, ordinal) {
    if (!/^[0-9a-f]{64}$/i.test(str(groupHmacHex))) error("INVALID_HASH", "集計用HMACは64桁の16進数で指定してください");
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 99999999)
      error("INVALID_ORDINAL", "集計行の連番が範囲外です");
    return "G1:" + str(groupHmacHex).toLowerCase() + ":" + String(ordinal).padStart(6, "0");
  }
  function dataset(data, label, required) {
    if (!data || !Array.isArray(data.headers) || !Array.isArray(data.rows))
      error("INVALID_DATASET", label + "にheaders/rowsがありません");
    var headers = data.headers.slice();
    var seen = new Set(headers);
    if (headers.length !== seen.size || headers.some(function(h){return !str(h);}))
      error("INVALID_HEADERS", label + "の列名が不正です");
    (required || []).forEach(function(h) {
      if (!seen.has(h)) error("MISSING_COLUMN", label + "に「" + h + "」列がありません");
    });
    data.rows.forEach(function(row, i) {
      if (!Array.isArray(row) || row.length !== headers.length)
        error("INVALID_ROW", label + "の" + (i + 1) + "件目の列数が異なります");
    });
    return {headers: headers, rows: data.rows, index: new Map(headers.map(function(h,i){return [h,i];}))};
  }
  function get(d, row, name) { return d.index.has(name) ? row[d.index.get(name)] : ""; }
  function projection(d, row, headers) {
    return headers.map(function(h){return d.index.has(h) ? row[d.index.get(h)] : "";});
  }
  function headerUnion(a, b) {
    var h = a.slice(), seen = new Set(h);
    b.forEach(function(x){if (!seen.has(x)){h.push(x);seen.add(x);}});
    return h;
  }
  function numericId(value, prefix) {
    var raw = str(value);
    var m = raw.match(new RegExp("^" + prefix + "([0-9]+)$"));
    return m ? Number(m[1]) : null;
  }
  function idAllocator(rows, d, column, prefix) {
    var used = new Set(), max = 0;
    rows.forEach(function(row) {
      var id = str(get(d, row, column));
      if (!id || used.has(id)) error("INVALID_EXISTING_IDS", column + "が未設定または重複しています");
      used.add(id);
      var n = numericId(id, prefix);
      if (n !== null) max = Math.max(max, n);
    });
    return function() {
      var next;
      do {
        max++;
        next = prefix + String(max).padStart(6, "0");
      } while(used.has(next));
      used.add(next);
      return next;
    };
  }
  function checkedIdentity(d, row, isExisting) {
    var mode = str(get(d, row, "応募識別方式"));
    var key = str(get(d, row, "応募識別キー"));
    if (mode === "UNIDENTIFIED") {
      if (key) error("INVALID_IDENTITY_KEY", "UNIDENTIFIED行にはキーを付与できません");
      return {mode:mode, key:""};
    }
    if (PERSON_MODES.indexOf(mode) >= 0) {
      if (!PERSON_KEY.test(key)) error("INVALID_IDENTITY_KEY", "人物応募のキーが不正です");
    } else if (mode === "AGG_DAILY") {
      var match = key.match(AGG_KEY);
      if (!match || Number(match[2]) < 1)
        error("INVALID_IDENTITY_KEY", "日別集計のキーが不正です");
    } else {
      error("INVALID_IDENTITY_MODE", (isExisting ? "保存済み" : "今回の") + "応募識別方式が不明です");
    }
    return {mode:mode, key:key};
  }
  function groupOf(key) {
    var match = key.match(AGG_KEY);
    if (!match) return null;
    return {group:match[1], ordinal:Number(match[2])};
  }
  function inspectAggregateRows(data) {
    var groups = new Map();
    data.rows.forEach(function(row) {
      if (str(get(data,row,"応募識別方式")) !== "AGG_DAILY") return;
      var info = groupOf(str(get(data,row,"応募識別キー")));
      if (!info) error("INVALID_IDENTITY_KEY", "日別集計キーを解析できません");
      if (!groups.has(info.group)) groups.set(info.group,new Set());
      if (groups.get(info.group).has(info.ordinal))
        error("DUPLICATE_AGGREGATE", "同じ日別集計の連番が重複しています（複数ファイルの合算かもしれません）");
      groups.get(info.group).add(info.ordinal);
    });
    groups.forEach(function(ordinals){
      var max = Math.max.apply(null,Array.from(ordinals));
      if (ordinals.size !== max) error("AGGREGATE_SEQUENCE_GAP", "集計グループの連番が欠けています");
    });
    return groups;
  }
  function validateAllIdentities(d) {
    d.rows.forEach(function(row){ checkedIdentity(d,row,false); });
    inspectAggregateRows(d);
  }
  function enforceMax(result, maxRows) {
    if (result.rows.length > maxRows)
      error("ROW_LIMIT", "統合後の行数が" + maxRows + "件の上限を超えています");
  }

  /** Pure merge. Existing datasets are never mutated. */
  function merge(input) {
    var mode = str(input && input.mode);
    if (mode !== "APPEND" && mode !== "REPLACE")
      error("INVALID_STRATEGY", "APPENDかREPLACEを明示してください");
    var maxRows = input.maxRows === undefined ? 100000 : input.maxRows;
    if (!Number.isSafeInteger(maxRows) || maxRows < 1) error("INVALID_LIMIT","行数上限が不正です");
    var nextApp = dataset(input.incoming.applicationData, "今回応募", ["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ","応募識別キー","応募識別方式"]);
    var nextJob = dataset(input.incoming.jobAnalysisMaster, "今回求人", ["求人参照ID","企業ID","仕事番号"]);
    validateAllIdentities(nextApp);
    var oldApp, oldJob;
    if (mode === "APPEND") {
      if (!input.existing || String(input.existing.applicationIdentityVersion || "") !== VERSION)
        error("MIGRATION_REQUIRED", "旧形式は初回のみ全件入れ替えで移行してください");
      oldApp = dataset(input.existing.applicationData, "保存済み応募", ["レコードID","企業ID","仕事番号","求人参照ID","応募識別キー","応募識別方式"]);
      oldJob = dataset(input.existing.jobAnalysisMaster, "保存済み求人", ["求人参照ID","企業ID","仕事番号"]);
      validateAllIdentities(oldApp);
    } else {
      oldApp = dataset({headers:nextApp.headers,rows:[]}, "保存済み応募");
      oldJob = dataset({headers:nextJob.headers,rows:[]}, "保存済み求人");
    }
    var appHeaders = headerUnion(oldApp.headers,nextApp.headers);
    var jobHeaders = headerUnion(oldJob.headers,nextJob.headers);
    var appResult = oldApp.rows.map(function(row){return projection(oldApp,row,appHeaders);});
    var jobResult = oldJob.rows.map(function(row){return projection(oldJob,row,jobHeaders);});
    var oldJobRefs = new Map();
    var refs = new Set();
    oldJob.rows.forEach(function(row){
      var ref = str(get(oldJob,row,"求人参照ID"));
      var key = jobKey(get(oldJob,row,"企業ID"), get(oldJob,row,"仕事番号"));
      if (!ref || refs.has(ref)) error("INVALID_EXISTING_IDS","既存求人参照IDが空欄または重複しています");
      refs.add(ref);
      if (key) {
        if (oldJobRefs.has(key)) error("DUPLICATE_JOB_KEY","保存済み求人の企業ID＋仕事番号が重複しています");
        oldJobRefs.set(key,ref);
      }
    });
    var getNextJobId = idAllocator(oldJob.rows,oldJob,"求人参照ID","JOB");
    var getNextAppId = idAllocator(oldApp.rows,oldApp,"レコードID","APP");
    var nextJobMap = new Map();
    var nextJobRefLookup = new Map();
    nextJob.rows.forEach(function(row){
      var key = jobKey(get(nextJob,row,"企業ID"),get(nextJob,row,"仕事番号"));
      var ref = str(get(nextJob,row,"求人参照ID"));
      if (!ref) error("INVALID_INCOMING_JOB","今回求人の参照IDがありません");
      if (nextJobRefLookup.has(ref)) error("DUPLICATE_INCOMING_JOB_REF","今回求人の参照IDが重複しています");
      nextJobRefLookup.set(ref,key);
      if (key && !nextJobMap.has(key)) nextJobMap.set(key,row);
    });
    var identitySet = new Set();
    oldApp.rows.forEach(function(row){
      var key = str(get(oldApp,row,"応募識別キー"));
      if (key) {
        if(identitySet.has(key)) error("DUPLICATE_EXISTING_IDENTITY","既存の応募識別キーが重複しています");
        identitySet.add(key);
      }
    });
    var incomingSet = new Set();
    var picked = [];
    var skippedAsExisting = 0, duplicateWithinUpload = 0;
    nextApp.rows.forEach(function(row){
      var identity = checkedIdentity(nextApp,row,false);
      if (mode === "APPEND" && identity.mode === "UNIDENTIFIED")
        error("UNIDENTIFIED_APPEND","氏名・応募IDがなく集計由来とも判定できない応募は差分追加できません");
      if (identity.key) {
        if (incomingSet.has(identity.key)) {
          if (identity.mode === "AGG_DAILY")
            error("DUPLICATE_AGGREGATE","同じ集計日・連番が入力内で重複しています");
          duplicateWithinUpload++;
          return;
        }
        incomingSet.add(identity.key);
        if (identitySet.has(identity.key)) { skippedAsExisting++; return; }
        identitySet.add(identity.key);
      }
      picked.push(row);
    });
    // Aggregate count decreases: only groups actually supplied in the new upload.
    var oldGroups = inspectAggregateRows(oldApp);
    var newGroups = inspectAggregateRows(nextApp);
    var decreases = [];
    newGroups.forEach(function(v,k){
      var before = oldGroups.has(k) ? oldGroups.get(k).size : 0;
      if (v.size < before) decreases.push({groupKey:"G1:"+k, saved:before, incoming:v.size});
    });

    // Existing jobs are never overwritten. Candidate jobs not referenced by
    // newly accepted applications are not appended to the dimension table.
    var addedJobs = 0;
    picked.forEach(function(appRow){
      var company = get(nextApp,appRow,"企業ID");
      var no = get(nextApp,appRow,"仕事番号");
      var key = jobKey(company,no);
      if (!key || oldJobRefs.has(key)) return;
      var candidate = nextJobMap.get(key);
      if (!candidate) return;
      var assigned = getNextJobId();
      var mapped = projection(nextJob,candidate,jobHeaders);
      mapped[jobHeaders.indexOf("求人参照ID")] = assigned;
      jobResult.push(mapped);
      oldJobRefs.set(key,assigned);
      addedJobs++;
    });

    picked.forEach(function(row){
      var mapped = projection(nextApp,row,appHeaders);
      mapped[appHeaders.indexOf("レコードID")] = getNextAppId();
      var incomingRef = str(get(nextApp,row,"求人参照ID"));
      var key = jobKey(get(nextApp,row,"企業ID"),get(nextApp,row,"仕事番号"));
      // A provisional ref in incoming should refer to the same company/job,
      // and must never bind the application to a different job.
      if (incomingRef && nextJobRefLookup.has(incomingRef) && nextJobRefLookup.get(incomingRef) !== key)
        error("JOB_REF_MISMATCH","応募の仮求人参照IDと企業ID・仕事番号が一致しません");
      mapped[appHeaders.indexOf("求人参照ID")] = key && oldJobRefs.has(key) ? oldJobRefs.get(key) : "";
      appResult.push(mapped);
    });
    var applicationData = {headers:appHeaders, rows:appResult};
    var jobAnalysisMaster = {headers:jobHeaders, rows:jobResult};
    enforceMax(applicationData,maxRows);
    enforceMax(jobAnalysisMaster,maxRows);
    return {
      applicationIdentityVersion:VERSION,
      applicationData:applicationData,
      jobAnalysisMaster:jobAnalysisMaster,
      stats:{
        strategy:mode,
        oldApplications:oldApp.rows.length,
        uploadedApplications:nextApp.rows.length,
        duplicateWithinUpload:duplicateWithinUpload,
        skippedAsExisting:skippedAsExisting,
        addedApplications:picked.length,
        finalApplications:appResult.length,
        oldJobs:oldJob.rows.length,
        addedJobs:addedJobs,
        finalJobs:jobResult.length,
        aggregateDecreases:decreases
      }
    };
  }
  return {
    VERSION:VERSION, IDENTITY_HEADERS:IDENTITY_HEADERS,
    normalizeJobNo:normalizeJobNo, jobKey:jobKey,
    dateParts:dateParts, personMaterial:personMaterial,
    aggregateMaterial:aggregateMaterial,
    personIdentityKey:personIdentityKey, aggregateIdentityKey:aggregateIdentityKey,
    merge:merge
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = VAAAppendMergeCore;
