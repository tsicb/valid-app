"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "../central-api/15_Property_Capacity_Diagnostics.gs"),
    "utf8"
);
const NOW = Date.parse("2026-11-18T03:12:04.000Z");
const day = 86400000;
const dateBefore = n => new Date(NOW - n * day).toISOString();

function contextFor(properties) {
    let reads = 0;
    const logs = [];
    const store = {
        getProperties() { reads++; return {...properties}; },
        setProperty() { throw Error("MUST NOT WRITE"); },
        setProperties() { throw Error("MUST NOT WRITE"); },
        deleteProperty() { throw Error("MUST NOT DELETE"); },
        deleteAllProperties() { throw Error("MUST NOT DELETE"); }
    };
    const ctx = vm.createContext({
        Utilities: {newBlob:value=>({getBytes:()=>Buffer.from(String(value), "utf8")})},
        PropertiesService: {getScriptProperties:()=>store},
        Date, console: {log:s=>logs.push(String(s))}
    });
    vm.runInContext(source, ctx);
    return {ctx, logs, reads:()=>reads};
}
const secret="REDACT_ME_SUPER_SECRET_ABC123";
const token="VIEWER_FAKE_SECRET_TOKEN_VALUE_XYZ";
const workbook="WORKBOOK_PRIVATE_SHEET_ID";
const properties={
    ACCESS_KEY:secret,
    VAA_APPLICATION_IDENTITY_HMAC_V1:"sensitive_hmac_" + secret,
    SCHEMA_VERSION:"3.0",
    SYSTEM_ANALYSIS_DATASTORE_FOLDER_ID:"sensitive_folder_id",
    ["VIEWER_"+token]:JSON.stringify({spreadsheetId:workbook, lastAccessAt:dateBefore(1),accessCount:4}),
    ["RPTREG_"+workbook]:JSON.stringify({spreadsheetId:workbook,fileName:"PRIVATE_CLIENT_COMPANY"}),
    ["VAA_TARGET_UPDATE_"+workbook]:JSON.stringify({requestId:"secret_request",expiresAt:NOW+30000}),
    REQ_DONE: JSON.stringify({status:"READY",createdAt:dateBefore(42),leaseUntil:"",requestId:"PRIVATE_DONE"}),
    REQ_ERROR: JSON.stringify({status:"ERROR",createdAt:dateBefore(95),leaseUntil:"",lastErrorMessage:secret}),
    REQ_PENDING: JSON.stringify({status:"PROCESSING",createdAt:dateBefore(1),leaseUntil:new Date(NOW+90000).toISOString()}),
    REQ_BAD:"not-valid-json",
    REQ_DATELESS:JSON.stringify({status:"READY",createdAt:""}),
    SOME_UNKNOWN_KEY:secret
};

test("readonly scan reads only and logs no property key, value, token, ID or error text",()=>{
    const a=contextFor(properties);
    const result=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",
        a.ctx
    );
    assert.equal(a.reads(),1);
    assert.equal(result.strictReadOnly,true);
    assert.equal(result.includesPropertyValues,false);
    assert.equal(result.includesPropertyKeys,false);
    assert.equal(result.propertyCount,Object.keys(properties).length);
    const output=JSON.stringify(result);
    for(const forbidden of [secret,token,workbook,"SOME_UNKNOWN_KEY","PRIVATE_CLIENT_COMPANY","PRIVATE_DONE","secret_request","REQ_DONE","VIEWER_"+token]){
        assert.equal(output.includes(forbidden),false,forbidden+" was disclosed");
    }
    assert.equal(a.logs.length,0);
    assert.equal(result.estimatedTotalBytes, Object.entries(properties).reduce((n,[key,val])=>n+Buffer.byteLength(key)+Buffer.byteLength(String(val)),0));
    assert.equal(result.estimatedValueBytes, Object.values(properties).reduce((n,val)=>n+Buffer.byteLength(String(val)),0));
});

test("group totals and safe lifecycle summary preserve request statuses and active leases",()=>{
    const {ctx}=contextFor(properties);
    const res=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    const groups=Object.fromEntries(Array.from(res.groups,g=>[g.category,g]));
    assert.equal(groups.REQUEST_RECORDS.count,5);
    assert.equal(groups.VIEWER_MAPPINGS.count,1);
    assert.equal(groups.REPORT_REGISTRY.count,1);
    assert.equal(groups.UPDATE_LEASES.count,1);
    assert.equal(groups.PROTECTED_CONFIG.count,3);
    assert.equal(groups.SYSTEM_CONFIG.count,1);
    assert.equal(groups.OTHER_UNCLASSIFIED.count,1);
    assert.equal(res.requestLifecycle.ready,2);
    assert.equal(res.requestLifecycle.error,1);
    assert.equal(res.requestLifecycle.inProgressOrOther,1);
    assert.equal(res.requestLifecycle.malformed,1);
    assert.equal(res.requestLifecycle.olderThan30Days,2);
    assert.equal(res.requestLifecycle.olderThan90Days,1);
    assert.equal(res.requestLifecycle.activeLease,1);
    assert.equal(res.requestLifecycle.completedOrErrorOlderThan30DaysNoActiveLease,2);
    assert.equal(res.requestLifecycle.missingCreatedAt,1);
});

test("large individual property detected without showing its value",()=>{
    const {ctx}=contextFor({"REQ_BIG":"x".repeat(9200)});
    const result=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(result.groups[0].overSingleValueLimit,1);
    assert.equal(result.largestValueBytes,9200);
    assert.ok(!JSON.stringify(result).includes("xxxxxxxxxx"));
});

test("unknown or fresh requests are never counted as old cleanup candidates",()=>{
    const {ctx}=contextFor({
        REQ_YOUNG:JSON.stringify({status:"READY",createdAt:dateBefore(2)}),
        REQ_BUSY:JSON.stringify({status:"ERROR",createdAt:dateBefore(100),leaseUntil:new Date(NOW+60000).toISOString()}),
        REQ_WORKING:JSON.stringify({status:"PROCESSING",createdAt:dateBefore(100)}),
        REQ_NO_DATE:JSON.stringify({status:"READY"}),
        REQ_UNKNOWN:JSON.stringify({status:"WEIRD",createdAt:dateBefore(100)})
    });
    const result=vm.runInContext(
        "vaaScriptPropertyCapacitySummary_(PropertiesService.getScriptProperties().getProperties(), "+NOW+")",ctx
    );
    assert.equal(result.requestLifecycle.completedOrErrorOlderThan30DaysNoActiveLease,0);
    assert.equal(result.requestLifecycle.activeLease,1);
});

test("editor-run entry point reads exactly once and logs only the safe summary",()=>{
    const {ctx,logs,reads}=contextFor(properties);
    const output=vm.runInContext("vaaAuditScriptPropertyCapacityReadOnly()",ctx);
    assert.equal(output.audit,"SCRIPT_PROPERTY_CAPACITY_READ_ONLY");
    assert.equal(reads(),1);
    assert.equal(logs.length,1);
    assert.match(logs[0],/^VAA_PROPERTY_CAPACITY_READONLY /);
    assert.doesNotMatch(logs[0],/REDACT_ME|PRIVATE_CLIENT|secret_request|VIEWER_FAKE/);
});
