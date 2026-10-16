'use strict';
// OFFLINE FIXTURE: drives the production runUndoCoverage.main success path
// (selection, executeCase supervisor/cleanup, certify, receipt write, five parent
// reports and seal) with two explicit substitutions only: the worker command
// replays saved historical outputs (tools/task998-fixture-worker.cjs) and the
// gameplay receipt builder returns a labelled fixture wrapper of the historical
// receipt. Nothing here is a gameplay receipt; every launch root is inventoried
// and then removed so no fixture output can be indexed as proof.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), zlib = require('node:zlib'), cp = require('node:child_process');
const {performance} = require('node:perf_hooks');
const server = '/root/diplomacy_server';
const budget = require(server + '/tests/helpers/evidenceBudget');
const codec = require(server + '/tests/helpers/proofCodec');
const receipts = require(server + '/tests/helpers/undoReceiptModules');
const runner = require(server + '/tests/helpers/runUndoCoverage');
const DEADLINE_MS = 590000, started = performance.now();
const deadline = setTimeout(() => { console.error('FAIL outer deadline 590000ms'); process.exit(124); }, DEADLINE_MS);
const task = fs.realpathSync('/root/diplomacy/artifacts/TASK-998');
const out = fs.realpathSync(process.argv[2]);
assert(out.startsWith(task + path.sep), 'output must be inside TASK-998');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const logical = file => file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file);
const baselineFile = path.join(task, 'recovery-36/current/sidecar-lifecycle.json');
const baseline = JSON.parse(fs.readFileSync(baselineFile));
const PARENT = ['timing.json', 'cleanup.json', 'coverage.json', 'tests.log', 'failure.json'];
const TERMINAL = ['execution.json', 'supervisor-cleanup.json'];
const RUNNER_OUTPUTS = new Set([...TERMINAL, 'tests.log', 'receipt.json', 'worker.log']);
const sourceHashes = Object.fromEntries(['tests/helpers/runUndoCoverage.js', 'tests/helpers/evidenceBudget.js',
    'tests/helpers/proofCodec.js', 'tests/helpers/boundedWorkerLog.js', 'tests/helpers/sidecarStorage.js',
    'tests/helpers/undoReceiptModules.js', 'tests/reliability/helpers/owned-storage.js']
    .map(p => [p, sha(fs.readFileSync(path.join(server, p)))]));
for (const tool of ['task998-success-finalization.cjs', 'task998-fixture-worker.cjs'])
    sourceHashes['tools/' + tool] = sha(fs.readFileSync(path.join(__dirname, tool)));
// Pin the production lifecycle this fixture claims to exercise.
const runnerSource = fs.readFileSync(server + '/tests/helpers/runUndoCoverage.js', 'utf8');
for (const marker of ["['timing.json','cleanup.json','coverage.json','tests.log','failure.json']",
    "write(path.dirname(result.logPath),'receipt.json',receipt)", 'budget.seal();', 'const receipt=certify(result);'])
    assert(runnerSource.includes(marker), 'runner lifecycle changed: ' + marker);

// Predeclared inputs: smallest and largest recovery-36 current-policy launches.
const ordered = [...baseline.fragments].sort((a, b) => a.retainedSidecarBytes - b.retainedSidecarBytes);
const chosen = {smallest: ordered[0], largest: ordered[ordered.length - 1]};
function specFor(fragment) {
    const root = fs.realpathSync(fragment.root), replay = [];
    let worker, external = 0;
    for (const h of fragment.fileHashes) {
        const name = path.basename(h.source).replace(/\.gz$/, ''), inRoot = path.dirname(h.source) === root;
        if (inRoot && name === 'worker.log') { worker = {source: h.source, logicalSHA256: h.inputLogicalSHA256}; continue; }
        if (inRoot && RUNNER_OUTPUTS.has(name)) continue; // produced by the real runner
        const relative = h.source.startsWith(root + path.sep)
            ? path.relative(root, h.source).replace(/\.gz$/, '') : path.join('external', (external++) + '-' + name);
        replay.push({source: h.source, relative, logicalSHA256: h.inputLogicalSHA256, framed: h.framed, producer: h.writer.producer});
    }
    assert(worker, 'saved launch lacks root worker output');
    return {matrixID: fragment.matrixID, moduleID: fragment.moduleID, root, replay, worker,
        proof: {source: fragment.original.proofPath, logicalSHA256: fragment.original.proofSHA256},
        historicalReceipt: path.join(root, 'receipt.json')};
}
const inputHashes = () => Object.fromEntries(Object.values(chosen).flatMap(f => {
    const s = specFor(f); return [...s.replay, s.worker, s.proof, {source: s.historicalReceipt}];
}).map(e => [e.source, sha(fs.readFileSync(e.source))]));
const inputsBefore = inputHashes();
function inventory(root) {
    const files = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else { assert(e.isFile(), 'unexpected non-file ' + p); const b = fs.readFileSync(p);
                files.push({path: path.relative(root, p), bytes: b.length, sha256: sha(b)}); }
        }
    })(root);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
