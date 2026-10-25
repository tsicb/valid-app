"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const core=require("../central-api/append-merge-core.js");

const A=["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ",
  "応募日時","応募識別キー","応募識別方式"];
const J=["求人参照ID","企業ID","仕事番号","仕事名"];
const key=value=>"I1:"+crypto.createHmac("sha256","legacy-test-only")
  .update(core.personMaterial("PERSON_NAME","DEMO001","2026/10/01",value))
  .digest("hex");
const row=(id,name)=>[id,"DEMO001","DEMO_JOB","JOB000001",1,"2026/10/01",key(name),"PERSON_NAME"];
const jobs={headers:J,rows:[["JOB000001","DEMO001","DEMO_JOB","旧掲載求人"]]};

test("real legacy-shaped DataStore requires REPLACE and preserves old values before migration",()=>{
  // Older CREATE did not store identity columns or identity-version marker.
  const keptIndices=A.map((h,i)=>["応募識別キー","応募識別方式"].includes(h)?-1:i).filter(i=>i>=0);
  const oldRows=[row("APP000001","架空甲"),row("APP000002","架空乙")];
  const legacy={
    applicationIdentityVersion:undefined,
    applicationData:{
      headers:keptIndices.map(i=>A[i]),
      rows:oldRows.map(a=>keptIndices.map(i=>a[i]))
    },
    jobAnalysisMaster:jobs
  };
  const before=structuredClone(legacy);
  const incoming={
    applicationData:{headers:A,rows:[row("APP000001","架空甲"),row("APP000002","架空乙")]},
    jobAnalysisMaster:structuredClone(jobs)
  };
  assert.throws(()=>core.merge({mode:"APPEND",existing:legacy,incoming}),{code:"MIGRATION_REQUIRED"});
  assert.deepEqual(legacy,before,"failed APPEND must not mutate legacy DataStore");
  // A deliberate REPLACE installs version 1 without trying to derive
  // identities from the legacy rows.
  const replacement=core.merge({mode:"REPLACE",existing:legacy,incoming});
  assert.equal(replacement.applicationIdentityVersion,"1");
  assert.equal(replacement.stats.finalApplications,2);
  assert.equal(replacement.stats.finalJobs,1);
  // After the migration, APPEND is safe and idempotent again.
  const migrated={
    applicationIdentityVersion:replacement.applicationIdentityVersion,
    applicationData:replacement.applicationData,
    jobAnalysisMaster:replacement.jobAnalysisMaster
  };
  const next={
    applicationData:{headers:A,rows:[row("APP000001","架空甲"),row("APP000003","架空丙")]},
    jobAnalysisMaster:structuredClone(jobs)
  };
  const appended=core.merge({mode:"APPEND",existing:migrated,incoming:next});
  assert.equal(appended.stats.skippedAsExisting,1);
  assert.equal(appended.stats.addedApplications,1);
  assert.equal(appended.stats.finalApplications,3);
  assert.equal(appended.stats.finalJobs,1);
  assert.equal(appended.jobAnalysisMaster.rows[0][3],"旧掲載求人");
});
test("legacy CREATE without protocol is allowed by current DataStore writer but UPDATE still requires V1",()=>{
  const fs=require("node:fs");
  const path=require("node:path");
  const source=fs.readFileSync(path.join(__dirname,"../central-api/01_DataStore_Performance.gs"),"utf8");
  assert.match(source,/if \(normalizeString_\(payload\.updateProtocol\) === 'IDENTITY_V1'\)/);
  const guard=fs.readFileSync(path.join(__dirname,"../central-api/13_Append_Update_Guard.gs"),"utf8");
  assert.match(guard,/UPDATE_PROTOCOL_REQUIRED/);
  assert.match(guard,/APPLICATION_IDENTITY_REQUIRED/);
});
