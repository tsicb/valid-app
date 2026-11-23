"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const crypto=require("node:crypto");
const core=require("../central-api/append-merge-core.js");
const candidate=require("../experimental/append-limited-update-core.cjs");

const root=path.join(__dirname,"../central-api");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const sig=s=>crypto.createHmac("sha256","limited-gas-qa").update(s).digest("hex");
const p=v=>core.personIdentityKey(sig(core.personMaterial("PERSON_NAME","C01","2026/11/05",v)));
const A=["レコードID","企業ID","仕事番号","求人参照ID","求人データ突合フラグ","応募日時","対応状況","応募識別キー","応募識別方式"];
const J=["求人参照ID","企業ID","仕事番号","仕事名","給与金額MIN","求人分析情報ソース"];
const ds=(h,rows)=>({headers:h.slice(),rows:rows.map(r=>r.slice())});
const app=(who="山田",opts={})=>[
 opts.id||"APP000001","C01",opts.job||"J101",opts.ref===undefined?"JOB000001":opts.ref,
 opts.flag===undefined?1:opts.flag,opts.date||"2026/11/05 10:00:00",
 opts.status||"未対応",p(who),"PERSON_NAME"
];
const job=(opts={})=>[
 opts.ref||"JOB000001","C01",opts.job||"J101",
 opts.title||"倉庫",opts.salary||"1200",opts.source||"JOB_CSV"
];
const existing=(apps,jobs)=>({
 applicationIdentityVersion:"1",applicationData:ds(A,apps),
 jobAnalysisMaster:ds(J,jobs)
});
const newData=(apps,jobs)=>({
 applicationData:ds(A,apps),jobAnalysisMaster:ds(J,jobs),
 processInfo:ds(["項目","値"],[]),
 inputFiles:ds(["ファイル"],[]),
 imageMasterInitial:ds(["画像"],[])
});
const extras=(items,jobRows=[])=>({
 applicationData:ds(["応募識別キー","応募識別方式","企業ID","仕事番号",
  "応募日時","対応状況","求人参照ID","求人データ突合フラグ"],
  items.map(({who="山田",job="J101",status="面接確定",date="2026/11/05 10:00:00",ref="",flag=0})=>
   [p(who),"PERSON_NAME","C01",job,date,status,ref,flag]
  )),
 jobAnalysisMaster:ds(J,jobRows)
});
function payload(apps,jobs,supplemental) {
 const request={
   targetSpreadsheetId:"QA_ONLY", updateStrategy:"APPEND",updateProtocol:"IDENTITY_V1",
   datasets:newData(apps,jobs),requestId:"qa1"
 };
 if(supplemental) {
   request.limitedAppendProtocol="LIMITED_APPEND_V1";
   request.limitedAppendCandidates=supplemental;
 }
 return request;
}
function make(){
 const map=new Map(),files=new Map();
 let seq=0;
 const props={
   getProperty:key=>map.has(key)?map.get(key):null,
   setProperty:(key,value)=>map.set(key,value),
   deleteProperty:key=>map.delete(key)
 };
 const ctx={
   VAAAppendMergeCore:core,
   API_CONFIG:{MAX_DATASET_ROWS:100000,ANALYSIS_DATASTORE_VERSION:"1.0",PROCESS_LEASE_MS:390000},
   PropertiesService:{getScriptProperties:()=>props},
   normalizeString_:v=>v===undefined||v===null?"":String(v).trim(),
   invalid_:(code,message)=>({ok:false,code,message}),
   Utilities:{
     Charset:{UTF_8:"UTF-8"},DigestAlgorithm:{SHA_256:"sha256"},
     computeDigest:(_alg,text)=>Array.from(crypto.createHash("sha256").update(text).digest()).map(n=>n>127?n-256:n)
   },
   MimeType:{PLAIN_TEXT:"text/plain"},
   getOrCreateAnalysisDataStoreFolder_:()=>({createFile:(_name,text)=>{
     const id="FILE"+(++seq);
     const file={id,text,getId:()=>id,getBlob:()=>({getDataAsString:()=>text}),setTrashed:()=>{}};
     files.set(id,file);return file;
   }}),
   buildAnalysisDataStoreObject_:(ss,clean,requestId)=>({
     dataType:"VALID_APPLICATION_ANALYSIS_DATASTORE",
     spreadsheetId:ss.getId(),requestId,
     datasets:clean.datasets
   }),
   validateAnalysisDataStoreObject_:(obj,id,requestId)=>({
     ok:obj.spreadsheetId===id&&obj.requestId===requestId
   }),
   Number,Date,JSON,Map,Set
 };
 vm.createContext(ctx);
 for(const name of ["26_Limited_Append.gs","13_Append_Update_Guard.gs","12_Append_DataStore.gs"])
   vm.runInContext(read(name),ctx,{filename:name});
 return {
   f:name=>ctx[name],props,files,
   ss:{getId:()=>"QA_ONLY"}
 };
}
const json=r=>JSON.parse(JSON.stringify(r));

