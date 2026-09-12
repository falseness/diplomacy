// Synthetic cache contracts only; no synthetic outputs enter a game.
const assert = require('node:assert/strict');
const tf = require('@tensorflow/tfjs-node');
const { batchCache } = require('./task106-batch-cache.cjs');
let offset = 0;
let calls = 0;
const model = { predict(inputs, options) {
  assert.equal(options.batchSize, 32);
  assert(inputs[0].shape[0] <= 32);
  calls += 1;
  return [inputs[0].add(offset), inputs[1].add(offset)];
} };
function check(cache, count, shift = 0) {
  tf.tidy(() => {
    const x = tf.tensor2d(Array.from({ length: count }, (_, i) => i + shift), [count, 1]);
    const result = cache.predict([x, x]);
    for (const output of result) assert.deepEqual(Array.from(output.dataSync()),
      Array.from({ length: count }, (_, i) => i + shift + offset));
  });
  assert.equal(tf.memory().numTensors, 0);
}
const cache = batchCache(model);
for (const count of [1, 31, 32, 33, 64, 65]) {
  check(cache, count);
  const before = calls;
  check(cache, count);
  assert.equal(calls, before);
  console.log(`BATCH CACHE CONTROL: PASS count=${count} exactBothOutputs warmHit tensors=0`);
}
check(cache, 65, 0.5);
const before = calls;
cache.clear();
offset = 5;
check(cache, 65);
assert(calls > before);
assert(cache.stats.peakBytes <= 16 * 1024 * 1024);
cache.close();
assert.equal(cache.stats.bytes, 0);
assert.throws(() => cache.predict([]), /closed/);
console.log('CACHE LIFETIME CONTROL: PASS changedInputs resetWeights closedReject bytes=0');
const bounded = batchCache(model, 2500);
for (let i = 0; i < 10; i++) check(bounded, 32, i);
assert(bounded.stats.evictions > 0);
assert(bounded.stats.peakBytes <= 2500);
bounded.close();
const disabled = batchCache(model, 0);
check(disabled, 65);
check(disabled, 65);
assert.equal(disabled.stats.hits, 0);
assert.equal(disabled.stats.bytes, 0);
disabled.close();
console.log('CACHE BOUND CONTROL: PASS eviction oversizeDisabled accountedBytesWithinLimit');
const failed = batchCache({ predict() { throw new Error('injected prediction failure'); } });
assert.throws(() => check(failed, 1), /injected prediction failure/);
assert.equal(tf.memory().numTensors, 0);
failed.close();
console.log('CACHE ERROR CONTROL: PASS originalErrorPreserved tensors=0 bytes=0');
console.log('BATCH CACHE CONTROLS: PASS');
