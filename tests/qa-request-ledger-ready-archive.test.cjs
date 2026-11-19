"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const foundation=read("central-api/20_Request_Ready_Ledger_Foundation.gs");

const LEDGER_ID="QA_PRIVATE_LEDGER_ABCDEFGHIJKLMNOP";
const TARGET="QA_SYNTHETIC_TARGET_ABCDEFGHIJKLMNOP";
const REQUEST="QA_SYNTHETIC_READY_CREATE_20261119_V1";
const UPDATE="QA_SYNTHETIC_READY_UPDATE_20261119_V1";
const HEADERS=[
  "requestKey","recordJson","recordDigest",
  "revision","updatedAt","schemaVersion","recordStatus"
];
const sha=x=>crypto.createHash("sha256").update(x,"utf8").digest("hex");
const ready=(id=REQUEST,mode="CREATE")=>({
  requestId:id,operationMode:mode,
  status:"READY",stage:"READY",spreadsheetId:TARGET,
  spreadsheetUrl:"https://docs.google.com/spreadsheets/d/"+TARGET+"/edit",
  ...(mode==="UPDATE"?{
    targetSpreadsheetId:TARGET,updateStrategy:"APPEND",
    updatePayloadDigest:"b".repeat(64)
  }:{})
});
const rawReady=(id=REQUEST,mode="CREATE")=>JSON.stringify(ready(id,mode));
const rowFrom=(id,raw)=>[
  sha(id),raw,sha(raw),1,"2026-11-19T10:00:00.000Z","READY_ARCHIVE_V1","READY"
];

function harness(opts={}) {
  const propsMap={
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER_ID,
    ["REQ_"+REQUEST]:rawReady()
  };
  if(opts.unconfigured)delete propsMap.VAA_REQUEST_LEDGER_SPREADSHEET_ID;
  if(opts.noSource)delete propsMap["REQ_"+REQUEST];
  if(opts.badSource)propsMap["REQ_"+REQUEST]='{BROKEN_JSON';
  if(opts.sourceProcessing)
    propsMap["REQ_"+REQUEST]=JSON.stringify({...ready(),status:"PROCESSING",stage:"OPENED"});
  if(opts.activeLease)propsMap["REQ_"+REQUEST]=JSON.stringify({...ready(),
    leaseUntil:"2099-01-01T00:00:00.000Z"});
  if(opts.sourceChanged)propsMap["REQ_"+REQUEST]=JSON.stringify({...ready(),fileName:"Changed"});
  if(opts.updateSource)
    propsMap["REQ_"+UPDATE]=rawReady(UPDATE,"UPDATE");
  if(opts.targetLease)propsMap["VAA_TARGET_UPDATE_"+TARGET]="ACTIVE";
  const rows=[opts.badHeader?["WRONG",...HEADERS.slice(1)]:HEADERS.slice()];
  if(opts.existing)rows.push(rowFrom(REQUEST,rawReady()));
  if(opts.existingConflict)
    rows.push(rowFrom(REQUEST,JSON.stringify({...ready(),fileName:"OTHER"})));
  if(opts.invalidDigest)rows.push(rowFrom(REQUEST,rawReady()).map((v,i)=>i===2?"0".repeat(64):v));
  if(opts.invalidRecord)rows.push(rowFrom(REQUEST,JSON.stringify({...ready(),requestId:"OTHER"})));
  if(opts.duplicates){rows.push(rowFrom(REQUEST,rawReady()));rows.push(rowFrom(REQUEST,rawReady()));}

  const effects={writes:0,deletes:0,appends:0,locks:0,releases:0,logs:[]};
  const props={
    getProperty:k=>propsMap[k]??null,
    getProperties:()=>({...propsMap}),
    setProperty(){effects.writes++;throw Error("PROPERTIES_WRITE_FORBIDDEN");},
    deleteProperty(){effects.deletes++;throw Error("PROPERTIES_DELETE_FORBIDDEN");}
  };
  function range(row,col,numRows,numCols){
    return {
      getValues:()=>{
        if(opts.rangeThrows)throw Error("QA_READ_ERROR");
        return rows.slice(row-1,row-1+numRows).map(v=>v.slice(col-1,col-1+numCols));
      },
      createTextFinder:key=>({
        matchEntireCell(){return this;},
        matchCase(){return this;},
        findAll:()=>{
          if(opts.findThrows)throw Error("QA_LOOKUP_ERROR");
          return rows.slice(1).flatMap((v,i)=>v[0]===key?[{getRow:()=>i+2}]:[]);
        }
      })
    };
  }
  const sheet={
    getLastRow:()=>rows.length,
    getRange:range,
    appendRow:row=>{
      effects.appends++;
      if(opts.appendFailsBefore)throw Error("QA_BEFORE_WRITE");
      rows.push(row);
      if(opts.appendFailsAfter)throw Error("QA_AFTER_WRITE");
      if(opts.mutatePropertyAfterAppend)
        propsMap["REQ_"+REQUEST]=JSON.stringify({...ready(),updatedAt:"RACE"});
      if(opts.corruptAppended)rows[rows.length-1][2]="WRONG_DIGEST";
    }
  };
  const scope={
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},
      Charset:{UTF_8:"UTF_8"},
      computeDigest:(alg,x)=>Array.from(
        crypto.createHash("sha256").update(String(x),"utf8").digest()
      )
    },
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{openById:id=>{
      if(opts.openThrows)throw Error("NO_PERMISSION");
      assert.equal(id,LEDGER_ID);
      return {getSheetByName:tab=>
        opts.missingTab?null:(tab==="receipts"?sheet:null)};
    }},
    LockService:{getScriptLock:()=>({
      waitLock:()=>{effects.locks++;},
      releaseLock:()=>{effects.releases++;}
    })},
    DriveApp:{getFileById:id=>{
      if(opts.targetUnavailable)throw Error("UNKNOWN_TARGET");
      assert.equal(id,TARGET);
      return {getName:()=>"QA_SYNTHETIC_FILE"};
    }},
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_"},
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    normalizeString_:x=>String(x??"").trim(),
    console:{log:x=>effects.logs.push(x)},
    Date
  };
  const context=vm.createContext(scope);
  vm.runInContext(read("central-api/04_Request_Target.gs"),context);
  vm.runInContext(foundation,context);
  return {effects,rows,propsMap,
    run:expr=>vm.runInContext(expr,context),
    copy:id=>scope.vaaLedgerReadyCopyOneUnderLock_(props,id||REQUEST),
    lookup:id=>scope.vaaLedgerReadyLookupReadOnly_(props,id||REQUEST)
  };
}

