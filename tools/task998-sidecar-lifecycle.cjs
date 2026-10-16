'use strict';
// Offline saved-input accounting. This never launches services or certifies cases.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), {EventEmitter} = require('node:events');
const zlib = require('node:zlib');
const {finished} = require('node:stream/promises');
const server = '/root/diplomacy_server';
const budget = require(server + '/tests/helpers/evidenceBudget');
const logs = require(server + '/tests/helpers/boundedWorkerLog');
const base = fs.realpathSync('/root/diplomacy/artifacts'), task = path.join(base, 'TASK-998');
const out = fs.realpathSync(process.argv[2]);
assert(out.startsWith(task + path.sep), 'output must be inside TASK-998');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const inputs = {};
function read(file, expected) {
    const bytes = fs.readFileSync(file), hash = sha(bytes);
    // The historical ledger hashes logical proof bytes for archived .gz inputs.
    if (expected) assert.equal(file.endsWith('.gz') ? sha(zlib.gunzipSync(bytes)) : hash,
        expected, 'saved input changed: ' + file);
    if (inputs[file]) assert.equal(hash, inputs[file].sha256, 'input changed during replay');
    inputs[file] = {bytes: bytes.length, sha256: hash};
    return bytes;
}
const ledger = JSON.parse(read(task + '/recovery-13/ledger-completed.json'));
const measurements = JSON.parse(read(task + '/recovery-28/measurements.json'));
assert.equal(ledger.rows.length, 3900);
assert.equal(new Set(ledger.rows.map(r => r.matrixID)).size, 3900);
const sourceHashes = Object.fromEntries([
    'tests/helpers/evidenceBudget.js', 'tests/helpers/boundedWorkerLog.js',
    'tests/helpers/runUndoCoverage.js', 'tests/reliability/helpers/services.js',
].map(p => [p, sha(read(path.join(server, p)))]));
// Pin the assumptions used below to the inspected native caller implementation.
const runner = fs.readFileSync(server + '/tests/helpers/runUndoCoverage.js', 'utf8');
assert(runner.includes("['supervisor-cleanup.json', 'execution.json']"));
assert(runner.includes("['timing.json','cleanup.json','coverage.json','tests.log','failure.json']"));
assert(runner.includes('reserveReport(path.join(out, name), 65536)'));
assert(runner.includes('reserveReport(path.join(out,name),65536)'));
function category(file) {
    const name = path.basename(file).replace(/\.gz$/, '');
    if (/^(worker|tests)\.log$/.test(name)) return 'workerLogs';
    if (/mongo|provider/i.test(name)) return 'providerLogs';
    if (name === 'activity.jsonl' || /\.log$/.test(name)) return 'serviceActivityLogs';
    if (/cleanup|execution/.test(name)) return 'executionCleanupReports';
    if (/index|receipt/.test(name)) return 'indexesReceipts';
    return 'otherSidecars';
}
function inventory(root) {
    const files = new Set(), missingReferences = [], outsideReferences = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.isFile() && !/^scenario\.json(?:\.gz)?$/.test(entry.name)) files.add(p);
        }
    }
    walk(root);
    // Follow explicit log references in reports, including paths outside proof roots.
    // Do not guess missing historical paths or scan unrelated evidence directories.
    function refs(value) {
        if (typeof value === 'string' && path.isAbsolute(value) && /\.(log|jsonl)$/.test(value)) {
            if (!fs.existsSync(value)) missingReferences.push(value);
            else {
                const real = fs.realpathSync(value);
                if (!real.startsWith(fs.realpathSync(root) + path.sep)) outsideReferences.push(real);
                files.add(real);
            }
        } else if (value && typeof value === 'object') Object.values(value).forEach(refs);
    }
    for (const file of [...files]) {
        if (file.endsWith('.json') && fs.statSync(file).size < 1024 * 1024) {
            try { refs(JSON.parse(read(file))); } catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
            }
        }
    }
    // Canonicalize aliases so one actual file is charged only once per launch.
    return {files: [...new Set([...files].map(p => fs.realpathSync(p)))].sort(),
        missingReferences: [...new Set(missingReferences)], outsideReferences: [...new Set(outsideReferences)]};
}
const staging = path.join(out, 'owned-sidecar-replay');
fs.mkdirSync(staging); // Exclusive ownership: never reuse or remove a preexisting directory.
const previous = process.env[budget.ENV];
let serial = 0;
async function replay(spec, limit = 100000000, short = false) {
    const root = path.join(staging, String(serial++)); fs.mkdirSync(root);
    process.env[budget.ENV] = budget.initialize(root, limit);
    const costs = {}, fileHashes = [];
    try {
        // Parent final contents are NOT fabricated. Their reserved active cost is real,
        // but the unfinished slots below cannot be used as successful caller evidence.
        for (let i = 0; i < 5; i++) budget.reserveReport(path.join(root, 'parent-' + i), 65536);
        const slots = {};
        for (const name of ['execution.json', 'supervisor-cleanup.json'])
            slots[name] = budget.reserveReport(path.join(root, name), 65536);
        const pending = [];
        let workerTarget;
        const files = [...spec.files].sort((a,b) => Number(path.basename(b)==='worker.log')-Number(path.basename(a)==='worker.log'));
        for (const [i, file] of files.entries()) {
            const storedInput = read(file), kind = category(file), name = path.basename(file).replace(/\.gz$/, '');
            const bytes = file.endsWith('.gz') ? zlib.gunzipSync(storedInput) : storedInput;
            const target = path.join(root, 'sidecar-' + i);
            let stored;
            if (path.dirname(file) === fs.realpathSync(spec.root) && slots[name]) {
                pending.push({name, bytes}); continue;
            }
            if (name === 'tests.log' && path.dirname(file) === fs.realpathSync(spec.root)) {
                assert(workerTarget, 'native tests.log needs completed worker capture');
                budget.fs.copyFileSync(workerTarget, target);
                budget.fs.appendFileSync(target, zlib.gzipSync(`\nEXIT_STATUS=${spec.execution.exit.code===null?1:spec.execution.exit.code}\n`));
                assert.equal(zlib.gunzipSync(fs.readFileSync(target)).length,
                    zlib.gunzipSync(fs.readFileSync(workerTarget)).length + Buffer.byteLength(`\nEXIT_STATUS=${spec.execution.exit.code===null?1:spec.execution.exit.code}\n`));
                stored = fs.statSync(target).size;
            } else if (name === 'worker.log') {
                const child = {stdout: new EventEmitter(), stderr: new EventEmitter()};
                const capture = logs.createWorkerLog(target, {compress: true, limitBytes: bytes.length});
                capture.attach(child);
                // Decode historical compressed captures with their own native reader.
                assert(!spec.execution.logCapture?.encoding, 'compressed historical input needs explicit decoding');
                for (let offset = 0; offset < bytes.length; offset += 65536)
                    child.stdout.emit('data', bytes.subarray(offset, offset + 65536));
                const state = capture.close();
                if (state.failure) throw Error(state.failure);
                const result = {logPath: target, logCapture: state};
                logs.requireCompleteWorkerLog(result);
                assert.equal(sha(logs.readWorkerLog(result)), sha(bytes));
                stored = fs.statSync(target).size;
                if (path.dirname(file) === fs.realpathSync(spec.root)) workerTarget = target;
            } else {
                // services.js uses this same budgeted plain stream for service/activity.
                const stream = budget.fs.createWriteStream(target);
                const completion = finished(stream);
                stream.end(bytes); await completion;
                assert.equal(sha(fs.readFileSync(target)), sha(bytes));
                stored = bytes.length;
            }
            costs[kind] = (costs[kind] || 0) + stored;
            fileHashes.push({source: file, inputLogicalSHA256: sha(bytes), outputStoredSHA256: sha(fs.readFileSync(target)), storedBytes: stored});
        }
        for (const {name, bytes} of pending) {
            budget.finishReport(path.join(root, name), bytes, slots[name], {raw: true});
            assert.equal(sha(fs.readFileSync(path.join(root, name))), sha(bytes));
            costs.executionCleanupReports = (costs.executionCleanupReports || 0) + bytes.length;
        }
        assert.equal(pending.length, 2, 'missing saved terminal report');
        const state = budget.requireComplete();
        const actual = fs.readdirSync(root).reduce((n, name) => n + fs.statSync(path.join(root, name)).size, 0);
        assert.equal(state.usedBytes, actual);
        assert.equal(actual, 4096 + 5 * 65536 + Object.values(costs).reduce((a, b) => a + b, 0));
        assert(!short, 'one-byte-short unexpectedly passed');
        // No sealing: parent slots intentionally remain unfinished in this storage control.
        return {costs, fileHashes, retainedSidecarBytes: actual - 4096 - 5 * 65536,
            retainedWithUnfinishedParentSlotsBytes: actual, peakBytes: state.peakBytes,
            activeParentReservationBytes: 5 * 65536, terminalReportsReconstructed: true};
    } catch (error) {
        if (!short) throw error;
        assert(budget.read(process.env[budget.ENV]).failure, 'short control must fail budget, not unrelated input');
        assert.throws(() => budget.requireComplete(), /failed aggregate/);
        console.log('PASS one-byte-short permanent budget rejection: ' + error.message);
    } finally { fs.rmSync(root, {recursive: true}); assert(!fs.existsSync(root)); }
}
async function main() {
    const rows = [], fragments = [], started = performance.now();
    for (const row of ledger.rows.filter(r => r.measured)) {
        for (const original of row.originalHashes) {
            read(original.proofPath, original.proofSHA256);
            const root = path.dirname(original.proofPath);
            const execution = JSON.parse(read(path.join(root, 'execution.json'), original.executionSHA256));
            const spec = {root, execution, ...inventory(root)};
            const result = await replay(spec);
            fragments.push({matrixID: row.matrixID, moduleID: row.moduleID,
                original, ...spec, execution: undefined, ...result});
        }
        console.log('PASS native saved sidecars ' + row.matrixID + ' fragments=' + row.originalHashes.length);
    }
    for (const sample of [fragments[0], [...fragments].sort((a,b) => b.peakBytes-a.peakBytes)[0]]) {
        const spec = {...sample, execution: JSON.parse(read(path.join(sample.root, 'execution.json')))};
        const exact = await replay(spec, sample.peakBytes);
        assert.equal(exact.peakBytes, sample.peakBytes);
        await replay(spec, sample.peakBytes - 1, true);
        console.log('PASS exact allocation and failure cleanup ' + sample.matrixID);
    }
    for (const module of measurements.rows.map(r => r.module)) {
        const pop = ledger.rows.filter(r => r.moduleID === module);
        const observed = pop.filter(r => r.measured).map(r => fragments.filter(f => f.matrixID === r.matrixID)
            .reduce((n, f) => n + f.retainedSidecarBytes, 0));
        assert(observed.length);
        rows.push({moduleID: module, population: pop.length, measuredIDs: observed.length,
            unmeasuredIDs: pop.length - observed.length, sampleMeanBytes: observed.reduce((a,b)=>a+b,0)/observed.length,
            sampleMaxBytes: Math.max(...observed), weightedHistoricalMaxBytes: Math.max(...observed)*pop.length});
    }
    assert.equal(rows.length, 18);
    const result = {admitted: false, scope: 'native sidecar saved-input storage control; no gameplay or completed caller receipts',
        fragments, modules: rows, measuredIDs: ledger.rows.filter(r=>r.measured).length,
        unmeasuredIDs: ledger.rows.filter(r=>!r.measured).length,
        weightedHistoricalSidecarMaxBytes: rows.reduce((n,r)=>n+r.weightedHistoricalMaxBytes,0),
        maxObservedReplayPeakBytes: Math.max(...fragments.map(r=>r.peakBytes)),
        unresolved: ['future output strata and original worker stream chunk boundaries',
            'final parent reports/aggregate index and receipt replacement staging',
            'logs with no surviving explicit reference and future shared provider topology',
            'future fragment count and combined proof/sidecar execution ordering'],
        replayPolicies: {worker: 'current gzip-members capture, fixed 65536-byte input chunks',
            tests: 'current native copy of worker capture plus gzip exit member',
            serviceActivity: 'current budgeted plain stream; original exact logical bytes',
            reports: 'historical exact bytes through current budget writer, NOT current execution receipts',
            parent: 'five native 65536-byte reservations left unfinished; final contents unresolved',
            other: 'historical exact logical bytes; no claim to replay original rewrite order'},
        inputs, sourceHashes, elapsedMs: performance.now()-started};
    fs.writeFileSync(path.join(out, 'sidecar-lifecycle.json'), JSON.stringify(result, null, 2)+'\n');
    console.log(`PASS ${result.measuredIDs} historical IDs / ${fragments.length} fragments / 18 modules; ${result.unmeasuredIDs} unmeasured IDs`);
    console.log('NOT ADMITTED historical weighted sidecar maximum=' + result.weightedHistoricalSidecarMaxBytes);
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {
    if (previous === undefined) delete process.env[budget.ENV]; else process.env[budget.ENV] = previous;
    fs.rmSync(staging, {recursive: true}); assert(!fs.existsSync(staging));
    console.log('PASS owned replay staging removed; no services started');
});
