// Bounded feasibility screen, not a canonical training benchmark or quality gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const tf = require('@tensorflow/tfjs-node');
const {
  createRuntimeModelPredict, projectRuntimeVectorForModel,
  evaluateCurriculumSimpleAiWinrate, initialCurriculumState
} = require('../cloud-train-runner');

const BOARD_WIDTH = 3;
const CHANNELS = 21;
const BOARD_VALUES = BOARD_WIDTH * BOARD_WIDTH * CHANNELS;
const SCREEN_SEED = 87087;
const SCREEN_GAMES = 2;

async function main() {
  const [checkpoint, output] = process.argv.slice(2);
  assert(checkpoint && output, 'usage: node task106-predictor-screen.cjs CHECKPOINT OUTPUT');
  const modelFile = path.resolve(checkpoint, 'model.json');
  const metadata = JSON.parse(fs.readFileSync(modelFile));
  const hashes = {};
  for (const file of ['model.json', ...metadata.weightsManifest.flatMap(group => group.paths)]) {
    hashes[file] = crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(checkpoint, file))).digest('hex');
  }
  const model = await tf.loadLayersModel(`file://${modelFile}`);
  const original = createRuntimeModelPredict(model);
  const calls = [];
  const packedStats = { calls: 0, positions: 0, probes: [] };
  const tensorsBefore = tf.memory().numTensors;
  // The only candidate difference is contiguous Float32 input assembly. Use the
  // actual model and unchanged projection, keeping prediction/disposal identical.
  function packed(_identifier, grids) {
    const boards = new Float32Array(grids.length * BOARD_VALUES);
    const globals = new Float32Array(grids.length);
    grids.forEach((grid, index) => {
      const projected = projectRuntimeVectorForModel(grid);
      boards.set(projected.board, index * BOARD_VALUES);
      globals[index] = projected.globalValue;
    });
    const boardTensor = tf.tensor4d(boards, [grids.length, BOARD_WIDTH, BOARD_WIDTH, CHANNELS]);
    const globalTensor = tf.tensor2d(globals, [grids.length, 1]);
    let prediction;
    try {
      prediction = model.predict([boardTensor, globalTensor]);
      let value = prediction;
      if (Array.isArray(prediction)) {
        const index = prediction.findIndex(tensor =>
          (tensor.name || '').replace(/:\d+$/, '').split('/')[0] === 'combat_value');
        value = prediction[index >= 0 ? index : prediction.length - 1];
      }
      const values = Array.from(value.dataSync());
      packedStats.calls += 1;
      packedStats.positions += grids.length;
      if (packedStats.probes.length < 8) {
        packedStats.probes.push(...values.slice(0, 8 - packedStats.probes.length));
      }
      return values.map(value => [value]);
    } finally {
      if (Array.isArray(prediction)) {
        prediction.forEach(tensor => tensor.dispose());
      } else if (prediction) {
        prediction.dispose();
      }
      boardTensor.dispose();
      globalTensor.dispose();
    }
  }
  function timed(fn, identifier, grids) {
    const start = performance.now();
    const values = fn(identifier, grids);
    return { values, milliseconds: performance.now() - start };
  }
  function compare(identifier, grids) {
    // Alternate paired order without selecting calls/seeds on observed timing.
    let before, after;
    if (calls.length % 2 === 0) {
      before = timed(original, identifier, grids);
      after = timed(packed, identifier, grids);
    } else {
      after = timed(packed, identifier, grids);
      before = timed(original, identifier, grids);
    }
    assert.deepEqual(after.values, before.values, 'packed prediction differs');
    calls.push({ positions: grids.length, originalMs: before.milliseconds, packedMs: after.milliseconds });
    // Original outputs alone drive the unchanged runtime players.
    return before.values;
  }
  try {
    const start = performance.now();
    const result = await evaluateCurriculumSimpleAiWinrate({
      curriculumGateGames: SCREEN_GAMES, curriculumPredictFunction: compare
    }, {
      seed: SCREEN_SEED, completedGames: 1, runId: 'task106-predictor-screen',
      curriculum: initialCurriculumState()
    }, model);
    const wallMs = performance.now() - start;
    assert(calls.length > 0);
    assert.equal(result.results.length, SCREEN_GAMES);
    assert.deepEqual(result.sideDistribution, { modelA: 1, modelB: 1 });
    assert.equal(tf.memory().numTensors, tensorsBefore, 'screen leaked tensors');
    const originalMs = calls.reduce((sum, call) => sum + call.originalMs, 0);
    const packedMs = calls.reduce((sum, call) => sum + call.packedMs, 0);
    const summary = {
      kind: 'paired predictor feasibility screen; not canonical wall timings',
      checkpoint: path.resolve(checkpoint), hashes, node: process.version,
      seed: SCREEN_SEED, calls, result, wallMs, originalMs, packedMs,
      estimatedEvaluationReduction: (originalMs - packedMs) / (wallMs - packedMs),
      caveat: 'Subtracts duplicate prediction time; assertion, cache and instrumentation effects remain. SimpleAi evaluation only; no baseline-evaluation or complete-training speed claim.'
    };
    fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
    console.log('PACKED PREDICTION PARITY: PASS calls=' + calls.length);
    console.log('TENSOR LIFECYCLE: PASS');
    console.log('BALANCED COMPLETE INVENTORY: ' + JSON.stringify(result));
    console.log('FEASIBILITY TIMING: ' + JSON.stringify({ wallMs, originalMs, packedMs,
      estimatedEvaluationReduction: summary.estimatedEvaluationReduction }));
  } finally {
    model.dispose();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
