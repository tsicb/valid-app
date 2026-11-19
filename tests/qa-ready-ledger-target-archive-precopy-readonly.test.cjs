"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const read = p => fs.readFileSync(path.join(__dirname,"..",p),"utf8");

const qa = read("qa/Ready_Ledger_Migration_Target_Archive_ReadOnly_QA.gs");
const inventory = read("qa/Ready_Ledger_Migration_Inventory_ReadOnly_QA.gs");
const archive = read("central-api/20_Request_Ready_Ledger_Foundation.gs");
const capacity = read("central-api/15_Property_Capacity_Diagnostics.gs");
const SECRET = "PRIVATE_AUTH_TOKEN_NEVER_PRINT_ME";
const ROOT = "QA_ISOLATED_ROOT";
const OUTPUT = "QA_ISOLATED_OUTPUT";
const ids = ["QA_G4","QA_G5A","QA_G5R","QA_G6"];
const bad = "QA_JOURNAL_E2E_CREATE_20261119_V1";
const good = "QA_JOURNAL_E2E_CREATE_20261119_V2";
const update = "QA_JOURNAL_E2E_UPDATE_20261119_V1";
const synthetic = "QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const target = "ISOLATED_SPREADSHEET_TARGET_DO_NOT_LOG";
const clone = x => JSON.parse(JSON.stringify(x));

function receipt(id, mode="CREATE",extra={}){
  return {
    requestId:id,operationMode:mode,status:"READY",stage:"READY",
    spreadsheetId:target, leaseUntil:"",createdAt:"2026-11-19T10:00:00Z",
    ...(mode==="UPDATE"?{
      targetSpreadsheetId:target,updateStrategy:"APPEND",
      updatePayloadDigest:"0123456789abcdef"}:{}),
    privateInfo:SECRET,...extra
  };
}

