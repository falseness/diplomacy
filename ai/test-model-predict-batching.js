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

function loadModelApi(tensorApi = tf) {
  const context = vm.createContext({
    console,
    tf: tensorApi,
    CELL_VECTOR_SIZE: 3,
    gameSettings: {}
  });
  new vm.Script(fs.readFileSync(path.join(repoRoot, 'ai/model.js'), 'utf8'), {
    filename: 'ai/model.js'
  }).runInContext(context);
  return context;
}

function oldPredict(model, candidates, tensorApi = tf) {
  if (candidates.length === 0) {
    return [];
  }
  return tf.tidy(() => {
    const boards = [];
    for (let index = 0; index < candidates.length; ++index) {
      boards.push(tensorApi.tensor3d(candidates[index][0]));
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

const RANDOM_SEED = 103103;
const REPEATED_CALLS = 25;

function makeCandidates(batchSize) {
  let state = RANDOM_SEED + batchSize;
  function random() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000 - 0.5;
  }
  const result = [];
  for (let batch = 0; batch < batchSize; ++batch) {
    const board = [];
    for (let x = 0; x < 2; ++x) {
      board[x] = [];
      for (let y = 0; y < 3; ++y) {
        board[x][y] = [];
        for (let channel = 0; channel < 3; ++channel) {
          board[x][y][channel] =
            random();
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
  console.log(`EQUALITY: batch=${batchSize} seed=${RANDOM_SEED + batchSize} length=${actual.length} maxDiff=${maxDiff}`);
  check(maxDiff <= 1e-6,
    'batched predict changed output values', { batchSize, maxDiff });
}

const empty = api.predict(model, []);
check(Array.isArray(empty) && empty.length === 0,
  'empty predict input should return an empty array');
check(api.predict(model, makeCandidates(1)).length === 1,
  'single-candidate predict should return exactly one value row');

console.log('EDGES: PASS empty=0 singleton=1');

// tfjs exports getter-only properties: assigning tf.tensor3d silently did
// nothing in the old test. A facade observes calls from the real VM function.
const counts = { tensor3d: 0, tensor4d: 0, tensor2d: 0, predict: 0, readback: 0 };
const tensorApi = { ...tf };
for (const name of ['tensor3d', 'tensor4d', 'tensor2d']) {
  tensorApi[name] = (...args) => {
    counts[name] += 1;
    return tf[name](...args);
  };
}
const observedApi = loadModelApi(tensorApi);
const observedModel = {
  predict(inputs) {
    counts.predict += 1;
    const output = model.predict(inputs);
    const originalReadback = output.arraySync;
    output.arraySync = function(...args) {
      counts.readback += 1;
      return originalReadback.apply(this, args);
    };
    return output;
  }
};
try {
  // Negative control proves the facade detects the actual old allocation path.
  oldPredict(model, makeCandidates(48), tensorApi);
  check(counts.tensor3d === 48, 'allocation spy failed its old-path control', counts);
  console.log('NEGATIVE_CONTROL: PASS old path observed 48 tensor3d calls');
  for (const name of Object.keys(counts)) counts[name] = 0;
  const baseline = tf.memory().numTensors;
  const candidates = makeCandidates(48);
  for (let iteration = 0; iteration < REPEATED_CALLS; ++iteration) {
    observedApi.predict(observedModel, candidates);
  }
  check(counts.tensor3d === 0 && counts.tensor4d === REPEATED_CALLS &&
    counts.tensor2d === REPEATED_CALLS && counts.predict === REPEATED_CALLS &&
    counts.readback === REPEATED_CALLS, 'batched call counts changed', counts);
  check(tf.memory().numTensors === baseline,
    'predict() leaked tensors', { baseline, current: tf.memory().numTensors });
  console.log('ALLOCATION: PASS ' + JSON.stringify(counts));
  console.log(`TENSOR_LEAK: PASS calls=${REPEATED_CALLS} baseline=${baseline} current=${tf.memory().numTensors}`);
}
finally {
  model.dispose();
}

console.log('Model predict batching invariants passed');
