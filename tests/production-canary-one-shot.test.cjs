"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const page=fs.readFileSync(path.join(__dirname,"../qa/production-canary-one-shot.html"),"utf8");
const source=page.match(/<script>([\s\S]*?)<\/script>/)?.[1]||"";
const app=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const canaryId="VAA_READY_RETIRE_CANARY_CREATE_20261121_Q5A6M8N2";

function browser(){
 const elements={};let called=0,body=null,confirmCount=0;
 const storage=new Map();
 for(const id of ["request-id","access-key","check-deployed","check-mode","check-preflight","check-approval","confirm","send","status"]){
  elements[id]={value:"",checked:false,disabled:false,textContent:"",handler:null,
   addEventListener(ev,fn){assert.equal(ev,"click");this.handler=fn}};
 }
 const doc={getElementById:id=>elements[id]};
 const sandbox={document:doc,window:{confirm:()=>{confirmCount++;return true}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  fetch:async (url,options)=>{
   called++;body=JSON.parse(options.body);
   assert.equal(options.method,"POST");
   assert.equal(options.credentials,"omit");
   assert.match(url,/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/);
   return {ok:true,json:async()=>({ok:true,status:"READY",reused:false})};
  }
 };
 vm.runInNewContext(source,sandbox);
 return {elements,storage,send:async()=>elements.send.handler(),getCalled:()=>called,getPayload:()=>body,getConfirmCount:()=>confirmCount};
}

test("one-shot page has valid JavaScript and no auto POST",()=>{
 assert.ok(source.length>1000);
 new vm.Script(source);
 const b=browser();
 assert.equal(b.getCalled(),0);
 assert.match(page,/架空データ1件/);
 assert.doesNotMatch(source,/sessionStorage|document\.cookie|localStorage\.setItem\(.*(?:access|requestId)/i);
});
test("exact CREATE ID and explicit authorization required",async()=>{
 const b=browser();
 await b.send();assert.equal(b.getCalled(),0);
 b.elements["request-id"].value="some-id";
 b.elements["access-key"].value="SECRET";
 for(const id of ["check-deployed","check-mode","check-preflight","check-approval"])b.elements[id].checked=true;
 b.elements.confirm.value="ONE_CREATE_ONLY";
 await b.send();assert.equal(b.getCalled(),0);
 b.elements["request-id"].value=canaryId;
 b.elements["check-approval"].checked=false;
 await b.send();assert.equal(b.getCalled(),0);
});
test("one approved send uses canonical synthetic envelope, blocks second send",async()=>{
 const b=browser();
 b.elements["request-id"].value=canaryId;
 b.elements["access-key"].value="NON_LOGGED_TEST_KEY";
 for(const id of ["check-deployed","check-mode","check-preflight","check-approval"])b.elements[id].checked=true;
 b.elements.confirm.value="ONE_CREATE_ONLY";
 await b.send();
 assert.equal(b.getCalled(),1);
 assert.equal(b.elements.send.disabled,true);
 assert.equal(b.elements["access-key"].value,"");
 assert.equal(b.elements["request-id"].value,"");
 assert.equal(b.getPayload().requestId,canaryId);
 assert.equal(b.getPayload().datasets.applicationData.rows.length,1);
 assert.equal(b.getPayload().datasets.jobAnalysisMaster.rows.length,1);
 assert.equal(b.getPayload().datasets.applicationData.headers.length,22);
 assert.equal(b.getPayload().datasets.jobAnalysisMaster.headers.length,28);
 assert.equal(b.getPayload().schemaVersion,"3.0");
 assert.equal(b.getPayload().accessKey,"NON_LOGGED_TEST_KEY");
 assert.equal(b.getPayload().outputFolderId,"");
 assert.equal(b.getPayload().targetSpreadsheetId,undefined);
 assert.equal(b.getPayload().targetSpreadsheetUrl,undefined);
 assert.equal(b.storage.size,1);
 assert.ok([...b.storage.values()].every(v=>v==="1"));
 await b.send();assert.equal(b.getCalled(),1);
 assert.equal(b.getConfirmCount(),1);
 assert.doesNotMatch(b.elements.status.textContent,/NON_LOGGED_TEST_KEY|QA_REF_1|Q5A6M8N2/);
});
test("payload version and endpoint track canonical Pages source",()=>{
 const endpoint=app.match(/const SHEETS_API_URL = "([^"]+)"/)?.[1];
 assert.ok(endpoint);
 assert.ok(source.includes("const ENDPOINT=\""+endpoint+"\""));
 const appVersion=app.match(/const SHEETS_APP_VERSION = "([^"]+)"/)?.[1];
 const masterVersion=app.match(/const COMMON_MASTER_VERSION = "([^"]+)"/)?.[1];
 assert.ok(appVersion&&masterVersion);
 assert.ok(source.includes("appVersion:\""+appVersion+"\""));
 assert.ok(source.includes("commonMasterVersion:\""+masterVersion+"\""));
});
