"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,
  "../central-api/24_Request_Ledger_V2_Production_Gate.gs"),"utf8");
const ID="SYNTHETIC_NEW_V2_READY_001";
const TARGET="SYNTHETIC_OUTPUT_FILE_ID_TEST";
const ROOT="SYNTHETIC_PRIVATE_ROOT";
const OUTPUT="SYNTHETIC_MANAGED_OUTPUT";
const LEDGER="V".repeat(42);
const SECRET="SOURCE_RECEIPT_SECRET_NEVER_EXPOSE";
function fixture(opts={}){
  const kind=opts.kind||"UPDATE";
  const rec={
    requestId:ID,operationMode:kind,status:"READY",stage:"READY",
    spreadsheetId:TARGET,secret:SECRET,
    ...(kind==="UPDATE"?{
      targetSpreadsheetId:TARGET,
      updateStrategy:"APPEND",
      updatePayloadDigest:"SYNTHETIC_DIGEST"
    }:{})
  };
  const raw=JSON.stringify(rec);
  const identity={
    requestId:ID,operationMode:kind,
    targetSpreadsheetId:kind==="UPDATE"?TARGET:"",
    updateStrategy:kind==="UPDATE"?"APPEND":"",
    updatePayloadDigest:kind==="UPDATE"?"SYNTHETIC_DIGEST":""
  };
  const data={
    VAA_JOURNAL_DOP_MODE:opts.off?"OFF":"PROD_V2_GATED",
    VAA_REQUEST_JOURNAL_MODE:"PROD_RESERVATION_V2",
    VAA_PROD_LEDGER_FENCE:"ACTIVE_V1",
    VAA_PROD_LEDGER_ROOT_ID:ROOT,
    VAA_PROD_LEDGER_OUTPUT_ID:OUTPUT,
    VAA_PROD_READY_RETIRE_MODE:opts.armed?
      "RETIRE_VERIFIED_NEW_READY_V1":"OFF",
    VAA_PROD_LEGACY_MIGRATION_MODE:opts.legacyOn?
      "COPY_DUAL_ARCHIVE_READY_V1":"OFF",
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER
  };
  if(!opts.alreadyRetired)data["REQ_"+ID]=opts.mismatch?
    JSON.stringify({...rec,secret:"CORRUPTED"}):raw;
  let propertyReads=0;
  const effects={propertyWrites:0,archiveWrites:0,logs:[],lookups:0};
  const props={
    getProperty:k=>data[k]||null,
    getProperties:()=>{
      propertyReads++;
      return opts.drift&&propertyReads===2?
        {...data,EXTRA:"CONCURRENT_EDIT"}:{...data};
    },
    setProperty:()=>{effects.propertyWrites++;throw Error("FORBIDDEN");},
    deleteProperty:()=>{effects.propertyWrites++;throw Error("FORBIDDEN");}
  };
  const oneHash="HASHED_ID_ONLY";
  const reserved=[oneHash,1,"RESERVED",JSON.stringify({
    ...identity,phase:"RESERVED",receipt:null
  }),"digest1","",new Date().toISOString(),"V2"];
  const done=[oneHash,2,"READY",JSON.stringify({
    ...identity,phase:"READY",receipt:rec
  }),"digest2","digest1",new Date().toISOString(),"V2"];
  const rows=opts.pendingOnly?[reserved]:[reserved,done];
  if(opts.duplicate)rows.push(done);
  if(opts.bogusPhase)rows[rows.length-1][2]="UNKNOWN";
  const tab={
    getLastRow:()=>opts.tooLarge?1002:rows.length+1,
    getRange:(_,__,___,____)=>({
      getValues:()=>opts.emptyJournal?[]:rows
    }),
    appendRow:()=>{effects.archiveWrites++;throw Error("FORBIDDEN")}
  };
  if(opts.emptyJournal)tab.getLastRow=()=>1;
  const file={
    getMimeType:()=>opts.badMime?"OTHER":"GOOGLE_SHEETS",
    getSharingAccess:()=>"PRIVATE",
    isTrashed:()=>false,
    getParents:()=>({n:0,
      hasNext(){return this.n++<1},
      next(){return {getId:()=>ROOT}}
    })
  };
  const api={
    API_CONFIG:{ROOT_FOLDER_ID:ROOT,SHEET_OUTPUT_FOLDER_ID:OUTPUT},
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    DriveApp:{Access:{PRIVATE:"PRIVATE"},getFileById:()=>file},
    VAA_JOURNAL_DOP_MODE_PROP_:"VAA_JOURNAL_DOP_MODE",
    VAA_LEDGER_JOURNAL_MODE_PROP_:"VAA_REQUEST_JOURNAL_MODE",
    VAA_LEDGER_READY_PROPERTY_:"VAA_REQUEST_LEDGER_SPREADSHEET_ID",
    PropertiesService:{getScriptProperties:()=>props},
    console:{log:x=>effects.logs.push(String(x))},
    vaaLedgerJournalError_:code=>Object.assign(new Error("REDACTED"),{code}),
    vaaLedgerJournalOpenReadOnly_:()=>({
      readySheet:{},sheet:tab
    }),
    vaaLedgerReadyRequestId_:id=>{
      if(typeof id!=="string"||!id)throw Error("BAD_ID");
      return id;
    },
    vaaLedgerJournalLookupFromSheet_:(_,id)=>{
      effects.lookups++;
      assert.equal(id,ID);
      if(opts.badJournal)throw Error(SECRET);
      if(opts.pendingOnly)return {state:"RESERVED",revision:1};
      return {state:"READY",revision:2,
        latest:{body:{receipt:rec}}};
    },
    vaaLedgerReadyValidateRaw_:(id,text)=>{
      const v=JSON.parse(text);
      if(v.requestId!==id||v.status!=="READY"||
         v.stage!=="READY")throw Error(SECRET);
      return v;
    },
    vaaLedgerReadyLookupFromSheet_:()=>opts.v1Collision?
      {state:"FOUND",raw}:{state:"NOT_FOUND"},
    getRequestPropertyKey_:id=>"REQ_"+id,
    isLeaseActive_:()=>!!opts.activeLease,
    vaaTargetUpdateLeaseKey_:id=>"UPDATE_LEASE_"+id,
    vaaLedgerDopReceiptMatches_:()=>!opts.badTarget
  };
  const ctx=vm.createContext(api);vm.runInContext(source,ctx);
  return {
    run:()=>ctx.vaaLedgerProdReadyRetirePreflightReadOnly(),
    effects,data,props
  };
}

