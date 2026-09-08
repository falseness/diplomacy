// Diagnostic only: split the frozen checkpoint predictor's preparation cost.
// Production files are never edited and these timings are not speed-gate evidence.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const v8 = require('v8');
const zlib = require('zlib');
const assert = require('assert');
const {performance} = require('perf_hooks');
const {execFileSync} = require('child_process');
const [captureArg, checkpointArg, outputArg] = process.argv.slice(2);
const capture = path.resolve(captureArg), checkpoint = path.resolve(checkpointArg);
const output = path.resolve(outputArg), root = path.resolve(__dirname, '../..');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(capture, name)));
const save = (name, data) => fs.writeFileSync(path.join(output, name),
  JSON.stringify(data, null, 2) + '\n', {flag: 'wx'});

async function main() {
  fs.mkdirSync(output); // Evidence attempts are immutable.
  const prior = read('predeclared.json');
  for (const [name, hash] of Object.entries(prior.sources)) {
    assert.equal(digest(fs.readFileSync(path.join(root, name))), hash, name);
  }
  for (const [name, hash] of Object.entries(prior.checkpointHashes)) {
    assert.equal(digest(fs.readFileSync(name)), hash, name);
    assert.equal(digest(fs.readFileSync(path.join(checkpoint, path.relative(
      path.dirname(Object.keys(prior.checkpointHashes).find(p => p.endsWith('/model.json'))), name)))), hash);
  }
  const inputs = read('frozen-inputs.json');
  const outcomes = read('outcomes.json');
  assert.equal(outcomes.length, 6);
  assert.equal(inputs.length, outcomes.reduce((n, o) => n + o.game.inference.calls, 0));
  const order = ['original', 'instrumented', 'instrumented', 'original'];
  const filename = path.join(root, 'ai/benchmark-gamestart-trained-model.js');
  const source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf('function createPredictor(');
  const end = source.indexOf('\nfunction runRuntimeGame(', start);
  assert(start >= 0 && end > start);
  let body = source.slice(start, end);
  function replace(before, after) {
    assert.equal(body.split(before).length, 2, 'unique instrumentation anchor: ' + before);
    body = body.replace(before, after);
  }
  replace('    const expectedWidth', '    let phaseStart = __phaseNow();\n    const expectedWidth');
  replace('    const boardTensor = tf.tensor4d(',
    "    __phaseRecord('adaptation', phaseStart);\n    const boardTensor = __phaseTime('boardTensor', () => tf.tensor4d(");
  replace('      adaptedBoards.flat(3),', "      __phaseTime('flatten', () => adaptedBoards.flat(3)),");
  replace('expectedHeight, expectedChannels]\n    );', 'expectedHeight, expectedChannels]\n    ));');
  replace('tf.tensor2d(globals, [globals.length, 1]);',
    "__phaseTime('globalTensor', () => tf.tensor2d(globals, [globals.length, 1]));");
  replace('checkpointModel.predict([boardTensor, globalTensor]);',
    "__phaseTime('backend', () => checkpointModel.predict([boardTensor, globalTensor]));");
  replace('Array.from(prediction.dataSync());',
    "__phaseTime('readAndConvert', () => Array.from(prediction.dataSync()));");
  replace('prediction.dispose();', "__phaseTime('predictionDispose', () => prediction.dispose());");
  replace('      boardTensor.dispose();\n      globalTensor.dispose();',
    "      __phaseTime('inputDispose', () => { boardTensor.dispose(); globalTensor.dispose(); });");
  const transformed = source.slice(0, start) + body + source.slice(end);
  save('predeclared.json', {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root}).toString().trim(),
    status: execFileSync('git', ['status', '--short'], {cwd: root}).toString(),
    order, sourceHash: digest(source), transformedHash: digest(transformed),
    driverHash: digest(fs.readFileSync(__filename)), prior,
    captureHashes: Object.fromEntries(['predeclared.json', 'frozen-inputs.json', 'outcomes.json']
      .map(n => [n, digest(fs.readFileSync(path.join(capture, n)))])),
    node: process.version, execArgv: process.execArgv,
    limitations: 'Frozen host-realm vectors; checkpoint replay, not canonical evolving training. boardTensor includes flatten, subtracted below. Projection-only contrast has no inference or fitting. All four passes retained; calibration includes JIT/GC/host noise.'
  });
  fs.writeFileSync(path.join(output, 'instrumented-source.js'), transformed, {flag: 'wx'});
  let phases;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled.__phaseNow = () => performance.now();
  compiled.__phaseRecord = (name, began) => { phases[name] = (phases[name] || 0) + performance.now() - began; };
  compiled.__phaseTime = (name, fn) => {
    const began = performance.now();
    try { return fn(); } finally { compiled.__phaseRecord(name, began); }
  };
  compiled._compile('const {__phaseNow, __phaseRecord, __phaseTime} = module;\n' +
    transformed.replace(/^#![^\n]*\n/, ''), filename);
  const original = require(filename);
  const {projectRuntimeVectorForModel} = require('../cloud-train-runner');
  const loaded = await original.loadCheckpoint(checkpoint);
  const runs = [];
  try {
    for (const mode of order) {
      phases = {};
      const stats = {calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0};
      const predict = (mode === 'original' ? original : compiled.exports).createPredictor(loaded.model, stats);
      let totalMs = 0, projectionMs = 0, projectionFlattenMs = 0;
      const comparisons = [];
      for (const input of inputs) {
        const bytes = fs.readFileSync(path.join(capture, input.name));
        assert.equal(digest(bytes), input.hash);
        const vectors = v8.deserialize(zlib.gunzipSync(bytes));
        let began = performance.now();
        const values = predict(loaded.model, vectors);
        totalMs += performance.now() - began;
        assert.deepStrictEqual(values, input.values);
        comparisons.push({name: input.name, positions: vectors.length,
          expectedHash: digest(JSON.stringify(input.values)), actualHash: digest(JSON.stringify(values))});
        // Actual canonical projection function on the identical frozen inputs.
        // Its output is a different model representation: no timing transfer claim.
        began = performance.now();
        const boards = vectors.map(vector => projectRuntimeVectorForModel(vector).board);
        projectionMs += performance.now() - began;
        began = performance.now();
        const flat = boards.flat();
        projectionFlattenMs += performance.now() - began;
        assert.equal(flat.length, vectors.length * 3 * 3 * 21);
      }
      if (mode === 'instrumented') phases.boardTensor -= phases.flatten;
      const run = {mode, totalMs, phases, residualMs: totalMs - Object.values(phases).reduce((a, b) => a + b, 0),
        projectionMs, projectionFlattenMs, stats, memory: process.memoryUsage(), comparisons};
      runs.push(run);
      save(`pass-${runs.length}.json`, run);
      console.log('PREPARATION_PHASES: ' + JSON.stringify({...run, comparisons: comparisons.length}));
    }
  } finally { loaded.model.dispose(); }
  save('timings.json', runs);
  console.log('PREPARATION_EQUIVALENCE: PASS all 269 calls and 7848 positions in all four passes');
  assert.equal(inputs.length, 269);
  assert.equal(inputs.reduce((n, i) => n + i.positions, 0), 7848);
  console.log('PREPARATION_PROFILE: PASS diagnostic only; canonical speed gate remains unmeasured');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
