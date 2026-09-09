// Bounded fit/save/reload integration; no learned-strength or win-rate claim.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const { createTrainingBatch, createModel, saveCheckpoint, parseArgs } = require('../economy-training');
const { loadCheckpoint, createPredictor } = require('../benchmark-trained-model');

// Optional stage argument extends the original stage-1 invocation unchanged.
const STAGE = Number(process.argv[3] || 1);
const STAGE_SHAPES = [[7, 5], [9, 7], [11, 9], [11, 9], [11, 9], [11, 9], [9, 9], [9, 9]];
assert(Number.isInteger(STAGE) && STAGE >= 1 && STAGE <= STAGE_SHAPES.length);
const MAP_SOURCE = `stage-${STAGE}-native`;
const TRAINING_SEED = 103700 + STAGE;
const STRUCTURAL_BASE = 11800 + (STAGE - 1) * 200;
// A conservative superset of every structural seed used by each existing smoke.
const STRUCTURAL_SEEDS = Array.from({ length: 20 }, (_, index) => STRUCTURAL_BASE + index);
const GAMEPLAY_SEED = STRUCTURAL_BASE + 42;
const BOARD_SHAPE = [...STAGE_SHAPES[STAGE - 1], 82]; // x, y, channel.
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function weightHash(model) {
  return tf.tidy(() => {
    const hash = crypto.createHash('sha256');
    for (const weight of model.getWeights()) {
      hash.update(Buffer.from(weight.dataSync().buffer));
    }
    return hash.digest('hex');
  });
}
function predictBatch(model, boards, globals) {
  return tf.tidy(() => Array.from(model.predict([boards, globals]).dataSync()));
}

async function main() {
  const output = path.resolve(process.argv[2]);
  // Refuse to overwrite any prior fit or select a checkpoint after evaluation.
  fs.mkdirSync(output);
  const plan = {
    mapSource: MAP_SOURCE, trainingSeeds: [TRAINING_SEED], validationSeeds: [],
    structuralSeeds: STRUCTURAL_SEEDS, gameplaySeeds: [GAMEPLAY_SEED],
    intersections: [], epochs: 1, selection: 'only checkpoint after one fixed batch and one epoch',
    claim: 'shape and training integration only; no learned-strength claim',
    targets: 'existing runtime collector: legal post-action vector tactical score / 240000 + player material score * 0.25, min-max normalized within each decision; heuristic teacher, not terminal outcomes',
    axisOrder: ['batch', 'x', 'y', 'channel'], inputShapes: [[null, ...BOARD_SHAPE], [null, 1]]
  };
  assert(![...STRUCTURAL_SEEDS, GAMEPLAY_SEED].includes(TRAINING_SEED));
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2));
  console.log('FROZEN_PLAN: ' + JSON.stringify(plan));
  assert.equal(parseArgs([]).mapSource, 'town');
  assert.equal(parseArgs(['--map-source', MAP_SOURCE]).mapSource, MAP_SOURCE);
  const defaultModel = createModel(9, 9);
  assert.deepStrictEqual(defaultModel.inputs.map(input => input.shape), [[null, 9, 9, 82], [null, 1]]);
  defaultModel.dispose();
  console.log('DEFAULT_SHAPE: PASS 9x9x82');
  const batch = createTrainingBatch(TRAINING_SEED, [2], MAP_SOURCE);
  assert(batch.boards.length > 0);
  assert.equal(batch.map.provenance.generator, `generateEconomyStage${STAGE}TrainingMap`);
  assert.deepStrictEqual(batch.players, ['AIPlayerWithEconomy', 'SimpleAiPlayerWithEconomy']);
  for (const board of batch.boards) {
    assert.equal(board.length, BOARD_SHAPE[0]);
    for (const column of board) {
      assert.equal(column.length, BOARD_SHAPE[1]);
      for (const cell of column) assert.equal(cell.length, BOARD_SHAPE[2]);
    }
  }
  assert(batch.labels.every(Number.isFinite));
  const data = JSON.stringify(batch);
  fs.writeFileSync(path.join(output, 'batch.json'), data);
  console.log('REAL_BATCH: ' + JSON.stringify({ examples: batch.labels.length, map: batch.map, players: batch.players, actions: batch.actionCounts, sha256: sha(data) }));
  const model = createModel(...BOARD_SHAPE.slice(0, 2));
  const boards = tf.tensor4d(batch.boards.flat(3), [batch.boards.length, ...BOARD_SHAPE]);
  const globals = tf.tensor2d(batch.globals, [batch.globals.length, 1]);
  const labels = tf.tensor2d(batch.labels, [batch.labels.length, 1]);
  const beforeHash = weightHash(model);
  const beforePredictions = predictBatch(model, boards, globals);
  const history = await model.fit([boards, globals], labels, { epochs: plan.epochs, batchSize: 32, shuffle: false, verbose: 0 });
  const loss = history.history.loss[0];
  assert(Number.isFinite(loss));
  const afterHash = weightHash(model);
  assert.notEqual(beforeHash, afterHash);
  const predictions = predictBatch(model, boards, globals);
  assert(predictions.every(Number.isFinite));
  const trainingEffect = Math.max(...predictions.map((value, i) => Math.abs(value - beforePredictions[i])));
  assert(trainingEffect > 0);
  const checkpointPath = path.join(output, 'checkpoint');
  await saveCheckpoint(model, checkpointPath, { ...plan, loss, beforeHash, afterHash, dataSha256: sha(data), labelScale: 1, featureFusionWeight: 0 });
  const checkpoint = await loadCheckpoint(checkpointPath);
  assert.deepStrictEqual(checkpoint.report.signature.inputs, plan.inputShapes);
  assert.equal(weightHash(checkpoint.model), afterHash);
  const reloaded = predictBatch(checkpoint.model, boards, globals);
  assert.deepStrictEqual(reloaded, predictions);
  const predictor = createPredictor(checkpoint.model, checkpoint.inference);
  const hookPrediction = predictor(checkpoint.model, [[batch.boards[0], batch.globals[0]]]);
  assert(Math.abs(hookPrediction[0] - predictions[0]) < 1e-5);
  const zeroWeights = model.getWeights().map(weight => tf.zerosLike(weight));
  model.setWeights(zeroWeights);
  zeroWeights.forEach(weight => weight.dispose());
  const zeroPredictions = predictBatch(model, boards, globals);
  const zeroEffect = Math.max(...predictions.map((value, i) => Math.abs(value - zeroPredictions[i])));
  assert(zeroEffect > 0);
  const report = { loss, beforeHash, afterHash, trainingEffect, zeroEffect, reloadedSignature: checkpoint.report.signature, checkpointPath, inference: checkpoint.inference, claim: plan.claim };
  fs.writeFileSync(path.join(output, 'fit-report.json'), JSON.stringify(report, null, 2));
  console.log('FIT_SAVE_RELOAD: PASS ' + JSON.stringify(report));
  console.log('MODEL_CONTROLS: PASS untrained and zeroed predictions differ; direct checkpoint output, no heuristic fusion; no gameplay strength conclusion');
  checkpoint.model.dispose();
  model.dispose();
  boards.dispose(); globals.dispose(); labels.dispose();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
