// CPU sampling of fixed production workloads. Diagnostic, never a speed gate.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const zlib = require('zlib');
const inspector = require('inspector');
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
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', {interval: pre.samplingIntervalUs});
    await post('Profiler.start');
  }
  const start = performance.now();
  for (let index = 0; index < 6; index += 1) {
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
    console.log('SIMULATION_OUTCOME: ' + JSON.stringify(outcome));
    memory.push(process.memoryUsage());
    await new Promise(resolve => setImmediate(resolve));
  }
  const end = performance.now();
  if (mode === 'on') {
    const {profile} = await post('Profiler.stop');
    write('.cpuprofile', profile);
    session.disconnect();
  }
  await new Promise(resolve => setImmediate(resolve));
  observer.disconnect();
  // Save every complete example/result, outside both sampled and wall-time intervals.
  const data = zlib.gzipSync(Buffer.from(JSON.stringify(retained)));
  fs.writeFileSync(output + '.results.json.gz', data, {flag: 'wx'});
  write('.json', {fixture, mode, outcomes, intervals, memory, gc,
    gameMs: intervals.reduce((sum, interval) => sum + interval.end - interval.begin, 0),
    batchMs: end - start, resultsHash: hash(data), retainedCount: retained.length,
    node: process.version, execArgv: process.execArgv});
  if (checkpoint) checkpoint.model.dispose();
  console.log('SIMULATION_BATCH: PASS ' + fixture + ' ' + mode + ' 6 complete retained results');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
