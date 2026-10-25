/**
 * Browser-only applicant fingerprinting for valid-app (IDENTITY_V1).
 * Source records stay in memory; only the opaque keys are exported.
 */
var VAAClientIdentity = (function () {
  "use strict";
  const PERSON_ID = "PERSON_ID";
  const PERSON_NAME = "PERSON_NAME";
  const AGG_DAILY = "AGG_DAILY";

  function str(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }
  function company(value) { return str(value).toUpperCase(); }
  function jobNo(value) {
    return str(value).toUpperCase().replace(/_[0-9]{3,8}$|§.*/g, "");
  }
  function personValue(value) {
    return str(value).normalize("NFKC").replace(/[\s\u3000]+/g, " ");
  }
  function dateParts(value) {
    const raw = str(value);
    const m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T].*)?$/);
    if (!m) throw new Error("応募日時から年月日を確認できません。");
    const y = Number(m[1]), mon = Number(m[2]), d = Number(m[3]);
    const check = new Date(Date.UTC(y, mon - 1, d));
    if (check.getUTCFullYear() !== y ||
        check.getUTCMonth() + 1 !== mon ||
        check.getUTCDate() !== d) {
      throw new Error("応募日時に存在しない日付があります。");
    }
    const month = String(y).padStart(4, "0") + "-" +
      String(mon).padStart(2, "0");
    return {month, date:month + "-" + String(d).padStart(2, "0")};
  }
  function material(method, companyId, date, value) {
    if (method !== PERSON_ID && method !== PERSON_NAME)
      throw new Error("応募識別方式が不正です。");
    const id = company(companyId);
    const val = personValue(value);
    if (!id || !val) throw new Error("企業IDまたは応募識別情報がありません。");
    return JSON.stringify(["PERSON_V1",method,id,dateParts(date).month,val]);
  }
  function aggregateMaterial(row) {
    const id = company(row.enterpriseId),
      job = jobNo(row.jobNo),
      media = str(row.media);
    if (!id || !job || !media) {
      throw new Error("AirWork応募の企業ID・仕事番号・媒体が不足しています。");
    }
    return JSON.stringify(["AGG_DAILY_V1",id,job,media,dateParts(row.date).date]);
  }
  function isAirWork(row) {
    return !str(row.applicantId) &&
      !personValue(row.name) &&
      str(row.media) === "AirWork" &&
      str(row.jobName) === "AirWork（応募実績）" &&
      str(row.status) === "AirWork（状況未取得）";
  }
  function toHex(bytes) {
    return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function createSigner(secret, provider) {
    if (!str(secret)) throw new Error("応募識別キーを取得できませんでした。");
    const webCrypto = provider ||
      (typeof crypto !== "undefined" ? crypto : null);
    if (!webCrypto || !webCrypto.subtle || typeof TextEncoder !== "function") {
      throw new Error("応募識別キーの作成には安全なHTTPS環境が必要です。");
    }
    const encoder = new TextEncoder();
    const hmacKey = await webCrypto.subtle.importKey(
      "raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]
    );
    const memo = new Map();
    return async function sign(message) {
      if (!memo.has(message)) {
        memo.set(message, webCrypto.subtle.sign("HMAC",hmacKey,encoder.encode(message)).then(toHex));
      }
      return memo.get(message);
    };
  }
  async function assign(rows,secret,provider) {
    const sign = await createSigner(secret,provider);
    const aggregateOrdinals = new Map();
    const aggregateFiles = new Map();
    const entries = (rows || []).map(row => {
      const raw = row && row.__vaaIdentityRaw || {};
      const id = str(raw.applicantId), name = personValue(raw.name);
      const enterpriseId = str(row && (row["企業コード"] || row["企業ID"]));
      const date = str(row && row["応募日時"]);
      const common = {
        enterpriseId,
        jobNo:str(row && row["仕事番号"]),
        date,
        media:str(row && row["応募媒体"]),
        jobName:str(row && row["仕事名"]),
        status:str(row && row["対応状況"]),
        applicantId:id,
        name
      };
      if (id || name) {
        const mode = id ? PERSON_ID : PERSON_NAME;
        const source = id || name;
        return {row,mode,source:material(mode,enterpriseId,date,source)};
      }
      if (isAirWork(common)) {
        const group = aggregateMaterial(common);
        const fileIndex = raw.inputFileIndex;
        if (!aggregateFiles.has(group)) aggregateFiles.set(group,new Set());
        aggregateFiles.get(group).add(fileIndex);
        const ordinal = (aggregateOrdinals.get(group)||0)+1;
        aggregateOrdinals.set(group,ordinal);
        if (ordinal>99999999) throw new Error("AirWork日別応募の件数上限を超えています。");
        return {row,mode:AGG_DAILY,source:group,ordinal};
      }
      return {row,mode:"UNIDENTIFIED",source:""};
    });
    aggregateFiles.forEach((fileIds)=>{
      if (fileIds.size>1) {
        throw new Error("同じ日・仕事番号のAirWork実績が複数CSVにあります。重複のないファイルに整理してください。");
      }
    });
    // Sign only unique messages; keep concurrency bounded for large CSVs.
    const materials = Array.from(new Set(entries.filter(e=>e.source).map(e=>e.source)));
    const signatures = new Map();
    for(let i=0;i<materials.length;i+=200) {
      const batch = materials.slice(i,i+200);
      const hashes = await Promise.all(batch.map(sign));
      batch.forEach((s,j)=>signatures.set(s,hashes[j]));
    }
    let unidentifiable = 0;
    for(const e of entries) {
      let key = "";
      if (e.mode === PERSON_ID || e.mode === PERSON_NAME) {
        key = "I1:" + signatures.get(e.source);
      } else if (e.mode === AGG_DAILY) {
        key = "G1:" + signatures.get(e.source) + ":" +
          String(e.ordinal).padStart(6,"0");
      } else {
        unidentifiable++;
      }
      Object.defineProperty(e.row,"__vaaIdentity",{
        value:{key,mode:e.mode},enumerable:false,configurable:true
      });
    }
    return {total:entries.length,unidentifiable,aggregateGroups:aggregateOrdinals.size};
  }
  return {assign,isAirWork,dateParts,material,aggregateMaterial};
})();
if (typeof module !== "undefined" && module.exports) module.exports=VAAClientIdentity;