const work = path.join(out, 'owned-launch-roots');
fs.mkdirSync(work); // exclusive: never reuse a preexisting directory
const realSpawn = cp.spawn, realExact = receipts.exactReceipt, realFinish = budget.finishReport;
async function launch(label, spec, limit, inject = null) {
    const parent = path.join(work, label); fs.mkdirSync(parent);
    const specFile = path.join(parent, 'fixture-spec.json');
    fs.writeFileSync(specFile, JSON.stringify(spec));
    const launchRoot = path.join(parent, 'launch'); let fixtureReceipts = 0, injected = false;
    cp.spawn = (command, args, options) => realSpawn(process.execPath, [path.join(__dirname, 'task998-fixture-worker.cjs'), args[2]],
        {...options, env: {...options.env, TASK998_FIXTURE_SPEC: specFile}});
    receipts.exactReceipt = (caseID, moduleID, executions) => {
        // Fixture boundary: read the real finalized execution report, wrap the
        // saved historical receipt, and label it as non-gameplay storage output.
        const execution = codec.parseProof(fs.readFileSync(executions[0]), executions[0]);
        assert.equal(execution.exit.code, 0); assert.equal(caseID, spec.matrixID);
        fixtureReceipts++;
        return {offlineFixture: 'TASK-998 recovery-37 success-finalization storage fixture; NOT gameplay; NOT certified',
            matrixID: caseID, moduleID, executionPath: executions[0], executionSHA256: sha(fs.readFileSync(executions[0])),
            historicalReceipt: JSON.parse(fs.readFileSync(spec.historicalReceipt))};
    };
    budget.finishReport = (file, value, reservation, options) => {
        if (inject && !injected && path.basename(file) === inject) { injected = true; throw Error('injected write failure ' + inject); }
        return realFinish(file, value, reservation, options);
    };
    const t0 = performance.now(); let error = null;
    try { await runner.main(['--case-id', spec.matrixID, '--output', launchRoot, '--evidence-budget-bytes', String(limit)]); }
    catch (e) { error = e; }
    finally { cp.spawn = realSpawn; receipts.exactReceipt = realExact; budget.finishReport = realFinish; }
    assert.equal(process.env[budget.ENV], undefined, 'runner leaked budget environment');
    const stateFile = path.join(launchRoot, '.evidence-budget.json'), state = budget.read(stateFile);
    const files = inventory(launchRoot), retained = files.reduce((n, f) => n + f.bytes, 0);
    assert.equal(retained, state.usedBytes, 'stored inventory differs from budget usedBytes');
    const read = name => codec.parseProof(fs.readFileSync(path.join(launchRoot, name)), name);
    // Every reservation must be finished: a padded '{}' slot is an unfinished reservation.
    const unfinished = [...PARENT, ...TERMINAL.map(n => spec.matrixID + '/' + n)].filter(name => {
        const b = fs.readFileSync(path.join(launchRoot, name));
        return b.length === 65536 && b.subarray(0, 2).toString() === '{}' && b.subarray(2).every(c => c === 32);
    });
    const r = {label, matrixID: spec.matrixID, moduleID: spec.moduleID, limitBytes: limit, injected: inject,
        error: error && error.message, sealed: !!state.sealed, budgetFailure: state.failure,
        usedBytes: state.usedBytes, peakBytes: state.peakBytes, inventoryBytes: retained, files,
        unfinishedReservations: unfinished, fixtureReceiptsBuilt: fixtureReceipts, elapsedMs: performance.now() - t0};
    r.reports = Object.fromEntries([...PARENT, ...TERMINAL.map(n => spec.matrixID + '/' + n)].map(n =>
        [n, fs.statSync(path.join(launchRoot, n)).size]));
    r.coverage = read('coverage.json'); r.failure = read('failure.json');
    r.testsLogExit = (fs.readFileSync(path.join(launchRoot, 'tests.log'), 'utf8').match(/EXIT_STATUS=(\d+)/) || [])[1];
    r.execution = read(spec.matrixID + '/execution.json');
    r.selection = JSON.parse(fs.readFileSync(path.join(launchRoot, 'selection.json'))).count;
    return {r, launchRoot, stateFile};
}
function stageIndex(parent, receipt) {
    // Collection index staging: tmp write then rename, first creation and one
    // replacement (old+new overlap charged by the budget writer).
    const root = path.join(work, parent); fs.mkdirSync(root);
    process.env[budget.ENV] = budget.initialize(root, 100000000);
    try {
        const file = path.join(root, 'receipt-index.json'), tmp = file + '.tmp';
        budget.fs.writeFileSync(tmp, JSON.stringify([receipt], null, 2) + '\n'); budget.fs.renameSync(tmp, file);
        const one = budget.read(process.env[budget.ENV]);
        budget.fs.writeFileSync(tmp, JSON.stringify([receipt, receipt], null, 2) + '\n'); budget.fs.renameSync(tmp, file);
        const two = budget.requireComplete();
        assert.equal(JSON.parse(fs.readFileSync(file)).length, 2);
        assert.equal(inventory(root).reduce((n, f) => n + f.bytes, 0), two.usedBytes);
        return {entryBytes: Buffer.byteLength(JSON.stringify(receipt, null, 2)), oneEntry: {usedBytes: one.usedBytes, peakBytes: one.peakBytes},
            replacedTwoEntries: {usedBytes: two.usedBytes, peakBytes: two.peakBytes}};
    } finally { delete process.env[budget.ENV]; }
}
async function main() {
    const results = {};
    for (const [label, fragment] of Object.entries(chosen)) {
        const spec = specFor(fragment), base = {usedWithUnfinishedParentSlotsBytes: fragment.retainedWithUnfinishedParentSlotsBytes,
            peakBytes: fragment.peakBytes, sidecarBytes: fragment.retainedSidecarBytes, source: baselineFile};
        const ok = await launch(label + '-success', spec, 100000000);
        const s = ok.r;
        assert.equal(s.error, null, 'success launch failed: ' + s.error);
        assert(s.sealed, 'successful launch not sealed'); assert.equal(s.budgetFailure, null);
        assert.deepEqual(s.unfinishedReservations, []);
        assert.equal(s.coverage.certified.length, 1); assert.deepEqual(s.coverage.unresolved, []);
        assert.equal(s.failure.failure, null); assert.equal(s.testsLogExit, '0'); assert.equal(s.selection, 1);
        assert.equal(s.execution.exit.code, 0); assert(s.execution.cleanup.allOwnedResourcesRemoved);
        assert.equal(s.fixtureReceiptsBuilt, 1);
        assert(s.files.some(f => f.path === spec.matrixID + '/receipt.json'));
        console.log(`PASS ${label} SUCCESSFUL parent finalization AND seal exercised: ${spec.matrixID} used=${s.usedBytes} peak=${s.peakBytes} unfinished=0 parentReports=${PARENT.map(n => n + ':' + s.reports[n]).join(',')}`);
        // Sealed independent root is immutable to later producers.
        const before = inventory(ok.launchRoot), stateBytes = fs.readFileSync(ok.stateFile);
        process.env[budget.ENV] = ok.stateFile;
        try { assert.throws(() => budget.fs.writeFileSync(path.join(ok.launchRoot, 'later'), 'x'), /sealed evidence budget/); }
        finally { delete process.env[budget.ENV]; }
        assert.deepEqual(inventory(ok.launchRoot), before); assert.deepEqual(fs.readFileSync(ok.stateFile), stateBytes);
        console.log(`PASS ${label} sealed root immutable: later write refused, ${before.length} files and state unchanged`);
        const index = stageIndex(label + '-index', JSON.parse(fs.readFileSync(path.join(ok.launchRoot, spec.matrixID, 'receipt.json'))));
        // Exact budget at the measured peak; one byte short; injected final write failure.
        // Launch peaks include pid/start-time/tmp-name bytes, so each boundary is
        // taken from the most recent launch and every attempt must satisfy
        // success <=> own peak <= limit. Bounded retries, all attempts retained.
        const attempts = [];
        let lastPeak = s.peakBytes, exact, short;
        for (let i = 0; i < 6 && !(exact && short); i++) {
            const kind = exact ? 'short' : 'exact', limit = kind === 'exact' ? lastPeak : lastPeak - 1;
            const a = (await launch(`${label}-${kind}-${i}`, spec, limit)).r; attempts.push(a);
            if (a.error === null) { assert(a.sealed); assert(a.peakBytes <= a.limitBytes); assert.deepEqual(a.unfinishedReservations, []); lastPeak = a.peakBytes; }
            else { assert.equal(a.sealed, false); assert(a.budgetFailure, a.label + ' failed without budget failure: ' + a.error);
                assert.equal(a.coverage.certified?.length || 0, 0); }
            console.log(`${a.error === null ? 'PASS' : 'REJECTED'} ${a.label} limit=${a.limitBytes} ownPeak=${a.peakBytes} sealed=${a.sealed} ${a.error || ''}`);
            if (kind === 'exact' && a.error === null && a.peakBytes === a.limitBytes) exact = a;
            else if (kind === 'short' && a.error !== null && a.limitBytes === lastPeak - 1) short = a;
        }
        assert(exact, 'no exact-budget launch sealed at its own peak');
        assert(short, 'no one-byte-short launch rejected');
        const fail = (await launch(label + '-write-failure', spec, 100000000, 'coverage.json')).r;
        assert(fail.error); assert.equal(fail.sealed, false);
        assert.match(fail.error, /injected write failure coverage\.json/);
        assert.equal(fail.failure.finalizationErrors[0].file, 'coverage.json');
        assert.equal(fail.testsLogExit, '1');
        console.log(`PASS ${label} exact budget ${exact.limitBytes} sealed at own peak`);
        console.log(`PASS ${label} one-byte-short (${short.limitBytes}) rejected unsealed with budget failure: ${short.error}`);
        console.log(`PASS ${label} write-failure rejected unsealed; failure.json names coverage.json; tests.log EXIT_STATUS=1`);
        const peaks = [s, ...attempts].filter(a => a.error === null).map(a => a.peakBytes);
        results[label] = {spec: {...spec, replay: spec.replay.length}, baseline: base, success: s, boundaryAttempts: attempts, exact: exact.label, short: short.label, writeFailure: fail, index,
            successfulPeakJitterBytes: Math.max(...peaks) - Math.min(...peaks),
            delta: {completedMinusIncompleteUsedBytes: s.usedBytes - base.usedWithUnfinishedParentSlotsBytes,
                completedMinusIncompletePeakBytes: s.peakBytes - base.peakBytes,
                finalizationOverheadBytes: s.usedBytes - base.sidecarBytes}};
    }
    const inputsAfter = inputHashes();
    assert.deepEqual(inputsAfter, inputsBefore, 'historical inputs changed');
    console.log(`PASS ${Object.keys(inputsBefore).length} historical input files unchanged (sha256 before/after)`);
    const result = {experiment: 'recovery-37 successful parent finalization checkpoint (offline fixture)',
        successfulParentFinalizationExercised: true, sealExercised: true,
        fixtureBoundary: ['worker command replaced by tools/task998-fixture-worker.cjs replaying saved outputs',
            'undoReceiptModules.exactReceipt replaced by labelled historical-receipt wrapper; NOT a gameplay receipt'],
        realProductionPath: ['runUndoCoverage.main argument parsing, selection and budget initialize', 'executeCase supervisor, owned storage manifest, cleanup, worker log capture, tests.log copy',
            'certify (finalization, budget, worker log, exit, cleanup, deadline checks)', 'receipt.json write', 'five parent reports finished in reserved slots', 'budget.seal'],
        gameplayReceiptsProduced: 0, results, sourceHashes, inputHashes: inputsBefore, node: process.version,
        deadlineMs: DEADLINE_MS, elapsedMs: performance.now() - started};
    fs.writeFileSync(path.join(out, 'success-finalization.json'), JSON.stringify(result, null, 2) + '\n');
    assert(result.elapsedMs < DEADLINE_MS);
    console.log('PASS success-finalization component: successful parent finalization exercised=true seal exercised=true gameplay receipts=0 elapsedMs=' + Math.round(result.elapsedMs));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    clearTimeout(deadline); delete process.env[budget.ENV];
    fs.rmSync(work, {recursive: true}); assert(!fs.existsSync(work));
    console.log('PASS owned fixture launch roots removed; no services started; no fixture receipts retained');
});
