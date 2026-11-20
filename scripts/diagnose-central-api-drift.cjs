"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Deliberately data-minimal. Never prints source content, source fragments,
// property IDs, token values, script contents or error stack traces.
function classify(gitText, gasText) {
  const normalized = s => String(s).replace(/\r\n?/g,"\n");
  const removeBom = s => s.replace(/^\uFEFF/,"");
  const trimEndEachLine = s => s.split("\n").map(x => x.replace(/[ \t]+$/g,"")).join("\n");
  const trimBlankEnd = s => s.replace(/\n+$/g,"");
  const expected = normalized(gitText), actual = normalized(gasText);
  let category = "CONTENT_DIFFERENCE_REVIEW_REQUIRED";
  if (expected === actual) category = "IDENTICAL_AFTER_EOL_NORMALIZATION";
  else if (removeBom(expected) === removeBom(actual)) category = "BOM_ONLY";
  else if (trimEndEachLine(removeBom(expected)) === trimEndEachLine(removeBom(actual)))
    category = "LINE_END_WHITESPACE_ONLY";
  else if (trimBlankEnd(trimEndEachLine(removeBom(expected))) ===
           trimBlankEnd(trimEndEachLine(removeBom(actual))))
    category = "FINAL_BLANK_LINES_AND_WHITESPACE_ONLY";

  const left = expected.split("\n"), right = actual.split("\n");
  let firstMismatchLine = 0, mismatchingAlignedLines = 0;
  for (let i=0; i<Math.max(left.length,right.length); i++) {
    if (left[i] !== right[i]) {
      mismatchingAlignedLines++;
      if (!firstMismatchLine) firstMismatchLine=i+1;
    }
  }
  return {
    category, exactAfterEol:expected===actual,
    gitLines:left.length, gasLines:right.length,
    gitChars:expected.length, gasChars:actual.length,
    firstMismatchLine, mismatchingAlignedLines,
    gitFinalNewline:expected.endsWith("\n"),
    gasFinalNewline:actual.endsWith("\n"),
    gitHasBom:gitText.startsWith("\uFEFF"),
    gasHasBom:gasText.startsWith("\uFEFF")
  };
}
// Compare normalized bytes against a pinned, immutable Git history revision.
// A same-length source is not considered equal unless every byte matches.
function fingerprintHistoricalSource(gasText,historicalText) {
  const normalize = s => String(s).replace(/\r\n?/g,"\n");
  return normalize(gasText)===normalize(historicalText) ?
    "MATCHES_2026_11_19_GITHUB_REVISION" :
    "DOES_NOT_MATCH_KNOWN_2026_11_19_REVISION";
}
function createSummary(result) {
  const rows = [
    "## Central API legacy migration source drift (read only)",
    "",
    "- Target file: `25_Request_Ledger_V2_Legacy_Batch_Migration.gs`",
    "- Source classification: `"+result.category+"`",
    "- Matches pinned 2026-11-19 GitHub source: `"+
      (result.historicalVersion||"NOT_CHECKED")+"`",
    "- Equal after line-ending normalization: "+result.exactAfterEol,
    "- GitHub lines / GAS lines: "+result.gitLines+" / "+result.gasLines,
    "- GitHub characters / GAS characters: "+result.gitChars+" / "+result.gasChars,
    "- First different aligned line: "+result.firstMismatchLine,
    "- Different aligned line positions: "+result.mismatchingAlignedLines,
    "- Final newline GitHub / GAS: "+result.gitFinalNewline+" / "+result.gasFinalNewline,
    "- UTF-8 BOM GitHub / GAS: "+result.gitHasBom+" / "+result.gasHasBom,
    "",
    "This report contains **no source text or values**.",
    "It does not inspect Script Properties, write GAS, push code, or deploy Web Apps.",
    "Any difference is **not** approval to run SYNC. Do not infer semantic equivalence",
    "from whitespace-only categories without a separate review."
  ];
  return rows.join("\n")+"\n";
}
if (require.main === module) {
  // CI workflow calls without user-derived path inputs.
  const target="25_Request_Ledger_V2_Legacy_Batch_Migration";
  const local=path.join("central-api",target+".gs");
  const remoteGs=path.join(".gas-stage",target+".gs");
  const remoteJs=path.join(".gas-stage",target+".js");
  const historical=path.join(".gas-stage",".historic-file25");
  try {
    const remote=fs.existsSync(remoteGs)?remoteGs:
      fs.existsSync(remoteJs)?remoteJs:null;
    if (!remote || !fs.existsSync(local) || !fs.existsSync(historical)) {
      process.stdout.write("DRIFT_DIAGNOSTIC: TARGET_MISSING\n");
      process.exitCode=2;
    } else {
      const remoteSource=fs.readFileSync(remote,"utf8");
      const result=classify(fs.readFileSync(local,"utf8"),remoteSource);
      result.historicalVersion=fingerprintHistoricalSource(
        remoteSource,fs.readFileSync(historical,"utf8"));
      const report=createSummary(result);
      if (process.env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,report);
      process.stdout.write("DRIFT_DIAGNOSTIC: REPORT_WRITTEN_READ_ONLY\n");
    }
  } catch (_) {
    process.stdout.write("DRIFT_DIAGNOSTIC: UNCLASSIFIED_FAILURE\n");
    process.exitCode=2;
  }
}
module.exports={classify,createSummary,fingerprintHistoricalSource};
