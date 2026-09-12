// Saved-boundary semantic prerequisite only; no training speed claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tf = require('@tensorflow/tfjs-node');
const { ReusableBaselineEvaluator } = require('../reusable-baseline-evaluation');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');

async function main() {
  const [planFile, output] = process.argv.slice(2);
  const plan = JSON.parse(fs.readFileSync(planFile));
  const report = { boundaries: [], shutdown: [] };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const pool = new ReusableBaselineEvaluator();
  try {
    for (const boundary of plan.boundaries) {
      const model = await tf.loadLayersModel(`file://${path.resolve(boundary.checkpoint, 'model.json')}`);
      try {
        assert.equal(snapshotHash(await snapshotModel(model)), boundary.hash);
        const result = await pool.evaluate({ curriculumGateGames: 2,
          curriculumBaselineAiModelPath: plan.baseline }, boundary.state, model);
        report.boundaries.push(result);
        save();
        // Preserve the full raw result before checking historical control parity.
        assert.deepEqual(result.results, boundary.results, 'saved-boundary semantic drift');
        console.log(`BOUNDARY PARITY: PASS boundary=${report.boundaries.length} games=2 hash=${result.hash}`);
      } finally { model.dispose(); }
    }
  } finally {
    report.shutdown = await pool.close();
    report.finalTensors = tf.memory().numTensors;
    save();
    for (const child of report.shutdown) {
      assert.equal(child.tensors, 0);
      assert.equal(child.exit.code, 0);
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    }
    assert.equal(report.finalTensors, 0);
    console.log('BOUNDARY CLEANUP: PASS children=2 reaped=2 ownedTensors=0 parentTensors=0');
  }
  assert.equal(new Set(report.boundaries.map(b => b.hash)).size, 2);
  const tensors = report.boundaries[0].refreshes.map(r => r.tensors);
  for (const b of report.boundaries) {
    assert.deepEqual(b.refreshes.map(r => r.tensors), tensors);
    assert.deepEqual(b.messages.map(r => r.tensors), tensors);
  }
  console.log('BOUNDED NATIVE POOL: PASS boundaries=2 games=4 freshHashes=2 stableTensors');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
