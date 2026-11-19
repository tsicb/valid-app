"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const source=read("qa/Ledger_V2_E2E_Create_Fresh_Id_QA.gs");
const NEW="QA_JOURNAL_E2E_CREATE_20261119_V2";
const OLD="QA_JOURNAL_E2E_CREATE_20261119_V1";
const ROOT="QA_TEST_ROOT";
const OUTPUT="QA_TEST_OUTPUT";
const TARGET="QA_TEST_NEW_BOOK";
const OLD_TARGET="QA_TEST_OLD_PARTIAL_BOOK";
const V1_ID="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const historical=["G4","G5APP","G5REP","G6D"];
const clone=v=>JSON.parse(JSON.stringify(v));
function make(opts={}){
 const map={
   VAA_JOURNAL_DOP_MODE:opts.armed?
     "TEST_ONE_SYNTHETIC_REQUEST_V1":"OFF",
   VAA_REQUEST_JOURNAL_MODE:opts.armed?
     "TEST_RESERVATION_V1":"OFF",
   VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID:opts.badAllowlist?
     "OTHER":NEW,
   VAA_JOURNAL_TEST_ROOT_ID:ROOT,
   VAA_JOURNAL_TEST_OUTPUT_ID:OUTPUT
 };
 historical.forEach(id=>map["REQ_"+id]=JSON.stringify({
   requestId:id,status:"READY",stage:"READY",spreadsheetId:"ORIGINAL_"+id
 }));
 const oldReceipt={
   requestId:OLD,operationMode:"CREATE",status:"ERROR",
   stage:"CREATED",spreadsheetId:OLD_TARGET
 };
 map["REQ_"+OLD]=JSON.stringify(oldReceipt);
 if(opts.oldGone)delete map["REQ_"+OLD];
 if(opts.newUsed)map["REQ_"+NEW]="ALREADY_STARTED";
 if(opts.oldReady)map["REQ_"+OLD]=JSON.stringify({...oldReceipt,status:"READY"});
 if(opts.badHistory)delete map.REQ_G5REP;
 const journal={
   [OLD]:opts.oldReservationGone?{state:"ABSENT"}:
     {state:"RESERVED",revision:1,latest:{digest:"old",body:{phase:"RESERVED"}}},
   [NEW]:{state:"ABSENT"}
 };
 const flags={posts:0,propertiesWritten:0,propertiesDeleted:0,logs:[]};
 const props={
   getProperty:k=>map[k]??null,
   getProperties:()=>({...map}),
   setProperty(){flags.propertiesWritten++;throw Error("NO_PROPERTY_WRITE");},
   deleteProperty(){flags.propertiesDeleted++;throw Error("NO_PROPERTY_DELETE");}
 };
 const readySheet={getSheetName:()=>"receipts"};
 const journalSheet={getLastRow:()=>opts.extraEvent?3:journal[NEW].state==="ABSENT"?2:4};
 const book={getId:()=>TARGET};
 const scope={
   VAA_QA_G4_CONFIG_:{testRootId:ROOT,testOutputId:OUTPUT,requestId:historical[0]},
   VAA_QA_G5_APPEND_REQUEST_ID_:historical[1],
   VAA_QA_G5_REPLACE_REQUEST_ID_:historical[2],
   VAA_QA_G6C_CONFIG_:{createRequestId:historical[3]},
   VAA_QA_LEDGER_E2E_CREATE_:{requestId:OLD},
   VAA_QA_LEDGER_READY_SYNTHETIC_ID_:V1_ID,
   VAA_JOURNAL_DOP_MODE_PROP_:"VAA_JOURNAL_DOP_MODE",
   VAA_JOURNAL_DOP_TEST_MODE_:"TEST_ONE_SYNTHETIC_REQUEST_V1",
   VAA_JOURNAL_DOP_ID_PROP_:"VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID",
   VAA_LEDGER_JOURNAL_MODE_PROP_:"VAA_REQUEST_JOURNAL_MODE",
   VAA_LEDGER_JOURNAL_TEST_MODE_:"TEST_RESERVATION_V1",
   VAA_LEDGER_JOURNAL_TEST_ROOT_PROP_:"VAA_JOURNAL_TEST_ROOT_ID",
   VAA_LEDGER_JOURNAL_TEST_OUTPUT_PROP_:"VAA_JOURNAL_TEST_OUTPUT_ID",
   VAA_LEDGER_REPLAY_MODE_PROPERTY_:"VAA_REQUEST_LEDGER_REPLAY_MODE",
   API_CONFIG:{MAX_DATASET_ROWS:100000},
   PropertiesService:{getScriptProperties:()=>props},
   vaaQaG4IsolatedConfig_:()=>props,
   vaaQaG4SyntheticPayload_:()=>({
     action:"create",requestId:"G4",companyDisplayName:"G4_OLD",
     datasets:{
       applicationData:{headers:["x"],rows:[["a"]]},
       jobAnalysisMaster:{headers:["y"],rows:[["b"]]}
     }
   }),
   getRequestPropertyKey_:id=>"REQ_"+id,
   vaaQaLedgerE2EHistorySnapshot_:p=>
     historical.map(id=>p.getProperty("REQ_"+id)||""),
   vaaQaLedgerE2EHistoryValid_:s=>s.length===4 &&
     s.every(Boolean),
   vaaQaLedgerE2EHistoryEqual_:(a,b)=>
     JSON.stringify(a)===JSON.stringify(b),
   vaaQaLedgerReadyPropsEqual_:(a,b)=>
     JSON.stringify(a)===JSON.stringify(b),
   validateEnvelope_:()=>({ok:!opts.badPayload}),
   vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:!opts.capacityDenied}),
   vaaQaLedgerReadyCheckPrivateTestLedger_:()=>readySheet,
   vaaLedgerJournalOpenReadOnly_:()=>({readySheet,sheet:journalSheet}),
   vaaLedgerJournalLookupFromSheet_:(s,id)=>clone(journal[id]||{state:"ABSENT"}),
   vaaLedgerReadyLookupFromSheet_:(s,id)=>
     id===V1_ID?{state:opts.v1Missing?"NOT_FOUND":"FOUND"}:
     {state:"NOT_FOUND"},
   vaaLedgerDopScopeCode_:(p,id,mode)=>
     mode==="CREATE" &&
     id===NEW &&
     p.getProperty("VAA_JOURNAL_DOP_SYNTHETIC_REQUEST_ID")===NEW &&
     !opts.badScope ? "" : "JOURNAL_DOP_TEST_SCOPE_DENIED",
   validateUpdateTargetDriveFile_:(id,folder)=>{
     if(folder!==OUTPUT || (id!==TARGET && id!==OLD_TARGET) ||
        opts.badTarget)throw Error("INVALID_TARGET");
   },
   vaaQaG4Invoke_:(payload)=>{
     flags.posts++;
     assert.equal(payload.requestId,NEW);
     if(opts.fails)throw Error("SIMULATED_SHEETS_DISCONNECT");
     if(opts.errorResponse)return {ok:false,code:"INTERNAL_ERROR"};
     const rec={
       requestId:NEW,operationMode:"CREATE",
       status:"READY",stage:"READY",spreadsheetId:TARGET
     };
     map["REQ_"+NEW]=JSON.stringify(rec);
     journal[NEW]={state:"READY",revision:2,latest:{
       digest:"new",body:{phase:"READY",receipt:clone(rec)}
     }};
     return {ok:true,status:"READY",reused:false,spreadsheetId:TARGET};
   },
   SpreadsheetApp:{openById:id=>{
     if(id!==TARGET)throw Error("WRONG_BOOK");
     return book;
   }},
   vaaQaG5ReadTestDataStore_:()=>({
     applicationData:{headers:["x"],rows:[["a"]]},
     jobAnalysisMaster:{headers:["y"],rows:[["b"]]}
   }),
   VAAAppendMergeCore:{merge:({incoming})=>clone(incoming)},
   console:{log:line=>flags.logs.push(line)},
   Date
 };
 const ctx=vm.createContext(scope);
 vm.runInContext(source,ctx);
 return {scope,props:map,run:name=>scope[name](),flags,journal};
}
test("new one-shot QA is syntactically valid and cannot mutate legacy state directly",()=>{
 new vm.Script(source);
 assert.doesNotMatch(source,/\.deleteProperty\s*\(|\.setTrashed\s*\(|\.createFile\s*\(|\.setProperty\s*\(/);
 assert.match(source,/vaaQaG4Invoke_\s*\(/);
 assert.match(source,/retryAuthorized:false/);
});

test("OFF preflight accepts one old RESERVED and a different unused V2 ID",()=>{
 const h=make();
 const r=h.run("vaaQaLedgerV2RetestPreflightReadOnly");
 assert.equal(r.pass,true);
 assert.equal(r.modesOff,true);
 assert.equal(r.oldFailedReservationPreserved,true);
 assert.equal(r.oldErrorReceiptPreserved,true);
 assert.equal(r.journalHasOldReservationOnly,true);
 assert.equal(r.newJournalIdAbsent,true);
 assert.equal(r.scriptPropertiesUnchanged,true);
 assert.equal(h.flags.posts,0);
 assert.equal(h.flags.propertiesWritten,0);
});

test("OFF preflight refuses creating when old failed record is missing, wrong, or journal damaged",()=>{
 for(const o of [
   {oldGone:true},{oldReady:true},{oldReservationGone:true},
   {extraEvent:true},{newUsed:true},{badHistory:true},
   {badPayload:true},{capacityDenied:true},{badTarget:true},
   {v1Missing:true},{badScope:true}
 ]){
   const h=make(o);
   const r=h.run("vaaQaLedgerV2RetestPreflightReadOnly");
   assert.equal(r.pass,false,JSON.stringify(o));
   assert.equal(h.flags.posts,0);
 }
});

test("armed preflight requires exact allowlist and all V2 TEST flags",()=>{
 const h=make({armed:true});
 assert.equal(h.run("vaaQaLedgerV2RetestPreflightReadOnly").pass,false);
 assert.equal(h.run("vaaQaLedgerV2RetestArmedPreflightReadOnly").pass,true);
 const x=make({armed:true,badAllowlist:true});
 assert.equal(x.run("vaaQaLedgerV2RetestArmedPreflightReadOnly").pass,false);
});

test("once-only fresh synthetic CREATE writes new V2, keeps failed V1 untouched",()=>{
 const h=make({armed:true});
 const oldRaw=h.props["REQ_"+OLD];
 const base=historical.map(id=>h.props["REQ_"+id]);
 const a=h.run("vaaQaLedgerV2RetestCreateOnce");
 assert.equal(a.pass,true);
 assert.equal(a.newJournalReady,true);
 assert.equal(a.journalRevision,2);
 assert.equal(h.flags.posts,1);
 assert.equal(h.props["REQ_"+OLD],oldRaw);
 assert.deepEqual(historical.map(id=>h.props["REQ_"+id]),base);
 assert.equal(h.run("vaaQaLedgerV2RetestInspectReadOnly").pass,true);
 assert.doesNotMatch(h.flags.logs.join("\n"),/QA_SECRET|QA_TEST_NEW_BOOK|https:\/\//);
});

test("second CREATE is refused by preflight, not POST-ed",()=>{
 const h=make({armed:true});
 h.run("vaaQaLedgerV2RetestCreateOnce");
 assert.throws(()=>h.run("vaaQaLedgerV2RetestCreateOnce"),
   /QA_V2_RETEST_NOT_ARMED_OR_NOT_SAFE/);
 assert.equal(h.flags.posts,1);
});

test("interrupted POST is never automatically retried; inspect shows non-ready",()=>{
 const h=make({armed:true,fails:true});
 assert.throws(()=>h.run("vaaQaLedgerV2RetestCreateOnce"),
   /SIMULATED_SHEETS_DISCONNECT/);
 assert.equal(h.flags.posts,1);
 assert.equal(h.run("vaaQaLedgerV2RetestInspectReadOnly").pass,false);
 assert.equal(h.flags.posts,1);
});

test("failure response cannot be mistaken for READY success",()=>{
 const h=make({armed:true,errorResponse:true});
 const a=h.run("vaaQaLedgerV2RetestCreateOnce");
 assert.equal(a.pass,false);
 assert.equal(a.responseOk,false);
 assert.equal(h.flags.posts,1);
});

test("inspection before running CREATE is read-only and no new journal event",()=>{
 const h=make();
 const a=h.run("vaaQaLedgerV2RetestInspectReadOnly");
 assert.equal(a.pass,false);
 assert.equal(a.newJournalState,"ABSENT");
 assert.equal(a.oldReservationPreserved,true);
 assert.equal(h.flags.posts,0);
 assert.equal(h.flags.propertiesDeleted,0);
});
