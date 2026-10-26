"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../report.html"), "utf8");
const sourceBetween = (start, end) => {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "function anchors exist: " + start);
  return html.slice(a, b);
};
const logic = sourceBetween("function moveCustomRowAxisValues(", "function renderCustomAxisReorderControls(");
const pureContext = vm.createContext({
  currentCustomAnalysisState: {rowAxes:["職種","年代","勤務地都道府県"],colAxis:"応募年月",userTouched:false},
  renderCustomAxisControls:()=>{}, scheduleCustomAnalysisRun:()=>{},
  customAxisDisplayLabel:v=>v,
  document:{getElementById:()=>null}
});
vm.runInContext(logic, pureContext, {filename:"report-reorder-core.js"});
const move = (rows,from,to) => Array.from(pureContext.moveCustomRowAxisValues(rows,from,to));

test("HTML keeps original four axis select IDs exactly once and has accessible drag/buttons",()=>{
  for(const id of ["customRowAxis1","customRowAxis2","customRowAxis3","customColAxis","customAxisSortable","customAxisReorderStatus"]){
    assert.equal((html.match(new RegExp('id="' + id + '"',"g"))||[]).length,1,id);
  }
  assert.equal((html.match(/class="custom-axis-row" data-custom-row-index=/g)||[]).length,3);
  assert.equal((html.match(/class="custom-axis-drag-handle"/g)||[]).length,3);
  assert.equal((html.match(/class="custom-axis-reorder-button"/g)||[]).length,6);
  assert.match(html,/role="status" aria-live="polite"/);
  assert.match(html,/\.custom-axis-drag-handle\s*\{[^}]*touch-action:none/);
});
test("all report inline scripts have valid JavaScript syntax",()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>0);
  for(const part of scripts)if(part[1].trim())assert.doesNotThrow(()=>new vm.Script(part[1]));
});
test("reorder first and second without changing the set of selected axes",()=>{
  assert.deepEqual(move(["職種","年代","勤務地都道府県"],0,1),["年代","職種","勤務地都道府県"]);
  assert.deepEqual(move(["職種","年代","勤務地都道府県"],1,0),["年代","職種","勤務地都道府県"]);
  assert.deepEqual(move(["職種","年代","勤務地都道府県"],0,2),["年代","勤務地都道府県","職種"]);
  assert.deepEqual(move(["職種","年代","勤務地都道府県"],2,0),["勤務地都道府県","職種","年代"]);
});
test("unused optional axes are compacted; invalid from/target indices cannot remove rows",()=>{
  assert.deepEqual(move(["職種","年代"],0,2),["年代","職種"]);
  assert.deepEqual(move(["職種","年代",""],1,0),["年代","職種"]);
  assert.deepEqual(move(["職種"],0,2),["職種"]);
  assert.deepEqual(move(["職種","年代"],3,0),["職種","年代"]);
  assert.deepEqual(move(["職種","年代"],0,NaN),["職種","年代"]);
});
test("reordering updates report local state once; no-op leaves the column axis and Sheet defaults alone",()=>{
  let render=0, aggregate=0, announcement="";
  const context=vm.createContext({
    currentCustomAnalysisState:{rowAxes:["職種","年代","勤務地都道府県"],colAxis:"応募年月",userTouched:false},
    renderCustomAxisControls:()=>render++,
    scheduleCustomAnalysisRun:()=>aggregate++,
    customAxisDisplayLabel:v=>v,
    document:{getElementById:id=>id==="customAxisReorderStatus"?{set textContent(v){announcement=v;}}:null}
  });
  vm.runInContext(logic,context);
  assert.equal(context.applyCustomRowAxisReorder(0,2),true);
  assert.deepEqual(Array.from(context.currentCustomAnalysisState.rowAxes),["年代","勤務地都道府県","職種"]);
  assert.equal(context.currentCustomAnalysisState.colAxis,"応募年月");
  assert.equal(context.currentCustomAnalysisState.userTouched,true);
  assert.equal(render,1); assert.equal(aggregate,1);
  assert.match(announcement,/年代、勤務地都道府県、職種/);
  assert.equal(context.applyCustomRowAxisReorder(2,2),false);
  assert.equal(render,1); assert.equal(aggregate,1);
});
test("pointer drop, cancellation, and keyboard arrows cause at most one reorder per operation",()=>{
  const listeners=new Map(),calls=[], previews=[];
  const mkClasses=()=>{const classes=new Set();return {add:x=>classes.add(x),remove:(...keys)=>keys.forEach(k=>classes.delete(k)),toggle:(x,on)=>on?classes.add(x):classes.delete(x),contains:x=>classes.has(x)};};
  const rows=Array.from({length:3},(_,i)=>({dataset:{customRowIndex:String(i)},classList:mkClasses(),querySelector:()=>null}));
  const handles=rows.map((row,i)=>({
    disabled:false,
    closest:q=>q===".custom-axis-drag-handle"?handles[i]:q===".custom-axis-row"?row:null,
    setPointerCapture(){this.captured=true;},
    hasPointerCapture(){return !!this.captured;},
    releasePointerCapture(){this.captured=false;}
  }));
  const list={
    dataset:{},addEventListener:(type,handler)=>listeners.set(type,handler),
    contains:()=>true,querySelectorAll:()=>rows
  };
  const doc={
    getElementById:()=>list,
    createElement:()=>({style:{},remove(){this.removed=true;}}),
    body:{appendChild:x=>previews.push(x)},
    elementFromPoint:(x,y)=>({closest:()=>x>500?null:rows[y>=150?2:y>=75?1:0]})
  };
  const ctx=vm.createContext({document:doc,
    currentCustomAnalysisState:{rowAxes:["職種","年代","勤務地都道府県"]},
    customAxisDisplayLabel:x=>x,applyCustomRowAxisReorder:(from,to)=>calls.push([from,to])});
  vm.runInContext(sourceBetween("let customRowPointerDrag = null;", "function runCustomAnalysisNow()"),ctx);
  ctx.bindCustomRowAxisReorderControls();
  ctx.bindCustomRowAxisReorderControls();
  const event=(target,y,id=9)=>({pointerId:id,pointerType:"mouse",button:0,isPrimary:true,target,clientX:12,clientY:y,preventDefault(){}});
  listeners.get("pointerdown")(event(handles[0],0));
  listeners.get("pointermove")(event(handles[0],180));
  assert.equal(calls.length,0,"do not reaggregate while pointer is moving");
  assert.equal(previews.length,1);
  assert.equal(rows[2].classList.contains("is-drop-target"),true);
  listeners.get("pointerup")(event(handles[0],180));
  assert.deepEqual(calls,[[0,2]]);
  assert.equal(previews[0].removed,true);
  listeners.get("pointerdown")(event(handles[1],75,10));
  listeners.get("pointermove")(event(handles[1],10,10));
  listeners.get("pointercancel")(event(handles[1],10,10));
  assert.equal(calls.length,1,"cancelled drag must not reorder");
  listeners.get("pointerdown")(event(handles[0],0,11));
  const outside={...event(handles[0],180,11),clientX:700};
  listeners.get("pointermove")(outside);
  listeners.get("pointerup")(outside);
  assert.equal(calls.length,1,"releasing outside the list must not reorder");
  let prevented=false;
  listeners.get("keydown")({target:handles[1],key:"ArrowUp",preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.deepEqual(calls[1],[1,0]);
  const button={disabled:false,dataset:{direction:"1"},closest:q=>q===".custom-axis-reorder-button"?button:q===".custom-axis-row"?rows[0]:null};
  listeners.get("click")({target:button});
  assert.deepEqual(calls[2],[0,1]);
});
