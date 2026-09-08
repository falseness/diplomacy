// Frozen-input diagnostic. These timings are never full-training speed evidence.
const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');
const {performance} = require('perf_hooks');
const {execFileSync} = require('child_process');
const [sourceArg, fixtureArg, checkpointArg, outputArg] = process.argv.slice(2);
const source = path.resolve(sourceArg), output = path.resolve(outputArg);
const fixture = path.resolve(fixtureArg), checkpointPath = path.resolve(checkpointArg);
fs.mkdirSync(output); // Refuse to overwrite any attempt.
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function save(name, value) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
function treeHashes(directory) {
  const result = {};
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, treeHashes(file));
    else if (entry.isFile()) result[file] = hash(fs.readFileSync(file));
  }
  return result;
}
async function main() {
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: source}).toString().split('\0').filter(Boolean);
  const sources = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(source, file)))]));
  const scenarios = JSON.parse(fs.readFileSync(fixture));
  save('predeclared.json', {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source}).toString().trim(),
    status: execFileSync('git', ['status', '--short'], {cwd: source}).toString(),
    sources, checkpointHashes: treeHashes(checkpointPath), fixtureHash: hash(fs.readFileSync(fixture)),
    driverHash: hash(fs.readFileSync(__filename)), scenarios, node: process.version,
    execArgv: process.execArgv, order: ['off', 'on', 'on', 'off'],
    limitations: 'Capture every call from all six declared canonical scenarios before timing. Replay identical frozen vectors and assert all output values. Expert rollout is replaced by frozen checkpoint; no fitting, holdout, strength or acceptance-speed claim.'
  });
  const {loadCheckpoint, createPredictor} = require(path.join(source, 'ai/benchmark-gamestart-trained-model'));
  const {runGame} = require(path.join(source, 'ai/benchmarkHarness'));
  const checkpoint = await loadCheckpoint(checkpointPath);
  const stats = {calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0};
  const predict = createPredictor(checkpoint.model, stats);
  const inputs = [], outcomes = [];
  function capture(model, vectors) {
    // Serialization precedes prediction, preserving mutable candidate values.
    const frozen = v8.serialize(vectors);
    const values = predict(model, vectors);
    const name = `input-${inputs.length}.v8.gz`;
    const data = zlib.gzipSync(frozen);
    fs.writeFileSync(path.join(output, name), data, {flag: 'wx'});
    inputs.push({name, hash: hash(data), positions: vectors.length, values});
    return values;
  }
  for (const scenario of scenarios) {
    console.log('CAPTURE_START: ' + JSON.stringify(scenario));
    const game = runGame({...scenario, predictFunction: capture, modelIdentifier: checkpoint.model,
      inferenceSource: 'TASK-102 diagnostic frozen checkpoint; not original expert/evolving predictor'});
    outcomes.push({scenario, game});
    console.log('CAPTURE_RESULT: ' + JSON.stringify(game));
  }
  save('frozen-inputs.json', inputs);
  save('outcomes.json', outcomes);
  console.log(`INPUTS_FROZEN: ${inputs.length} calls ${inputs.reduce((sum, i) => sum + i.positions, 0)} positions`);
  // Only backend entry and synchronous read are wrapped; preparation and disposal
  // remain the exact production predictor. Residual is explicitly an upper bound.
  const originalPredict = checkpoint.model.predict;
  let enabled = false, phases;
  checkpoint.model.predict = function(...args) {
    if (!enabled) return originalPredict.apply(this, args);
    const start = performance.now();
    const prediction = originalPredict.apply(this, args);
    phases.backendMs += performance.now() - start;
    const originalRead = prediction.dataSync;
    prediction.dataSync = function(...readArgs) {
      const start = performance.now();
      try { return originalRead.apply(this, readArgs); }
      finally { phases.readMs += performance.now() - start; }
    };
    return prediction;
  };
  const runs = [];
  for (const mode of ['off', 'on', 'on', 'off']) {
    enabled = mode === 'on';
    phases = {backendMs: 0, readMs: 0};
    let totalMs = 0;
    for (const input of inputs) {
      const data = fs.readFileSync(path.join(output, input.name));
      assert.equal(hash(data), input.hash);
      const vectors = v8.deserialize(zlib.gunzipSync(data));
      const start = performance.now();
      const values = predict(checkpoint.model, vectors);
      totalMs += performance.now() - start;
      assert.deepStrictEqual(values, input.values);
    }
    const run = {mode, totalMs, phases, residualMs: enabled ? totalMs - phases.backendMs - phases.readMs : null,
      calls: inputs.length, memory: process.memoryUsage()};
    runs.push(run);
    console.log('FROZEN_REPLAY: ' + JSON.stringify(run));
  }
  save('timings.json', runs);
  checkpoint.model.predict = originalPredict;
  checkpoint.model.dispose();
  assert(inputs.length > 0);
  console.log('OUTPUT_EQUIVALENCE: PASS every call and score in all four predeclared passes');
  console.log('INFERENCE_PROFILE: PASS diagnostic only; residual includes adaptation, flattening, tensor creation and disposal');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
