"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,
  "../central-api/25_Request_Ledger_V2_Legacy_Batch_Migration.gs"),"utf8");

const SECRET="NEVER_EXPOSE_THIS_PRIVATE_VALUE";
function iter(items){
  let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};
}
const newRec=(id,target)=>({
  requestId:id,status:"READY",stage:"READY",operationMode:"CREATE",
  spreadsheetId:target,internalSecret:SECRET
});
function fixture(options={}){
  const now=Date.now();
  const rows=[
    ["OLD_A","ACTIVE_A"],
    ["OLD_B","OUT_A"],["OLD_C","OUT_A"],
    ["OLD_D","OUT_B"],["OLD_E","OUT_C"],
    ["OLD_F","TRASH_A"],["OLD_G","MISSING_A"],
    ["OLD_H","UNLINKED_A"]
  ].map(x=>({id:x[0],type:"OLD_READY_TARGET",record:newRec(x[0],x[1])}));
  rows.forEach(x=>{x.raw=JSON.stringify(x.record);});
  rows.push({id:"OLD_ERROR",type:"NON_READY",record:{
    requestId:"OLD_ERROR",status:"ERROR",spreadsheetId:"OUT_A"
  }});
  rows[rows.length-1].raw=JSON.stringify(rows[rows.length-1].record);
  const props={
    RPTREG_OUT_A:JSON.stringify({spreadsheetId:"OUT_A"}),
    RPTREG_OUT_B:JSON.stringify({spreadsheetId:"OUT_B"}),
    RPTREG_TRASH_A:JSON.stringify({spreadsheetId:"TRASH_A"}),
    RPTREG_ACTIVE_A:JSON.stringify({spreadsheetId:"ACTIVE_A"}),
    RPTREG_ORPHAN_A:JSON.stringify({spreadsheetId:"ORPHAN_A"}),
    VIEWER_HASH_A:JSON.stringify({spreadsheetId:"OUT_A",
      lastAccessAt:new Date(now-86400000).toISOString(),accessCount:7}),
    VIEWER_HASH_A2:JSON.stringify({spreadsheetId:"OUT_A",
      lastAccessAt:new Date(now-150*86400000).toISOString()}),
    VIEWER_HASH_B:JSON.stringify({spreadsheetId:"OUT_C"}),
    VIEWER_HASH_C:JSON.stringify({spreadsheetId:"ACTIVE_A"}),
    VIEWER_HASH_D:JSON.stringify({spreadsheetId:"ORPHAN_B"}),
    SECRET_FIELD:SECRET
  };
  rows.forEach(x=>{props["REQ_"+x.id]=x.raw;});
  if(options.malformedRef)props.VIEWER_HASH_A="{broken confidential "+SECRET;
  if(options.mismatchRef)props.RPTREG_OUT_A=
    JSON.stringify({spreadsheetId:"DIFFERENT_PRIVATE_SHEET"});
  const stats={writes:0,deletes:0,logs:[],driveCalls:0,folderReads:0,
    filesRead:0};
  const properties={
    getProperties:()=>({...props}),
    setProperty:()=>{stats.writes++;},
    deleteProperty:()=>{stats.deletes++;}
  };
  function file(id,trashed=false){
    return {getId:()=>id,isTrashed:()=>trashed,
      getParents:()=>iter([])};
  }
  const subfolder={
    getId:()=>"CHILD",isTrashed:()=>false,
    getFilesByType:()=>{stats.filesRead++;return iter([file("ACTIVE_A")]);}
  };
  const folder={
    getId:()=>"ROOT",isTrashed:()=>!!options.trashedRoot,
    getFolders:()=>{
      stats.folderReads++;
      if(options.listFail)throw Error(SECRET);
      return iter([subfolder]);
    },
    getFilesByType:()=>{stats.filesRead++;return iter([file("OTHER_MANAGED")]);}
  };
  const mock={
    API_CONFIG:{
      REQUEST_PROPERTY_PREFIX:"REQ_",
      REPORT_REGISTRY_PREFIX:"RPTREG_",
      SHEET_OUTPUT_FOLDER_ID:"ROOT"
    },
    PropertiesService:{getScriptProperties:()=>properties},
    DriveApp:{
      getFolderById:id=>id==="ROOT"?folder:(()=>{throw Error(SECRET);})(),
      getFileById:id=>{
        stats.driveCalls++;
        if(id==="MISSING_A")throw Error(SECRET);
        return file(id,id==="TRASH_A");
      }
    },
    MimeType:{GOOGLE_SHEETS:"GOOGLE_SHEETS"},
    console:{log:x=>stats.logs.push(String(x))},
    vaaUtf8ByteLength_:x=>Buffer.byteLength(x,"utf8"),
    fileIsInManagedOutputTree_:()=>!!options.rosterMismatch
  };
  const cx=vm.createContext(mock);
  vm.runInContext(source,cx);
  cx.vaaLedgerResidualSources_=()=>{
    if(options.badSource)throw Error(SECRET);
    return {rows,modernExcluded:1};
  };
  if(options.drift){
    let count=0;
    properties.getProperties=()=>{
      count++;
      if(count>1)props.SECRET_FIELD="MUTATED_SECRET_VALUE";
      return {...props};
    };
  }
  const result=cx.vaaLedgerProdResidualLinkageAuditReadOnly();
  return {result,stats,props};
}
const named=(items,name)=>items.find(x=>x.category===name);
test("one read-only audit aggregates links by unique sheet and both mapping types",()=>{
  const {result:r,stats:c}=fixture();
  assert.equal(r.pass,true);
  assert.equal(r.strictReadOnly,true);
  assert.equal(r.inventoryComplete,true);
  assert.equal(r.referencesComplete,true);
  assert.equal(r.sourceStable,true);
  assert.equal(r.residualReqCount,9);
  assert.equal(r.readyReqCount,8);
  assert.equal(r.nonReadyCount,1);
  assert.equal(r.modernExcluded,1);
  assert.equal(r.uniqueReadyTargets,7);
  assert.equal(r.registryProperties,5);
  assert.equal(r.viewerProperties,5);
  assert.equal(r.uniqueMappedTargets,7);
  assert.equal(r.linkedReadyReqCount,4);
  assert.equal(r.linkedReadyUniqueTargets,3);
  assert.equal(r.folderCount,2);
  assert.equal(r.uniqueManagedSheets,2);
  assert.deepEqual(r.locations.map(x=>x.requests),[1,4,2,1,0]);
  assert.deepEqual(r.locations.map(x=>x.uniqueTargets),[1,3,2,1,0]);
  assert.deepEqual(r.linkedReadyByMapping.map(x=>x.requests),[2,1,1]);
  assert.deepEqual(r.linkedReadyByMapping.map(x=>x.uniqueTargets),[1,1,1]);
  assert.deepEqual(r.mappedTargets.map(x=>x.uniqueTargets),[1,4,2]);
  assert.deepEqual(r.mappedTargets.map(x=>x.registryProperties),[1,3,1]);
  assert.deepEqual(r.mappedTargets.map(x=>x.viewerProperties),[1,3,1]);
  assert.equal(named(r.mappedTargets,"OUTSIDE_WITH_READY_REQ")
    .targetsWithRecentViewerAccess30Days,1);
  assert.equal(r.mappedOutsideUniqueTargets,6);
  assert.equal(r.propertyWrites+r.propertyDeletes+r.archiveWrites+r.requestPosts,0);
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(c.writes+c.deletes,0);
  assert.equal(c.logs.length,1);
  assert.match(c.logs[0],/^VAA_RESIDUAL_LINKAGE_AUDIT /);
  for(const secret of [SECRET,"OUT_A","OLD_B","ACTIVE_A",
    "VIEWER_HASH_A","MUTATED_SECRET_VALUE"]){
    assert.equal(c.logs[0].includes(secret),false,
      "No source identifier or secret may appear in logs");
  }
  assert.equal(r.linkedReadyByMapping.reduce((a,x)=>a+x.requests,0),
    r.linkedReadyReqCount);
});
test("missing Drive target is outside roster, not proof of hard deletion",()=>{
  const {result:r}=fixture();
  assert.equal(r.pass,true);
  assert.equal(named(r.locations,"OUTSIDE_NO_LINK").requests,2);
  assert.equal(r.cleanupAuthorized,false);
});
test("malformed viewer record or mismatching Registry key is fail-closed",()=>{
  for(const opt of [{malformedRef:true},{mismatchRef:true}]){
    const {result:r,stats:c}=fixture(opt);
    assert.equal(r.pass,false);
    assert.equal(r.referencesComplete,false);
    assert.equal(r.errorStage,"SOURCE");
    assert.equal(r.errorCode,"LINKAGE_SOURCE_UNVERIFIED");
    assert.equal(r.cleanupAuthorized,false);
    assert.equal(c.writes+c.deletes,0);
  }
});
test("missing or trashed managed folder fails closed without absence claim",()=>{
  for(const opt of [{listFail:true},{trashedRoot:true}]){
    const {result:r,stats:c}=fixture(opt);
    assert.equal(r.pass,false);
    assert.equal(r.inventoryComplete,false);
    assert.equal(r.errorStage,"FOLDER_INVENTORY");
    assert.equal(r.errorCode,"LINKAGE_FOLDER_INVENTORY_FAILED");
    assert.equal(r.linkedReadyReqCount,0);
    assert.equal(c.writes+c.deletes,0);
  }
});
test("unexpected registry/parent mismatch stops classification",()=>{
  const {result:r}=fixture({rosterMismatch:true});
  assert.equal(r.pass,false);
  assert.equal(r.errorStage,"CLASSIFY");
  assert.equal(r.errorCode,"LINKAGE_CLASSIFICATION_UNVERIFIED");
  assert.equal(r.cleanupAuthorized,false);
});
test("underlying legacy source failure cannot expose exception details",()=>{
  const {result:r,stats:c}=fixture({badSource:true});
  assert.equal(r.pass,false);
  assert.equal(r.errorStage,"SOURCE");
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(c.logs[0].includes(SECRET),false);
});
test("concurrent Script Property changes fail source stability check",()=>{
  const {result:r,stats:c}=fixture({drift:true});
  assert.equal(r.pass,false);
  assert.equal(r.sourceStable,false);
  assert.equal(r.errorStage,"SOURCE_STABILITY");
  assert.equal(r.errorCode,"LINKAGE_SOURCE_CHANGED");
  assert.equal(r.cleanupAuthorized,false);
  assert.equal(c.logs[0].includes("MUTATED_SECRET_VALUE"),false);
});
