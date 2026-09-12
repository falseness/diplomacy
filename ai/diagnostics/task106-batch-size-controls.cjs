// Adapter contract controls only. Synthetic outputs are never used by a game.
const assert = require('node:assert/strict');
const tf = require('@tensorflow/tfjs-node');
const { batchSizePredict } = require('./task106-batch-size.cjs');

const grids = Array.from({ length: 65 }, () => [Array.from({ length: 3 }, () =>
  Array.from({ length: 3 }, () => Array(81).fill(0)))]);
let value = 0.25;
let calls = 0;
const model = { predict(inputs, options) {
  assert.equal(options.batchSize, 64);
  assert.deepEqual(inputs[0].shape, [inputs[1].shape[0], 3, 3, 21]);
  calls += 1;
  // The real adapter must dispose both outputs, not silently prune policy.
  return [tf.zeros([inputs[0].shape[0], 5]), tf.fill([inputs[0].shape[0], 1], value)];
} };
const candidate = batchSizePredict(model);
for (const count of [1, 31, 32, 33, 64, 65]) {
  assert.deepEqual(candidate(null, grids.slice(0, count)), Array.from({ length: count }, () => [value]));
  assert.equal(tf.memory().numTensors, 0);
  console.log(`BATCH ADAPTER CONTROL: PASS positions=${count} batchSize=64 bothOutputsDisposed`);
}
value = 0.5;
assert.deepEqual(candidate(null, grids), Array.from({ length: 65 }, () => [value]));
assert.equal(calls, 7);
console.log('NO CACHE CONTROL: PASS next call consumes changed model output');
assert.throws(() => batchSizePredict(model, 16), /diagnostic batch size/);
assert.throws(() => batchSizePredict({ predict() { throw new Error('injected predict failure'); } })(null, grids),
  /injected predict failure/);
assert.equal(tf.memory().numTensors, 0);
console.log('ERROR CONTROL: PASS rejected configuration and preserved prediction failure; tensors=0');
console.log('BATCH SIZE CONTROLS: PASS synthetic adapter contracts only');
