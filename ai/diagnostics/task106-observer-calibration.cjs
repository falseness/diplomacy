// Original-only observer calibration. This is not a cache or training benchmark.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const tf = require('@tensorflow/tfjs-node');
const runner = require('../cloud-train-runner');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const [planFile, directory, arm] = process.argv.slice(2);
  assert(planFile && directory && ['A', 'B'].includes(arm), 'usage: PLAN NEW_DIRECTORY A|B');
  fs.mkdirSync(directory);
  const plan = JSON.parse(fs.readFileSync(planFile));
  const report = { arm, games: [], attempted: [], calls: 0, positions: 0, gameMs: [],
    diagnosticMs: { tensor: 0, scalar: 0, hash: 0, report: 0 }, details: [], snapshots: [],
    finalTensors: null, passed: false };
  const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const provenance = { node: process.version, tf: tf.version.tfjs,
    status: fs.readFileSync('/proc/self/status', 'utf8'), environment: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(NODE|TF_|OMP_|MKL_|DIPLOMACY)/.test(k))),
    planHash: hash(planFile), sourceHash: hash(__filename), inputs: {} };
  assert.equal(provenance.node, 'v20.20.2');
  assert.equal(provenance.tf, '4.22.0');
  assert.match(provenance.status, /Cpus_allowed_list:\s+0-1\n/);
  assert.equal(process.env.NODE_OPTIONS, '--max-old-space-size=6144');
  for (const key of Object.keys(process.env)) assert(!/^(TF_NUM_|OMP_|MKL_)/.test(key), key);
  for (const checkpoint of [plan.baseline, ...plan.boundaries.map(b => b.checkpoint)]) {
    const metadata = JSON.parse(fs.readFileSync(path.join(checkpoint, 'model.json')));
    for (const name of ['model.json', ...metadata.weightsManifest.flatMap(g => g.paths)]) {
      const file = path.join(checkpoint, name);
      provenance.inputs[file] = hash(file);
      assert.equal(provenance.inputs[file], plan.inputHashes[file]);
    }
  }
  fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  const diagnostic = (name, fn) => {
    const start = performance.now();
    const result = fn();
    report.diagnosticMs[name] += performance.now() - start;
    return result;
  };
  function wrap(model, role) {
    const original = runner.createRuntimeModelPredict(model);
    return (id, grids) => {
      // A and B share only these minimal counters; each invokes exactly one predictor.
      report.calls++;
      report.positions += grids.length;
      const live = arm === 'B' ? diagnostic('tensor', () => tf.memory().numTensors) : null;
      const values = original(id, grids);
      if (arm === 'B') {
        diagnostic('tensor', () => assert.equal(tf.memory().numTensors, live));
        // Same-array sham intentionally cannot reproduce second-predictor/cache effects.
        const mismatch = diagnostic('scalar', () => values.findIndex((v, i) => !Object.is(v[0], values[i]?.[0])));
        assert.equal(mismatch, -1);
        const inputHash = diagnostic('hash', () => crypto.createHash('sha256').update(JSON.stringify(grids)).digest('hex'));
        diagnostic('report', () => report.details.push({ role, boundary: report.attempted.at(-1).boundary,
          seed: report.attempted.at(-1).seed, inputHash, stableTensors: true, positions: grids.length, mismatch }));
      }
      return values;
    };
  }
  let baseline;
  try {
    baseline = await tf.loadLayersModel(`file://${path.resolve(plan.baseline, 'model.json')}`);
    report.baselineHash = snapshotHash(await snapshotModel(baseline));
    for (const boundary of plan.boundaries) {
      const current = await tf.loadLayersModel(`file://${path.resolve(boundary.checkpoint, 'model.json')}`);
      try {
        const currentHash = snapshotHash(await snapshotModel(current));
        assert.equal(currentHash, boundary.hash);
        report.snapshots.push(currentHash);
        const tensors = tf.memory().numTensors;
        for (const game of [1, 2]) {
          report.attempted.push({ boundary: boundary.hash, game, seed: boundary.results[game - 1].seed });
          save();
          const start = performance.now();
          const result = runner.runCurriculumBaselineGame({ curriculumBaselineAiModelPath: plan.baseline },
            boundary.state, game, wrap(current, 'current'), wrap(baseline, 'baseline'));
          report.gameMs.push(performance.now() - start);
          report.games.push(result);
          save();
          assert.deepEqual(result, boundary.results[game - 1], 'saved full game drift');
          assert.equal(tf.memory().numTensors, tensors);
          console.log(`OBSERVER GAME: PASS seed=${result.seed} calls=${result.inference.calls} positions=${result.inference.positions} nonResult=${result.nonResult}`);
        }
      } finally { current.dispose(); }
    }
    assert.equal(report.calls, 1936);
    assert.equal(report.positions, 57547);
    assert.equal(report.details.length, arm === 'B' ? 1936 : 0);
    report.passed = true;
  } finally {
    if (baseline) baseline.dispose();
    report.finalTensors = tf.memory().numTensors;
    save();
    assert.equal(report.finalTensors, 0);
    console.log('OBSERVER CLEANUP: PASS ownedTensors=0');
  }
  console.log(`OBSERVER CALIBRATION: PASS arm=${arm} games=4 calls=1936 positions=57547 nonResults=4`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
