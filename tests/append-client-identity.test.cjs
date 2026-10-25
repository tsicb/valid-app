"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const client=require("../append-identity-v1.js");
const core=require("../central-api/append-merge-core.js");
const secret="test-key-only-never-production";

function row({name="",id="",company="C01",date="2026/10/01",
  job="J001",media="Indeed",title="普通求人",status="応募",fileIndex=0}={}) {
  const r={"企業コード":company,"応募日時":date,"仕事番号":job,"応募媒体":media,
    "仕事名":title,"対応状況":status};
  Object.defineProperty(r,"__vaaIdentityRaw",{enumerable:false,configurable:true,
    value:{name,applicantId:id,inputFileIndex:fileIndex}});
  return r;
}
function personHmac(name,method="PERSON_NAME",c="C01",date="2026/10/01") {
  return "I1:"+crypto.createHmac("sha256",secret)
    .update(core.personMaterial(method,c,date,name)).digest("hex");
}
function aggHmac(r,n) {
  return "G1:"+crypto.createHmac("sha256",secret)
    .update(core.aggregateMaterial(r["企業コード"],r["仕事番号"],r["応募媒体"],r["応募日時"]))
    .digest("hex")+":"+String(n).padStart(6,"0");
}
function air(overrides={}) {
  return row({media:"AirWork",title:"AirWork（応募実績）",status:"AirWork（状況未取得）",
    job:"AIRWORK_ONLY",...overrides});
}
test("client PERSON_NAME HMAC matches canonical GAS merge signature format",async()=>{
  const a=row({name:" 山田　太郎 "});
  const b=row({name:"佐藤",date:"2026/10/04"});
  const s=await client.assign([a,b],secret,crypto.webcrypto);
  assert.equal(s.unidentifiable,0);
  assert.equal(a.__vaaIdentity.mode,"PERSON_NAME");
  assert.equal(a.__vaaIdentity.key,personHmac("山田 太郎"));
  assert.equal(b.__vaaIdentity.key,personHmac("佐藤","PERSON_NAME","C01","2026/10/04"));
});
test("person IDs take precedence over names and remain month-scoped",async()=>{
  const a=row({name:"別名",id:"person-17"});
  const b=row({name:"田中",id:"person-17",date:"2026/10/20"});
  await client.assign([a,b],secret,crypto.webcrypto);
  assert.equal(a.__vaaIdentity.key,personHmac("person-17","PERSON_ID"));
  assert.equal(b.__vaaIdentity.key,a.__vaaIdentity.key);
  assert.notEqual(a.__vaaIdentity.key,personHmac("別名"));
});
test("same-month person keys differ across companies, not jobs",async()=>{
  const a=row({name:"田中",company:"C01",job:"J001"});
  const b=row({name:"田中",company:"C01",job:"J002"});
  const c=row({name:"田中",company:"C02",job:"J002"});
  await client.assign([a,b,c],secret,crypto.webcrypto);
  assert.equal(a.__vaaIdentity.key,b.__vaaIdentity.key);
  assert.notEqual(a.__vaaIdentity.key,c.__vaaIdentity.key);
});
test("AirWork same-day daily rows receive stable 1..N snapshot keys",async()=>{
  const rows=Array.from({length:5},()=>air());
  const stats=await client.assign(rows,secret,crypto.webcrypto);
  assert.equal(stats.aggregateGroups,1);
  for(let i=0;i<5;i++) {
    assert.equal(rows[i].__vaaIdentity.mode,"AGG_DAILY");
    assert.equal(rows[i].__vaaIdentity.key,aggHmac(rows[i],i+1));
  }
  const repeat=Array.from({length:7},()=>air());
  await client.assign(repeat,secret,crypto.webcrypto);
  assert.equal(repeat[4].__vaaIdentity.key,rows[4].__vaaIdentity.key);
  assert.notEqual(repeat[6].__vaaIdentity.key,rows[4].__vaaIdentity.key);
});
test("AirWork cross-file overlapping same day is rejected instead of double-counted",async()=>{
  await assert.rejects(
    ()=>client.assign([air({fileIndex:0}),air({fileIndex:1})],secret,crypto.webcrypto),
    /複数CSV/
  );
});
test("unidentified rows do not receive fingerprint, not falsely aggregate",async()=>{
  const r=row();
  const s=await client.assign([r],secret,crypto.webcrypto);
  assert.equal(r.__vaaIdentity.mode,"UNIDENTIFIED");
  assert.equal(r.__vaaIdentity.key,"");
  assert.equal(s.unidentifiable,1);
});
test("different AirWork day and job must not share same group",async()=>{
  const a=air(), b=air({date:"2026/10/02"}), c=air({job:"J002"});
  await client.assign([a,b,c],secret,crypto.webcrypto);
  assert.equal(new Set([a.__vaaIdentity.key,b.__vaaIdentity.key,c.__vaaIdentity.key]).size,3);
});
test("raw name and original applicantId are not included in enumerable model attributes",async()=>{
  const a=row({name:"山田太郎",id:"confidential-person-id"});
  await client.assign([a],secret,crypto.webcrypto);
  const serialized=JSON.stringify(a);
  assert.ok(!serialized.includes("山田太郎"));
  assert.ok(!serialized.includes("confidential-person-id"));
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes("応募識別キー")); // dataset maps only the opaque metadata
  assert.equal(typeof a.__vaaIdentity.key,"string");
});
test("invalid dates and missing enterprise ID block person hashing rather than inventing identity",async()=>{
  await assert.rejects(()=>client.assign([row({name:"佐藤",date:"2026/02/30"})],secret,crypto.webcrypto),/存在しない/);
  await assert.rejects(()=>client.assign([row({name:"佐藤",company:""})],secret,crypto.webcrypto),/企業ID/);
});
test("HTML includes mode selector/confirmation and original share modal remains separate",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  for(const id of ["vaaUpdateModeSection","vaaUpdateConfirmModal","vaaUpdateConfirmAck",
    "vaaUpdateConfirmAccept","shareConfirmModal","runBtn"]) {
    assert.equal((html.match(new RegExp('id="'+id+'"',"g"))||[]).length,1,id);
  }
  assert.match(html,/append-identity-v1\.js/);
  assert.match(html,/vaaApplyApplicationIdentities\(accessKey\)/);
  assert.match(html,/globalLastUpdateStrategy === "APPEND"/);
  assert.match(html,/capability\?\.updateProtocol === "IDENTITY_V1"/);
  assert.match(html,/await vaaAwaitUpdateConfirmation/);
});
test("CREATE passes versioned identity and input names are hidden from payload",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
  assert.match(html,/updateProtocol: "IDENTITY_V1"/);
  assert.match(html,/"応募識別キー": row\.__vaaIdentity\?\.key \|\| ""/);
  assert.match(html,/"応募識別方式": row\.__vaaIdentity\?\.mode \|\| "UNIDENTIFIED"/);
  assert.match(html,/Object\.defineProperty\(newRow, "__vaaIdentityRaw"/);
  assert.match(html,/enumerable: false/);
});
