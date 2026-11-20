"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const source = read("qa/Ready_Ledger_Migration_Inventory_ReadOnly_QA.gs");
const capacity = read("central-api/15_Property_Capacity_Diagnostics.gs");
const archive = read("central-api/20_Request_Ready_Ledger_Foundation.gs");
// All relative lease / age fixtures must follow the runtime date. A fixed
// test date caused "future" leases to become expired on the real clock.
const NOW = Date.now();
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
const SECRET = "SECRET_TOKEN_VALUE_NEVER_LOG_999";
const TARGET = "SENSITIVE_SPREADSHEET_ID_123";

function ready(id, mode = "CREATE", extra = {}) {
  return JSON.stringify({
    requestId:id, operationMode:mode,
    status:"READY", stage:"READY",
    spreadsheetId:TARGET,
    createdAt:daysAgo(40), leaseUntil:"",
    ...(mode === "UPDATE" ? {
      targetSpreadsheetId:TARGET,
      updateStrategy:"APPEND",
      updatePayloadDigest:"0123456789abcdef"
    } : {}),
    extraSecret:SECRET,
    ...extra
  });
}

function harness(properties, opt = {}) {
  const calls = {reads:0, writes:0, logs:[]};
  const store = {
    getProperties() {
      calls.reads++;
      if (calls.reads === 2 && opt.drift) return {
        ...properties, REQ_CONCURRENT:ready("CONCURRENT")
      };
      return {...properties};
    },
    setProperty() {calls.writes++;throw Error("DO_NOT_MUTATE");},
    deleteProperty() {calls.writes++;throw Error("DO_NOT_MUTATE");},
    setProperties() {calls.writes++;throw Error("DO_NOT_MUTATE");},
    deleteAllProperties() {calls.writes++;throw Error("DO_NOT_MUTATE");}
  };
  const context = vm.createContext({
    API_CONFIG:{REQUEST_PROPERTY_PREFIX:"REQ_"},
    PropertiesService:{getScriptProperties:()=>store},
    Utilities:{
      newBlob:x=>({getBytes:()=>Buffer.from(String(x),"utf8")})
    },
    console:{log:x=>calls.logs.push(String(x))}
  });
  vm.runInContext(capacity, context);
  vm.runInContext(archive, context);
  vm.runInContext(source, context);
  return {run:()=>vm.runInContext(
    "vaaQaReadyMigrationInventoryReadOnly()", context
  ), summary:()=>context, calls};
}

test("basic inventory counts only structurally-valid legacy READY records",()=>{
  const p = {
    REQ_CREATE:ready("CREATE"),
    REQ_UPDATE:ready("UPDATE","UPDATE"),
    REQ_RECENT:ready("RECENT","CREATE",{createdAt:daysAgo(2)}),
    REQ_DATELESS:ready("DATELESS","CREATE",{createdAt:""}),
    REQ_BADJSON:"NOT_JSON",
    REQ_ERROR:JSON.stringify({requestId:"ERROR",status:"ERROR"}),
    REQ_PARTIAL:ready("PARTIAL","CREATE",{stage:"PROCESSING"}),
    REQ_MISMATCH:ready("DIFFERENT"),
    REQ_BAD_UPDATE:ready("BAD_UPDATE","UPDATE",{updatePayloadDigest:""}),
    REQ_BAD_LEASE:ready("BAD_LEASE","CREATE",{leaseUntil:"invalid-date"}),
    REQ_TARGET_LEASE:ready("TARGET_LEASE","UPDATE"),
    ["VAA_TARGET_UPDATE_"+TARGET]:"old-target-lease",
    REQ_QA_JOURNAL_E2E_UPDATE_20261119_V1:
      ready("QA_JOURNAL_E2E_UPDATE_20261119_V1","UPDATE"),
    ACCESS_KEY:SECRET,
    RPTREG_KEY:"hidden"
  };
  // Target lease applies to ALL UPDATE receipts sharing TARGET,
  // including REQ_UPDATE. Remove the lease from the normal fixture
  // by testing that exclusion separately.
  const h = harness(p);
  const r = h.run();
  assert.equal(r.pass,true);
  assert.equal(r.requestPropertyCount,12);
  assert.equal(r.structurallyCopyableCount,3);
  assert.equal(r.structurallyCopyableByMode.CREATE.count,3);
  assert.equal(r.structurallyCopyableByMode.UPDATE.count,0);
  assert.equal(r.exclusionCounts.updateTargetLeasePresent,2);
  assert.equal(r.exclusionCounts.journalTestNamespace,1);
  assert.equal(r.exclusionCounts.malformedJson,1);
  assert.equal(r.exclusionCounts.nonReady,1);
  assert.equal(r.exclusionCounts.readyStageMismatch,1);
  assert.equal(r.exclusionCounts.invalidRequestId,1);
  assert.equal(r.exclusionCounts.invalidReadyReceipt,1);
  assert.equal(r.exclusionCounts.activeOrInvalidReceiptLease,1);
  assert.equal(r.exclusionCount,9);
  assert.equal(r.candidateAtLeast30DaysOld,1);
  assert.equal(r.candidateCreatedAtUnknownOrFuture,1);
  assert.equal(r.countsReconciled,true);
  assert.equal(h.calls.reads,2);
  assert.equal(h.calls.writes,0);
});