test("limited GAS source matches isolated Node candidate on status + embedded job upgrade",()=>{
 const h=make(),prev=existing([
   app("山田",{flag:0,status:"未対応"})
 ],[job({source:"APPLICATION_EMBEDDED",title:"元タイトル",salary:""})]);
 const upload=newData([app("山田",{ref:"JOB000099",status:"面接確定"})],
   [job({ref:"JOB000099",salary:"1350",title:"正式タイトル"})]);
 const spec={mode:"APPEND",incoming:upload,existing:prev};
 const actual=h.f("VAALimitedAppendMerge").mergeLimited(spec);
 const expected=candidate.mergeLimited(spec);
 assert.deepEqual(json(actual),json(expected));
 assert.equal(actual.stats.jobPromotedToCsv,1);
 assert.equal(actual.stats.statusUpdatedApplications,1);
});

test("legacy APPEND plan and legacy request digest unchanged without optional protocol",()=>{
 const h=make();
 const pld=payload([app("山田",{status:"面接確定"})],[job()]);
 const digest=h.f("vaaDigestUpdateRequest_")(pld);
 const legacyText=JSON.stringify([
   "APPEND","IDENTITY_V1","QA_ONLY",pld.datasets
 ]);
 assert.equal(digest,crypto.createHash("sha256").update(legacyText).digest("hex"));
 const prev=existing([app("山田",{status:"未対応"})],[job()]);
 const plan=h.f("vaaBuildAppendStorePlan_")(pld, {applicationIdentityVersion:"1",datasets:prev},"APPEND");
 assert.equal(plan.datasets.applicationData.rows[0][6],"未対応");
 assert.equal(plan.stats.statusUpdatedApplications,undefined);
 assert.equal(h.f("vaaValidateUpdateProtocol_")(pld).ok,true);
});

test("capabilities remain OFF until explicit ScriptProperty true",()=>{
 const h=make();
 assert.equal(h.f("vaaUpdateCapabilities_")().limitedAppend.enabled,false);
 h.props.setProperty("VAA_LIMITED_APPEND_ENABLED","false");
 assert.equal(h.f("vaaUpdateCapabilities_")().limitedAppend.enabled,false);
 h.props.setProperty("VAA_LIMITED_APPEND_ENABLED","true");
 assert.equal(h.f("vaaUpdateCapabilities_")().limitedAppend.enabled,true);
});

test("opt-in candidates are rejected when feature OFF, malformed, or using REPLACE",()=>{
 const h=make(),extra=extras([{who:"山田"}]);
 const pld=payload([app("山田")],[job()],extra);
 assert.equal(h.f("vaaValidateUpdateProtocol_")(pld).code,"LIMITED_APPEND_NOT_ENABLED");
 assert.throws(()=>h.f("vaaBuildAppendStorePlan_")(pld,{applicationIdentityVersion:"1",datasets:existing([app("山田")],[job()])},"APPEND"),
   {code:"LIMITED_APPEND_NOT_AUTHORIZED"});
 h.props.setProperty("VAA_LIMITED_APPEND_ENABLED","true");
 assert.equal(h.f("vaaValidateUpdateProtocol_")(pld).ok,true);
 pld.updateStrategy="REPLACE";
 assert.equal(h.f("vaaValidateUpdateProtocol_")(pld).code,"LIMITED_APPEND_PROTOCOL_INVALID");
 pld.updateStrategy="APPEND";pld.limitedAppendProtocol="WRONG";
 assert.equal(h.f("vaaValidateUpdateProtocol_")(pld).code,"LIMITED_APPEND_PROTOCOL_INVALID");
});