function harness(opts={}){
  const history=Object.fromEntries(ids.map((id,i)=>[
    "REQ_"+id,JSON.stringify(receipt(id,i===1||i===2?"UPDATE":"CREATE"))
  ]));
  const oldReceipt={requestId:bad,operationMode:"CREATE",status:"ERROR",
    stage:"CREATED",spreadsheetId:"PARTIAL_BOOK"};
  const newReceipt=receipt(good);
  const updateReceipt=receipt(update,"UPDATE");
  const propsMap={
    ...history,
    ["REQ_"+bad]:JSON.stringify(oldReceipt),
    ["REQ_"+good]:JSON.stringify(newReceipt),
    ["REQ_"+update]:JSON.stringify(updateReceipt),
    VAA_JOURNAL_DOP_MODE:opts.armed?"TEST_ONE_SYNTHETIC_REQUEST_V1":"OFF",
    VAA_REQUEST_JOURNAL_MODE:opts.armed?"TEST_RESERVATION_V1":"OFF",
    VAA_REQUEST_LEDGER_REPLAY_MODE:"OFF",
    ACCESS_KEY:SECRET
  };
  if(opts.recordInvalid) propsMap.REQ_QA_G4="INVALID_JSON";
  if(opts.currentTargetLease)propsMap["VAA_TARGET_UPDATE_"+target]="LEASE_EXISTS";
  if(opts.unknownReceipt){
    delete propsMap.REQ_QA_G4;
    propsMap.REQ_UNKNOWN=JSON.stringify(receipt("UNKNOWN"));
  }
  const calls={read:0,writes:0,driveReads:0,ledgerReads:0,logs:[]};
  const props={
    getProperties(){
      calls.read++;
      if(opts.drift && calls.read>=2){
        return {...propsMap,NEW_CONCURRENT_CONFIG:"new"};
      }
      return {...propsMap};
    },
    getProperty:key=>propsMap[key]||null,
    setProperty(){calls.writes++;throw Error("NOT_ALLOWED");},
    deleteProperty(){calls.writes++;throw Error("NOT_ALLOWED");},
    setProperties(){calls.writes++;throw Error("NOT_ALLOWED");}
  };
  const book={getId:()=>"SECRET_ARCHIVE_BOOK"};
  const v1={
    getSheetName:()=>"receipts",
    getParent:()=>book,
    getLastRow:()=>opts.extraV1Row?3:2
  };
  const v2={getLastRow:()=>opts.extraJournalRow?7:6};
  const journal={
    [bad]:{state:"RESERVED",revision:1},
    [good]:{state:"READY",revision:2,latest:{body:{receipt:clone(newReceipt)}}},
    [update]:{state:"READY",revision:2,latest:{body:{receipt:clone(updateReceipt)}}}
  };
  if(opts.badJournal)journal[good]={state:"RESERVED",revision:1};
  const mock={
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_"},
    VAA_QA_G4_CONFIG_:{testRootId:ROOT,testOutputId:OUTPUT},
    VAA_QA_LEDGER_E2E_CREATE_:{requestId:bad},
    VAA_QA_LEDGER_V2_RETEST_:{requestId:good},
    VAA_QA_LEDGER_V2_UPDATE_:{requestId:update},
    VAA_QA_LEDGER_READY_SYNTHETIC_ID_:synthetic,
    PropertiesService:{getScriptProperties:()=>props},
    Utilities:{newBlob:v=>({getBytes:()=>Buffer.from(String(v),"utf8")})},
    console:{log:v=>calls.logs.push(String(v))},
    vaaQaG4IsolatedConfig_:()=>{
      if(opts.badScope) throw Error("SCOPE_DENIED:"+SECRET);
      return props;
    },
    vaaQaLedgerE2EHistoricIds_:()=>ids.slice(),
    vaaQaLedgerE2EHistorySnapshot_:p=>ids.map(id=>p.getProperty("REQ_"+id)),
    vaaQaLedgerE2EHistoryValid_:records=>
      records.length===4 && records.every((raw,i)=>{
        try {
          const r=JSON.parse(raw);
          return r.requestId===ids[i] && r.status==="READY" &&
            r.stage==="READY" && !!r.spreadsheetId;
        }catch(_){return false;}
      }),
    vaaQaLedgerReadyCheckPrivateTestLedger_:()=>{
      calls.driveReads++;
      if(opts.ledgerPrivateInvalid)throw Error("PRIVATE_LEDGER_INVALID:"+SECRET);
      return v1;
    },
    vaaLedgerJournalOpenReadOnly_:()=>({sheet:v2,readySheet:v1}),
    vaaLedgerJournalLookupFromSheet_:(sheet,id)=>{
      calls.ledgerReads++;
      if(opts.journalUnreadable)throw Error("PRIVATE_JOURNAL_ERROR:"+SECRET);
      return clone(journal[id]||{state:"ABSENT"});
    },
    vaaLedgerReadyLookupFromSheet_:(sheet,id)=>{
      calls.ledgerReads++;
      if(opts.archiveUnreadable)throw Error("PRIVATE_ARCHIVE_ERROR:"+SECRET);
      if(id===synthetic)return {state:opts.syntheticGone?"NOT_FOUND":"FOUND"};
      if(id===ids[0] && opts.archiveConflict) return {
        state:"FOUND",raw:JSON.stringify(receipt(ids[0],"CREATE",{privateInfo:"different"}))
      };
      if(id===ids[0] && opts.archiveExact) return {
        state:"FOUND",raw:propsMap["REQ_"+ids[0]]
      };
      return {state:"NOT_FOUND"};
    },
    validateUpdateTargetDriveFile_:(id,folder)=>{
      calls.driveReads++;
      if(id!==target || folder!==OUTPUT || opts.badTarget)throw Error("TARGET:"+SECRET);
      return {isTrashed:()=>!!opts.trashedTarget};
    },
    getRequestPropertyKey_:id=>"REQ_"+id
  };
  const ctx=vm.createContext(mock);
  vm.runInContext(capacity,ctx);
  // Keep the real READY receipt validator, but retain the in-memory mock
  // for Sheets queries; loading the 20_ source declares a lookup function.
  const readMock=mock.vaaLedgerReadyLookupFromSheet_;
  vm.runInContext(archive,ctx);
  ctx.vaaLedgerReadyLookupFromSheet_=readMock;
  vm.runInContext(inventory,ctx);
  vm.runInContext(qa,ctx);
  return {run:()=>ctx.vaaQaReadyMigrationTargetArchiveReadOnly(),calls,propsMap};
}

