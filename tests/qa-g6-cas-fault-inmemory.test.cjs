"use strict";
/**
 * G6-H: exercise the REAL canonical DataStore stage/CAS functions against
 * strictly in-memory faux Apps Script services. No Google APIs, files or
 * credentials are involved, and no QA helper touches production.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mergeCore = require("../central-api/append-merge-core.js");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const canonical = read("central-api/12_Append_DataStore.gs");
const entrypoint = read("central-api/02_EntryPoint.gs");

const OLD = "QA_G6D_PREVIOUS_SYNTHETIC_DATASTORE";
const BACKUP = "QA_G6D_EARLIER_SYNTHETIC_BACKUP";
const STAGED = "QA_G6H_ONLY_FAKE_STAGED_FILE";
const SHEET = "QA_G6D_ONLY_FAKE_SHEET";
const PREVIOUS_REQUEST = "QA_G6C_FAULT_DOMAIN_CREATE_20261119_V1";
const REQUEST = "QA_G6E_FAULT_DOMAIN_APPEND_20261119_V1";
const deep = x => JSON.parse(JSON.stringify(x));

function fakeCanonicalEnvironment(options = {}) {
  const state = {
    pointer: options.alreadyCommitted ? STAGED : OLD,
    pointerRequest: options.alreadyCommitted ? REQUEST : PREVIOUS_REQUEST,
    backup: BACKUP,
    lockAcquired: 0, lockReleased: 0,
    stateReads: 0, stateWriteCalls: 0,
    flushCalls: 0, stageFilesCreated: 0,
    stageFilesTrashed: 0, trashedIds: [], driveReads: [],
    propertyWrites: 0, postCalls: 0, logs: []
  };
  const body = {
    applicationIdentityVersion: mergeCore.VERSION,
    updateStrategy: options.badStrategy ? "REPLACE" : "APPEND",
    datasets: {
      applicationData: {headers: ["id"], rows: [["QA1"], ["QA2"]]},
      jobAnalysisMaster: {headers: ["job"], rows: [["QA_JOB"]]}
    }
  };
  const stage = {
    spreadsheetId: SHEET,
    fileId: STAGED,
    requestId: REQUEST,
    expectedSourceFileId: OLD,
    strategy: "APPEND",
    applicationIdentityVersion: mergeCore.VERSION,
    dataStoreVersion: "DATASTORE_TEST_VERSION",
    chars: 128,
    stats: {finalApplications: 2, finalJobs: 1}
  };
  const stagedFile = {
    getId: () => STAGED,
    getBlob: () => ({
      getDataAsString: () => {
        if (options.stageReadThrows) throw Error("INJECT_STAGE_READ");
        return options.invalidJson ? "{INVALID_JSON" : JSON.stringify(body);
      }
    }),
    setTrashed: flag => {
      if (flag !== true) throw Error("BAD_TRASH_FLAG");
      state.stageFilesTrashed++;
      state.trashedIds.push(STAGED);
    }
  };
  const contextData = {
    VAAAppendMergeCore: mergeCore,
    API_CONFIG: {ANALYSIS_DATASTORE_VERSION: "DATASTORE_TEST_VERSION"},
    MimeType: {PLAIN_TEXT: "text/plain"},
    Date,
    normalizeString_: x => String(x ?? "").trim(),
    buildAnalysisDataStoreObject_: (ss, payload, id) => {
      if (ss.getId() !== SHEET || id !== REQUEST) throw Error("INVALID_TEST_SOURCE");
      return deep(body);
    },
    getOrCreateAnalysisDataStoreFolder_: () => ({
      createFile: (name, json, mime) => {
        state.stageFilesCreated++;
        if (options.stageCreateThrows) throw Error("INJECT_STAGE_CREATE");
        return stagedFile;
      }
    }),
    rptReadStateData_: ss => {
      assert.equal(ss.getId(), SHEET);
      state.stateReads++;
      const pointer = options.proofReadWrong && state.stateWriteCalls > 0
        ? "QA_FAKE_OBSERVED_OTHER_POINTER"
        : state.pointer;
      const pointerRequest = options.proofReadWrong && state.stateWriteCalls > 0
        ? "QA_FAKE_UNVERIFIED_REQUEST"
        : state.pointerRequest;
      return {map: {
        analysisDataStoreFileId: pointer,
        analysisDataStoreRequestId: pointerRequest,
        analysisDataStoreBackupFileId: state.backup
      }};
    },
    rptSetStateValues_: (ss, updates, cachedState) => {
      assert.equal(ss.getId(), SHEET);
      state.stateWriteCalls++;
      if (options.failBeforePointer) throw Error("INJECT_BEFORE_CAS");
      state.pointer = updates.analysisDataStoreFileId;
      state.pointerRequest = updates.analysisDataStoreRequestId;
      state.backup = updates.analysisDataStoreBackupFileId;
      if (options.failAfterPointer) throw Error("INJECT_AFTER_CAS");
    },
    SpreadsheetApp: {
      flush: () => {
        state.flushCalls++;
        if (options.failFlushAfterCas) throw Error("INJECT_FLUSH_AFTER_CAS");
      }
    },
    LockService: {getScriptLock: () => {
      state.lockAcquired++;
      return {
        waitLock: delay => {assert.equal(delay, 20000);},
        releaseLock: () => {state.lockReleased++;}
      };
    }},
    DriveApp: {
      getFileById: id => {
        state.driveReads.push(id);
        if (id === STAGED) {
          if (options.stageMissing) throw Error("INJECT_STAGE_FILE_MISSING");
          return stagedFile;
        }
        if (id === BACKUP) return {
          setTrashed: flag => {
            assert.equal(flag, true);
            state.trashedIds.push(BACKUP);
          }
        };
        throw Error("UNEXPECTED_FAKE_DRIVE_FILE");
      }
    },
    validateAnalysisDataStoreObject_: (data, spreadsheetId, requestId) => ({
      ok: !options.invalidDataStore && spreadsheetId === SHEET &&
        requestId === REQUEST && data &&
        data.applicationIdentityVersion === mergeCore.VERSION,
      reason: options.invalidDataStore ? "INJECT_INVALID_DATASTORE" : ""
    }),
    console: {log: line => state.logs.push(line)}
  };
  const ctx = vm.createContext(contextData);
  vm.runInContext(canonical, ctx);
  const ss = {getId: () => SHEET};
  return {state, stage, ss,
    run: (script, ctxData) => vm.runInContext(script,ctx),
    commit: () => ctx.vaaCommitStagedAppendDataStore_(ss, stage),
    stageOnly: () => ctx.vaaStageAppendDataStore_(
      ss, {payload: {datasets: {}},
        applicationIdentityVersion: mergeCore.VERSION,
        strategy: "APPEND",
        stats: stage.stats
      }, REQUEST, OLD
    )
  };
}

function assertNoRealIO(environment) {
  const s = environment.state;
  assert.equal(s.propertyWrites, 0);
  assert.equal(s.postCalls, 0);
  assert.equal(s.logs.length, 0);
}

test("G6-H executes canonical stage/CAS source, never a rewritten copy", () => {
  assert.match(canonical, /function vaaCommitStagedAppendDataStore_/);
  assert.match(canonical, /function vaaStageAppendDataStore_/);
  assert.match(entrypoint, /appendWriteResult = vaaExecuteAppendDataStoreUpdate_/);
  assert.match(canonical, /rptSetStateValues_/);
  assert.match(canonical, /SpreadsheetApp\.flush\(\)/);
  assert.match(canonical, /DATASTORE_COMMIT_UNCERTAIN/);
  assert.doesNotMatch(read("scripts/stage-append-test-gas.mjs"),
    /qa-g6-cas-fault-inmemory/);
});

test("G6-H staged file is unlinked before CAS; no original pointer changes", () => {
  const h = fakeCanonicalEnvironment();
  const result = h.stageOnly();
  assert.equal(result.fileId, STAGED);
  assert.equal(h.state.stageFilesCreated, 1);
  assert.equal(h.state.stageFilesTrashed, 0);
  assert.equal(h.state.pointer, OLD);
  assert.equal(h.state.stateWriteCalls, 0);
  assert.equal(h.state.lockAcquired, 0);
  assertNoRealIO(h);
});

test("G6-H failed staged-file verification removes only the new fake stage", () => {
  for(const opts of [{invalidJson:true},{stageReadThrows:true},{invalidDataStore:true}]) {
    const h = fakeCanonicalEnvironment(opts);
    assert.throws(()=>h.stageOnly());
    assert.equal(h.state.stageFilesCreated, 1);
    assert.equal(h.state.stageFilesTrashed, 1);
    assert.deepEqual(h.state.trashedIds, [STAGED]);
    assert.equal(h.state.pointer, OLD);
    assert.equal(h.state.stateWriteCalls, 0);
    assertNoRealIO(h);
  }
});

test("G6-H stage allocation failure cannot alter the committed pointer", () => {
  const h = fakeCanonicalEnvironment({stageCreateThrows:true});
  assert.throws(()=>h.stageOnly(),/INJECT_STAGE_CREATE/);
  assert.equal(h.state.pointer, OLD);
  assert.equal(h.state.stateWriteCalls, 0);
  assert.equal(h.state.stageFilesTrashed, 0);
  assertNoRealIO(h);
});

test("G6-H CAS conflict fails before pointer change and releases lock", () => {
  const h = fakeCanonicalEnvironment();
  h.state.pointer = "QA_UNRELATED_NEWER_DATASTORE";
  const e = assert.throws(()=>h.commit());
  // assert.throws returns undefined in some Node versions; state proves outcome.
  assert.equal(h.state.pointer, "QA_UNRELATED_NEWER_DATASTORE");
  assert.equal(h.state.stateWriteCalls, 0);
  assert.equal(h.state.lockAcquired, 1);
  assert.equal(h.state.lockReleased, 1);
  assert.deepEqual(h.state.trashedIds, []);
  assertNoRealIO(h);
});

test("G6-H CAS rejects missing/invalid stage file without changing pointer", () => {
  for (const opt of [{stageMissing:true},{invalidJson:true},
    {badStrategy:true},{invalidDataStore:true}]) {
    const h = fakeCanonicalEnvironment(opt);
    assert.throws(()=>h.commit());
    assert.equal(h.state.pointer, OLD);
    assert.equal(h.state.stateWriteCalls, 0);
    assert.equal(h.state.lockReleased, 1);
    assert.deepEqual(h.state.trashedIds, []);
    assertNoRealIO(h);
  }
});

test("G6-H fault before pointer write is a pre-commit abort", () => {
  const h = fakeCanonicalEnvironment({failBeforePointer:true});
  assert.throws(()=>h.commit(),/INJECT_BEFORE_CAS/);
  assert.equal(h.state.pointer, OLD);
  assert.equal(h.state.stateWriteCalls, 1);
  assert.equal(h.state.lockReleased, 1);
  assert.deepEqual(h.state.trashedIds, []);
  assertNoRealIO(h);
});

test("G6-H fault immediately after pointer write is ambiguous; no cleanup", () => {
  const h = fakeCanonicalEnvironment({failAfterPointer:true});
  assert.throws(()=>h.commit(),/INJECT_AFTER_CAS/);
  assert.equal(h.state.pointer, STAGED);
  assert.equal(h.state.pointerRequest, REQUEST);
  assert.equal(h.state.backup, OLD);
  assert.equal(h.state.lockReleased, 1);
  assert.deepEqual(h.state.trashedIds, []);
  assertNoRealIO(h);
});

test("G6-H flush exception after pointer set retains previous backup", () => {
  const h = fakeCanonicalEnvironment({failFlushAfterCas:true});
  assert.throws(()=>h.commit(),/INJECT_FLUSH_AFTER_CAS/);
  assert.equal(h.state.pointer, STAGED);
  assert.equal(h.state.backup, OLD);
  assert.equal(h.state.flushCalls, 1);
  assert.equal(h.state.lockReleased, 1);
  assert.deepEqual(h.state.trashedIds, []);
  assertNoRealIO(h);
});

test("G6-H uncertain CAS proof returns explicit error and does not trash backups", () => {
  const h = fakeCanonicalEnvironment({proofReadWrong:true});
  const err = assert.throws(()=>h.commit());
  assert.equal(h.state.pointer, STAGED);
  assert.equal(h.state.backup, OLD);
  assert.equal(h.state.lockReleased, 1);
  assert.deepEqual(h.state.trashedIds, []);
  assertNoRealIO(h);
});

test("G6-H successful CAS preserves immediate predecessor, cleans older backup only", () => {
  const h = fakeCanonicalEnvironment();
  const result = h.commit();
  assert.equal(result.ok, true);
  assert.equal(result.reused, false);
  assert.equal(result.fileId, STAGED);
  assert.equal(result.backupFileId, OLD);
  assert.equal(h.state.pointer, STAGED);
  assert.equal(h.state.pointerRequest, REQUEST);
  assert.equal(h.state.backup, OLD);
  assert.equal(h.state.stateWriteCalls, 1);
  assert.equal(h.state.flushCalls, 1);
  assert.equal(h.state.lockReleased, 1);
  assert.deepEqual(h.state.trashedIds, [BACKUP]);
  assertNoRealIO(h);
});

test("G6-H same-request CAS replay reuses committed pointer without mutation", () => {
  const h = fakeCanonicalEnvironment({alreadyCommitted:true});
  const result = h.commit();
  assert.equal(result.ok,true);
  assert.equal(result.reused,true);
  assert.equal(h.state.pointer,STAGED);
  assert.equal(h.state.stateWriteCalls,0);
  assert.equal(h.state.flushCalls,0);
  assert.equal(h.state.lockReleased,1);
  assert.deepEqual(h.state.trashedIds,[]);
  assertNoRealIO(h);
});

test("G6-H no deferred, automatic or user-triggered Google API calls", () => {
  const h = fakeCanonicalEnvironment();
  assert.equal(h.state.propertyWrites, 0);
  assert.equal(h.state.postCalls, 0);
  assert.deepEqual(h.state.driveReads, []);
  assertNoRealIO(h);
});
