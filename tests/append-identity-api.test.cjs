"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const file=fs.readFileSync(path.join(__dirname,"../central-api/14_Append_Identity.gs"),"utf8");
function makeHarness() {
  const values=new Map();
  let locked=false, generated=0, authenticated=true;
  const props={
    getProperty:key=>values.get(key)||null,
    setProperty:(key,value)=>values.set(key,value)
  };
  const sandbox={
    PropertiesService:{getScriptProperties:()=>props},
    normalizeString_:v=>v===null||v===undefined?"":String(v).trim(),
    LockService:{getScriptLock:()=>({
      waitLock(){if(locked)throw new Error("LOCK_BUSY");locked=true;},
      releaseLock(){locked=false;}
    })},
    Utilities:{getUuid:()=>{
      generated++;
      return "12345678-abcdefab-abcdefab-"+String(generated).padStart(12,"0");
    }},
    validateManageAuth_:()=>authenticated?{ok:true}:{ok:false,code:"AUTH_INVALID",message:"Invalid"},
    errorOutput_:(code,message)=>({ok:false,code,message}),
    jsonOutput_:x=>x,
    API_CONFIG:{EXPECTED_PAGES_VERSION:"PAGE_STABLE"},
    VAAAppendMergeCore:{VERSION:"1"},
    Date
  };
  vm.createContext(sandbox);
  vm.runInContext(file,sandbox,{filename:"14_Append_Identity.gs"});
  return {
    call:payload=>sandbox.vaaHandleIdentityKey_(payload),
    ensure:()=>sandbox.vaaEnsureIdentitySecret_(),
    authenticate:on=>{authenticated=on;},
    keys:values,
    get generated(){return generated;},
    get locked(){return locked;}
  };
}
const request={action:"manageIdentityKey",pagesVersion:"PAGE_STABLE"};
test("unauthorised requests cannot obtain the HMAC secret or initialize it",()=>{
  const h=makeHarness();h.authenticate(false);
  const response=h.call(request);
  assert.equal(response.ok,false);
  assert.equal(response.code,"AUTH_INVALID");
  assert.equal(h.keys.size,0);
});
test("wrong Pages protocol version is rejected before secret issuance",()=>{
  const h=makeHarness();const response=h.call({...request,pagesVersion:"WRONG"});
  assert.equal(response.ok,false);
  assert.equal(response.code,"PAGES_VERSION_MISMATCH");
  assert.equal(h.keys.size,0);
});
test("authorised sessions reuse a long-lived secret with no key rotation",()=>{
  const h=makeHarness();
  const one=h.call(request),two=h.call(request);
  assert.equal(one.ok,true);
  assert.equal(one.keyVersion,"1");
  assert.equal(one.updateProtocol,"IDENTITY_V1");
  assert.equal(one.identitySecret,two.identitySecret);
  assert.ok(one.identitySecret.length>=64);
  assert.equal(h.generated,3);
  assert.equal(h.keys.size,1);
  assert.equal(h.locked,false);
});
test("an existing key is not regenerated and successful auth does not echo ACCESS_KEY",()=>{
  const h=makeHarness();
  h.keys.set("VAA_APPLICATION_IDENTITY_HMAC_V1","previous-secret");
  const out=h.call({...request,accessKey:"test-sensitive-access-key"});
  assert.equal(out.identitySecret,"previous-secret");
  assert.equal(h.generated,0);
  assert.ok(!JSON.stringify(out).includes("test-sensitive-access-key"));
});
test("the entrypoint dispatches manageIdentityKey only by explicitly named route",()=>{
  const entry=fs.readFileSync(path.join(__dirname,"../central-api/02_EntryPoint.gs"),"utf8");
  assert.match(entry,/actionName === 'MANAGEIDENTITYKEY'/);
  assert.match(entry,/vaaHandleIdentityKey_\(payload\)/);
  const writer=fs.readFileSync(path.join(__dirname,"../central-api/01_DataStore_Performance.gs"),"utf8");
  assert.match(writer,/dataObject\.applicationIdentityVersion = VAAAppendMergeCore\.VERSION/);
  assert.match(writer,/normalizeString_\(payload\.updateProtocol\) === 'IDENTITY_V1'/);
});
