"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const from=html.indexOf("function vaaAwaitUpdateConfirmation(");
const to=html.indexOf("function measureJsonBytes(",from);
if(from<0 || to<from)throw Error("Update-confirmation function anchors changed");
const source=html.slice(from,to);

function makeDom() {
  const elements=new Map();
  const rootListeners=new Map();
  function eventTarget(id) {
    const listeners=new Map();
    const classes=new Set(["hidden"]);
    return {
      id,checked:false,disabled:false,textContent:"",className:"",attrs:{},
      classList:{
        add:x=>classes.add(x),
        remove:x=>classes.delete(x),
        contains:x=>classes.has(x),
        toggle:(x,active)=>{if(active)classes.add(x);else classes.delete(x);}
      },
      focus(){this.focused=true;},
      setAttribute(key,value){this.attrs[key]=value;},
      addEventListener(type,fn){listeners.set(type,fn);},
      removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);},
      click(){
        if(this.disabled)return;
        const handler=listeners.get("click");
        if(handler)handler({type:"click",target:this});
      },
      change(){listeners.get("change")?.(this.checked);},
      hasListener:type=>listeners.has(type)
    };
  }
  const doc={
    getElementById(id){
      if(!elements.has(id))elements.set(id,eventTarget(id));
      return elements.get(id);
    },
    addEventListener(type,fn){rootListeners.set(type,fn);},
    removeEventListener(type,fn){if(rootListeners.get(type)===fn)rootListeners.delete(type);},
    keydown(key){rootListeners.get("keydown")?.({key});}
  };
  const scope={document:doc,vaaUpdateTargetDisplayName:()=> "検証用の架空企業"};
  vm.createContext(scope);
  vm.runInContext(source,scope,{filename:"index-confirm-flow.js"});
  const openConfirm=(options={})=>scope.vaaAwaitUpdateConfirmation({
    mode:options.mode||"APPEND",
    spreadsheetId:"TEST_SHEET_01",appRows:9,appFiles:1,jobFiles:1,
    unmatchedJobWarning: Boolean(options.unmatchedJobWarning),
    onConfirmed:options.onConfirmed
  });
  return {doc,element:id=>doc.getElementById(id),openConfirm};
}

test("UPDATE confirmation stays on index until the user's actual consent click",async()=>{
  const ui=makeDom();
  let tabs=0,clicked=false;
  const result=ui.openConfirm({
    onConfirmed:()=>{
      clicked=true;
      tabs++;
    }
  });
  assert.equal(tabs,0,"do not create a viewer tab when the modal appears");
  assert.equal(ui.element("vaaUpdateConfirmModal").classList.contains("hidden"),false);
  assert.equal(ui.element("vaaUpdateConfirmCompany").textContent,"対象企業：検証用の架空企業");
  assert.equal(ui.element("vaaUpdateConfirmAccept").disabled,false);
  ui.element("vaaUpdateConfirmAccept").click();
  assert.equal(clicked,true,"onConfirmed is invoked synchronously inside user click");
  assert.equal(tabs,1);
  assert.equal(await result,true);
  assert.equal(ui.element("vaaUpdateConfirmModal").classList.contains("hidden"),true);
  assert.equal(ui.element("vaaUpdateConfirmAccept").hasListener("click"),false);
  ui.element("vaaUpdateConfirmAccept").click();
  assert.equal(tabs,1,"confirmation cannot reserve multiple tabs");
});

test("cancellation and Escape never reserve a tab or start an update",async()=>{
  for(const closing of ["vaaUpdateConfirmCancel","vaaUpdateConfirmClose","vaaUpdateConfirmBackdrop","Escape"]){
    const ui=makeDom();
    let tabs=0;
    const awaiting=ui.openConfirm({onConfirmed:()=>tabs++});
    if(closing==="Escape")ui.doc.keydown("Escape");
    else ui.element(closing).click();
    assert.equal(await awaiting,false);
    assert.equal(tabs,0,closing);
    assert.equal(ui.element("vaaUpdateConfirmModal").classList.contains("hidden"),true);
  }
});

test("REPLACE must be acknowledged before its confirmation click can open a viewer tab",async()=>{
  const ui=makeDom();
  let tabs=0;
  const result=ui.openConfirm({mode:"REPLACE",onConfirmed:()=>tabs++});
  const accept=ui.element("vaaUpdateConfirmAccept");
  assert.equal(accept.disabled,true);
  assert.equal(tabs,0);
  accept.click();
  assert.equal(tabs,0);
  const ack=ui.element("vaaUpdateConfirmAck");
  ack.checked=true;
  ack.change();
  assert.equal(accept.disabled,false);
  accept.click();
  assert.equal(tabs,1);
  assert.equal(await result,true);
});

