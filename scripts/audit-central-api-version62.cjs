"use strict";
const fs=require("node:fs"),path=require("node:path");
const normalize=s=>String(s).replace(/\r\n?/g,"\n");
// Read local immutable version text and return metadata only; NEVER log code.
function scripts(dir,onlyGs){
 const names=fs.readdirSync(dir).filter(n=>onlyGs?/\.gs$/.test(n):/\.(gs|js)$/.test(n)),m=new Map();
 for(const name of names){const base=name.replace(/\.(gs|js)$/,"");if(m.has(base))throw Error("DUPLICATE");m.set(base,name);}
 return m;
}
function classify({file24,file02,file25}){
 const gate=typeof file24==="string"&&/function\s+vaaLedgerProdModeStatus_\s*\(/.test(file24)&&/function\s+vaaLedgerProdDecideUnderLock_\s*\(/.test(file24);
 const invoked=typeof file02==="string"&&/vaaLedgerProdDecideUnderLock_\s*\(/.test(file02);
 const canary=typeof file24==="string"&&file24.includes("CANARY_ONE_NEW_READY_V1")&&/function\s+vaaLedgerProdRetireCanary_\s*\(/.test(file24)&&/function\s+vaaLedgerProdRetireCanaryPreflightReadOnly\s*\(/.test(file24);
 const legacy=typeof file25==="string"&&/function\s+vaaLedgerProdLegacyAuditReadOnly\s*\(/.test(file25);
 return {gate,invoked,canary,legacy,status:gate&&invoked?(canary?"HAS_EXACT_CANARY_SOURCE":"BEFORE_EXACT_CANARY_SOURCE"):"SOURCE_SCOPE_REVIEW_REQUIRED"};
}
function inspect(gitDir,versionDir){
 const git=scripts(gitDir,true),remote=scripts(versionDir,false);
 const load=base=>remote.has(base)?fs.readFileSync(path.join(versionDir,remote.get(base)),"utf8"):null;
 const capabilities=classify({file24:load("24_Request_Ledger_V2_Production_Gate"),file02:load("02_EntryPoint"),file25:load("25_Request_Ledger_V2_Legacy_Batch_Migration")});
 const missing=[...git.keys()].filter(k=>!remote.has(k)).length;
 const extra=[...remote.keys()].filter(k=>!git.has(k)).length;
 const changed=[...git.keys()].filter(k=>remote.has(k)&&normalize(fs.readFileSync(path.join(gitDir,git.get(k)),"utf8"))!==normalize(load(k))).length;
 return {...capabilities,version:62,remoteCount:remote.size,gitCount:git.size,missing,extra,changed,exact:!missing&&!extra&&!changed};
}
function summary(x){
 return [
  "## Central API version 62 immutable source audit (read only)","",
  "- Version inspected: 62",
  "- Versioned source classification: "+x.status,
  "- Version 62 scripts / GitHub scripts: "+x.remoteCount+" / "+x.gitCount,
  "- V2 production gateway present: "+x.gate,
  "- doPost calls V2 production gateway: "+x.invoked,
  "- Single-request retirement canary implemented: "+x.canary,
  "- Legacy migration audit implemented: "+x.legacy,
  "- Exactly equals current GitHub source: "+x.exact,
  "- Missing / unexpected / changed scripts: "+x.missing+" / "+x.extra+" / "+x.changed,"",
  "This job reads immutable saved version 62 only: no source text or IDs are output.",
  "No Script Properties, doPost, GAS writes, deployments or REQ changes.",
  "This report does NOT authorize deployment or canary activation."
 ].join("\n")+"\n";
}
if(require.main===module){try{
 if(!fs.existsSync(".gas-version62/appsscript.json"))throw Error("MISSING_MANIFEST");
 const out=summary(inspect("central-api",".gas-version62"));
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,out);
 process.stdout.write("V62_READONLY_AUDIT: REPORT_WRITTEN\n");
}catch(_){process.stdout.write("V62_READONLY_AUDIT: FAILURE_WITHOUT_SOURCE_OUTPUT\n");process.exitCode=2;}}
module.exports={normalize,classify,inspect,summary};