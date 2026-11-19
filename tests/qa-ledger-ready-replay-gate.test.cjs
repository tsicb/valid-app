"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const gate=read("central-api/21_Request_Ready_Ledger_Replay_Gate.gs");
const entry=read("central-api/02_EntryPoint.gs");
const testId="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const otherId="QA_NOT_ARCHIVED_CREATE_20261119_V1";
const updId="QA_LEDGER_SYNTHETIC_READY_UPDATE_20261119_V1";
const root="QA_TEST_ROOT_1234567890";
const output="QA_TEST_OUTPUT_1234567890";
const ledger="QA_LEDGER_PRIVATE_NATIVE_1234567890";
const target="QA_G6D_INDEPENDENT_TEST_TARGET";
const headers=["requestKey","recordJson","recordDigest","revision","updatedAt","schemaVersion","recordStatus"];
const digest=x=>crypto.createHash("sha256").update(x,"utf8").digest("hex");

function setup(o={}){
  const mode=o.disabled?"":(o.mode??"TEST_READY_REPLAY_ONLY_V1");
  const id=o.update?updId:testId;
  const record={
    requestId:id,operationMode:o.update?"UPDATE":"CREATE",
    status:"READY",stage:"READY",
    spreadsheetId:target,spreadsheetUrl:"https://docs.google.com/spreadsheets/d/"+target+"/edit",
    outputFolderId:output,
    ...(o.update?{targetSpreadsheetId:target,updateStrategy:"APPEND",updatePayloadDigest:"sha_test_digest"}:{})
  };
  if(o.corruptRecord)record.spreadsheetId="OTHER_FILE";
  const text=JSON.stringify(record);
  const row=[digest(id),text,digest(text),1,
    "2026-11-19T10:00:00.000Z","READY_ARCHIVE_V1","READY"];
  if(o.badDigest)row[2]="0".repeat(64);
  const rows=[headers.slice()];
  if(!o.missing)rows.push(row);
  if(o.duplicate)rows.push(row.slice());
  const propsMap={
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:ledger,
    VAA_REQUEST_LEDGER_REPLAY_MODE:mode,
    VAA_LEDGER_REPLAY_TEST_ROOT_ID:o.wrongRoot?"OTHER_ROOT":root,
    VAA_LEDGER_REPLAY_TEST_OUTPUT_ID:output,
    VAA_LEDGER_REPLAY_TEST_REQUEST_ID:o.allowOther?otherId:id,
    SCHEMA_VERSION:"3.0", ACCESS_KEY:"QA_FAKE_SECRET"
  };
  if(o.propertyPresent)propsMap["REQ_"+id]=text;
  if(o.invalidMode)propsMap.VAA_REQUEST_LEDGER_REPLAY_MODE="READY_V1";
  const calls={created:0,propertyWrites:0,propertyDeletes:0,
    appendRows:0,locks:0,releases:0,searches:0};
  const props={
    getProperty:k=>propsMap[k]??null,
    getProperties:()=>({...propsMap}),
    setProperty(){calls.propertyWrites++;throw Error("PROP_WRITE_FORBIDDEN");},
    deleteProperty(){calls.propertyDeletes++;throw Error("PROP_DELETE_FORBIDDEN");}
  };
  function iter(arr){
    let idx=0;return {hasNext:()=>idx<arr.length,next:()=>arr[idx++]};
  }
  const file={
    getMimeType:()=>"application/vnd.google-apps.spreadsheet",
    getSharingAccess:()=>o.publicLedger?"ANYONE":"PRIVATE",
    getParents:()=>iter([{getId:()=>o.parentOutside?"OTHER_FOLDER":root}]),
    getName:()=>"QA_SYNTHETIC_LEDGER"
  };
  const targetFile={
    getMimeType:()=>"application/vnd.google-apps.spreadsheet",
    getParents:()=>iter([{getId:()=>o.targetOutside?"OTHER_FOLDER":output,
      getParents:()=>iter([])}]),
    getName:()=>"QA_INDEPENDENT_TEST_WORKBOOK"
  };
  const sheet={
    getLastRow:()=>rows.length,
    getRange:(row,col,height,width)=>({
      getValues:()=>rows.slice(row-1,row-1+height).map(x=>x.slice(col-1,col-1+width)),
      createTextFinder:key=>({
        matchEntireCell(){return this;},matchCase(){return this;},
        findAll:()=>{
          calls.searches++;
          return rows.slice(1).flatMap((r,i)=>r[0]===key?[{getRow:()=>i+2}]:[]);
        }
      })
    }),
    appendRow(){calls.appendRows++;throw Error("LEDGER_WRITE_FORBIDDEN");}
  };
  const scope={
    API_CONFIG:{
      ROOT_FOLDER_ID:root,SHEET_OUTPUT_FOLDER_ID:output,
      REQUEST_PROPERTY_PREFIX:"REQ_",MAX_BODY_CHARS:200000,
      CURRENT_STORAGE_LAYOUT:"DATASTORE_V1",
      DEFAULT_SCHEMA_VERSION:"3.0"
    },
    DriveApp:{
      Access:{PRIVATE:"PRIVATE"},
      getFileById:fileId=>{
        if(fileId===ledger) {
          if(o.ledgerUnavailable)throw Error("LEDGER_IO_ERROR");
          return file;
        }
        if(fileId===target)return targetFile;
        throw Error("UNKNOWN_FILE");
      }
    },
    MimeType:{GOOGLE_SHEETS:"application/vnd.google-apps.spreadsheet"},
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{
      openById:sid=>{
        if(sid!==ledger||o.ledgerUnavailable)throw Error("LEDGER_NOT_ACCESSIBLE");
        return {getSheetByName:t=>t==="receipts"?sheet:null};
      },
      create(){calls.created++;throw Error("WORKBOOK_CREATE_FORBIDDEN");}
    },
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},Charset:{UTF_8:"UTF_8"},
      computeDigest:(alg,source)=>Array.from(crypto.createHash("sha256")
        .update(String(source),"utf8").digest())
    },
    LockService:{getScriptLock:()=>({
      waitLock:()=>{calls.locks++;},
      releaseLock:()=>{calls.releases++;}
    })},
    perfMs_:()=>0,
    normalizeString_:v=>String(v??"").trim(),
    jsonOutput_:r=>r,
    errorOutput_:(code,msg)=>({ok:false,code,message:msg}),
    vaaCheckNewRequestCapacityReadOnly_:()=>({allowed:false}),
    console:{log(){}},
    Date
  };
  const ctx=vm.createContext(scope);
  for(const f of [
    "central-api/04_Request_Target.gs",
    "central-api/20_Request_Ready_Ledger_Foundation.gs",
    "central-api/13_Append_Update_Guard.gs",
    "central-api/21_Request_Ready_Ledger_Replay_Gate.gs",
    "central-api/23_Request_Ledger_V2_DoPost_Bridge.gs",
    "central-api/02_EntryPoint.gs"
  ])vm.runInContext(read(f),ctx);
  scope.validateEnvelope_=()=>({ok:true});
  scope.extractSpreadsheetId_=s=>s===target?target:"";
  scope.vaaDigestUpdateRequest_=()=>"sha_test_digest";
  const invoke=(override={})=>{
    const payload={action:"create",requestId:id,
      schemaVersion:"3.0",accessKey:"QA_FAKE_SECRET",
      ...(o.update?{targetSpreadsheetId:target,updateStrategy:o.strategy||"APPEND"}:{})
    };
    return scope.doPost({postData:{contents:JSON.stringify({...payload,...override})}});
  };
  return {calls,propsMap,invoke,
    decision:(targetMode=o.update?"UPDATE":"CREATE",requestId=id,
      targetId=o.update?target:"",strategy=o.strategy||"APPEND",hash="sha_test_digest")=>
      scope.vaaLedgerReplayDecisionReadOnly_(
        props,requestId,targetMode,targetId,strategy,hash),
    testId:id};
}
const noWrites=t=>{
  assert.equal(t.calls.created,0);
  assert.equal(t.calls.appendRows,0);
  assert.equal(t.calls.propertyWrites,0);
  assert.equal(t.calls.propertyDeletes,0);
};

