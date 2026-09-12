// Bounded output-pruning hypothesis. Original predictions drive every game.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const tf = require('@tensorflow/tfjs-node');
const runner = require('../cloud-train-runner');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');

// Match LayersModel.predict's default batch boundaries without creating a
// second model owner or changing the trained graph/weights.
function valueOutputPredict(model) {
  const output = model.getLayer('combat_value').output.name;
  return runner.createRuntimeModelPredict({ predict(inputs) {
    return tf.tidy(() => {
      const batches = [];
      for (let start = 0; start < inputs[0].shape[0]; start += 32) {
        const count = Math.min(32, inputs[0].shape[0] - start);
        batches.push(tf.tidy(() => model.execute(inputs.map(input =>
          input.slice([start, ...input.shape.slice(1).map(() => 0)],
            [count, ...input.shape.slice(1)])), output)));
      }
      return tf.concat(batches, 0);
    });
  } });
}

async function main() {
  const [planFile, directory] = process.argv.slice(2);
  assert(planFile && directory, 'usage: node task106-value-output.cjs PLAN NEW_DIRECTORY');
  fs.mkdirSync(directory); // Refuse to overwrite any attempted experiment.
  const plan = JSON.parse(fs.readFileSync(planFile));
  const report = { kind: 'paired value-output semantic prerequisite, not training timing',
    calls: [], games: [], attempted: [], finalTensors: null, passed: false };
  const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const sourceHash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const provenance = { node: process.version, tf: tf.version, sources: {}, inputs: {},
    environment: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(NODE|TF_|OMP_|MKL_|DIPLOMACY)/.test(key))) };
  for (const file of [__filename, require.resolve('../cloud-train-runner'), planFile]) {
    provenance.sources[file] = sourceHash(file);
  }
  for (const checkpoint of [plan.baseline, ...plan.boundaries.map(b => b.checkpoint)]) {
    const metadata = JSON.parse(fs.readFileSync(path.join(checkpoint, 'model.json')));
    for (const file of ['model.json', ...metadata.weightsManifest.flatMap(g => g.paths)]) {
      const resolved = path.join(checkpoint, file);
      provenance.inputs[resolved] = sourceHash(resolved);
    }
  }
  fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  function compare(model, role) {
    const original = runner.createRuntimeModelPredict(model);
    const candidate = valueOutputPredict(model);
    return (id, grids) => {
      const timed = fn => {
        const start = performance.now();
        const values = fn(id, grids);
        return { values, ms: performance.now() - start };
      };
      let before, after;
      if (report.calls.length % 2) { after = timed(candidate); before = timed(original); }
      else { before = timed(original); after = timed(candidate); }
      const mismatch = before.values.findIndex((v, i) => !Object.is(v[0], after.values[i]?.[0]));
      report.calls.push({ role, positions: grids.length, beforeMs: before.ms, afterMs: after.ms,
        mismatch, ...(mismatch < 0 ? {} : { before: before.values[mismatch], after: after.values[mismatch] }) });
      if (mismatch >= 0 || before.values.length !== after.values.length) {
        save();
        assert.fail('value-output numeric drift');
      }
      return before.values;
    };
  }
  let baseline;
  try {
    baseline = await tf.loadLayersModel(`file://${path.resolve(plan.baseline, 'model.json')}`);
    for (const boundary of plan.boundaries) {
      const current = await tf.loadLayersModel(`file://${path.resolve(boundary.checkpoint, 'model.json')}`);
      try {
        assert.equal(snapshotHash(await snapshotModel(current)), boundary.hash);
        const tensors = tf.memory().numTensors;
        for (const game of [1, 2]) {
          report.attempted.push({ boundary: boundary.hash, game, seed: boundary.results[game - 1].seed });
          save();
          const result = runner.runCurriculumBaselineGame({ curriculumBaselineAiModelPath: plan.baseline },
            boundary.state, game, compare(current, 'current'), compare(baseline, 'baseline'));
          report.games.push(result);
          save();
          assert.deepEqual(result, boundary.results[game - 1], 'saved boundary work drift');
          assert.equal(tf.memory().numTensors, tensors, 'prediction tensor leak');
          console.log(`VALUE OUTPUT PARITY: PASS seed=${result.seed} calls=${result.inference.calls} positions=${result.inference.positions}`);
        }
      } finally { current.dispose(); }
    }
    report.passed = true;
  } finally {
    if (baseline) baseline.dispose();
    report.finalTensors = tf.memory().numTensors;
    save();
    assert.equal(report.finalTensors, 0);
    console.log('VALUE OUTPUT CLEANUP: PASS ownedTensors=0');
  }
  console.log(`VALUE OUTPUT PREREQUISITE: PASS games=${report.games.length} calls=${report.calls.length}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { valueOutputPredict };
