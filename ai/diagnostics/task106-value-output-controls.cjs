// Synthetic controls only; these are not gameplay or speed measurements.
const assert = require('node:assert/strict');
const tf = require('@tensorflow/tfjs-node');
const { valueOutputPredict } = require('./task106-value-output.cjs');
const { createRuntimeModelPredict } = require('../cloud-train-runner');
const { createAlphaZeroLiteCombatModel } = require('../alphazero-lite-combat');

const { model } = createAlphaZeroLiteCombatModel({ seed: 10629 });
const predictor = valueOutputPredict(model);
const original = createRuntimeModelPredict(model);
const grids = Array.from({ length: 65 }, (_, index) => [Array.from({ length: 3 }, (_, x) =>
  Array.from({ length: 3 }, (_, y) => Array.from({ length: 81 }, (_, c) =>
    ((index * 13 + x * 7 + y * 11 + c * 3) % 17 - 8) / 8)))]);
try {
  const live = tf.memory().numTensors;
  for (const count of [1, 31, 32, 33, 64, 65]) {
    assert.deepEqual(predictor(null, grids.slice(0, count)), original(null, grids.slice(0, count)));
    assert.equal(tf.memory().numTensors, live);
    console.log(`BATCH CONTROL: PASS positions=${count} exactValues stableTensors=${live}`);
  }
  const before = predictor(null, grids);
  const layer = model.getLayer('combat_value');
  const weights = layer.getWeights();
  const bias = tf.add(weights[1], 1);
  layer.setWeights([weights[0], bias]);
  bias.dispose();
  const after = predictor(null, grids);
  assert.notDeepEqual(after, before, 'stale/constant predictor');
  assert.deepEqual(after, original(null, grids));
  console.log('FRESH WEIGHT CONTROL: PASS changed weights change values; exact reference equality');
  assert.throws(() => valueOutputPredict({ getLayer() { throw new Error('missing output'); } }), /missing output/);
  console.log('MISSING OUTPUT CONTROL: PASS rejected');
  const broken = valueOutputPredict({
    getLayer: name => model.getLayer(name),
    execute() { throw new Error('injected execution failure'); }
  });
  assert.throws(() => broken(null, grids), /injected execution failure/);
  assert.equal(tf.memory().numTensors, live, 'exception leaked tensors');
  console.log('EXECUTION FAILURE CONTROL: PASS original error preserved; no tensor leak');
} finally {
  model.dispose();
  if (model.optimizer) model.optimizer.dispose();
}
assert.equal(tf.memory().numTensors, 0);
console.log('VALUE OUTPUT CONTROLS: PASS finalTensors=0');
