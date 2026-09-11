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
  const [checkpoint, output, mode = 'packed'] = process.argv.slice(2);
  assert(checkpoint && output, 'usage: node task106-predictor-screen.cjs CHECKPOINT OUTPUT');
  assert(['packed', 'deduplicated'].includes(mode), 'unknown screen mode');
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
  let uniquePositions = 0;
  let mismatchedValues = 0;
  let firstMismatch = null;
  // Use the actual model and unchanged projection/disposal. Deduplication is a
  // diagnostic candidate only; original outputs always drive the game.
  function packed(_identifier, grids) {
    let boards = new Float32Array(grids.length * BOARD_VALUES);
    let globals = new Float32Array(grids.length);
    const indices = [];
    const unique = new Map();
    let count = 0;
    grids.forEach((grid, index) => {
      const projected = projectRuntimeVectorForModel(grid);
      if (mode === 'packed') {
        boards.set(projected.board, index * BOARD_VALUES);
        globals[index] = projected.globalValue;
        indices.push(count++);
        return;
      }
      // Compare exact tensor-input bytes, not a lossy hash or board identity.
      // The map is local to this call, so it cannot cache stale model weights.
      const input = new Float32Array([...projected.board, projected.globalValue]);
      const key = Buffer.from(input.buffer).toString('hex');
      let target = unique.get(key);
      if (target === undefined) {
        target = count++;
        unique.set(key, target);
        boards.set(projected.board, target * BOARD_VALUES);
        globals[target] = projected.globalValue;
      }
      indices.push(target);
    });
    uniquePositions += count;
    boards = boards.subarray(0, count * BOARD_VALUES);
    globals = globals.subarray(0, count);
    const boardTensor = tf.tensor4d(boards, [count, BOARD_WIDTH, BOARD_WIDTH, CHANNELS]);
    const globalTensor = tf.tensor2d(globals, [count, 1]);
    let prediction;
    try {
      prediction = model.predict([boardTensor, globalTensor]);
      let value = prediction;
      if (Array.isArray(prediction)) {
        const index = prediction.findIndex(tensor =>
          (tensor.name || '').replace(/:\d+$/, '').split('/')[0] === 'combat_value');
        value = prediction[index >= 0 ? index : prediction.length - 1];
      }
      const uniqueValues = Array.from(value.dataSync());
      const values = indices.map(index => uniqueValues[index]);
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
    before.values.forEach((value, index) => {
      if (!Object.is(value[0], after.values[index][0])) {
        mismatchedValues += 1;
        firstMismatch ||= { call: calls.length, index, original: value[0], candidate: after.values[index][0] };
      }
    });
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
      kind: 'paired predictor feasibility screen; not canonical wall timings', mode,
      uniquePositions, mismatchedValues, firstMismatch,
      checkpoint: path.resolve(checkpoint), hashes, node: process.version,
      seed: SCREEN_SEED, calls, result, wallMs, originalMs, packedMs,
      estimatedEvaluationReduction: (originalMs - packedMs) / (wallMs - packedMs),
      caveat: 'Subtracts duplicate prediction time; assertion, cache and instrumentation effects remain. SimpleAi evaluation only; no baseline-evaluation or complete-training speed claim.'
    };
    fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
    console.log('PREDICTION PARITY: ' + (mismatchedValues === 0 ? 'PASS' : 'FAIL') + ' calls=' + calls.length);
    console.log('TENSOR LIFECYCLE: PASS');
    console.log('BALANCED COMPLETE INVENTORY: ' + JSON.stringify(result));
    console.log('FEASIBILITY TIMING: ' + JSON.stringify({ wallMs, originalMs, packedMs,
      estimatedEvaluationReduction: summary.estimatedEvaluationReduction }));
    console.log('UNIQUE INPUT SCREEN: ' + JSON.stringify({ mode, uniquePositions, mismatchedValues, firstMismatch }));
    assert.equal(mismatchedValues, 0, 'candidate predictions differ');
  } finally {
    model.dispose();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
