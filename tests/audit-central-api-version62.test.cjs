"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {classify,inspect,summary}=require("../scripts/audit-central-api-version62.cjs");
const gate="function vaaLedgerProdModeStatus_(){}\nfunction vaaLedgerProdDecideUnderLock_(){}\n";
const entry="function doPost(){vaaLedgerProdDecideUnderLock_();}\n";
const canary=gate+"const mode='CANARY_ONE_NEW_READY_V1';\nfunction vaaLedgerProdRetireCanary_(){}\nfunction vaaLedgerProdRetireCanaryPreflightReadOnly(){}\n";
test("legacy V2 production gate cannot use later canary mode",()=>{
 const r=classify({file24:gate,file02:entry});
 assert.equal(r.status,"BEFORE_EXACT_CANARY_SOURCE");
 assert.equal(r.gate,true);assert.equal(r.invoked,true);assert.equal(r.canary,false);
});
test("recognizes exact canary only when full source is present",()=>{
 const r=classify({file24:canary,file02:entry});
 assert.equal(r.status,"HAS_EXACT_CANARY_SOURCE");assert.equal(r.canary,true);
});
test("incomplete canary token never counts as supported",()=>{
 const r=classify({file24:gate+"// CANARY_ONE_NEW_READY_V1",file02:entry});
 assert.equal(r.canary,false);
});
test("unknown V2 wiring is flagged as review required",()=>{
 for(const opt of [{file24:null,file02:entry},{file24:gate,file02:"doPost(){}"},
   {file24:"const mode='CANARY_ONE_NEW_READY_V1'",file02:entry}]){
  assert.equal(classify(opt).status,"SOURCE_SCOPE_REVIEW_REQUIRED");
 }
});
function withFiles(git,remote,check){
 const p=fs.mkdtempSync(path.join(os.tmpdir(),"vaa-v62-"));
 const g=path.join(p,"git"),r=path.join(p,"v62");
 fs.mkdirSync(g);fs.mkdirSync(r);
 try{
  for(const [n,c] of Object.entries(git))fs.writeFileSync(path.join(g,n),c);
  for(const [n,c] of Object.entries(remote))fs.writeFileSync(path.join(r,n),c);
  check(inspect(g,r));
 }finally{fs.rmSync(p,{recursive:true,force:true});}
}
test("post version pull classifies old version without source leakage",()=>{
 withFiles({"24_Request_Ledger_V2_Production_Gate.gs":canary,"02_EntryPoint.gs":entry},
  {"24_Request_Ledger_V2_Production_Gate.js":gate,"02_EntryPoint.js":entry.replace(/\n/g,"\r\n")},x=>{
   assert.equal(x.status,"BEFORE_EXACT_CANARY_SOURCE");
   assert.equal(x.changed,1);assert.equal(x.exact,false);
  });
});
test("normalized newline only is exact source",()=>{
 withFiles({"24_Request_Ledger_V2_Production_Gate.gs":gate},
  {"24_Request_Ledger_V2_Production_Gate.js":gate.replace(/\n/g,"\r\n")},x=>{
   assert.equal(x.exact,true);
  });
});
test("report only exposes capability metadata, never source",()=>{
 const marker="SECRET_SYNTHETIC_SOURCE_123";
 withFiles({"24_Request_Ledger_V2_Production_Gate.gs":gate+marker},
  {"24_Request_Ledger_V2_Production_Gate.gs":gate+"changed "+marker},x=>{
   const report=summary(x);
   assert.equal(report.includes(marker),false);
   assert.equal(report.includes("function vaaLedgerProd"),false);
   assert.match(report,/read only/);
  });
});
test("unrelated extra file is counted but never printed",()=>{
 withFiles({"02_EntryPoint.gs":entry},
  {"02_EntryPoint.gs":entry,"PRIVATE_NAME.gs":"secret"},x=>{
   assert.equal(x.extra,1);assert.equal(x.exact,false);
   assert.equal(summary(x).includes("PRIVATE_NAME"),false);
  });
});
