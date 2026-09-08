// Exercise production tensor packing against the previous nested-array operation.
const assert = require('assert');
const tf = require('@tensorflow/tfjs-node');
const {loadCheckpoint, createPredictor} = require('../benchmark-gamestart-trained-model');

async function main() {
  const checkpoint = await loadCheckpoint(process.argv[2]);
  const model = checkpoint.model;
  const [, width, height, channels] = model.inputs[0].shape;
  const shapes = [[width, height, channels], [width + 1, height + 2, channels + 3],
    [Math.max(1, width - 1), Math.max(1, height - 1), Math.max(1, channels - 2)]];
  const vectors = shapes.map(([w, h, c], index) => [Array.from({length: w}, (_, x) =>
    Array.from({length: h}, (_, y) => Array.from({length: c}, (_, channel) =>
      Math.sin(x + y * w + channel) * (index + 1)))), index / 3]);
  const original = JSON.stringify(vectors);
  const adapted = vectors.map(([board]) => Array.from({length: width}, (_, x) =>
    Array.from({length: height}, (_, y) => {
      const source = board[Math.min(board.length - 1, Math.floor(x * board.length / width))]
        [Math.min(board[0].length - 1, Math.floor(y * board[0].length / height))];
      const cell = source.slice(0, channels);
      while (cell.length < channels) cell.push(0);
      return cell;
    })));
  const expectedBoard = tf.tensor4d(adapted.flat(3), [vectors.length, width, height, channels]);
  const expectedGlobal = tf.tensor2d(vectors.map(vector => [Number(vector[1]) || 0]));
  const expectedOutput = model.predict([expectedBoard, expectedGlobal]);
  const originalPredict = model.predict;
  let calls = 0;
  model.predict = function(inputs) {
    calls += 1;
    assert.deepStrictEqual(inputs[0].dataSync(), expectedBoard.dataSync());
    assert.deepStrictEqual(inputs[1].dataSync(), expectedGlobal.dataSync());
    return originalPredict.call(this, inputs);
  };
  const stats = {calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0};
  try {
    const scores = createPredictor(model, stats)(model, vectors);
    assert.deepStrictEqual(scores.map(score => score[0]), Array.from(expectedOutput.dataSync()));
    assert.strictEqual(JSON.stringify(vectors), original);
    assert.strictEqual(calls, 1);
    assert.strictEqual(stats.positions, shapes.length);
    assert.strictEqual(stats.resizedInputs, shapes.length - 1);
    assert.strictEqual(stats.channelAdaptations, shapes.length - 1);
    console.log('TENSOR_PACKING: PASS exact tensor bytes and real checkpoint scores; resize, truncate, pad, batch order and immutable inputs');
  } finally {
    model.predict = originalPredict;
    expectedBoard.dispose(); expectedGlobal.dispose(); expectedOutput.dispose(); model.dispose();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