test("supplemental candidates and protocol change requestId digest, legacy stays stable",()=>{
 const h=make(),pld=payload([app("山田")],[job()],extras([{who:"山田"}]));
 const first=h.f("vaaDigestUpdateRequest_")(pld);
 const other=json(pld);other.limitedAppendCandidates.applicationData.rows[0][5]="辞退";
 const changed=h.f("vaaDigestUpdateRequest_")(other);
 const legacy=h.f("vaaDigestUpdateRequest_")(payload([app("山田")],[job()]));
 assert.notEqual(first,changed);
 assert.notEqual(first,legacy);
 assert.match(first,/^[0-9a-f]{64}$/);
 assert.equal(h.f("vaaValidateUpdateRequestRecord_")(
   {updateStrategy:"APPEND",updatePayloadDigest:first},"APPEND",changed).code,"REQUEST_PAYLOAD_MISMATCH");
});

test("opt-in plan uses sidecar once, but no sidecar can reach staged DataStore JSON",()=>{
 const h=make();
 h.props.setProperty("VAA_LIMITED_APPEND_ENABLED","true");
 const prev=existing([app("山田",{status:"未対応",ref:"",flag:0})],[]);
 const side=extras([{who:"山田",status:"面接確定",ref:"UC000001",flag:1}],
   [job({ref:"UC000001",salary:"1350"})]);
 const pld=payload([app("山田",{job:"J202",status:"未対応",ref:"",flag:0})],[],side);
 pld.datasets.applicationData.rows[0][5]="2026/11/18 10:00:00";
 const original=json(pld);
 const plan=h.f("vaaBuildAppendStorePlan_")(pld,
   {applicationIdentityVersion:"1",datasets:prev},"APPEND");
 assert.equal(plan.stats.statusUpdatedApplications,1);
 assert.equal(plan.stats.updatedFromSupplementalCandidates,1);
 assert.equal(plan.stats.jobAddedForExistingApplications,1);
 assert.equal(plan.stats.finalApplications,1);
 assert.equal(Object.hasOwn(plan.payload,"limitedAppendCandidates"),false);
 assert.equal(Object.hasOwn(plan.payload,"limitedAppendProtocol"),false);
 assert.deepEqual(json(pld),original);
 assert.equal(plan.payload.datasets.applicationData.rows[0][6],"面接確定");
 const stage=h.f("vaaStageAppendDataStore_")(h.ss,plan,"qa_save","");
 const written=h.files.get(stage.fileId).text;
 assert.ok(!written.includes("limitedAppendCandidates"));
 assert.ok(!written.includes("limitedAppendProtocol"));
 assert.ok(!written.includes("UC000001"));
 const data=JSON.parse(written);
 assert.equal(data.datasets.applicationData.rows.length,1);
 assert.equal(data.updateStats.updatedFromSupplementalCandidates,1);
});

test("staging fails closed if transient payload somehow bypasses stripping",()=>{
 const h=make(),prev=existing([app("山田")],[job()]);
 const pl=h.f("vaaBuildAppendStorePlan_")(payload([app("山田")],[job()]),
   {applicationIdentityVersion:"1",datasets:prev},"APPEND");
 pl.payload.limitedAppendCandidates=extras([{who:"山田"}]);
 assert.throws(()=>h.f("vaaStageAppendDataStore_")(h.ss,pl,"blocked",""),
   {code:"LIMITED_APPEND_PERSISTENCE_BLOCKED"});
 assert.equal(h.files.size,0);
});

test("GAS engine refuses candidate with alternate company or fake applicant ID",()=>{
 const h=make(),prev=existing([app("山田")],[job()]);
 const pld=payload([app("山田")],[job()],extras([{who:"山田"}]));
 pld.limitedAppendCandidates.applicationData.rows[0][2]="C02";
 assert.throws(()=>h.f("VAALimitedAppendMerge").mergeLimited({
   mode:"APPEND",existing:prev,incoming:pld.datasets,candidates:pld.limitedAppendCandidates
 }),{code:"INVALID_UPDATE_CANDIDATES"});
});

test("stats retain only counts, not applicant identifiers",()=>{
 const h=make();
 const s=h.f("vaaSummarizeUpdateStats_")({
   statusUpdatedApplications:3,
   jobPromotedToCsv:2,
   applicationsNewlyMatchedToJobCsv:4,
   updatedFromSupplementalCandidates:1,
   userName:"private",secret:"private"
 });
 assert.equal(s.statusUpdatedApplications,3);
 assert.equal(s.jobPromotedToCsv,2);
 assert.equal(s.userName,undefined);
 assert.ok(!JSON.stringify(s).includes("private"));
});
