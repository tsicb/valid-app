"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const qa=read("qa/Ledger_Ready_Synthetic_Sheets_Test_QA.gs");
const request="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const g6d="QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const target="QA_ISOLATED_G6D_TEST_WORKBOOK_12345";
const root="QA_TEST_ROOT_FOLDER_12345";
const output="QA_TEST_OUTPUT_FOLDER_12345";
const ledgerId="QA_LEDGER_NATIVE_SPREADSHEET_123456789";
const headers=["requestKey","recordJson","recordDigest","revision","updatedAt","schemaVersion","recordStatus"];
const hash=x=>crypto.createHash("sha256").update(String(x),"utf8").digest("hex");
function make(opts={}) {
  const propsData={
    "SCHEMA_VERSION":"3.0","ACCESS_KEY":"QA_FAKE_SECRET_NEVER_LOG",
    "VAA_REQUEST_LEDGER_SPREADSHEET_ID":ledgerId,
    ["REQ_"+g6d]:JSON.stringify({
      requestId:g6d,operationMode:"CREATE",status:"READY",stage:"READY",
      spreadsheetId:target,outputFolderId:output
    }),
    "REQ_G4":"HISTORICAL_G4","REQ_G5APP":"HISTORICAL_G5APP",
    "REQ_G5REP":"HISTORICAL_G5REP"
  };
  if(opts.realIdCollision)propsData["REQ_"+request]="ALREADY_USED";
  const effects={writes:0,deletes:0,locks:0,releases:0,appends:0,
    logs:[],targetReads:0,ledgerReads:0};
  const rows=[opts.badHeader?["INVALID",...headers.slice(1)]:headers.slice()];
  const property={
    getProperty:k=>propsData[k]??null,
    getProperties:()=>({...propsData}),
    setProperty(){effects.writes++;throw Error("PROP_WRITE_FORBIDDEN");},
    deleteProperty(){effects.deletes++;throw Error("PROP_DELETE_FORBIDDEN");}
  };
  const sheet={
    getLastRow:()=>rows.length,
    getRange:(row,col,height,width)=>({
      getValues:()=>rows.slice(row-1,row-1+height)
        .map(x=>x.slice(col-1,col-1+width)),
      createTextFinder:key=>({
        matchEntireCell(){return this;},
        matchCase(){return this;},
        findAll:()=>rows.slice(1).flatMap(
          (v,i)=>v[0]===key?[{getRow:()=>i+2}]:[]
        )
      })
    }),
    appendRow:r=>{
      effects.appends++;
      if(opts.beforeWriteFailure)throw Error("QA_PRE_WRITE");
      rows.push(r);
      if(opts.lostWriteResponse)throw Error("QA_LOST_RESPONSE");
    }
  };
  const ledgerFile={
    getMimeType:()=>"application/vnd.google-apps.spreadsheet",
    getSharingAccess:()=>opts.publicLedger?"ANYONE":"PRIVATE",
    getName:()=>opts.wrongName?"UNKNOWN":"valid-app｜READY履歴台帳｜隔離TEST（空台帳）",
    getParents:()=>{
      const ps=opts.wrongParent?[{getId:()=>output}]:[{getId:()=>root}];
      let n=0;return {hasNext:()=>n<ps.length,next:()=>ps[n++]};
    }
  };
  const scope={
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_",ROOT_FOLDER_ID:root,
      SHEET_OUTPUT_FOLDER_ID:output,CURRENT_STORAGE_LAYOUT:"DATASTORE_V1"},
    VAA_QA_G4_CONFIG_:{testRootId:root,testOutputId:output},
    VAA_QA_G6C_CONFIG_:{createRequestId:g6d},
    MimeType:{GOOGLE_SHEETS:"application/vnd.google-apps.spreadsheet"},
    DriveApp:{
      Access:{PRIVATE:"PRIVATE"},
      getFileById:id=>{
        if(id===ledgerId){effects.ledgerReads++;return ledgerFile;}
        if(id===target){effects.targetReads++;return {
          getName:()=>"QA_G6D_SYNTHETIC",
          getMimeType:()=>"application/vnd.google-apps.spreadsheet",
          getParents:()=>{
            let used=false;
            return {hasNext:()=>!used,next:()=>{
              used=true;return {getId:()=>output};
            }};
          }
        };}
        throw Error("UNKNOWN_DRIVE_FILE");
      }
    },
    PropertiesService:{getScriptProperties:()=>property},
    SpreadsheetApp:{openById:id=>{
      if(id!==ledgerId)throw Error("INVALID_LEDGER");
      return {getSheetByName:name=>name==="receipts"?sheet:null};
    }},
    Utilities:{DigestAlgorithm:{SHA_256:"SHA_256"},Charset:{UTF_8:"UTF_8"},
      computeDigest:(a,x)=>Array.from(crypto.createHash("sha256")
        .update(String(x),"utf8").digest())},
    LockService:{getScriptLock:()=>({
      waitLock:()=>{effects.locks++;},
      releaseLock:()=>{effects.releases++;}
    })},
    vaaQaG4IsolatedConfig_:()=>{
      if(opts.badIsolation)throw Error("QA_ISOLATION_FAILED");
      return property;
    },
    vaaQaG6DInspectFaultDomainReadOnly:()=>({
      pass:!opts.badDomain,readyCount:opts.badDomain?3:4,
      dataStoreMatchesSynthetic:!opts.badDomain,
      historicalReceiptsStable:true,originalDataStoreStable:true
    }),
    validateUpdateTargetDriveFile_:(id,out)=>{
      if(id!==target||out!==output)throw Error("NOT_TEST_TARGET");
    },
    vaaTargetUpdateLeaseKey_:id=>"VAA_TARGET_UPDATE_"+id,
    normalizeString_:v=>String(v??"").trim(),
    console:{log:m=>effects.logs.push(m)},
    Date
  };
  const ctx=vm.createContext(scope);
  for(const file of [
    "central-api/04_Request_Target.gs",
    "central-api/20_Request_Ready_Ledger_Foundation.gs",
    "qa/Ledger_Ready_Synthetic_Sheets_Test_QA.gs"
  ])vm.runInContext(read(file),ctx);
  return {run:s=>vm.runInContext(s,ctx),effects,propsData,rows};
}
const noRealWrites=h=>{
  assert.equal(h.effects.writes,0);
  assert.equal(h.effects.deletes,0);
};