test("read-only preflight verifies V2 READY chain and preserved REQ without writes",()=>{
  for(const kind of ["CREATE","UPDATE"]){
    const f=fixture({kind});
    const before=JSON.stringify(f.data);
    const r=f.run();
    assert.equal(r.pass,true,JSON.stringify(r));
    assert.equal(r.journalEvents,2);
    assert.equal(r.journalReady,1);
    assert.equal(r.journalPending,0);
    assert.equal(r.modernReadyWithReq,1);
    assert.equal(r.eligibleForFutureRetirement,1);
    assert.equal(r.sourceStable,true);
    assert.equal(r.activationAuthorized,false);
    assert.equal(r.propertyDeletes,0);
    assert.equal(f.effects.propertyWrites,0);
    assert.equal(f.effects.archiveWrites,0);
    assert.equal(before,JSON.stringify(f.data));
    assert.equal(f.effects.lookups,1);
  }
});
test("replay after already retired REQ is verifiable but not another delete",()=>{
  const f=fixture({alreadyRetired:true});const r=f.run();
  assert.equal(r.pass,true);
  assert.equal(r.modernReadyWithReq,0);
  assert.equal(r.modernReadyWithoutReq,1);
  assert.equal(r.eligibleForFutureRetirement,0);
  assert.equal(f.effects.propertyWrites,0);
});
test("unresolved RESERVED journal stops preflight without actions",()=>{
  const f=fixture({pendingOnly:true});const r=f.run();
  assert.equal(r.pass,false);
  assert.equal(r.journalPending,1);
  assert.equal(r.errorCode,"PREFLIGHT_JOURNAL_PENDING");
  assert.equal(r.activationAuthorized,false);
});
test("unknown or duplicate journal event refuses approval",()=>{
  for(const opts of [{bogusPhase:true},{duplicate:true},{badJournal:true},
                     {tooLarge:true},{emptyJournal:true}]){
    const f=fixture(opts),r=f.run();
    assert.equal(r.pass,false,JSON.stringify(opts));
    assert.equal(f.effects.propertyWrites,0);
    assert.equal(f.effects.archiveWrites,0);
    assert.equal(r.activationAuthorized,false);
  }
});
test("mode, scope, receipt and target uncertainty all fail closed",()=>{
  for(const opts of [
    {off:true},{armed:true},{legacyOn:true},{badMime:true},
    {mismatch:true},{v1Collision:true},{activeLease:true},
    {badTarget:true},{drift:true}
  ]){
    const f=fixture(opts),r=f.run();
    assert.equal(r.pass,false,JSON.stringify(opts));
    assert.equal(f.effects.propertyWrites,0);
    assert.equal(f.effects.archiveWrites,0);
    assert.equal(r.activationAuthorized,false);
  }
});
test("aggregate diagnostics never emit receipt secrets or identifiers",()=>{
  const f=fixture({mismatch:true});
  const result=f.run();
  const output=JSON.stringify(result)+" "+f.effects.logs.join(" ");
  for(const secret of [ID,TARGET,ROOT,OUTPUT,LEDGER,SECRET]){
    assert.equal(output.includes(secret),false,secret);
  }
  assert.equal(output.includes("VAA_PROD_READY_RETIRE_PREFLIGHT"),true);
});
test("manual-only preflight does not alter main doPost or viewer route",()=>{
  new vm.Script(source);
  const s=source.slice(source.indexOf(
    "function vaaLedgerProdReadyRetirePreflightReadOnly()"));
  assert.doesNotMatch(s,/\.deleteProperty\s*\(/);
  assert.doesNotMatch(s,/\.setProperty\s*\(/);
  assert.doesNotMatch(s,/\.appendRow\s*\(/);
  assert.doesNotMatch(s,/\bdoPost\s*\(/);
  assert.doesNotMatch(s,/UrlFetchApp|ScriptApp\./);
});
