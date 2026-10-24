"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const begin=html.indexOf("async function postSheetsPayloadUntilReady(");
const end=html.indexOf("function normalizeCompanyDisplayNameForUi(",begin);
if(begin<0 || end<begin)throw Error("Cannot locate Pages retry helper");
const script=html.slice(begin,end);

function fake(responseSequence,opts={}){
  let rounds=0, sleepCount=0;
  const received=[];
  const logs=[];
  let time=0;
  const responses=responseSequence.slice();
  const sandbox={
    performance:{now:()=>time++},
    SHEETS_MAX_AUTO_RESUME_ROUNDS:opts.maxRounds||5,
    SHEETS_MAX_AUTO_RESUME_MS:999999,
    postSheetsPayload:async()=>{
      rounds++;
      if(!responses.length)throw Error("Unexpected extra request");
      return {httpOk:true,status:200,data:responses.shift()};
    },
    prepareSheetsTransport:async()=>({mode:"PLAIN_JSON"}),
    sleepMs:async()=>{sleepCount++;},
    normalizeString:v=>v===null || v===undefined?"":String(v).trim(),
    sheetsStageLabel:v=>v?.stage||"PROCESSING",
    mapSheetsApiError:v=>v?.message||"error",
    console:{warn:(...args)=>logs.push(args)}
  };
  vm.createContext(sandbox);
  vm.runInContext(script,sandbox,{filename:"index-ready-response.js"});
  const call=()=>sandbox.postSheetsPayloadUntilReady(
    "http://localhost:8765/__test_api__",
    {requestId:"req-one"},
    v=>received.push(v),
    {mode:"PLAIN_JSON"}
  );
  return {call,get rounds(){return rounds;},
    get sleepCount(){return sleepCount;},received,logs};
}
test("READY with spreadsheet ID but missing URL is recoverable without another request",async()=>{
  const x=fake([{ok:true,status:"READY",stage:"READY",
    spreadsheetId:"TEST_SPREADSHEET_123",requestId:"req-one"}]);
  const out=await x.call();
  assert.equal(out.spreadsheetUrl,"https://docs.google.com/spreadsheets/d/TEST_SPREADSHEET_123/edit");
  assert.equal(x.rounds,1);
});
test("incomplete ok response must retry SAME requestId until READY contains a URL",async()=>{
  const x=fake([
    {ok:true,status:"PROCESSING",stage:"DATA_WRITTEN"},
    {ok:true,status:"READY",stage:"READY",spreadsheetUrl:"https://docs.google.com/spreadsheets/d/TEST_1/edit"}
  ]);
  const out=await x.call();
  assert.equal(out.status,"READY");
  assert.equal(x.rounds,2);
  assert.equal(x.sleepCount,1);
  assert.equal(x.logs.length,1);
});
test("pending response still resumes under original requestId",async()=>{
  const x=fake([
    {ok:true,pending:true,status:"PROCESSING",stage:"OPENED",retryAfterMs:1000},
    {ok:true,pending:false,status:"READY",spreadsheetUrl:"https://docs.google.com/spreadsheets/d/TEST_1/edit"}
  ]);
  await x.call();
  assert.equal(x.rounds,2);
  assert.equal(x.sleepCount,1);
});
test("no spreadsheet ID/URL never reports false success and hits safe retry limit",async()=>{
  const x=fake(Array.from({length:4},()=>({ok:true,status:"READY",stage:"READY"})),{maxRounds:3});
  await assert.rejects(x.call(),{code:"AUTO_RESUME_LIMIT"});
  assert.equal(x.rounds,3);
  assert.equal(x.sleepCount,3);
  assert.equal(x.logs.length,3);
});
test("server-side errors are still propagated rather than retried as success",async()=>{
  const x=fake([{ok:false,code:"AUTH_INVALID",message:"Invalid"}]);
  await assert.rejects(x.call(),{code:"AUTH_INVALID"});
  assert.equal(x.rounds,1);
});
