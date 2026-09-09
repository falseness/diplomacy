const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs');

const repoRoot = path.resolve(__dirname, '..');

function loadModelApi() {
  const context = vm.createContext({
    console,
    tf,
    CELL_VECTOR_SIZE: 8,
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

function createModel() {
  const board = tf.input({ shape: [8, 8, 8] });
  const globals = tf.input({ shape: [1] });
  const flat = tf.layers.flatten().apply(board);
  const boardValue = tf.layers.dense({
    units: 1,
    useBias: false,
    kernelInitializer: 'ones'
  }).apply(flat);
  const output = tf.layers.add().apply([boardValue, globals]);
  return tf.model({ inputs: [board, globals], outputs: output });
}

function makeCandidates(batchSize) {
  const result = [];
  for (let batch = 0; batch < batchSize; ++batch) {
    const board = [];
    for (let x = 0; x < 8; ++x) {
      board[x] = [];
      for (let y = 0; y < 8; ++y) {
        board[x][y] = [];
        for (let channel = 0; channel < 8; ++channel) {
          board[x][y][channel] =
            ((batch + 3) * 11 + x * 7 + y * 5 + channel) / 10000;
        }
      }
    }
    result.push([board, batch / 100]);
  }
  return result;
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function seconds(start) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1e9;
}

function timePredict(label, fn, model, candidates, calls, repeats) {
  const timings = [];
  for (let repeat = 0; repeat < repeats; ++repeat) {
    const start = process.hrtime.bigint();
    for (let call = 0; call < calls; ++call) {
      fn(model, candidates);
    }
    timings.push(seconds(start));
  }
  return {
    label,
    calls,
    repeats,
    batchSize: candidates.length,
    timings,
    median: median(timings)
  };
}

const calls = Number(process.argv[2] || 1000);
const batchSize = Number(process.argv[3] || 48);
const repeats = Number(process.argv[4] || 3);
for (const [name, value] of Object.entries({ calls, batchSize, repeats })) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
const candidates = makeCandidates(batchSize);
const api = loadModelApi();
const model = createModel();

try {
  api.predict(model, candidates);
  oldPredict(model, candidates);
  const before = timePredict('old-per-candidate-tensor3d', oldPredict, model, candidates, calls, repeats);
  const after = timePredict('batched-tensor4d', api.predict, model, candidates, calls, repeats);
  const reduction = ((before.median - after.median) / before.median) * 100;
  const report = {
    command: `node ai/benchmark-model-predict-batching.js ${calls} ${batchSize} ${repeats}`,
    node: process.version,
    platform: process.platform,
    before,
    after,
    reduction
  };
  console.log(JSON.stringify(report, null, 2));
  // Compare durations directly to avoid subtraction rounding at exactly 10%.
  const passed = Number.isFinite(reduction) && before.median > 0 &&
    after.median <= before.median * 0.9;
  console.log(`SPEED_GATE: ${passed ? 'PASS' : 'FAIL'} required >=10 percent`);
  if (!passed) {
    process.exitCode = 1;
  }
}
finally {
  model.dispose();
}
