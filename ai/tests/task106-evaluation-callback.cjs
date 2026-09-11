const assert = require('node:assert/strict');
const path = require('node:path');
const tf = require('@tensorflow/tfjs-node');
const candidate = require('../cloud-train-runner');
const frozen = require(path.resolve(process.argv[2], 'ai/cloud-train-runner'));
async function main() {
  const state = { seed: 87087, completedGames: 1, runId: 'task106-callback', curriculum: candidate.initialCurriculumState() };
  const outcomes = [];
  for (const runner of [frozen, candidate]) {
    let calls = 0;
    const result = await runner.evaluateCurriculumBaselineAiWinrate({
      curriculumGateGames: 2, curriculumBaselineAiModelPath: path.resolve(process.argv[3]),
      baselineEvaluationConcurrency: 2,
      baselineEvaluationObserver: () => { throw new Error('callback dispatched across IPC'); },
      curriculumPredictFunction: (_identifier, grids) => { calls += 1; return grids.map(() => [0]); }
    }, state, null);
    outcomes.push({ calls, result });
    assert(calls > 0, 'custom predictor unused');
    assert.equal(tf.memory().numTensors, 0);
    console.log('CALLBACK OUTCOME: ' + JSON.stringify(outcomes.at(-1)));
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
  console.log('CALLBACK SERIAL PARITY: PASS exact calls/results; null current model; concurrency requested; no children');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