test("known seven-REQ TEST baseline: all four legacy targets valid and absent from V1/V2",()=>{
  const h=harness();
  const r=h.run();
  assert.equal(r.pass,true,JSON.stringify(r));
  assert.equal(r.expectedSevenReceipts,true);
  assert.equal(r.fourHistoricCandidatesVerified,true);
  assert.equal(r.targetFilesVerified,4);
  assert.equal(r.v1ArchiveMissingCount,4);
  assert.equal(r.v1ArchiveExactMatchCount,0);
  assert.equal(r.v2LegacyAbsentCount,4);
  assert.equal(r.v2PreviousFiveEventsPreserved,true);
  assert.equal(r.v2ReadyReceiptsMatchProperties,true);
  assert.equal(r.failedCreateV1Preserved,true);
  assert.equal(r.propertySnapshotReads,2);
  assert.equal(r.propertiesStableAcrossReads,true);
  assert.equal(h.calls.writes,0);
});

test("armed settings fail before any Drive/ledger reads",()=>{
  const h=harness({armed:true});
  const r=h.run();
  assert.equal(r.pass,false);
  assert.equal(r.modesOff,false);
  assert.equal(h.calls.driveReads,0);
});

test("missing or corrupted historic candidate fails before opening private ledger",()=>{
  for(const o of [{recordInvalid:true},{unknownReceipt:true},
    {currentTargetLease:true}]){
    const h=harness(o),r=h.run();
    assert.equal(r.pass,false,JSON.stringify(o));
    assert.equal(h.calls.driveReads,0);
  }
});

test("Drive folder membership, private test ledger, and trashed files fail closed",()=>{
  for(const o of [{badTarget:true},{trashedTarget:true},
    {ledgerPrivateInvalid:true},{badScope:true}]){
    const h=harness(o),r=h.run();
    assert.equal(r.pass,false,JSON.stringify(o));
    assert.equal(r.migrationAuthorized,false);
    assert.equal(h.calls.writes,0);
    assert.doesNotMatch(h.calls.logs[0],/PRIVATE_AUTH_TOKEN|ISOLATED_SPREADSHEET_TARGET/);
  }
});

test("V1 conflict or ledger read error fails closed; never reinterprets as missing",()=>{
  for(const o of [{archiveConflict:true},{archiveUnreadable:true}]){
    const h=harness(o),r=h.run();
    assert.equal(r.pass,false,JSON.stringify(o));
    assert.equal(r.v1ArchiveMissingCount<4,true);
    assert.equal(h.calls.writes,0);
  }
});

test("V1 synthetic original, journal chain, and ledger expected rows remain required",()=>{
  for(const o of [{syntheticGone:true},{badJournal:true},
    {extraJournalRow:true},{extraV1Row:true},{journalUnreadable:true}]){
    const h=harness(o),r=h.run();
    assert.equal(r.pass,false,JSON.stringify(o));
    assert.equal(h.calls.writes,0);
  }
});

test("concurrent property mutation between reads is detected",()=>{
  const h=harness({drift:true});
  const r=h.run();
  assert.equal(r.pass,false);
  assert.equal(r.propertiesStableAcrossReads,false);
  assert.equal(h.calls.writes,0);
});

test("all logs and returns redact request IDs, secrets, spreadsheets and archive keys",()=>{
  const h=harness({badScope:true});
  const r=h.run();
  const txt=JSON.stringify(r)+" "+h.calls.logs.join(" ");
  for(const secret of [SECRET,target,"REQ_QA_G4",bad,good,update,synthetic]){
    assert.equal(txt.includes(secret),false,secret);
  }
  assert.equal(r.propertyWrites,0);
  assert.equal(r.archiveWrites,0);
  assert.equal(r.journalWrites,0);
  assert.equal(r.deletionAuthorized,false);
  assert.equal(r.replaySwitchAuthorized,false);
});

test("no direct data-mutating calls, no POST or background execution",()=>{
  new vm.Script(qa);
  assert.doesNotMatch(qa,/\.(?:setProperty|setProperties|deleteProperty|appendRow|setValues|moveTo|trash)\s*\(/);
  assert.doesNotMatch(qa,/doPost\s*\(|UrlFetchApp|ScriptApp|LockService/);
});
