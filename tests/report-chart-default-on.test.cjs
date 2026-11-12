"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const report = fs.readFileSync(path.join(__dirname, "../report.html"), "utf8");

test("chart switch has an ON-first accessible fallback before JavaScript runs", () => {
    const markup = report.match(/<button id="viewerAnalysisChartToggle"[\s\S]*?<\/button>/);
    assert.ok(markup);
    assert.match(markup[0], /aria-checked="true"/);
    assert.match(markup[0], /title="各分析表のグラフを非表示"/);
    assert.match(markup[0], /class="analysis-chart-toggle-state">ON<\/span>/);
});

test("initial state and every new report load default to charts ON", () => {
    assert.equal((report.match(/let currentViewerAnalysisChartsEnabled = true;/g) || []).length, 1);
    assert.match(report, /currentViewerBucketOverrides = \{\};\s*currentViewerAnalysisChartsEnabled = true;\s*analysisMonthSeriesState\.clear\(\);\s*updateAnalysisChartToggleUi\(\)/);
    assert.doesNotMatch(report, /currentViewerAnalysisChartsEnabled = false;/);
});

test("the user can still turn charts OFF and ON without resetting other report state", () => {
    const start = report.indexOf("function updateAnalysisChartToggleUi() {");
    const end = report.indexOf("function viewerBasicShortLabel(", start);
    assert.ok(start >= 0 && end > start);
    const state = {textContent:""};
    const attributes = {};
    const handlers = {};
    const button = {
        dataset:{},
        title:"",
        setAttribute:(key,value)=>{attributes[key]=value;},
        querySelector:(selector)=>selector===".analysis-chart-toggle-state"?state:null,
        addEventListener:(event,callback)=>{handlers[event]=callback;}
    };
    let renderCount = 0;
    const ctx = vm.createContext({
        document:{getElementById:id=>id==="viewerAnalysisChartToggle"?button:null},
        currentViewerData:{},
        renderReport:()=>{renderCount++;}
    });
    vm.runInContext("let currentViewerAnalysisChartsEnabled = true;\n" + report.slice(start,end),ctx);
    ctx.initializeAnalysisChartToggle();
    assert.equal(attributes["aria-checked"],"true");
    assert.equal(state.textContent,"ON");
    assert.equal(button.title,"各分析表のグラフを非表示");
    handlers.click();
    assert.equal(attributes["aria-checked"],"false");
    assert.equal(state.textContent,"OFF");
    assert.equal(button.title,"各分析表のグラフを表示");
    handlers.click();
    assert.equal(attributes["aria-checked"],"true");
    assert.equal(state.textContent,"ON");
    assert.equal(renderCount,2);
    // Re-initializing the page controls must not attach a second click handler.
    const original=handlers.click;
    ctx.initializeAnalysisChartToggle();
    assert.equal(handlers.click,original);
});

test("charts remain lazy-rendered after switching the initial value",()=>{
    assert.match(report,/function initializeAnalysisChartPanels\(root = document\) \{[\s\S]*?if \(!currentViewerAnalysisChartsEnabled\) return;/);
    assert.match(report,/new IntersectionObserver\(/);
    assert.match(report,/function analysisChartPanelHtml\([\s\S]*?if \(!currentViewerAnalysisChartsEnabled\) return "";/);
});
