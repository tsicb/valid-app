#!/usr/bin/env node
/**
 * Prepare a local browser-only copy of Pages that points to a TEST GAS Web App.
 * Does not modify tracked Pages, deploy anything, or embed access credentials.
 *
 * Usage:
 *   node scripts/build-append-smoke-site.mjs "https://script.google.com/macros/s/TEST_ID/exec"
 *   cd .smoke-pages && python -m http.server 8765
 *   open http://localhost:8765/index.html
 */
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const out=join(root,".smoke-pages");
const incoming=process.argv[2] || "";
let test;
try {test=new URL(incoming);}catch{throw Error("TEST GAS Web App URLが必要です。");}
if(test.protocol!=="https:" ||
  test.hostname!=="script.google.com" ||
  !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(test.pathname) ||
  test.search || test.hash) {
  throw Error("Google Apps Scriptのテスト用Web App /exec URLを指定してください。");
}
const prod="https://script.google.com/macros/s/AKfycbwS_-ptDyhVk5yrNtRB8I32WUJen-xdjKUtp-Rf7Dbdhhg4V9Vw3gneD9K7ErZgP_Y/exec";
if(test.href===prod) {
  throw Error("本番GAS URLは使用できません。別プロジェクトのテスト用GASを指定してください。");
}
mkdirSync(out,{recursive:true});
const sources=["index.html","report.html","common-masters-v1.js","analysis-core.js","append-identity-v1.js",
  "assets/favicon-index.svg","assets/favicon-index-32.png","assets/favicon-report.svg","assets/favicon-report-32.png"];
for(const name of sources){
  const src=join(root,name),dest=join(out,name);
  if(!existsSync(src))throw Error("Pages依存ファイルがありません: "+name);
  mkdirSync(dirname(dest),{recursive:true});
  if(name==="index.html"||name==="report.html"){
    const original=readFileSync(src,"utf8");
    if(original.split(prod).length!==2) {
      throw Error(name+"に想定外のGAS API URLがあります。手動で確認してください。");
    }
    writeFileSync(dest,original.replace(prod,test.href),"utf8");
  }else{
    copyFileSync(src,dest);
  }
}
writeFileSync(join(out,"SMOKE_BUILD_INFO.txt"),
  [
    "Synthetic test-only browser build",
    "This directory is generated and should never be deployed as production Pages.",
    "Test API URL: "+test.href,
    "Open: http://localhost:8765/index.html",
    "No access key, HMAC material or applicant data is written by this build."
  ].join("\n")+"\n");
console.log("テスト用画面を生成しました: "+out);
console.log("起動: cd .smoke-pages && python -m http.server 8765");
console.log("ブラウザ: http://localhost:8765/index.html");
