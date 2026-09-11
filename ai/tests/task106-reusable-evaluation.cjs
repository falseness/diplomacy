const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const tf = require('@tensorflow/tfjs-node');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');
const { ReusableBaselineEvaluator } = require('../reusable-baseline-evaluation');
const root = path.resolve(process.argv[2]);
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json')));
const frozen = require(path.join(root, 'frozen/ai/cloud-train-runner'));
const checkpoint = path.resolve('artifacts/TASK-106/iteration-11/screen-current-w1/final/task106-screen');
const baseline = '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training';
const report = { plan, arms: [], parity: false, opportunity: false };
const save = () => fs.writeFileSync(path.join(root, 'screen.json'), JSON.stringify(report, null, 2));
async function main() {
  const model = await tf.loadLayersModel(`file://${checkpoint}/model.json`);
  const weights = model.getWeights();
  const original = weights[0].dataSync().slice();
  const count = tf.memory().numTensors;
  try {
    for (let repeat = 0; repeat < plan.orders.length; repeat++) {
      for (const mode of plan.orders[repeat]) {
        const arm = { repeat, mode, boundaries: [] };
        const start = performance.now();
        const pool = mode.startsWith('reuse') ? new ReusableBaselineEvaluator() : null;
        try {
          for (let b = 0; b < 2; b++) {
            const values = original.slice(); values[0] += plan.offsets[b];
            const changed = tf.tensor(values, weights[0].shape, weights[0].dtype);
            model.setWeights([changed, ...weights.slice(1)]); changed.dispose();
            const state = { seed: plan.stateSeeds[b], completedGames: 1, runId: 'task106-two-game', curriculum: frozen.initialCurriculumState() };
            const options = { curriculumGateGames: 2, curriculumBaselineAiModelPath: baseline,
              baselineEvaluationConcurrency: mode === 'oneshot' ? 2 : 0 };
            const boundaryStart = performance.now();
            const hash = snapshotHash(await snapshotModel(model));
            let observation;
            if (pool) observation = await pool.evaluate(options, state, model, mode === 'reuseSerial' ? 1 : 2);
            else {
              const messages = []; options.baselineEvaluationObserver = message => messages.push(message);
              const result = await frozen.evaluateCurriculumBaselineAiWinrate(options, state, model);
              observation = { results: result.results, aggregate: result, messages, hash };
            }
            arm.boundaries.push({ boundary: b + 1, state, wallMs: performance.now() - boundaryStart, ...observation });
            assert.equal(tf.memory().numTensors, count);
            console.log('BOUNDARY COMPLETE: ' + JSON.stringify({ repeat, mode, boundary: b + 1, hash, wallMs: arm.boundaries[b].wallMs }));
          }
        } finally { if (pool) arm.shutdown = await pool.close(); }
        arm.wallMs = performance.now() - start;
        report.arms.push(arm); save();
        console.log('SEQUENCE COMPLETE: ' + JSON.stringify({ repeat, mode, wallMs: arm.wallMs }));
      }
    }
    for (const arm of report.arms) {
      assert.notEqual(arm.boundaries[0].hash, arm.boundaries[1].hash);
      arm.boundaries.forEach((boundary, i) => {
        assert.equal(boundary.hash, report.arms[0].boundaries[i].hash);
        assert.deepEqual(boundary.results, report.arms[0].boundaries[i].results);
        assert.deepEqual(boundary.results.map(r => r.seed), plan.gameSeeds.slice(i * 2, i * 2 + 2));
      });
      if (arm.shutdown) {
        assert.deepEqual(arm.boundaries[0].refreshes.map(m => m.pid), arm.boundaries[1].refreshes.map(m => m.pid));
        assert.deepEqual(arm.boundaries[0].refreshes.map(m => m.tensors), arm.boundaries[1].refreshes.map(m => m.tensors));
        arm.shutdown.forEach(m => { assert.equal(m.tensors, 0); assert.equal(m.exit.code, 0); });
      }
    }
    report.parity = true;
    report.meansMs = Object.fromEntries(plan.orders[0].map(mode => [mode,
      report.arms.filter(a => a.mode === mode).reduce((s, a) => s + a.wallMs, 0) / plan.repetitions]));
    report.netReductionPercent = 100 * (1 - report.meansMs.reuseConcurrent / report.meansMs.frozen);
    report.minimumProjectedPercent = report.netReductionPercent * plan.minimumShare;
    report.opportunity = report.minimumProjectedPercent >= 10;
    console.log('PERSISTENT PARITY: PASS sequences=8 boundaries=16 games=32 distinctHashes=2');
    console.log('NET OPPORTUNITY: ' + JSON.stringify({ meansMs: report.meansMs, netReductionPercent: report.netReductionPercent,
      minimumProjectedPercent: report.minimumProjectedPercent, opportunity: report.opportunity }));
  } finally { model.dispose(); report.finalTensors = tf.memory().numTensors; save(); }
  assert.equal(report.finalTensors, 0);
  console.log('FINAL CLEANUP: PASS parent tensors=0; retained child models disposed; exits=0');
}
main().catch(error => { report.failure = error.stack; save(); console.error(error); process.exitCode = 1; });
