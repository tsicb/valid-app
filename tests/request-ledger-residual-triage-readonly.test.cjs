"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const script=fs.readFileSync(path.join(__dirname,
  "../central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs"),"utf8");

function iterator(items) {
  let i=0;
  return {hasNext:()=>i<items.length,next:()=>items[i++]};
}
const ready=(id,target)=>({requestId:id,status:"READY",stage:"READY",
  operationMode:"CREATE",spreadsheetId:target});
function fixture(opt={}){
  const entries=[
    {type:"OLD_UPDATE_NO_PROOF",id:"OLD_UPDATE",record:{
      requestId:"OLD_UPDATE",status:"READY",stage:"READY",
      operationMode:"UPDATE",spreadsheetId:"MISSING_A",
      targetSpreadsheetId:"MISSING_A"}},
    {type:"OLD_READY_TARGET",id:"ACTIVE",record:ready("ACTIVE","ACTIVE_SHEET")},
    {type:"OLD_READY_TARGET",id:"TRASH",record:ready("TRASH","TRASH_A")},
    {type:"OLD_READY_TARGET",id:"EXTERNAL",record:ready("EXTERNAL","OUTSIDE_B")},
    {type:"OLD_READY_TARGET",id:"MODERN",record:ready("MODERN","ACTIVE_SHEET")},
    {type:"NON_READY",id:"ERROR",record:{
      requestId:"ERROR",status:"ERROR",spreadsheetId:"OUTSIDE_C"}}
  ];
  const snapshot={
    RPTREG_OUTSIDE_B:JSON.stringify({spreadsheetId:"OUTSIDE_B"}),
    VIEWER_HASH_A:JSON.stringify({spreadsheetId:"OUTSIDE_B"}),
    VAA_PROD_LEGACY_MIGRATION_MODE:"OFF"
  };
  entries.forEach(x=>{snapshot["REQ_"+x.id]=JSON.stringify(x.record);});
  if(opt.malformedViewer)snapshot.VIEWER_HASH_A="{bad json}";
  if(opt.malformedRegistry)snapshot.RPTREG_OUTSIDE_B="{bad json}";
  const counters={writes:0,deletes:0,log:[],driveCalls:0,journalReads:0,
    getFolders:0,getFiles:0};
  const props={
    getProperties:()=>({...snapshot}),
    setProperty:()=>{counters.writes++;},
    deleteProperty:()=>{counters.deletes++;}
  };
  const file=(id,trashed=false)=>({
    getId:()=>id,isTrashed:()=>trashed,
    getParents:()=>iterator([])
  });
  const child={
    getId:()=>"CHILD_1",isTrashed:()=>false,
    getFilesByType:()=>{counters.getFiles++;return iterator([
      file("ACTIVE_SHEET")
    ]);}
  };
  const root={
    getId:()=>"ROOT",isTrashed:()=>!!opt.rootTrashed,
    getFolders:()=>{counters.getFolders++;if(opt.folderError)throw Error("SECRET");
      return iterator(opt.noChild?[]:[child]);},
    getFilesByType:()=>{counters.getFiles++;return iterator([
      file("ROOT_SHEET")
    ]);}
  };
  const mock={
    console:{log:x=>counters.log.push(String(x))},
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_",
      REPORT_REGISTRY_PREFIX:"RPTREG_",SHEET_OUTPUT_FOLDER_ID:"ROOT"},
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    DriveApp:{
      getFolderById:id=>id==="ROOT"?root:(()=>{throw Error("SECRET");})(),
      getFileById:id=>{
        counters.driveCalls++;
        if(id==="TRASH_A")return file(id,true);
        if(id==="OUTSIDE_B"||id==="OUTSIDE_C")return file(id);
        if(id==="MISSING_A")throw Error("SECRET");
        return file(id);
      }
    },
    PropertiesService:{getScriptProperties:()=>props},
    vaaLedgerJournalOpenReadOnly_:()=>({sheet:{}}),
    vaaLedgerJournalLookupFromSheet_:(_sheet,id)=>{
      counters.journalReads++;
      return id==="MODERN"?{state:"READY",revision:2}:{state:"ABSENT"};
    },
    vaaLedgerProdLegacyEntries_:()=>{
      const src=entries.filter(x=>x.type==="OLD_READY_TARGET").map(x=>({
        id:x.id,raw:snapshot["REQ_"+x.id],record:x.record
      }));
      return {ready:src,quarantined:[{id:"OLD_UPDATE"}],
        nonReady:1,modern:0};
    },
    vaaUtf8ByteLength_:str=>Buffer.byteLength(str,"utf8"),
    fileIsInManagedOutputTree_:(_file,_root)=>!!opt.rosterMismatch
  };
  const legacyEntriesMock=mock.vaaLedgerProdLegacyEntries_;
  const context=vm.createContext(mock);
  vm.runInContext(script,context);
  // Script declarations replace context properties: restore captured fixture.
  context.vaaLedgerProdLegacyEntries_=legacyEntriesMock;
  if(opt.mutateOnRead){
    let call=0;
    props.getProperties=()=>{
      call++;
      if(call>=2)snapshot.UNRELATED="VERY_SECRET_MUTATION_456";
      return {...snapshot};
    };
  }
  const result=context.vaaLedgerProdResidualReqTriageReadOnly();
  return {result,counters,snapshot};
}
function bucket(out,name){
  return out.categories.find(x=>x.category===name);
}
test("one read-only audit classifies old UPDATE, active, trashed, linked, and ERROR",()=>{
  const {result:r,counters:c}=fixture();
  assert.equal(r.pass,true);
  assert.equal(r.inventoryComplete,true);
  assert.equal(r.sourceStable,true);
  assert.equal(r.referencesComplete,true);
  assert.equal(r.residualReqCount,5);
  assert.equal(r.modernExcluded,1);
  assert.equal(r.oldUpdateNoProof,1);
  assert.equal(r.nonReady,1);
  assert.equal(r.folderCount,2);
  assert.equal(r.uniqueManagedSheets,2);
  assert.equal(bucket(r,"CURRENT_MANAGED").count,1);
  assert.equal(bucket(r,"OUTSIDE_NO_LINK").count,1);
  assert.equal(bucket(r,"OUTSIDE_WITH_LINK").count,1);
  assert.equal(bucket(r,"TRASHED").count,1);
  assert.equal(bucket(r,"ERROR_REVIEW").count,1);
  assert.equal(bucket(r,"UNKNOWN").count,0);
  assert.equal(r.driveCannotOpen,1);
  assert.equal(r.driveTrashed,1);
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(r.propertyWrites,0);
  assert.equal(r.propertyDeletes,0);
  assert.equal(c.writes,0);
  assert.equal(c.deletes,0);
  assert.equal(c.getFolders,1);
  assert.equal(c.getFiles,2);
  assert.equal(c.log.length,1);
  const wire=c.log[0];
  assert.match(wire,/^VAA_RESIDUAL_REQ_TRIAGE /);
  for(const value of ["MISSING_A","ACTIVE_SHEET","OUTSIDE_B",
    "TRASH_A","REQ_OLD_UPDATE","SECRET"]){
    assert.equal(wire.includes(value),false,
      "must not log a private ID, URL or exception: "+value);
  }
  assert.equal(r.sourceKinds.reduce((n,g)=>n+g.count,0),5);
  assert.equal(r.categories.reduce((n,g)=>n+g.count,0),5);
  assert.ok(r.categories.every(x=>Number.isFinite(x.estimatedBytes)));
});
test("missing file is not called deleted: only outside a COMPLETE managed roster",()=>{
  const {result:r}=fixture();
  assert.equal(r.inventoryComplete,true);
  assert.equal(bucket(r,"OUTSIDE_NO_LINK").count,1);
  assert.equal(r.driveCannotOpen,1);
  assert.equal(r.cleanupAuthorized,false);
});
test("incomplete managed folder enumeration fails closed, without absence claims",()=>{
  const {result:r,counters:c}=fixture({folderError:true});
  assert.equal(r.pass,false);
  assert.equal(r.inventoryComplete,false);
  assert.equal(r.errorStage,"FOLDER_INVENTORY");
  assert.equal(r.errorCode,"TRIAGE_FOLDER_INVENTORY_FAILED");
  assert.equal(r.residualReqCount,0);
  assert.equal(bucket(r,"OUTSIDE_NO_LINK").count,0);
  assert.equal(c.writes+c.deletes,0);
});
test("trashed root fails closed",()=>{
  const {result:r}=fixture({rootTrashed:true});
  assert.equal(r.pass,false);
  assert.equal(r.inventoryComplete,false);
  assert.equal(bucket(r,"OUTSIDE_NO_LINK").count,0);
});
test("malformed viewer/registry prevents 'unlinked' classification",()=>{
  for(const opt of [{malformedViewer:true},{malformedRegistry:true}]){
    const {result:r}=fixture(opt);
    assert.equal(r.pass,true);
    assert.equal(r.referencesComplete,false);
    assert.ok(r.malformedReferences>0);
    assert.equal(bucket(r,"OUTSIDE_NO_LINK").count,0);
    assert.equal(bucket(r,"UNKNOWN").count,1);
    assert.equal(bucket(r,"CURRENT_MANAGED").count,1);
    assert.equal(r.cleanupAuthorized,false);
  }
});
test("source property drift fails closed and reports no secret content",()=>{
  const {result:r,counters:c}=fixture({mutateOnRead:true});
  assert.equal(r.pass,false);
  assert.equal(r.sourceStable,false);
  assert.equal(r.errorStage,"SOURCE_STABILITY");
  assert.equal(r.errorCode,"TRIAGE_SOURCE_CHANGED");
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(c.writes+c.deletes,0);
  assert.equal(c.log[0].includes("VERY_SECRET_MUTATION_456"),false);
});
test("Drive inventory / parents disagreement fails closed",()=>{
  const {result:r,counters:c}=fixture({rosterMismatch:true});
  assert.equal(r.pass,false);
  assert.equal(r.errorStage,"CLASSIFY");
  assert.equal(r.errorCode,"TRIAGE_CLASSIFICATION_UNVERIFIED");
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(c.writes+c.deletes,0);
});
