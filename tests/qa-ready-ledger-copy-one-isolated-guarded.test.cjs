"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname,"../qa/Ready_Ledger_Migration_Copy_One_Once_QA.gs"),
  "utf8"
);

const IDS=["QA_G4_HISTORIC_CREATE","QA_G5_HISTORIC_UPDATE_APP",
           "QA_G5_HISTORIC_UPDATE_REPLACE","QA_G6_HISTORIC_CREATE"];
const FAILED="QA_JOURNAL_E2E_CREATE_20261119_V1";
const CREATED="QA_JOURNAL_E2E_CREATE_20261119_V2";
const UPDATED="QA_JOURNAL_E2E_UPDATE_20261119_V1";
const SYNTHETIC="QA_LEDGER_SYNTHETIC_READY_CREATE_20261119_V1";
const SECRET="PRIVATE_SHOULD_NEVER_APPEAR_IN_LOG";
const WORKBOOK="SENSITIVE_PRIVATE_WORKBOOK_IDENTIFIER";
const ARM="TEST_ONE_LEGACY_READY_COPY_V1";

function receipt(id,mode="CREATE"){
  return {requestId:id,operationMode:mode,status:"READY",stage:"READY",
    spreadsheetId:WORKBOOK,createdAt:"2026-11-19T10:00:00Z",
    ...(mode==="UPDATE"?{
      targetSpreadsheetId:WORKBOOK,updateStrategy:"APPEND",
      updatePayloadDigest:"0123456789abcdef"}:{}),
    secret:SECRET
  };
}
function harness(opts={}){
  let mode=opts.arm ? ARM : "OFF";
  const properties={
    ...Object.fromEntries(IDS.map((id,i)=>["REQ_"+id,
      JSON.stringify(receipt(id,i===1||i===2?"UPDATE":"CREATE"))])),
    ["REQ_"+FAILED]:JSON.stringify({
      requestId:FAILED,operationMode:"CREATE",status:"ERROR",
      spreadsheetId:"INCOMPLETE_TEST_BOOK"
    }),
    ["REQ_"+CREATED]:JSON.stringify(receipt(CREATED)),
    ["REQ_"+UPDATED]:JSON.stringify(receipt(UPDATED,"UPDATE")),
    VAA_QA_READY_COPY_ONE_MODE:mode,
    VAA_JOURNAL_DOP_MODE:"OFF",VAA_REQUEST_JOURNAL_MODE:"OFF",
    VAA_REQUEST_LEDGER_REPLAY_MODE:"OFF",
    ACCESS_KEY:SECRET
  };
  const state={archive:new Map([[SYNTHETIC,"original-archived-receipt"]]),
    calls:{copy:0,propertyReads:0,append:0,locks:0,releases:0,logs:[],
      archiveReads:0,targetAudits:0}
  };
  const props={
    getProperties:()=>{
      state.calls.propertyReads++;
      return opts.drift && state.calls.propertyReads >= 2 &&
        state.calls.propertyReads%2===0
        ? {...properties,CONCURRENT_MUTATION:"X"}:{...properties};
    },
    getProperty:k=>properties[k]||null,
    setProperty:()=>{throw Error("DO_NOT_WRITE");},
    deleteProperty:()=>{throw Error("DO_NOT_DELETE");}
  };
  const contexts={
    console:{log:s=>state.calls.logs.push(String(s))},
    PropertiesService:{getScriptProperties:()=>props},
    VAA_QA_G4_CONFIG_:{requestId:IDS[0]},
    VAA_QA_LEDGER_READY_SYNTHETIC_ID_:SYNTHETIC,
    VAA_QA_LEDGER_E2E_CREATE_:{requestId:FAILED},
    VAA_QA_LEDGER_V2_RETEST_:{requestId:CREATED},
    VAA_QA_LEDGER_V2_UPDATE_:{requestId:UPDATED},
    vaaQaG4IsolatedConfig_:()=>{if(opts.badScope)throw Error("BAD_SCOPE:"+SECRET);return props;},
    getRequestPropertyKey_:id=>"REQ_"+id,
    vaaQaLedgerE2EHistoricIds_:()=>IDS.slice(),
    vaaQaLedgerE2EHistorySnapshot_:()=>IDS.map(id=>properties["REQ_"+id]),
    vaaQaLedgerE2EHistoryValid_:s=>s.length===4&&s.every((raw,i)=>{
      try{const x=JSON.parse(raw);return x.requestId===IDS[i]&&
        x.status==="READY"&&x.stage==="READY";}catch(_){return false;}
    }),
    vaaLedgerReadyValidateRaw_:(id,raw)=>{
      const x=JSON.parse(raw);
      if(x.requestId!==id || x.status!=="READY" || x.stage!=="READY" ||
        !x.spreadsheetId ||
        (x.operationMode!=="CREATE"&&x.operationMode!=="UPDATE")) {
        throw Error("INVALID_READY:"+SECRET);
      }
      return x;
    },
    vaaQaReadyMigrationTargetArchiveReadOnly:()=>{
      state.calls.targetAudits++;
      const noCopy=!state.archive.has(IDS[0]);
      return {
        pass:noCopy&&!opts.priorAuditBad,propertySnapshotReads:2,
        propertiesStableAcrossReads:true,
        targetFilesVerified:4,v1ArchiveMissingCount:noCopy?4:3,
        v1ArchiveExactMatchCount:noCopy?0:1,
        v1ArchiveConflictCount:0,v2LegacyAbsentCount:4,
        v2PreviousFiveEventsPreserved:true,
        v1ArchiveExpectedRowCount:noCopy,
        v1SyntheticOriginalPreserved:true,archiveWrites:0,
        propertyWrites:0
      };
    },
    vaaQaReadyMigrationSameSnapshot_:(a,b)=>{
      const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
      return ak.length===bk.length && ak.every((k,i)=>k===bk[i]&&a[k]===b[k]);
    },
    vaaQaReadyMigrationInventorySummary_:()=>({
      requestPropertyCount:7,structurallyCopyableCount:4,exclusionCount:3,
      exclusionCounts:{nonReady:1,journalTestNamespace:2,
        updateTargetLeasePresent:0}
    }),
    LockService:{getScriptLock:()=>{
      state.calls.locks++;
      return {waitLock:()=>{if(opts.lockUnavailable)
        throw Error("LOCK_TIMEOUT");},
        releaseLock:()=>state.calls.releases++};
    }},
    vaaLedgerReadyCopyOneUnderLock_:(_,id)=>{
      state.calls.copy++;
      if(id!==IDS[0])throw Error("WRONG_ID");
      if(state.archive.has(id))return {state:"VERIFIED_EXISTING"};
      state.calls.append++;
      state.archive.set(id,properties["REQ_"+id]);
      if(opts.uncertainWrite)throw Error("SHEETS_RESPONSE_LOST:"+SECRET);
      return {state:"COPIED_AND_VERIFIED"};
    },
    vaaQaLedgerReadyCheckPrivateTestLedger_:()=>({
      getLastRow:()=>state.archive.size+1
    }),
    vaaLedgerReadyLookupFromSheet_:(_,id)=>{
      state.calls.archiveReads++;
      if(opts.archiveUnavailable)throw Error("PRIVATE_ARCHIVE_FAIL:"+SECRET);
      const raw=state.archive.get(id);
      return raw===undefined?{state:"NOT_FOUND"}:
        {state:"FOUND",raw,revision:1};
    },
    vaaLedgerJournalOpenReadOnly_:()=>({sheet:{getLastRow:()=>6}}),
    vaaLedgerJournalLookupFromSheet_:(_,id)=>{
      if(IDS.includes(id))return {state:"ABSENT"};
      if(id===FAILED)return {state:"RESERVED",revision:1};
      const raw=properties["REQ_"+id];
      if(id===CREATED||id===UPDATED){
        return {state:"READY",revision:2,
          latest:{body:{receipt:JSON.parse(raw)}}};
      }
      throw Error("UNKNOWN_ID");
    }
  };
  const ctx=vm.createContext(contexts);
  vm.runInContext(source,ctx);
  return {
    ctx,state,properties,
    off:()=>ctx.vaaQaReadyCopyOneOffPreflightReadOnly(),
    armed:()=>ctx.vaaQaReadyCopyOneArmedPreflightReadOnly(),
    once:()=>ctx.vaaQaReadyCopyFirstOnce(),
    inspect:()=>ctx.vaaQaReadyCopyFirstInspectReadOnly(),
    setMode:m=>{properties.VAA_QA_READY_COPY_ONE_MODE=m;}
  };
}

