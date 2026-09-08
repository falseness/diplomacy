// Diagnostic only: canonical teacher ranking on frozen examples and weights.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const assert = require('assert');
const {execFileSync} = require('child_process');
const {performance, PerformanceObserver} = require('perf_hooks');
const tf = require('@tensorflow/tfjs-node');
const trainer = require('../cloud-train-runner');

const ROOT = path.resolve(__dirname, '../..');
const GAME_COUNT = 6;
const TRAINING_SEED = 87087;
const TEACHER_SEED = TRAINING_SEED + 50000;
const STAGE = 0;
const EPOCHS = 20;
const ORDER = ['original', 'instrumented', 'instrumented', 'original'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checkpoint = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const write = (name, value) => fs.writeFileSync(path.join(output, name),
  JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const git = (...args) => execFileSync('git', args, {cwd: ROOT});

async function main() {
  fs.mkdirSync(output); // Refuse to replace a previous attempt.
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const sources = {};
  for (const name of git('ls-files', '-z').toString().split('\0').filter(Boolean)) {
    const bytes = fs.readFileSync(path.join(ROOT, name));
    assert.equal(hash(bytes), hash(git('show', revision + ':' + name)), name);
    sources[name] = hash(bytes);
  }
  const checkpointHashes = Object.fromEntries(['model.json', 'weights.bin', 'metadata.json']
    .map(name => [name, hash(fs.readFileSync(path.join(checkpoint, name)))]));
  write('predeclared.json', {revision, sources, checkpoint, checkpointHashes,
    driverHash: hash(fs.readFileSync(__filename)), status: git('status', '--short').toString(),
    gameCount: GAME_COUNT, teacherSeed: TEACHER_SEED, stage: STAGE, epochs: EPOCHS, order: ORDER,
    node: process.version, execArgv: process.execArgv, tfjs: tf.version,
    scenarios: Array.from({length: GAME_COUNT}, (_, i) => ({game: i + 1,
      seed: TEACHER_SEED + i + 1, modelSide: i % 2 === 0 ? 'A' : 'B'})),
    limitations: 'First six startup expert teacher games; saved step-1 canonical checkpoint, not startup weights. Fixed-data ranking only, not pretraining, evolving training or either speed gate. Expert rollout is the unchanged production default; no checkpoint rollout or strength claim. On/off order includes JIT, GC and host variation; no overhead correction.'});
  const results = [];
  const captureStarted = performance.now();
  for (let game = 1; game <= GAME_COUNT; game += 1) {
    const result = trainer.collectRuntimeCombatTeacherGame(TEACHER_SEED, STAGE, game);
    results.push(result);
    console.log('TEACHER_OUTCOME: ' + JSON.stringify({...result, examples: result.examples.length}));
  }
  const frozen = zlib.gzipSync(Buffer.from(JSON.stringify(results)));
  fs.writeFileSync(path.join(output, 'examples.json.gz'), frozen, {flag: 'wx'});
  write('capture.json', {hash: hash(frozen), captureMs: performance.now() - captureStarted,
    examples: results.reduce((n, r) => n + r.examples.length, 0),
    outcomes: results.map(({examples, ...result}) => ({...result, examples: examples.length}))});
  // All fixtures and expected input hashes are saved before any fitting timing.
  const prototype = tf.LayersModel.prototype;
  const originalFit = prototype.fit;
  let fitEvents = [], gc = [];
  const observer = new PerformanceObserver(list => {
    for (const event of list.getEntries()) gc.push({startTime: event.startTime, duration: event.duration});
  });
  observer.observe({entryTypes: ['gc']});
  const runs = [];
  try {
    for (const mode of ORDER) {
      assert.equal(hash(fs.readFileSync(path.join(output, 'examples.json.gz'))), hash(frozen));
      const gameResults = JSON.parse(zlib.gunzipSync(frozen));
      const model = await tf.loadLayersModel('file://' + path.join(checkpoint, 'model.json'));
      fitEvents = [];
      prototype.fit = mode === 'original' ? originalFit : async function(...args) {
        const start = performance.now();
        try { return await originalFit.apply(this, args); }
        finally { fitEvents.push({ms: performance.now() - start,
          inputShapes: args[0].map(tensor => tensor.shape), options: args[2]}); }
      };
      const beforeMemory = process.memoryUsage();
      const start = performance.now();
      let history;
      try { history = await trainer.trainRuntimeCombatBatch(model, {gameResults}, EPOCHS); }
      finally { prototype.fit = originalFit; }
      const end = performance.now();
      assert(history && history.history.loss.length === EPOCHS);
      assert(history.history.loss.every(Number.isFinite));
      const weights = model.getWeights();
      const weightBytes = Buffer.concat(weights.map(tensor => Buffer.from(tensor.dataSync().buffer)));
      const weightHash = hash(weightBytes);
      // Preserve the trained weights themselves so the hash is independently auditable.
      fs.writeFileSync(path.join(output, `weights-${runs.length + 1}.bin`), weightBytes, {flag: 'wx'});
      const loss = history.history.loss;
      await new Promise(resolve => setImmediate(resolve));
      const run = {mode, totalMs: end - start, fitEvents,
        residualMs: mode === 'instrumented' ? end - start - fitEvents.reduce((n, f) => n + f.ms, 0) : null,
        loss, weightHash, beforeMemory, afterMemory: process.memoryUsage(),
        gc: gc.filter(event => event.startTime >= start && event.startTime < end)};
      runs.push(run);
      write(`pass-${runs.length}.json`, run);
      model.dispose();
      console.log('FITTING_PHASES: ' + JSON.stringify(run));
      assert.deepStrictEqual(loss, runs[0].loss, 'all loss epochs must match');
      assert.equal(weightHash, runs[0].weightHash, 'all trained weights must match');
    }
  } finally { prototype.fit = originalFit; observer.disconnect(); }
  write('timings.json', runs);
  console.log('FITTING_EQUIVALENCE: PASS 4 identical loss histories and trained weight hashes');
  console.log('FITTING_PROFILE: PASS diagnostic only; no canonical speed-gate claim');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