test("valid UPDATE is included when no target lease exists",()=>{
  const h=harness({REQ_UPDATE:ready("UPDATE","UPDATE")});
  const r=h.run();
  assert.equal(r.pass,true);
  assert.equal(r.structurallyCopyableCount,1);
  assert.equal(r.structurallyCopyableByMode.UPDATE.count,1);
  assert.equal(r.exclusionCount,0);
});

test("UPDATE digest/strategy/target integrity is enforced by existing V1 validator",()=>{
  const p={
    REQ_A:ready("A","UPDATE",{updatePayloadDigest:""}),
    REQ_B:ready("B","UPDATE",{updateStrategy:"BAD"}),
    REQ_C:ready("C","UPDATE",{targetSpreadsheetId:"different"}),
    REQ_D:ready("D","CREATE",{spreadsheetId:""}),
    REQ_GOOD:ready("GOOD")
  };
  const r=harness(p).run();
  assert.equal(r.structurallyCopyableCount,1);
  assert.equal(r.exclusionCounts.invalidReadyReceipt,4);
});

test("invalid and active receipt leases are excluded; expired lease needs later review",()=>{
  const r=harness({
    REQ_FUTURE:ready("FUTURE","CREATE",{
      leaseUntil:new Date(NOW+20000).toISOString()
    }),
    REQ_INVALID:ready("INVALID","CREATE",{leaseUntil:"not-a-date"}),
    REQ_EXPIRED:ready("EXPIRED","CREATE",{leaseUntil:daysAgo(1)})
  }).run();
  assert.equal(r.exclusionCounts.activeOrInvalidReceiptLease,2);
  assert.equal(r.structurallyCopyableCount,1);
  assert.equal(r.migrationAuthorized,false);
  assert.equal(r.deletionAuthorized,false);
});

test("audit fails closed when the second Script Properties snapshot has drift",()=>{
  const h=harness({REQ_A:ready("A")},{drift:true});
  const r=h.run();
  assert.equal(r.pass,false);
  assert.equal(r.sourceStableAcrossReads,false);
  assert.equal(r.countsReconciled,true);
  assert.equal(h.calls.writes,0);
});

test("aggregate JSON and log never expose secrets, request IDs, property keys or target IDs",()=>{
  const h=harness({
    REQ_PRIVATE_PERSON:ready("PRIVATE_PERSON","UPDATE"),
    ["VIEWER_"+SECRET]:SECRET,
    ACCESS_KEY:SECRET
  });
  const r=h.run();
  const output=JSON.stringify(r)+" "+h.calls.logs.join(" ");
  for(const sensitive of [
    "PRIVATE_PERSON","REQ_PRIVATE_PERSON","SENSITIVE_SPREADSHEET_ID",
    SECRET,"VIEWER_"+SECRET,"ACCESS_KEY"
  ]) assert.equal(output.includes(sensitive),false,sensitive);
  assert.equal(r.includesPropertyKeys,false);
  assert.equal(r.includesPropertyValues,false);
  assert.equal(r.includesRequestIds,false);
  assert.equal(r.ledgerReadOrWritten,false);
  assert.equal(r.driveTargetsChecked,false);
  assert.equal(r.archiveCoverageChecked,false);
  assert.equal(r.cleanupPerformed,false);
  assert.equal(h.calls.logs.length,1);
  assert.match(h.calls.logs[0],/^VAA_QA_READY_MIGRATION_INVENTORY /);
});

test("empty request store still reconciles and never authorizes a migration",()=>{
  const r=harness({ACCESS_KEY:SECRET}).run();
  assert.equal(r.pass,true);
  assert.equal(r.requestPropertyCount,0);
  assert.equal(r.structurallyCopyableCount,0);
  assert.equal(r.exclusionCount,0);
  assert.equal(r.migrationAuthorized,false);
  assert.equal(r.deletionAuthorized,false);
});

test("the QA source is syntax-valid and has no mutation or external-service calls",()=>{
  new vm.Script(source);
  assert.doesNotMatch(source,/\.(?:setProperty|setProperties|deleteProperty|deleteAllProperties|appendRow|setValues)\s*\(/);
  assert.doesNotMatch(source,/DriveApp|SpreadsheetApp|UrlFetchApp|LockService|ScriptApp|doPost\s*\(/);
});
