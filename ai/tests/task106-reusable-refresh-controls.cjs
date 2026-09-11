const assert = require('node:assert/strict');
const path = require('node:path');
const tf = require('@tensorflow/tfjs-node');
const { EvaluatorProcess } = require('../reusable-baseline-evaluation');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');
const runner = require('../cloud-train-runner');
async function main() {
  const model = await tf.loadLayersModel(`file://${path.resolve(process.argv[2], 'model.json')}`);
  const baselinePath = path.resolve(process.argv[3]);
  const snapshot = await snapshotModel(model), hash = snapshotHash(snapshot);
  model.dispose();
  for (const kind of ['stale-hash', 'stale-boundary', 'duplicate-game']) {
    const worker = new EvaluatorProcess();
    try {
      await worker.request('refresh', {boundary:1, snapshot, baselinePath});
      const job = {boundary:1, hash, game:2,
        state:{seed:87087,completedGames:1,runId:'task106-refresh-control',curriculum:runner.initialCurriculumState()},
        options:{curriculumBaselineAiModelPath:baselinePath}};
      if (kind === 'duplicate-game') {
        const result = await worker.request('game', job);
        console.log('CONTROL GAME: '+JSON.stringify(result));
      }
      if (kind === 'stale-hash') job.hash = 'stale';
      if (kind === 'stale-boundary') job.boundary = 0;
      await assert.rejects(worker.request('game',job), /stale|duplicate/);
    } finally { await assert.rejects(worker.close(), /stale|duplicate/); }
    assert(worker.exit);
    console.log(`REFRESH REJECTION: PASS ${kind}; real loaded models; process reaped`);
  }
  assert.equal(tf.memory().numTensors, 0);
}
main().catch(error => {console.error(error);process.exitCode=1;});
