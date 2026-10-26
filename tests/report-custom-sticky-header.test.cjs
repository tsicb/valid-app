"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../report.html"), "utf8");
function sourceBetween(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, "function anchors found: " + start);
    return html.slice(a, b);
}
const syncSource = sourceBetween(
    "function syncCustomPivotCloneColumns(", "function copyStickyHeaderGeometry("
);
const cloneSource = sourceBetween(
    "function refreshStickyHeaderClone(", "function updateStickyHeaderVisibility("
);
function head(cells) {
    return {rows: [{cells}], querySelectorAll: () => cells};
}
function mockCell(width, colSpan=1) {
    return {colSpan, getBoundingClientRect: () => ({width}), style:{}};
}
function fakeCol() { return {style:{}}; }
function fakeColgroup() {
    return {
        children:[],
        appendChild(col) {this.children.push(col);},
        remove() {this.removed=true;}
    };
}
function setup(widths, pivot=true) {
    const originalCells = widths.map(width => mockCell(width));
    const floatingCells = widths.map(width => mockCell(width));
    const original = {
        classList:{contains: name => pivot && name==="custom-table"},
        tHead:head(originalCells)
    };
    const floating = {
        tHead:head(floatingCells),
        style:{width:"720px",minWidth:"720px"},
        group:null,
        querySelector(query) {
            assert.equal(query,":scope > colgroup");
            return this.group;
        },
        insertBefore(group,thead) {
            assert.equal(thead,this.tHead);
            this.group=group;
        }
    };
    const context=vm.createContext({
        document:{createElement: tag => tag==="colgroup"?fakeColgroup():tag==="col"?fakeCol():null},
        getComputedStyle: () => ({borderCollapse:"collapse"}),
        Number,Array
    });
    vm.runInContext(syncSource,context);
    return {original,floating,originalCells, floatingCells, sync:()=>context.syncCustomPivotCloneColumns(original,floating)};
}
test("all inline report scripts remain syntactically valid",()=>{
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length);
    for(const part of scripts)if(part[1].trim())new vm.Script(part[1]);
});
test("three row axes: no unintended 720px floating-header minimum or column expansion",()=>{
    const widths=[112,134,104,112,112,112]; // Screenshot-like three-level pivot and month columns.
    const s=setup(widths);
    s.sync();
    assert.equal(s.floating.style.width,"686px");
    assert.equal(s.floating.style.minWidth,"686px");
    assert.equal(s.floating.style.maxWidth,"686px");
    assert.equal(s.floating.style.borderCollapse,"collapse");
    assert.deepEqual(s.floating.group.children.map(x=>x.style.width),widths.map(x=>x+"px"));
    assert.equal(s.floating.group.children.slice(0,3).reduce((sum,x)=>sum+parseFloat(x.style.width),0),350);
});
test("one, two, and three row-axis layouts use the measured header cells",()=>{
    for(const widths of [
        [175,100,115,130],
        [95,210,112,112,112],
        [90,90,90,112,112,112]
    ]){
        const s=setup(widths);
        s.sync();
        assert.equal(parseFloat(s.floating.style.width),widths.reduce((a,b)=>a+b,0));
        assert.deepEqual(s.floating.group.children.map(x=>parseFloat(x.style.width)),widths);
    }
});
test("repeated scroll/resize sync reuses colgroup and tracks changed dimensions",()=>{
    const s=setup([112,134,104,112,112,112]);
    s.sync();
    const oldGroup=s.floating.group;
    s.originalCells[1].getBoundingClientRect=()=>({width:154});
    s.sync();
    assert.equal(s.floating.group,oldGroup);
    assert.equal(s.floating.style.width,"706px");
    assert.equal(oldGroup.children[1].style.width,"154px");
    s.original.tHead.rows[0].cells=s.originalCells.slice(0,5);
    s.floating.tHead.rows[0].cells=s.floatingCells.slice(0,5);
    s.sync();
    assert.notEqual(s.floating.group,oldGroup,"a changed column count recreates colgroup");
    assert.equal(oldGroup.removed,true);
    assert.equal(s.floating.group.children.length,5);
});
test("non-custom tables and unsupported colspan layouts retain previous behavior",()=>{
    const standard=setup([150,120,130],false);
    standard.sync();
    assert.equal(standard.floating.style.minWidth,"720px");
    assert.equal(standard.floating.group,null);
    const span=setup([150,120],true);
    span.originalCells[0].colSpan=2;
    span.sync();
    assert.equal(span.floating.group,null);
});
test("floating clone strips source sticky left, position and z-index styles",()=>{
    for(const pivot of [true,false]){
        let clonedHeaders=[], invoked=0;
        const originalHeaders=[0,1,2,3,4,5].map(()=>({
            style:{position:"sticky",left:"104px",zIndex:"27"},removeAttribute(){}
        }));
        const clonedHead={querySelectorAll:()=>clonedHeaders};
        const originalHead={cloneNode(){clonedHeaders=originalHeaders.map(x=>({
            style:{...x.style},removeAttribute(){}
        }));return clonedHead;}};
        const floating={
            tHead:null,
            set innerHTML(value){assert.equal(value,"");this.tHead=null;},
            querySelectorAll:()=>clonedHeaders,
            appendChild(x){this.tHead=x;}
        };
        const original={
            tHead:originalHead,
            classList:{contains:name=>pivot&&name==="custom-table"},
            querySelector:()=>null
        };
        const ctx=vm.createContext({
            copyStickyHeaderGeometry:()=>invoked++,
            Array
        });
        vm.runInContext(cloneSource,ctx);
        ctx.refreshStickyHeaderClone({table:original,cloneTable:floating});
        assert.equal(invoked,1);
        assert.equal(clonedHeaders.length,6);
        for(const cell of clonedHeaders){
            assert.equal(cell.style.position,pivot?"static":"sticky");
            assert.equal(cell.style.left,pivot?"auto":"104px");
            assert.equal(cell.style.zIndex,pivot?"auto":"27");
        }
    }
});
test("custom source pivot still uses sticky geometry and sortable row labels",()=>{
    assert.match(html,/function applyCustomPivotStickyGeometry\(/);
    assert.match(html,/cell\.style\.position="sticky"/);
    assert.match(html,/function customPivotLeftOffsets\(/);
    assert.match(html,/function bindCustomRowAxisReorderControls\(/);
    assert.match(html,/function updateCustomPivotContextBar\(/);
});
