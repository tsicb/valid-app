/**
 * Test-only Pages variant for exercising migration from old DataStores.
 * Never deploy to production. UPDATE is forbidden by payload validation.
 */

export function toLegacyCreatePayload(payload) {
  if (!payload || payload.operationMode !== "create") {
    throw new Error(
      "旧形式テスト画面では新規作成のみ可能です。更新には通常のindex.htmlを使用してください。"
    );
  }
  // Never allow arbitrary user CSVs in a purpose-built old-format fixture.
  // Only the two known synthetic samples can create this test workbook.
  const inputFiles = payload.datasets && payload.datasets.inputFiles;
  if (!inputFiles || !Array.isArray(inputFiles.headers) ||
      !Array.isArray(inputFiles.rows)) {
    throw new Error("テスト用CSVの読込情報がありません。");
  }
  const typeColumn = inputFiles.headers.indexOf("種別");
  const nameColumn = inputFiles.headers.indexOf("ファイル名");
  if (typeColumn < 0 || nameColumn < 0) {
    throw new Error("CSV入力ファイル情報の形式が不正です。");
  }
  const actual = inputFiles.rows.map(row =>
    JSON.stringify([row[typeColumn],row[nameColumn]])
  ).sort();
  const expected = [
    JSON.stringify(["応募CSV","01_初回応募.csv"]),
    JSON.stringify(["求人CSV","01_初回求人.csv"])
  ].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "旧形式移行テストではsamples内の01_初回応募.csvと01_初回求人.csvだけを使用してください。"
    );
  }
  const source = payload.datasets && payload.datasets.applicationData;
  if (!source || !Array.isArray(source.headers) || !Array.isArray(source.rows)) {
    throw new Error("応募データがありません。");
  }
  const identity = new Set(["応募識別キー", "応募識別方式"]);
  if (!source.headers.includes("応募識別キー") ||
      !source.headers.includes("応募識別方式")) {
    throw new Error("現在の識別キー付きデータセットではありません。");
  }
  const keptIndices = source.headers
    .map((h,i) => identity.has(h) ? -1 : i)
    .filter(i => i >= 0);
  const headers = keptIndices.map(i => source.headers[i]);
  const rows = source.rows.map(row => {
    if (!Array.isArray(row) || row.length !== source.headers.length) {
      throw new Error("応募データの列数が不正です。");
    }
    return keptIndices.map(i => row[i]);
  });
  return {
    ...payload,
    updateProtocol: "",
    updateStrategy: "",
    datasets: {
      ...payload.datasets,
      applicationData: {headers, rows}
    }
  };
}

export function buildLegacyTestHtml(original) {
  const fn="function buildSheetsPayloadV3(";
  if (original.split(fn).length !== 2) {
    throw new Error("index.htmlのpayload関数が変更されました。移行テストを中止してください。");
  }
  if (!original.includes('updateProtocol: "IDENTITY_V1"')) {
    throw new Error("予想外の更新プロトコルです。移行テストを中止してください。");
  }
  const anchor="/**\n * Obtain session HMAC key";
  if (!original.includes(anchor) || original.includes("LEGACY_SMOKE_FIXTURE")) {
    throw new Error("既存HTMLの挿入箇所を検証できません。");
  }
  const wrapped=original.replace(fn,"function buildSheetsPayloadV3Modern(");
  const hook=[
    "/* LEGACY_SMOKE_FIXTURE -- synthetic test-only CREATE page. */",
    toLegacyCreatePayload.toString(),
    "function buildSheetsPayloadV3(...args) {",
    '  if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {',
    '    throw new Error("旧形式テスト画面はlocalhostでのみ使用できます。");',
    '  }',
    "  return toLegacyCreatePayload(buildSheetsPayloadV3Modern(...args));",
    "}",
    'window.addEventListener("DOMContentLoaded", () => {',
    '  document.title = "【旧形式移行テスト専用】" + document.title;',
    '  const banner=document.createElement("div");',
    '  banner.id="vaaLegacyTestBanner";',
    '  banner.style.cssText="position:sticky;top:0;z-index:55;padding:10px 16px;background:#fff4d6;color:#873b0f;border-bottom:2px solid #f59e0b;font-size:12px;font-weight:bold;text-align:center;";',
    '  banner.textContent="旧形式移行テスト専用：架空CSVで新規作成のみ（既存シートへの更新は禁止）";',
    '  document.body.prepend(banner);',
    '  if (location.hash.includes("sheet=")) {',
    '    document.getElementById("runBtn")?.addEventListener("click", ev => {',
    '      ev.preventDefault();ev.stopImmediatePropagation();',
    '      alert("このテスト画面では更新できません。通常のindex.htmlを使用してください。");',
    '    },true);',
    '  }',
    '});'
  ].join("\n");
  return wrapped.replace(anchor,hook+"\n\n"+anchor);
}
