"use strict";
const fs=require("node:fs");
const path=require("node:path");

// Read-only source comparison; never print, export, log or store source text.
function normalize(s){return String(s).replace(/\r\n?/g,"\n");}
function classifyGateway({current,remote,pinned}) {
  const expected=normalize(current),actual=normalize(remote),old=normalize(pinned);
  if(actual===expected)return "CURRENT_GITHUB_SOURCE";
  if(actual===old)return "PINNED_PRE_CANARY_GITHUB_SOURCE";
  if(actual.startsWith(old)&&actual.length>old.length)
    return "PINNED_PRE_CANARY_WITH_APPENDED_CODE";
  return "UNKNOWN_REMOTE_CHANGES_REVIEW_REQUIRED";
}
function inspectGateway({current,remote,pinned,temporaryScriptFound}) {
  const normalized=normalize(remote),old=normalize(pinned);
  return {
    classification:classifyGateway({current,remote,pinned}),
    githubLines:normalize(current).split("\n").length,
    remoteLines:normalized.split("\n").length,
    pinnedLines:old.split("\n").length,
    githubCharacters:normalize(current).length,
    remoteCharacters:normalized.length,
    pinnedCharacters:old.length,
    temporaryScriptFound:!!temporaryScriptFound
  };
}
function report(result){
  return [
    "## Central API file 24 stale-editor drift diagnosis (read only)",
    "",
    "- File: `24_Request_Ledger_V2_Production_Gate.gs`",
    "- Remote source classification: `"+result.classification+"`",
    "- Latest GitHub / remote / pinned pre-canary lines: "+
      [result.githubLines,result.remoteLines,result.pinnedLines].join(" / "),
    "- Latest GitHub / remote / pinned pre-canary characters: "+
      [result.githubCharacters,result.remoteCharacters,result.pinnedCharacters].join(" / "),
    "- Temporary 99_Canary_Properties_OneTime script present: "+
      result.temporaryScriptFound,
    "",
    "No source text, additions, values, credentials, Script Properties, or",
    "identifiers are printed. This job reads GAS source only.",
    "Append-only classification is not a safety or semantic approval:",
    "preserve the local addition before any source restoration.",
    "Do not run SYNC or retire any REQ from this finding alone."
  ].join("\n")+"\n";
}
if(require.main===module){
  try {
    const base="24_Request_Ledger_V2_Production_Gate";
    const source=path.join("central-api",base+".gs");
    const old=path.join(".gas-stage",".historic-file24");
    const a=path.join(".gas-stage",base+".gs");
    const b=path.join(".gas-stage",base+".js");
    const remote=fs.existsSync(a)?a:(fs.existsSync(b)?b:null);
    if(!remote||!fs.existsSync(source)||!fs.existsSync(old))
      throw Error("SOURCE_UNAVAILABLE");
    const summary=report(inspectGateway({
      current:fs.readFileSync(source,"utf8"),
      remote:fs.readFileSync(remote,"utf8"),
      pinned:fs.readFileSync(old,"utf8"),
      temporaryScriptFound:[".gs",".js"].some(ext=>
        fs.existsSync(path.join(".gas-stage","99_Canary_Properties_OneTime"+ext)))
    }));
    if(process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
    process.stdout.write("GATEWAY24_SOURCE_DIAGNOSIS: READ_ONLY_REPORT_WRITTEN\n");
  }catch(_){
    process.stdout.write("GATEWAY24_SOURCE_DIAGNOSIS: FAILED_NO_SOURCE_OUTPUT\n");
    process.exitCode=2;
  }
}
module.exports={normalize,classifyGateway,inspectGateway,report};
