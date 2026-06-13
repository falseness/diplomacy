const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs');

const repoRoot = path.resolve(__dirname, '..');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function loadModelApi() {
  const context = vm.createContext({
    console,
    tf,
    CELL_VECTOR_SIZE: 3,
    gameSettings: {}
  });
  new vm.Script(fs.readFileSync(path.join(repoRoot, 'ai/model.js'), 'utf8'), {
    filename: 'ai/model.js'
  }).runInContext(context);
  return context;
}

function oldPredict(model, candidates) {
  if (candidates.length === 0) {
    return [];
  }
  return tf.tidy(() => {
    const boards = [];
    for (let index = 0; index < candidates.length; ++index) {
      boards.push(tf.tensor3d(candidates[index][0]));
    }
    const globals = [];
    for (let index = 0; index < candidates.length; ++index) {
      globals.push(candidates[index][1]);
    }
    const boardTensor = tf.stack(boards);
    const globalTensor = tf.stack(globals);
    const prediction = model.predict([boardTensor, globalTensor]);
    return prediction.arraySync();
  });
}

function createSumModel() {
  const board = tf.input({ shape: [2, 3, 3] });
  const globals = tf.input({ shape: [1] });
  const boardSum = tf.layers.flatten().apply(board);
  const boardValue = tf.layers.dense({
    units: 1,
    useBias: false,
    kernelInitializer: 'ones'
  }).apply(boardSum);
  const output = tf.layers.add().apply([boardValue, globals]);
  return tf.model({ inputs: [board, globals], outputs: output });
}

function makeCandidates(batchSize) {
  const result = [];
  for (let batch = 0; batch < batchSize; ++batch) {
    const board = [];
    for (let x = 0; x < 2; ++x) {
      board[x] = [];
      for (let y = 0; y < 3; ++y) {
        board[x][y] = [];
        for (let channel = 0; channel < 3; ++channel) {
          board[x][y][channel] =
            ((batch + 1) * 17 + x * 5 + y * 3 + channel) / 1000;
        }
      }
    }
    result.push([board, (batch + 1) / 10]);
  }
  return result;
}

function flatten(values) {
  const result = [];
  for (const row of values) {
    if (Array.isArray(row)) {
      for (const value of flatten(row)) {
        result.push(value);
      }
    }
    else {
      result.push(row);
    }
  }
  return result;
}

const api = loadModelApi();
const source = fs.readFileSync(path.join(repoRoot, 'ai/model.js'), 'utf8');
const predictBody = source.slice(
  source.indexOf('function predict(model, xValidateArr)'),
  source.indexOf('\n\nfunction trainModelByHumanData')
);
check(!/tf\.tensor3d\s*\(/.test(predictBody),
  'predict() should not allocate per-candidate tensor3d values');
check(/tf\.tensor4d\s*\(/.test(predictBody),
  'predict() should build one batched board tensor4d');
check(/tf\.tensor2d\s*\(/.test(predictBody),
  'predict() should build one batched global tensor2d');

const model = createSumModel();
for (const batchSize of [1, 2, 48, 200]) {
  const candidates = makeCandidates(batchSize);
  const expected = flatten(oldPredict(model, candidates));
  const actual = flatten(api.predict(model, candidates));
  check(actual.length === expected.length,
    'prediction length changed', { batchSize, expected: expected.length, actual: actual.length });
  let maxDiff = 0;
  for (let index = 0; index < expected.length; ++index) {
    maxDiff = Math.max(maxDiff, Math.abs(expected[index] - actual[index]));
  }
  check(maxDiff <= 1e-6,
    'batched predict changed output values', { batchSize, maxDiff });
}

const empty = api.predict(model, []);
check(Array.isArray(empty) && empty.length === 0,
  'empty predict input should return an empty array');
check(api.predict(model, makeCandidates(1)).length === 1,
  'single-candidate predict should return exactly one value row');

let tensor3dCalls = 0;
const originalTensor3d = tf.tensor3d;
tf.tensor3d = function spyTensor3d(...args) {
  tensor3dCalls += 1;
  return originalTensor3d.apply(this, args);
};
try {
  const baseline = tf.memory().numTensors;
  for (let iteration = 0; iteration < 25; ++iteration) {
    api.predict(model, makeCandidates(48));
  }
  check(tensor3dCalls === 0,
    'predict() allocated tensor3d values after batching', { tensor3dCalls });
  check(tf.memory().numTensors === baseline,
    'predict() leaked tensors', { baseline, current: tf.memory().numTensors });
}
finally {
  tf.tensor3d = originalTensor3d;
  model.dispose();
}

console.log('Model predict batching invariants passed');
