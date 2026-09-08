// Observational replay only: never use these fixed-checkpoint timings as training gates.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const {performance, PerformanceObserver} = require('perf_hooks');
const [source, fixturePath, checkpointPath, mode, instrumentation, output] = process.argv.slice(2);
assert(['retain', 'discard'].includes(mode));
assert(['on', 'off'].includes(instrumentation));
const phases = {contextMs: 0, browserMs: 0, inferenceMs: 0, serializationMs: 0};
const gc = [];
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) gc.push({startMs: entry.startTime, durationMs: entry.duration, kind: entry.detail.kind});
});
observer.observe({entryTypes: ['gc']});
function timed(fn, key) {
  if (instrumentation === 'off') return fn;
  return function(...args) {
    const start = performance.now();
    try { return fn.apply(this, args); }
    finally { phases[key] += performance.now() - start; }
  };
}
const cache = require(path.join(source, 'ai/browserScriptCache'));
for (const [name, key] of Object.entries({createBrowserContext: 'contextMs', loadBrowserScripts: 'browserMs', detachBrowserResult: 'serializationMs'})) {
  cache[name] = timed(cache[name], key);
}
const {runGame} = require(path.join(source, 'ai/benchmarkHarness'));
async function main() {
  const {loadCheckpoint, createPredictor} = require(path.join(source, 'ai/benchmark-gamestart-trained-model'));
  const checkpoint = await loadCheckpoint(checkpointPath);
  const stats = {calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0};
  const predictFunction = timed(createPredictor(checkpoint.model, stats), 'inferenceMs');
  const scenarios = JSON.parse(fs.readFileSync(fixturePath));
  const retained = [], outcomes = [], memory = [];
  const batchStart = performance.now();
  let gameMs = 0;
  for (const scenario of scenarios) {
    console.log('START: ' + JSON.stringify(scenario));
    memory.push({event: 'before', seed: scenario.seed, ...process.memoryUsage()});
    const start = performance.now();
    let game = runGame({...scenario, predictFunction, modelIdentifier: checkpoint.model,
      inferenceSource: 'TASK-102 diagnostic frozen checkpoint; not original expert/evolving predictor'});
    const elapsedMs = performance.now() - start;
    gameMs += elapsedMs;
    // Hash complete data in both modes outside the timed runGame interval.
    const encoded = JSON.stringify(game);
    outcomes.push({scenario, elapsedMs, hash: crypto.createHash('sha256').update(encoded).digest('hex'), game: JSON.parse(encoded)});
    if (mode === 'retain') retained.push(game);
    game = null;
    memory.push({event: 'after', seed: scenario.seed, ...process.memoryUsage()});
    console.log('RESULT: ' + JSON.stringify(outcomes.at(-1)));
    await new Promise(resolve => setImmediate(resolve));
  }
  const batchEnd = performance.now();
  await new Promise(resolve => setImmediate(resolve));
  const report = {source, fixturePath, checkpointPath, mode, instrumentation,
    gameMs, batchMs: batchEnd - batchStart, phases,
    residualMs: instrumentation === 'on' ? gameMs - Object.values(phases).reduce((a,b) => a+b, 0) : null,
    memory, gc: gc.filter(e => e.startMs >= batchStart && e.startMs <= batchEnd),
    stats, retainedCount: retained.length, outcomes,
    limitations: 'GC overlaps phase times, is not additive. Residual includes simulation, model injection and harness overhead. Browser time includes first read/compile. Output copies are host-owned in both modes; only retain mode keeps original complete results. No fitting is executed.'};
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  assert.equal(outcomes.length, scenarios.length);
  console.log('REPLAY_COMPLETE: ' + outcomes.length);
  console.log('PROFILE: ' + JSON.stringify({gameMs, phases, residualMs: report.residualMs, retainedCount: retained.length}));
  checkpoint.model.dispose();
  observer.disconnect();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