test("source inserts replay fence before CREATE/UPDATE new-work admission",()=>{
  new vm.Script(gate);
  new vm.Script(entry);
  assert.doesNotMatch(gate,/\.setProperty\s*\(|\.deleteProperty\s*\(|\.appendRow\s*\(|\.createFile\s*\(|\.setTrashed\s*\(/);
  const gateCall=entry.indexOf("const ledgerReplay = vaaLedgerReplayDecisionReadOnly_");
  const check=entry.indexOf("const storedReceiptExists");
  const admission=entry.indexOf("const budgetAdmission = vaaCheckNewRequestCapacityReadOnly_");
  const create=entry.indexOf("SpreadsheetApp.create(");
  assert.ok(check>=0 && gateCall>check && admission>gateCall && create>gateCall);
  assert.ok(entry.indexOf("if (!storedReceiptExists)",check)<gateCall);
});

test("ledger-only READY successfully replays within doPost without a new REQ",()=>{
  const t=setup(),r=t.invoke();
  assert.equal(r.ok,true);
  assert.equal(r.reused,true);
  assert.equal(r.status,"READY");
  assert.equal(r.operationMode,"CREATE");
  assert.equal(r.requestId,testId);
  assert.equal(r.spreadsheetId,target);
  assert.equal(t.calls.locks,1);
  assert.equal(t.calls.releases,1);
  assert.ok(t.calls.searches>=1);
  noWrites(t);
});

test("legacy READY property takes precedence; no ledger read is needed",()=>{
  const t=setup({propertyPresent:true,ledgerUnavailable:true});
  const r=t.invoke();
  assert.equal(r.ok,true);
  assert.equal(r.reused,true);
  assert.equal(t.calls.searches,0);
  noWrites(t);
});

test("default OFF keeps old new-request admission behavior and does not read ledger",()=>{
  const t=setup({disabled:true});
  assert.equal(t.decision().state,"DISABLED");
  const r=t.invoke();
  assert.equal(r.ok,false);
  assert.equal(r.code,"PROPERTY_CAPACITY_NEAR_LIMIT");
  assert.equal(t.calls.searches,0);
  noWrites(t);
});

test("enabled TEST mode rejects ledger NOT_FOUND before any new side effect",()=>{
  const t=setup({missing:true}),r=t.invoke();
  assert.equal(r.ok,false);
  assert.equal(r.code,"LEDGER_REPLAY_NOT_FOUND_TEST_ONLY");
  noWrites(t);
});

test("duplicate/digest-corrupt/unavailable ledger always HALTs, not NEW",()=>{
  for(const opt of [{duplicate:true},{badDigest:true},
    {ledgerUnavailable:true},{corruptRecord:true}]){
    const t=setup(opt),r=t.invoke();
    assert.equal(r.ok,false);
    assert.equal(r.code,"LEDGER_REPLAY_UNVERIFIED");
    noWrites(t);
  }
});

test("TEST scope denies wrong root, wrong allowlist, public ledger, unrelated folder",()=>{
  for(const opt of [
    {wrongRoot:true},{allowOther:true},{publicLedger:true},
    {parentOutside:true},{targetOutside:true},{invalidMode:true}
  ]){
    const t=setup(opt),r=t.invoke();
    assert.equal(r.ok,false);
    assert.match(r.code,/LEDGER_REPLAY_TEST_SCOPE_DENIED|LEDGER_REPLAY_TEST_LEDGER_INVALID|LEDGER_REPLAY_TARGET_UNVERIFIED|LEDGER_REPLAY_CONFIG_INVALID/);
    noWrites(t);
  }
});

test("CREATE archived request cannot be repurposed for UPDATE or different request",()=>{
  const t=setup();
  assert.equal(t.decision("UPDATE",testId,target).code,"REQUEST_TARGET_MISMATCH");
  assert.equal(t.decision("CREATE",otherId).code,"LEDGER_REPLAY_TEST_SCOPE_DENIED");
  noWrites(t);
});

test("UPDATE archived replay requires identical target, APPEND strategy and payload digest",()=>{
  const t=setup({update:true});
  const success=t.invoke();
  assert.equal(success.ok,true);
  assert.equal(success.reused,true);
  assert.equal(success.operationMode,"UPDATE");
  assert.equal(t.decision("UPDATE",updId,"OTHER_TARGET").code,"REQUEST_TARGET_MISMATCH");
  assert.equal(t.decision("UPDATE",updId,target,"REPLACE").code,"REQUEST_PAYLOAD_MISMATCH");
  assert.equal(t.decision("UPDATE",updId,target,"APPEND","NOT_THE_SAME_DIGEST").code,"REQUEST_PAYLOAD_MISMATCH");
  noWrites(t);
});

test("invalid mode and present property collision never allow a second execution",()=>{
  const t=setup({invalidMode:true});
  assert.equal(t.decision().state,"HALT");
  const p=setup({propertyPresent:true});
  assert.equal(p.decision().code,"LEDGER_REPLAY_PROPERTY_COLLISION");
  noWrites(t);noWrites(p);
});
