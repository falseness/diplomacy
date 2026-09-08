// Allocation sampling, including collected objects; fixed diagnostic workloads only.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const zlib = require('zlib');
const inspector = require('inspector');
const vm = require('vm');
const hooks = require('./task102-allocation-hooks.cjs');
const trace = [];
const snapshots = new Map();
let gameIndex = -1;
function allocationSink(kind, encoded, meta) {
  const digest = hash(encoded);
  if (kind === 'snapshot') snapshots.set(meta.id, {digest, meta, created: trace.length});
  if (kind === 'inputs') {
    const inputs = JSON.parse(encoded);
    meta.forEach((id, index) => {
      if (id !== null) assert.equal(hash(JSON.stringify(inputs[index])), snapshots.get(id).digest, 'snapshot mutated before prediction');
    });
  }
  trace.push({gameIndex, kind, hash: digest, bytes: Buffer.byteLength(encoded), meta});
}
const OriginalScript = vm.Script;
vm.Script = class AllocationScript extends OriginalScript {
  constructor(source, options) {
    super(source + (options && options.filename === 'ai/players.js' ? hooks : ''), options);
  }
  runInContext(context, options) {
    context.__task102AllocationSink = allocationSink;
    return super.runInContext(context, options);
  }
};
const {performance, PerformanceObserver} = require('perf_hooks');
const [manifestPath, fixture, mode, output] = process.argv.slice(2);
const pre = JSON.parse(fs.readFileSync(manifestPath));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert(['teacher', 'component'].includes(fixture));
assert(['off', 'on'].includes(mode));
for (const [name, expected] of Object.entries(pre.sources)) {
  assert.equal(hash(fs.readFileSync(path.join(pre.root, name))), expected, name);
}
assert.equal(hash(fs.readFileSync(__filename)), pre.driverHash);
const write = (suffix, value) => fs.writeFileSync(output + suffix,
  JSON.stringify(value) + '\n', {flag: 'wx'});
async function main() {
  const trainer = require('../cloud-train-runner');
  const {runGame} = require('../benchmarkHarness');
  let checkpoint, predictor;
  if (fixture === 'component') {
    const api = require('../benchmark-gamestart-trained-model');
    for (const [name, expected] of Object.entries(pre.checkpointHashes)) {
      assert.equal(hash(fs.readFileSync(path.join(pre.checkpoint, name))), expected);
    }
    checkpoint = await api.loadCheckpoint(pre.checkpoint);
    predictor = api.createPredictor(checkpoint.model, {calls: 0, positions: 0,
      resizedInputs: 0, channelAdaptations: 0});
  }
  const session = new inspector.Session();
  const post = (method, params = {}) => new Promise((resolve, reject) =>
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  const gc = [];
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) gc.push({startTime: entry.startTime,
      duration: entry.duration, kind: entry.detail.kind});
  });
  observer.observe({entryTypes: ['gc']});
  const outcomes = [], retained = [], memory = [], intervals = [];
  if (mode === 'on') {
    session.connect();
    await post('HeapProfiler.enable');
    await post('HeapProfiler.startSampling', {samplingInterval: pre.allocationIntervalBytes, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true});
  }
  const start = performance.now();
  for (let index = 0; index < 6; index += 1) {
    gameIndex = index;
    snapshots.clear();
    memory.push(process.memoryUsage());
    const cpuBeginUs = Number(process.hrtime.bigint() / 1000n);
    const begin = performance.now();
    const result = fixture === 'teacher'
      ? trainer.collectRuntimeCombatTeacherGame(137087, 0, index + 1)
      : runGame({...pre.component[index], predictFunction: predictor,
        modelIdentifier: checkpoint.model,
        inferenceSource: 'TASK-102 diagnostic frozen checkpoint; not original expert/evolving predictor'});
    const end = performance.now();
    const cpuEndUs = Number(process.hrtime.bigint() / 1000n);
    intervals.push({begin, end, cpuBeginUs, cpuEndUs});
    retained.push(result);
    const encoded = JSON.stringify(result);
    const outcome = {index, hash: hash(encoded), elapsedMs: end - begin,
      result: fixture === 'teacher' ? {...result, examples: result.examples.length} : result};
    outcomes.push(outcome);
    console.log('ALLOCATION_OUTCOME: ' + JSON.stringify(outcome));
    memory.push(process.memoryUsage());
    await new Promise(resolve => setImmediate(resolve));
  }
  const end = performance.now();
  if (mode === 'on') {
    const {profile} = await post('HeapProfiler.stopSampling');
    write('.heapprofile', profile);
    session.disconnect();
  }
  await new Promise(resolve => setImmediate(resolve));
  observer.disconnect();
  write('.trace.json', trace);
  console.log('ALLOCATION_TRACE: PASS ' + trace.length + ' records; snapshot values intact at prediction');
  // Save every complete example/result, outside both sampled and wall-time intervals.
  const data = zlib.gzipSync(Buffer.from(JSON.stringify(retained)));
  fs.writeFileSync(output + '.results.json.gz', data, {flag: 'wx'});
  write('.json', {fixture, mode, outcomes, intervals, memory, gc,
    gameMs: intervals.reduce((sum, interval) => sum + interval.end - interval.begin, 0),
    batchMs: end - start, resultsHash: hash(data), retainedCount: retained.length,
    node: process.version, execArgv: process.execArgv});
  if (checkpoint) checkpoint.model.dispose();
  console.log('ALLOCATION_BATCH: PASS ' + fixture + ' ' + mode + ' 6 complete retained results');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
