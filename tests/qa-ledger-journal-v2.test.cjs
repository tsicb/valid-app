"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const v2=read("central-api/22_Request_Ledger_V2_Journal.gs");
const ID="QA_JOURNAL_RESERVED_CREATE_20261119_V1";
const UPD="QA_JOURNAL_RESERVED_UPDATE_20261119_V1";
const LEGACY="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const TARGET="QA_G6D_SYNTHETIC_WORKBOOK";
const ROOT="QA_ISOLATED_TEST_ROOT";
const OUTPUT="QA_ISOLATED_TEST_OUTPUT";
const LEDGER="QA_PRIVATE_GOOGLE_SHEETS_LEDGER_123456";
const HEAD1=["requestKey","recordJson","recordDigest","revision","updatedAt","schemaVersion","recordStatus"];
const HEAD2=["requestKey","revision","phase","recordJson","recordDigest","prevDigest","updatedAt","schemaVersion"];
const sha=x=>crypto.createHash("sha256").update(x,"utf8").digest("hex");
const freshReady=(id=ID,mode="CREATE")=>({
  requestId:id,operationMode:mode,status:"READY",stage:"READY",
  spreadsheetId:TARGET,spreadsheetUrl:"https://docs.google.com/spreadsheets/d/"+TARGET+"/edit",
  ...(mode==="UPDATE"?{
    targetSpreadsheetId:TARGET,updateStrategy:"APPEND",
    updatePayloadDigest:"a".repeat(64)
  }:{})
});
const identity=(id=ID,mode="CREATE")=>({
  requestId:id,operationMode:mode,targetSpreadsheetId:mode==="UPDATE"?TARGET:"",
  updateStrategy:mode==="UPDATE"?"APPEND":"",
  updatePayloadDigest:mode==="UPDATE"?"a".repeat(64):""
});
const clone=x=>JSON.parse(JSON.stringify(x));
function harness(opts={}){
  const propsMap={
    VAA_REQUEST_LEDGER_SPREADSHEET_ID:LEDGER,
    VAA_REQUEST_JOURNAL_MODE:"TEST_RESERVATION_V1",
    VAA_JOURNAL_TEST_ROOT_ID:opts.badRoot?"NOT_TEST":ROOT,
    VAA_JOURNAL_TEST_OUTPUT_ID:OUTPUT
  };
  const oldRows=[opts.badV1Header?["X",...HEAD1.slice(1)]:HEAD1.slice()];
  if(opts.legacyReady){
    const raw=JSON.stringify(freshReady(LEGACY));
    oldRows.push([sha(LEGACY),raw,sha(raw),1,"2026-11-19T00:00:00Z","READY_ARCHIVE_V1","READY"]);
  }
  const newRows=[opts.badV2Header?["X",...HEAD2.slice(1)]:HEAD2.slice()];
  const state={saves:0,deletes:0,writesV1:0,writesV2:0,logs:[]};
  const props={
    getProperty:k=>propsMap[k]??null,
    getProperties:()=>clone(propsMap),
    setProperty(){state.saves++;throw Error("NO_SCRIPT_PROPERTY_WRITE");},
    deleteProperty(){state.deletes++;throw Error("NO_SCRIPT_PROPERTY_DELETE");}
  };
  function sheet(rows,label) {
    return {
      getParent:()=>book,
      getLastRow:()=>rows.length,
      getRange:(row,col,height,width)=>({
        getValues:()=>rows.slice(row-1,row-1+height).map(r=>r.slice(col-1,col-1+width)),
        createTextFinder:key=>({
          matchEntireCell(){return this;},matchCase(){return this;},
          findAll:()=>rows.slice(1).flatMap((r,i)=>r[0]===key?[{getRow:()=>i+2}]:[])
        })
      }),
      appendRow:r=>{
        if(label==="legacy"){
          state.writesV1++;throw Error("LEGACY_READY_ROWS_READ_ONLY");
        }
        state.writesV2++;
        if(opts.beforeWriteFailure)throw Error("PRE_WRITE_FAILURE");
        rows.push(r);
        if(opts.afterWriteFailure)throw Error("POST_WRITE_RESPONSE_LOST");
        if(opts.corruptAppend)rows[rows.length-1][4]="0".repeat(64);
      }
    };
  }
  const legacySheet=sheet(oldRows,"legacy"),journal=sheet(newRows,"journal");
  const book={
    getSheetByName:name=>
      name==="receipts"?legacySheet:
      name==="journal_v2"&&!opts.missingJournal?journal:null
  };
  const scope={
    API_CONFIG:{
      REQUEST_PROPERTY_PREFIX:"REQ_",ROOT_FOLDER_ID:ROOT,
      SHEET_OUTPUT_FOLDER_ID:OUTPUT
    },
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{openById:id=>{
      if(opts.ledgerUnavailable)throw Error("NOT_FOUND");
      assert.equal(id,LEDGER);return book;
    }},
    DriveApp:{
      Access:{PRIVATE:"PRIVATE"},
      getFileById:id=>{
        if(id===LEDGER){
          if(opts.ledgerUnavailable)throw Error("NOT_FOUND");
          return {
            getMimeType:()=>"application/vnd.google-apps.spreadsheet",
            getSharingAccess:()=>opts.shared?"ANYONE":"PRIVATE",
            getParents:()=>{
              let count=0;const arr=opts.wrongParent?[{getId:()=>OUTPUT}]:[{getId:()=>ROOT}];
              return {hasNext:()=>count<arr.length,next:()=>arr[count++]};
            }
          };
        }
        if(id===TARGET){
          if(opts.badTarget)throw Error("TARGET_UNAVAILABLE");
          return {getName:()=>"QA_SYNTHETIC_TARGET"};
        }
        throw Error("UNEXPECTED_DRIVE_FILE");
      }
    },
    MimeType:{GOOGLE_SHEETS:"application/vnd.google-apps.spreadsheet"},
    Utilities:{
      DigestAlgorithm:{SHA_256:"SHA_256"},Charset:{UTF_8:"UTF_8"},
      computeDigest:(_,input)=>Array.from(
        crypto.createHash("sha256").update(String(input),"utf8").digest()
      )
    },
    vaaTargetUpdateLeaseKey_:target=>"VAA_TARGET_UPDATE_"+target,
    normalizeString_:v=>String(v??"").trim(),
    console:{log:s=>state.logs.push(s)},
    Date
  };
  const ctx=vm.createContext(scope);
  for(const file of [
    "central-api/04_Request_Target.gs",
    "central-api/20_Request_Ready_Ledger_Foundation.gs",
    "central-api/22_Request_Ledger_V2_Journal.gs"
  ])vm.runInContext(read(file),ctx);
  const api={
    reserve:i=>scope.vaaLedgerJournalReserveUnderLock_(props,i||identity()),
    lookup:id=>scope.vaaLedgerJournalReadOnly_(props,id||ID),
    finalize:id=>scope.vaaLedgerJournalFinalizeReadyUnderLock_(props,id||ID),
    replay:(id=ID,mode="CREATE",target="",strategy="",digest="")=>
      scope.vaaLedgerJournalReplayDecisionReadOnly_(
        props,id,mode,target,strategy,digest
      ),
    propsMap,newRows,oldRows,state,scope
  };
  return api;
}