const noPropertyMutation=h=>{
  assert.equal(h.effects.writes,0);
  assert.equal(h.effects.deletes,0);
};

test("Phase 1 is dormant and never modifies existing API replay pipeline",()=>{
  new vm.Script(foundation);
  assert.doesNotMatch(foundation, /\.deleteProperty\s*\(|\.setProperty\s*\(|\.setTrashed\s*\(|SpreadsheetApp\.create\s*\(/);
  // Ignore doPost mentioned in a comment describing the explicit restriction.
  assert.doesNotMatch(foundation, /^\s*doPost\s*\(/m);
  const entry=read("central-api/02_EntryPoint.gs");
  assert.doesNotMatch(entry,/vaaLedgerReadyLookupReadOnly_|vaaLedgerReadyCopyOneUnderLock_|vaaLedgerReadyCopyOneStandalone_/);
  assert.match(foundation,/LEDGER_WRITE_UNCERTAIN/);
});

test("empty but valid ledger is explicitly NOT_FOUND, without writing",()=>{
  const h=harness();
  assert.equal(h.lookup().state,"NOT_FOUND");
  assert.equal(h.effects.appends,0);
  noPropertyMutation(h);
});

test("copy one READY into ledger, exact JSON + SHA-256, no REQ deletion",()=>{
  const h=harness();
  const original=h.propsMap["REQ_"+REQUEST];
  const r=h.copy();
  assert.equal(r.state,"COPIED_AND_VERIFIED");
  assert.equal(r.propertyPreserved,true);
  assert.equal(h.rows.length,2);
  assert.equal(h.rows[1][0],sha(REQUEST));
  assert.equal(h.rows[1][1],original);
  assert.equal(h.rows[1][2],sha(original));
  assert.equal(h.rows[1][3],1);
  assert.equal(h.lookup().state,"FOUND");
  assert.equal(h.lookup().raw,original);
  assert.equal(h.propsMap["REQ_"+REQUEST],original);
  assert.equal(h.effects.appends,1);
  noPropertyMutation(h);
});

test("existing identical READY is idempotent and conflict is refused",()=>{
  const h=harness({existing:true});
  assert.equal(h.copy().state,"VERIFIED_EXISTING");
  assert.equal(h.effects.appends,0);
  const c=harness({existingConflict:true});
  assert.throws(()=>c.copy(),/LEDGER_EXISTING_CONFLICT/);
  assert.equal(c.effects.appends,0);
  noPropertyMutation(c);
});

test("update READY preserves strategy/digest and blocks active target lease",()=>{
  const h=harness({updateSource:true});
  assert.equal(h.copy(UPDATE).state,"COPIED_AND_VERIFIED");
  const row=h.lookup(UPDATE).record;
  assert.equal(row.updateStrategy,"APPEND");
  assert.equal(row.updatePayloadDigest,"b".repeat(64));
  const c=harness({updateSource:true,targetLease:true});
  assert.throws(()=>c.copy(UPDATE),/LEDGER_RECEIPT_ACTIVE/);
  assert.equal(c.effects.appends,0);
  noPropertyMutation(c);
});

test("ledger corrupt/duplicate/invalid row fails closed, not NOT_FOUND",()=>{
  for(const options of [
    {duplicates:true},{invalidDigest:true},
    {invalidRecord:true}
  ]){
    const h=harness(options);
    assert.throws(()=>h.lookup(),/LEDGER_DUPLICATE_KEY|LEDGER_ROW_UNVERIFIED|LEDGER_RECEIPT_INVALID/);
    assert.equal(h.effects.appends,0);
    noPropertyMutation(h);
  }
});

test("missing/invalid sheet, config, ACL and search exceptions fail closed",()=>{
  for(const options of [
    {unconfigured:true},{missingTab:true},{badHeader:true},
    {openThrows:true},{rangeThrows:true},{findThrows:true}
  ]){
    // TextFinder is only invoked when data rows exist.
    const h=harness({...options,existing:!!options.findThrows});
    assert.throws(()=>h.lookup(),/LEDGER_NOT_CONFIGURED|LEDGER_SHEET_MISSING|LEDGER_SCHEMA_MISMATCH|LEDGER_UNAVAILABLE/);
    noPropertyMutation(h);
  }
});

test("source not READY, expired target, missing source or lease forbids archival",()=>{
  for(const options of [
    {noSource:true},{badSource:true},{sourceProcessing:true},
    {activeLease:true},{targetUnavailable:true}
  ]){
    const h=harness(options);
    assert.throws(()=>h.copy(),/LEDGER_RECEIPT_INVALID|LEDGER_RECEIPT_ACTIVE|LEDGER_TARGET_UNVERIFIED/);
    assert.equal(h.effects.appends,0);
    noPropertyMutation(h);
  }
});

test("write-before-response loss is UNKNOWN; read-only lookup reveals durable row",()=>{
  const h=harness({appendFailsAfter:true});
  assert.throws(()=>h.copy(),/LEDGER_WRITE_UNCERTAIN/);
  assert.equal(h.effects.appends,1);
  assert.equal(h.lookup().state,"FOUND");
  assert.equal(h.rows.length,2);
  noPropertyMutation(h);
});

test("failure before write remains NOT_FOUND and no cleanup attempts occur",()=>{
  const h=harness({appendFailsBefore:true});
  assert.throws(()=>h.copy(),/LEDGER_WRITE_UNCERTAIN/);
  assert.equal(h.lookup().state,"NOT_FOUND");
  assert.equal(h.effects.appends,1);
  noPropertyMutation(h);
});

test("bad post-write verification or concurrent REQ drift never deletes original",()=>{
  for(const options of [{corruptAppended:true},{mutatePropertyAfterAppend:true}]){
    const h=harness(options);
    assert.throws(()=>h.copy(),/LEDGER_ROW_UNVERIFIED|LEDGER_WRITE_UNVERIFIED/);
    assert.equal(h.effects.appends,1);
    noPropertyMutation(h);
  }
});

test("standalone tool acquires/releases ScriptLock and logs only status",()=>{
  const h=harness();
  const r=h.run("vaaLedgerReadyCopyOneStandalone_('"+REQUEST+"')");
  assert.equal(r.state,"COPIED_AND_VERIFIED");
  assert.equal(h.effects.locks,1);
  assert.equal(h.effects.releases,1);
  assert.equal(h.effects.logs.length,1);
  assert.doesNotMatch(h.effects.logs[0],
    /QA_SYNTHETIC_READY_CREATE|QA_SYNTHETIC_TARGET|FAKE_SECRET|recordJson/);
  noPropertyMutation(h);
});