test("QA ledger module has no post/CAS/REQ deletion/Drive file write",()=>{
  new vm.Script(qa);
  assert.doesNotMatch(qa,
    /\bdoPost\s*\(|\bvaaCommitStagedAppendDataStore_\s*\(|\.setTrashed\s*\(|\.createFile\s*\(|\.setProperty\s*\(|\.deleteProperty\s*\(/);
  assert.match(qa,/vaaLedgerReadyCopyOneUnderLock_\s*\(/);
});

test("real Sheets preflight on empty private TEST ledger is read-only",()=>{
  const h=make(),r=h.run("vaaQaLedgerReadySyntheticPreflightReadOnly()");
  assert.equal(r.pass,true);
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.historicReadyReceipts,4);
  assert.equal(r.existingSyntheticArchiveRow,false);
  assert.equal(r.ledgerHasHeaderOnly,true);
  assert.equal(r.scriptPropertiesUnchanged,true);
  assert.equal(h.effects.appends,0);
  noRealWrites(h);
});

test("one-shot copy only writes a single synthetic ledger row; inspect passes",()=>{
  const h=make();
  const original=JSON.stringify(h.propsData);
  const r=h.run("vaaQaLedgerReadySyntheticCopyOnce()");
  assert.equal(r.pass,true);
  assert.equal(r.syntheticReadyArchived,true);
  assert.equal(r.syntheticArchiveRowCount,1);
  assert.equal(h.effects.appends,1);
  assert.equal(h.effects.locks,1);
  assert.equal(h.effects.releases,1);
  assert.equal(JSON.stringify(h.propsData),original);
  const a=h.run("vaaQaLedgerReadySyntheticInspectReadOnly()");
  assert.equal(a.pass,true);
  assert.equal(a.exactLedgerMatchesSyntheticRecord,true);
  assert.equal(a.replayResponseFromLedgerVerified,true);
  assert.equal(a.syntheticRequestIdNeverWrittenToRealProperties,true);
  assert.equal(h.effects.appends,1);
  assert.equal(h.rows[1][0],hash(request));
  assert.equal(h.rows[1][2],hash(h.rows[1][1]));
  assert.doesNotMatch(h.effects.logs.join("\n"),
    /QA_FAKE_SECRET_NEVER_LOG|QA_ISOLATED_G6D_TEST_WORKBOOK|QA_LEDGER_NATIVE_SPREADSHEET/);
  noRealWrites(h);
});

test("second write is denied before lock; use inspector instead",()=>{
  const h=make();
  assert.equal(h.run("vaaQaLedgerReadySyntheticCopyOnce()").pass,true);
  assert.throws(()=>h.run("vaaQaLedgerReadySyntheticCopyOnce()"),
    /QA_LEDGER_READY_COPY_PREFLIGHT_FAILED/);
  assert.equal(h.effects.appends,1);
  assert.equal(h.run("vaaQaLedgerReadySyntheticInspectReadOnly()").pass,true);
  noRealWrites(h);
});

test("response lost after append never retries, forensic read sees durable row",()=>{
  const h=make({lostWriteResponse:true});
  assert.throws(()=>h.run("vaaQaLedgerReadySyntheticCopyOnce()"),
    /LEDGER_WRITE_UNCERTAIN/);
  assert.equal(h.effects.appends,1);
  assert.equal(h.effects.releases,1);
  const r=h.run("vaaQaLedgerReadySyntheticInspectReadOnly()");
  assert.equal(r.pass,true);
  assert.equal(h.effects.appends,1);
  noRealWrites(h);
});

test("error before append preserves empty ledger and original properties",()=>{
  const h=make({beforeWriteFailure:true});
  assert.throws(()=>h.run("vaaQaLedgerReadySyntheticCopyOnce()"),
    /LEDGER_WRITE_UNCERTAIN/);
  const a=h.run("vaaQaLedgerReadySyntheticInspectReadOnly()");
  assert.equal(a.pass,false);
  assert.equal(a.archiveRowCount,0);
  assert.equal(h.effects.appends,1);
  noRealWrites(h);
});

test("TEST-only gating stops before write if ledger publicly shared/relocated",()=>{
  for(const opts of [{publicLedger:true},{wrongParent:true},
    {wrongName:true},{badHeader:true},{badIsolation:true},
    {badDomain:true},{realIdCollision:true}]){
    const h=make(opts);
    assert.throws(()=>h.run("vaaQaLedgerReadySyntheticCopyOnce()"));
    assert.equal(h.effects.appends,0);
    noRealWrites(h);
  }
});

test("read-only inspection before any copy never fabricates a READY replay",()=>{
  const h=make(),r=h.run("vaaQaLedgerReadySyntheticInspectReadOnly()");
  assert.equal(r.pass,false);
  assert.equal(r.archiveRowCount,0);
  assert.equal(r.replayResponseFromLedgerVerified,false);
  noRealWrites(h);
});