test("OFF state read-only preflight passes but armed one rejects",()=>{
  const h=harness();
  const a=h.off(),b=h.armed();
  assert.equal(a.pass,true);
  assert.equal(a.copyModeOff,true);
  assert.equal(a.propertiesWritten,false);
  assert.equal(b.pass,false);
  assert.equal(b.correctlyArmed,false);
  assert.equal(h.state.calls.copy,0);
  assert.equal(h.state.calls.append,0);
  assert.equal(h.state.calls.locks,0);
});
test("armed preflight passes only for explicit TEST mode, selected G4 CREATE, and unchanged prior audit",()=>{
  const h=harness({arm:true});
  assert.equal(h.off().pass,false);
  const a=h.armed();
  assert.equal(a.pass,true);
  assert.equal(a.knownOneG4CreateTarget,true);
  assert.equal(a.selectedLegacyReadyAbsentFromV1,true);
  assert.equal(h.state.calls.copy,0);
});
test("copy once appends exactly one V1 row, leaves all 7 receipts and V2 untouched; inspector agrees",()=>{
  const h=harness({arm:true});
  const before=JSON.stringify(h.properties);
  const res=h.once();
  assert.equal(res.pass,true,JSON.stringify(res));
  assert.equal(res.actualCopyAttempted,true);
  assert.equal(res.copyAndReadbackVerified,true);
  assert.equal(res.allScriptPropertiesUnchanged,true);
  assert.equal(JSON.stringify(h.properties),before);
  assert.equal(h.state.calls.copy,1);
  assert.equal(h.state.calls.append,1);
  assert.equal(h.state.calls.releases,1);
  const audit=h.inspect();
  assert.equal(audit.pass,true,JSON.stringify(audit));
  assert.equal(audit.archivedState,"FOUND");
  assert.equal(audit.independentArchiveReadsMatch,true);
  assert.equal(audit.archivedReceiptExactlyMatchesProperty,true);
  assert.equal(audit.otherThreeV1Absent,true);
  assert.equal(audit.journalRowsStillSix,true);
  assert.equal(audit.propertySnapshotsStable,true);
});
test("post-copy OFF and ARMED preflights do not authorize a second append",()=>{
  const h=harness({arm:true});
  assert.equal(h.once().pass,true);
  assert.equal(h.armed().pass,false);
  assert.equal(h.off().pass,false);
  assert.equal(h.state.calls.append,1);
});
test("lost Sheets response after write never creates automatic retry; inspector finds written row",()=>{
  const h=harness({arm:true,uncertainWrite:true});
  const res=h.once();
  assert.equal(res.pass,false);
  assert.equal(res.actualCopyAttempted,true);
  assert.equal(res.copiedRowState,"UNKNOWN");
  assert.equal(res.errorStage,"COPY_OR_UNKNOWN");
  assert.equal(res.retryAuthorized,false);
  assert.equal(h.state.calls.append,1);
  assert.equal(h.inspect().pass,true);
  assert.equal(h.state.calls.append,1);
});
test("OFF mode, wrong test scope or failed prior audit cannot write",()=>{
  for(const options of [{},{arm:true,badScope:true},{arm:true,priorAuditBad:true},
    {arm:true,lockUnavailable:true}]){
    const h=harness(options);
    const res=h.once();
    assert.equal(res.pass,false,JSON.stringify(options));
    assert.equal(h.state.calls.copy,0);
    assert.equal(h.state.calls.append,0);
  }
});
test("partial or missing archive is reported by read-only inspector with no mutation",()=>{
  const h=harness();
  const out=h.inspect();
  assert.equal(out.pass,false);
  assert.equal(out.archivedState,"NOT_FOUND");
  assert.equal(out.archiveRowsExactlyThree,false);
  assert.equal(h.state.calls.copy,0);
  assert.equal(h.state.calls.append,0);
});
test("source drift, no permission or inaccessible V1 archive fail closed",()=>{
  const a=harness({drift:true});
  assert.equal(a.off().pass,false);
  const b=harness({arm:true,archiveUnavailable:true});
  assert.equal(b.inspect().pass,false);
  assert.equal(b.inspect().failureStage,"ARCHIVE");
});
test("log summaries never expose IDs, receipt data, archive references or token",()=>{
  const h=harness({arm:true,uncertainWrite:true});
  h.once();h.inspect();
  const text=h.state.calls.logs.join("\n");
  for(const item of [SECRET,WORKBOOK,FAILED,CREATED,UPDATED,SYNTHETIC,
    IDS[0],IDS[1],IDS[2],IDS[3],"REQ_QA_G4_HISTORIC_CREATE"]){
    assert.equal(text.includes(item),false,item);
  }
  assert.equal(text.includes("VAA_QA_READY_COPY_ONE"),true);
});
test("editor-only copy wrapper has no direct REQ mutation, doPost or cleanup calls",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,/\.(?:setProperty|setProperties|deleteProperty|deleteAllProperties|appendRow|setValues|trash|moveTo)\s*\(/);
  assert.doesNotMatch(source,/\bdoPost\s*\(|UrlFetchApp|ScriptApp/);
  assert.match(source,/vaaLedgerReadyCopyOneUnderLock_/);
  assert.match(source,/LockService\.getScriptLock\(\)/);
});
