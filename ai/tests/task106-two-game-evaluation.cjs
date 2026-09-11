const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const tf = require('@tensorflow/tfjs-node');
const candidate = require('../cloud-train-runner');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');
const [frozenRoot, checkpoint, baseline, output] = process.argv.slice(2).map(value => path.resolve(value));
const frozen = require(path.join(frozenRoot, 'ai/cloud-train-runner'));
const PLAN = [
  { seed: 87087, order: ['frozen', 'childSerial', 'concurrent'] },
  { seed: 87089, order: ['concurrent', 'childSerial', 'frozen'] }
];
async function main() {
  const report = { node: process.version, plan: PLAN, arms: [], checkpoint, baseline,
    meaning: 'two separate evaluation boundaries; exact fresh model; inclusive local timing, not canonical speed' };
  const model = await tf.loadLayersModel(`file://${checkpoint}/model.json`);
  const savedHash = snapshotHash(await snapshotModel(model));
  // A predeclared one-element change proves children receive in-memory state,
  // rather than loading the checkpoint supplied only to this test driver.
  const weights = model.getWeights();
  const values = weights[0].dataSync().slice();
  values[0] += 0.001;
  const changed = tf.tensor(values, weights[0].shape, weights[0].dtype);
  model.setWeights([changed, ...weights.slice(1)]);
  changed.dispose();
  const freshHash = snapshotHash(await snapshotModel(model));
  assert.notEqual(freshHash, savedHash);
  report.savedHash = savedHash; report.freshHash = freshHash;
  const tensorCount = tf.memory().numTensors;
  try {
    for (const { seed, order } of PLAN) {
      for (const mode of order) {
        const children = [];
        const state = { seed, completedGames: 1, runId: 'task106-two-game', curriculum: candidate.initialCurriculumState() };
        const options = { curriculumGateGames: 2, curriculumBaselineAiModelPath: baseline,
          baselineEvaluationConcurrency: mode === 'concurrent' ? 2 : mode === 'childSerial' ? 1 : 0,
          baselineEvaluationObserver: message => children.push(message) };
        const start = performance.now();
        const result = await (mode === 'frozen' ? frozen : candidate).evaluateCurriculumBaselineAiWinrate(options, state, model);
        const arm = { seed, mode, wallMs: performance.now() - start, result, children,
          parentMemory: process.memoryUsage(), parentResources: process.resourceUsage() };
        report.arms.push(arm);
        fs.writeFileSync(output, JSON.stringify(report, null, 2));
        assert.equal(tf.memory().numTensors, tensorCount, 'parent tensor leak');
        assert.equal(snapshotHash(await snapshotModel(model)), freshHash);
        if (mode !== 'frozen') {
          assert.deepEqual(children.map(child => child.game), [1, 2]);
          children.forEach(child => { assert.equal(child.hash, freshHash); assert.equal(child.tensorsAfter, 0); });
        }
        console.log('TWO GAME ARM: ' + JSON.stringify(arm));
      }
      const arms = report.arms.filter(arm => arm.seed === seed);
      for (const arm of arms) assert.deepEqual(arm.result, arms[0].result);
      console.log(`BOUNDARY PARITY: PASS seed=${seed} games=2 modes=3 freshModel=${freshHash}`);
    }
    const mean = mode => report.arms.filter(arm => arm.mode === mode).reduce((sum, arm) => sum + arm.wallMs, 0) / PLAN.length;
    report.frozenMeanMs = mean('frozen'); report.childSerialMeanMs = mean('childSerial'); report.concurrentMeanMs = mean('concurrent');
    report.netReductionPercent = 100 * (1 - report.concurrentMeanMs / report.frozenMeanMs);
    report.minimumProjectedPercent = report.netReductionPercent * 0.47708567;
    report.opportunity = report.minimumProjectedPercent >= 10;
    report.parity = true;
    console.log('NET OPPORTUNITY: ' + JSON.stringify(report));
  } finally {
    model.dispose();
    report.finalTensors = tf.memory().numTensors;
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
  assert.equal(report.finalTensors, 0);
  console.log('MODEL CLEANUP: PASS parent tensors=0; every child tensors=0 and exit=0');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
