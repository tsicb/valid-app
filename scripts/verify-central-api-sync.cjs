"use strict";
const fs = require("node:fs");
const path = require("node:path");

// All comparisons run locally on the GitHub Actions runner.
// Only status categories and filenames are printed; never source content.
function normalize(s) {
  return String(s).replace(/\r\n?/g,"\n");
}
function verifyLegacyBeforeSync(expected, live, historical, previousProduction) {
  if (normalize(live)===normalize(expected)) return "ALREADY_CURRENT";
  // The exact 25.gs deployed in the independently VERIFIED 26/26 GAS SYNC
  // on 2026-11-21. Pin a git commit rather than allowing arbitrary history.
  if (typeof previousProduction==="string" &&
      normalize(live)===normalize(previousProduction)) {
    return "PINNED_PREVIOUS_PRODUCTION_SOURCE";
  }
  if (normalize(live)===normalize(historical)) return "PINNED_2026_11_19_REVISION";
  return "UNRECOGNIZED_SOURCE_BLOCK_SYNC";
}
function listScripts(dir, expectedOnly) {
  const names=fs.readdirSync(dir).filter(name=>expectedOnly?
    /\.gs$/.test(name):/\.(?:gs|js)$/.test(name));
  const map=new Map();
  for(const name of names){
    const key=name.replace(/\.(?:gs|js)$/,"");
    if(map.has(key))throw Error("DUPLICATE_SCRIPT_BASENAME");
    map.set(key,name);
  }
  return map;
}
function verifyPulledAgainstGit(gitDir,pulledDir) {
  const git=listScripts(gitDir,true);
  const live=listScripts(pulledDir,false);
  const missing=[...git.keys()].filter(x=>!live.has(x)).sort();
  const extra=[...live.keys()].filter(x=>!git.has(x)).sort();
  const changed=[...git.keys()].filter(base=>live.has(base)&&
    normalize(fs.readFileSync(path.join(gitDir,git.get(base)),"utf8"))!==
    normalize(fs.readFileSync(path.join(pulledDir,live.get(base)),"utf8"))
  ).sort();
  return {
    ok:git.size>0 && !missing.length && !extra.length && !changed.length,
    expectedCount:git.size,remoteCount:live.size,
    missing,extra,changed
  };
}
function summary(post) {
  return [
    "## Central API post-SYNC independent remote readback",
    "",
    "- Status: "+(post.ok?"VERIFIED_MATCH":"FAIL_CLOSED_REMOTE_MISMATCH"),
    "- Expected GitHub scripts: "+post.expectedCount,
    "- Actual remote scripts: "+post.remoteCount,
    "- Missing: "+post.missing.length,
    "- Unexpected: "+post.extra.length,
    "- Content drift: "+post.changed.length,
    "- Differing script names: "+
      ([...post.missing,...post.extra,...post.changed].length?
       [...new Set([...post.missing,...post.extra,...post.changed])]
          .sort().map(x=>x+".gs").join(", "):"None"),
    "",
    "Re-pulled from the live GAS project after clasp push.",
    "Does not inspect Script Properties, redeploy the Web App, or output source text.",
    "If failed, do not repeat SYNC automatically. Investigate before retrying."
  ].join("\n")+"\n";
}
function runFromCli() {
  const phase=process.argv[2];
  const stage=".gas-stage", git="central-api";
  try {
    if(phase==="preflight") {
      const historical=process.env.VAA_HISTORIC_FILE25;
      if(!historical || !fs.existsSync(historical))
        throw Error("HISTORICAL_SOURCE_UNAVAILABLE");
      const previous=process.env.VAA_PREVIOUS_PRODUCTION_FILE25;
      if(!previous || !fs.existsSync(previous))
        throw Error("PREVIOUS_PRODUCTION_SOURCE_UNAVAILABLE");
      const base="25_Request_Ledger_V2_Legacy_Batch_Migration";
      const local=path.join(git,base+".gs");
      const remoteGs=path.join(stage,base+".gs");
      const remoteJs=path.join(stage,base+".js");
      const remote=fs.existsSync(remoteGs)?remoteGs:
        fs.existsSync(remoteJs)?remoteJs:null;
      if(!remote || !fs.existsSync(local))
        throw Error("REMOTE_LEGACY_FILE_MISSING");
      const state=verifyLegacyBeforeSync(
        fs.readFileSync(local,"utf8"),
        fs.readFileSync(remote,"utf8"),
        fs.readFileSync(historical,"utf8"),
        fs.readFileSync(previous,"utf8")
      );
      const msg="LEGACY25_SOURCE_PRECHECK: "+state;
      process.stdout.write(msg+"\n");
      if(process.env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
          "## Legacy source pre-SYNC identity\n\n- "+msg+
          "\n- No Script Properties or request history inspected.\n");
      if(state==="UNRECOGNIZED_SOURCE_BLOCK_SYNC")process.exitCode=2;
    } else if(phase==="postflight") {
      const result=verifyPulledAgainstGit(git,stage);
      if(process.env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary(result));
      process.stdout.write("POST_SYNC_SOURCE_READBACK: "+
        (result.ok?"VERIFIED_MATCH":"FAIL_CLOSED_REMOTE_MISMATCH")+
        " expected="+result.expectedCount+
        " remote="+result.remoteCount+
        " mismatch="+(result.missing.length+result.extra.length+
          result.changed.length)+"\n");
      if(!result.ok)process.exitCode=2;
    } else {
      throw Error("INVALID_PHASE");
    }
  } catch(e) {
    // Never echo source snippets, file contents, or arbitrary error messages.
    const safe=["HISTORICAL_SOURCE_UNAVAILABLE",
      "PREVIOUS_PRODUCTION_SOURCE_UNAVAILABLE","REMOTE_LEGACY_FILE_MISSING",
      "INVALID_PHASE","DUPLICATE_SCRIPT_BASENAME"];
    const code=safe.includes(e.message)?e.message:"UNCLASSIFIED_FAILURE";
    process.stdout.write("SOURCE_GUARD: "+code+"\n");
    process.exitCode=2;
  }
}
if(require.main===module)runFromCli();
module.exports={normalize,verifyLegacyBeforeSync,verifyPulledAgainstGit,summary};
