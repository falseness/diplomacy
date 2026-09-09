const assert = require('assert');
const tf = require('@tensorflow/tfjs-node');
const { createPredictor } = require('../benchmark-gamestart-all-slots');

// Deterministic untrained models test tensor plumbing, never playing strength.
for (const channels of [78, 82]) {
  const boardInput = tf.input({ shape: [2, 3, channels] });
  const globalInput = tf.input({ shape: [1] });
  const features = tf.layers.concatenate().apply([
    tf.layers.flatten().apply(boardInput), globalInput
  ]);
  const output = tf.layers.dense({ units: 1,
    kernelInitializer: tf.initializers.randomNormal({ seed: 103900 }),
    biasInitializer: 'zeros' }).apply(features);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  const stats = { calls: 0, positions: 0 };
  const predict = createPredictor(model, stats);
  const vectors = [1, 2].map(candidate => [
    Array.from({ length: 2 }, (_, x) => Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: channels }, (_, c) => candidate + x / 2 + y / 3 + c / channels))),
    candidate / 4
  ]);
  const expected = tf.tidy(() => Array.from(model.predict([
    tf.tensor4d(vectors.map(v => v[0]), [2, 2, 3, channels]),
    tf.tensor2d(vectors.map(v => [v[1]]), [2, 1])
  ]).dataSync()));
  const baseline = tf.memory().numTensors;
  for (let index = 0; index < 25; index++) {
    assert.deepStrictEqual(predict(model, vectors).flat(), expected);
    assert.strictEqual(tf.memory().numTensors, baseline);
  }
  assert.deepStrictEqual(predict(model, []), []);
  const singletonExpected = tf.tidy(() => Array.from(model.predict([
    tf.tensor4d([vectors[0][0]], [1, 2, 3, channels]),
    tf.tensor2d([[vectors[0][1]]], [1, 1])
  ]).dataSync()));
  assert.deepStrictEqual(predict(model, [vectors[0]]).flat(), singletonExpected);
  for (const kind of ['width', 'height', 'channels', 'ragged']) {
    const invalid = JSON.parse(JSON.stringify(vectors));
    if (kind === 'width') invalid[0][0].pop();
    if (kind === 'height') invalid[0][0][0].pop();
    if (kind === 'channels') invalid[0][0][0][0].pop();
    if (kind === 'ragged') invalid[0][0][1][2].pop();
    const calls = stats.calls;
    assert.throws(() => predict(model, invalid), /native checkpoint input/);
    assert.strictEqual(stats.calls, calls);
    assert.strictEqual(tf.memory().numTensors, baseline);
    console.log(`NATIVE_REJECTION: PASS channels=${channels} mismatch=${kind} tensorBaseline=restored inference=0`);
  }
  // A real layer failure after input allocation must also release its tensors.
  const dense = model.layers[model.layers.length - 1];
  dense.dispose();
  const failedBaseline = tf.memory().numTensors;
  assert.throws(() => predict(model, vectors), /disposed/);
  assert.strictEqual(tf.memory().numTensors, failedBaseline);
  console.log(`NATIVE_PREDICTOR: PASS channels=${channels} orderedEquality=exact repeated=25 empty=0 singleton=1 failureCleanup=pass`);
  // Dispose remaining layers individually because the dense layer is disposed.
  for (const layer of model.layers) if (layer !== dense) layer.dispose();
}
console.log('Game-start native checkpoint predictor invariants passed');
