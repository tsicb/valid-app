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