test("journal V2 source validates; no doPost, CAS or REQ deletion",()=>{
  new vm.Script(v2);
  assert.doesNotMatch(v2,/\bdoPost\s*\(|\.deleteProperty\s*\(|\.setProperty\s*\(|\.setTrashed\s*\(|SpreadsheetApp\.create\s*\(/);
  assert.match(v2,/JOURNAL_WRITE_UNCERTAIN/);
});

test("RESERVED revision 1 is durable but cannot replay or start a second reservation",()=>{
  const h=harness();
  const r=h.reserve();
  assert.equal(r.state,"RESERVED");
  assert.equal(r.revision,1);
  assert.equal(h.lookup().state,"RESERVED");
  assert.equal(h.replay().state,"HALT");
  assert.throws(()=>h.reserve(),/JOURNAL_ALREADY_RESERVED/);
  assert.equal(h.newRows.length,2);
  assert.equal(h.newRows[1][0],sha(ID));
  assert.equal(h.newRows[1][1],1);
  assert.equal(h.newRows[1][2],"RESERVED");
  assert.equal(h.newRows[1][4],sha(h.newRows[1][3]));
  assert.equal(h.newRows[1][5],"");
  assert.equal(h.state.writesV1,0);
  assert.equal(h.state.writesV2,1);
  assert.equal(h.state.deletes,0);
});

test("READY revision 2 requires matching canonical READY source and chain",()=>{
  const h=harness();
  h.reserve();
  h.propsMap["REQ_"+ID]=JSON.stringify(freshReady());
  const r=h.finalize();
  assert.equal(r.state,"READY");
  assert.equal(r.revision,2);
  assert.equal(r.sourcePropertyPreserved,true);
  const journal=h.lookup();
  assert.equal(journal.state,"READY");
  assert.equal(journal.revision,2);
  assert.equal(h.newRows[2][5],h.newRows[1][4]);
  assert.equal(h.replay().state,"READY");
  assert.equal(h.replay().record.requestId,ID);
  assert.equal(h.propsMap["REQ_"+ID]!==undefined,true);
  assert.equal(h.state.writesV2,2);
  assert.equal(h.state.saves,0);
  assert.equal(h.state.deletes,0);
});

test("UPDATE reservation + READY preserves target strategy and digest",()=>{
  const h=harness();
  h.reserve(identity(UPD,"UPDATE"));
  h.propsMap["REQ_"+UPD]=JSON.stringify(freshReady(UPD,"UPDATE"));
  assert.equal(h.finalize(UPD).state,"READY");
  const good=h.replay(UPD,"UPDATE",TARGET,"APPEND","a".repeat(64));
  assert.equal(good.state,"READY");
  assert.equal(h.replay(UPD,"UPDATE",TARGET,"REPLACE","a".repeat(64)).state,"HALT");
  assert.equal(h.replay(UPD,"UPDATE","OTHER","APPEND","a".repeat(64)).state,"HALT");
  assert.equal(h.replay(UPD,"UPDATE",TARGET,"APPEND","DIFFERENT").state,"HALT");
});

test("journal always HALTs for unknown id, rather than authorizing new",()=>{
  const h=harness();
  assert.equal(h.lookup().state,"ABSENT");
  assert.equal(h.replay().state,"HALT");
  assert.equal(h.replay().code,"JOURNAL_NOT_SAFE_TO_REPLAY");
});

test("v1 READY archive continues to replay while V2 is absent",()=>{
  const h=harness({legacyReady:true});
  const r=h.replay(LEGACY);
  assert.equal(r.state,"READY");
  assert.equal(r.record.requestId,LEGACY);
  assert.throws(()=>h.reserve(identity(LEGACY)),/JOURNAL_LEGACY_READY_EXISTS/);
  assert.equal(h.state.writesV1,0);
  assert.equal(h.state.writesV2,0);
});

test("missing TEST mode, isolation, private ACL or correct parent blocks reservation",()=>{
  for(const opts of [{badRoot:true},{shared:true},{wrongParent:true},
    {missingJournal:true},{badV1Header:true},{badV2Header:true},
    {ledgerUnavailable:true}]){
    const h=harness(opts);
    assert.throws(()=>h.reserve());
    assert.equal(h.state.writesV1,0);
    assert.equal(h.state.writesV2,0);
  }
  const h=harness();delete h.propsMap.VAA_REQUEST_JOURNAL_MODE;
  assert.throws(()=>h.reserve(),/JOURNAL_TEST_MODE_REQUIRED/);
});

test("unexpected pre-existing REQ, invalid mode and UPDATE digest block reserve",()=>{
  const h=harness();h.propsMap["REQ_"+ID]=JSON.stringify(freshReady());
  assert.throws(()=>h.reserve(),/JOURNAL_PROPERTY_COLLISION/);
  const j=harness();
  assert.throws(()=>j.reserve({...identity(),operationMode:"NOPE"}),/JOURNAL_IDENTITY_INVALID/);
  assert.throws(()=>j.reserve({...identity(UPD,"UPDATE"),updatePayloadDigest:""}),/JOURNAL_IDENTITY_INVALID/);
  assert.equal(j.newRows.length,1);
});

test("corrupted rows, missing revision and duplicate RESERVED fail closed",()=>{
  const h=harness();
  h.reserve();
  h.newRows[1][4]="CORRUPT_DIGEST";
  assert.throws(()=>h.lookup(),/JOURNAL_ROW_UNVERIFIED/);
  const x=harness();
  x.reserve();
  x.newRows.push(x.newRows[1].slice());
  assert.throws(()=>x.lookup(),/JOURNAL_CHAIN_UNVERIFIED/);
  const y=harness();
  y.reserve();
  y.newRows[1][1]=2;
  assert.throws(()=>y.lookup(),/JOURNAL_CHAIN_UNVERIFIED/);
});

test("finalization refuses missing/PROCESSING/changed READY or unreachable target",()=>{
  const cases=[
    {source:null},{source:{...freshReady(),status:"PROCESSING"}},
    {source:{...freshReady(),requestId:"OTHER"}},
    {source:{...freshReady(),operationMode:"UPDATE",targetSpreadsheetId:TARGET,
      updateStrategy:"APPEND",updatePayloadDigest:"a".repeat(64)}}
  ];
  for(const o of cases){
    const h=harness();
    h.reserve();
    if(o.source)h.propsMap["REQ_"+ID]=JSON.stringify(o.source);
    assert.throws(()=>h.finalize());
    assert.equal(h.lookup().state,"RESERVED");
    assert.equal(h.state.writesV2,1);
  }
  const h=harness({badTarget:true});
  h.reserve();h.propsMap["REQ_"+ID]=JSON.stringify(freshReady());
  assert.throws(()=>h.finalize(),/JOURNAL_READY_TARGET_UNVERIFIED/);
});

test("write-before-response uncertainty can be inspected but never auto-retried",()=>{
  const h=harness({afterWriteFailure:true});
  assert.throws(()=>h.reserve(),/JOURNAL_WRITE_UNCERTAIN/);
  assert.equal(h.lookup().state,"RESERVED");
  assert.throws(()=>h.reserve(),/JOURNAL_ALREADY_RESERVED/);
  assert.equal(h.newRows.length,2);
});

test("a failure before append leaves journal ABSENT and no REQ changes",()=>{
  const h=harness({beforeWriteFailure:true});
  assert.throws(()=>h.reserve(),/JOURNAL_WRITE_UNCERTAIN/);
  assert.equal(h.lookup().state,"ABSENT");
  assert.equal(h.state.writesV2,1);
  assert.equal(h.state.deletes,0);
});

test("a corrupt post-write digest is unverified, not successful",()=>{
  const h=harness({corruptAppend:true});
  assert.throws(()=>h.reserve(),/JOURNAL_ROW_UNVERIFIED/);
  assert.equal(h.newRows.length,2);
  assert.throws(()=>h.lookup());
});

test("READY journal and legacy READY with conflicting payload never replay",()=>{
  const h=harness();
  h.reserve();
  h.propsMap["REQ_"+ID]=JSON.stringify(freshReady());
  h.finalize();
  const changed=JSON.stringify({...freshReady(),fileName:"ALT"});
  h.oldRows.push([sha(ID),changed,sha(changed),1,"2026-11-19","READY_ARCHIVE_V1","READY"]);
  assert.equal(h.replay().state,"HALT");
  assert.equal(h.replay().code,"JOURNAL_ARCHIVE_CONFLICT");
});