test("existing CREATE tab reservation remains tied to the first run click",()=>{
  const clickAt=html.indexOf("document.getElementById('runBtn').addEventListener('click'");
  const block=html.slice(clickAt,html.indexOf("                // 複数の応募CSVを並列で読み込み",clickAt));
  assert.match(block,/let viewerTab = targetSpreadsheetId\s*\?\s*null\s*:\s*reserveViewerTab\(/);
  assert.ok(block.indexOf("reserveViewerTab(")>block.indexOf("startEtlProcessingOverlay()"));
  assert.match(block,/globalLastUpdateStrategy = targetSpreadsheetId/);
  assert.ok(block.indexOf("globalLastUpdateStrategy = targetSpreadsheetId") <
    block.indexOf("const viewerTab =") || !block.includes("const viewerTab ="));
});

test("UPDATE mode is fixed early; confirmation callback opens tab before saving, never earlier",()=>{
  const clickAt=html.indexOf("document.getElementById('runBtn').addEventListener('click'");
  const modeAt=html.indexOf("globalLastUpdateStrategy = targetSpreadsheetId",clickAt);
  const csvAt=html.indexOf("await Promise.all(",clickAt);
  const modalAt=html.indexOf("const confirmed = await vaaAwaitUpdateConfirmation(",clickAt);
  const tabAt=html.indexOf("onConfirmed: () => {",modalAt);
  const createAt=html.indexOf("const published =",modalAt);
  assert.ok(clickAt<modeAt && modeAt<csvAt,"snapshot mode before async CSV work");
  assert.ok(modalAt<tabAt && tabAt<createAt,"viewer tab reservation belongs to modal click");
  assert.match(html.slice(tabAt,createAt),/viewerTab = reserveViewerTab\(/);
  assert.doesNotMatch(html.slice(modalAt,createAt),
    /globalLastUpdateStrategy = document.querySelector/);
  assert.match(html.slice(modalAt,createAt),/if \(!confirmed\)/);
  assert.match(html.slice(modalAt,createAt),/return;/);
});

test("unmatched-job notice is visible in UPDATE modal before a report tab exists",async()=>{
  const ui=makeDom();
  let tabs=0;
  const accepted=ui.openConfirm({
    unmatchedJobWarning:true,
    onConfirmed:()=>tabs++
  });
  const warning=ui.element("vaaUpdateConfirmUnmatchedWarning");
  assert.equal(warning.classList.contains("hidden"),false);
  assert.match(warning.textContent,/求人突合が0件/);
  assert.match(warning.textContent,/求人CSVは分析に使わず/);
  assert.equal(tabs,0,"a warning never opens a viewer tab by itself");
  ui.element("vaaUpdateConfirmAccept").click();
  assert.equal(await accepted,true);
  assert.equal(tabs,1,"only a click accepting both warnings can reserve the viewer tab");
});

test("cancelling UPDATE with unmatched-job warning does not open report or save",async()=>{
  const ui=makeDom();
  let tabs=0;
  const accepted=ui.openConfirm({
    unmatchedJobWarning:true,
    onConfirmed:()=>tabs++
  });
  ui.element("vaaUpdateConfirmCancel").click();
  assert.equal(await accepted,false);
  assert.equal(tabs,0);
});

test("normal UPDATE hides the warning, including after previous warned dialog",async()=>{
  const ui=makeDom();
  const first=ui.openConfirm({unmatchedJobWarning:true});
  assert.equal(ui.element("vaaUpdateConfirmUnmatchedWarning").classList.contains("hidden"),false);
  ui.element("vaaUpdateConfirmCancel").click();
  assert.equal(await first,false);
  const second=ui.openConfirm({unmatchedJobWarning:false});
  const warning=ui.element("vaaUpdateConfirmUnmatchedWarning");
  assert.equal(warning.classList.contains("hidden"),true);
  assert.equal(warning.textContent,"");
  ui.element("vaaUpdateConfirmCancel").click();
  assert.equal(await second,false);
});

test("REPLACE requires the destructive checkbox even when unmatched-job notice is shown",async()=>{
  const ui=makeDom();
  let tabs=0;
  const accepted=ui.openConfirm({mode:"REPLACE",unmatchedJobWarning:true,onConfirmed:()=>tabs++});
  const accept=ui.element("vaaUpdateConfirmAccept");
  assert.equal(accept.disabled,true);
  assert.equal(ui.element("vaaUpdateConfirmUnmatchedWarning").classList.contains("hidden"),false);
  accept.click();
  assert.equal(tabs,0);
  const ack=ui.element("vaaUpdateConfirmAck");
  ack.checked=true;
  ack.change();
  accept.click();
  assert.equal(await accepted,true);
  assert.equal(tabs,1);
});

test("no second unmatched-job confirm runs after UPDATE has opened report tab",()=>{
  const fnAt=html.indexOf("async function createGoogleSpreadsheet(");
  const firstCheck=html.indexOf("jobFileCount > 0 &&",fnAt);
  const tabAt=html.indexOf("const viewerTab =",firstCheck);
  const block=html.slice(firstCheck,tabAt);
  assert.match(block,/if \(targetSpreadsheetId\)/);
  assert.match(block,/if \(!unmatchedJobAcknowledged\)/);
  assert.match(block,/else \{\s*\/\/ Preserve existing CREATE behavior/);
  assert.match(block,/window\.confirm\(/);
  const invoke=html.slice(
    html.indexOf("const confirmed = await vaaAwaitUpdateConfirmation(",tabAt),
    html.indexOf("const published =",tabAt)
  );
  assert.match(invoke,/unmatchedJobWarning,/);
  assert.match(invoke,/unmatchedJobAcknowledged = unmatchedJobWarning/);
  assert.match(invoke,/viewerTab = reserveViewerTab\(/);
  assert.ok(
    invoke.indexOf("unmatchedJobWarning,") < invoke.indexOf("onConfirmed:"),
    "warning must be rendered before modal consent click"
  );
});
