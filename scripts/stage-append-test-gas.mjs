#!/usr/bin/env node
/**
 * Stage canonical GAS sources for an ISOLATED test Apps Script project.
 * Does not call clasp or touch a remote project.
 *
 * Requires .gas-test/appsscript.json populated by clasp pull from a
 * separate test Script ID. NEVER use the production Script ID here.
 *
 * Usage:
 * node scripts/stage-append-test-gas.mjs <TEST_ROOT_FOLDER_ID> <TEST_OUTPUT_FOLDER_ID>
 * clasp push --force
 */
import {readFileSync,writeFileSync,existsSync,readdirSync,copyFileSync,unlinkSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const stage=join(root,".gas-test");
const source=join(root,"central-api");
const [testRoot,testOutput]=process.argv.slice(2);
const prodRoot="1pczMllofAeCpPsMKmaU0fDDUUXgkXy8f";
const prodOutput="1izieBYn1U40y0sMkK2H5WzoILA1blYNb";
const valid=id=>/^[a-zA-Z0-9_-]{20,}$/.test(id||"");
if(!valid(testRoot)||!valid(testOutput)||testRoot===testOutput ||
  [prodRoot,prodOutput].includes(testRoot) ||
  [prodRoot,prodOutput].includes(testOutput)) {
  throw Error("テスト専用の異なるDriveルート／出力フォルダIDを指定してください。本番IDは使用できません。");
}
if(!existsSync(join(stage,"appsscript.json"))) {
  throw Error(".gas-test/appsscript.json がありません。別のテストGASからclasp pullを先に行ってください。");
}
const files=readdirSync(source).filter(name=>name.endsWith(".gs"));
if(files.length<14)throw Error("必要なGASソースが不足しています。");
const config=readFileSync(join(source,"00_Config.gs"),"utf8");
function replaceUnique(text,needle,replacement){
  if(text.split(needle).length!==2)throw Error("GAS Configの仕様が変わりました: "+needle);
  return text.replace(needle,replacement);
}
let configured=replaceUnique(config,
  "ROOT_FOLDER_ID: '"+prodRoot+"'",
  "ROOT_FOLDER_ID: '"+testRoot+"'");
configured=replaceUnique(configured,
  "SHEET_OUTPUT_FOLDER_ID: '"+prodOutput+"'",
  "SHEET_OUTPUT_FOLDER_ID: '"+testOutput+"'");
// Only after all preflight checks may the staging directory be modified.
// Preserve all files other than the GAS server-side sources.
for(const name of readdirSync(stage)){
  if(name.endsWith(".gs")||name.endsWith(".js"))unlinkSync(join(stage,name));
}
for(const name of files)copyFileSync(join(source,name),join(stage,name));
writeFileSync(join(stage,"00_Config.gs"),configured,"utf8");
console.log("隔離テスト用GASに"+files.length+"ファイルを配置しました（pushは未実行）。");
console.log("テストフォルダIDは .gas-test/00_Config.gs のみに保持されます。");
console.log("続ける前に .clasp.json の scriptId が本番とは異なることを確認してください。");
