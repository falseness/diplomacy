const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs');

const filename = path.resolve(__dirname, '../benchmark-model-predict-batching.js');
const source = fs.readFileSync(filename, 'utf8');

function run(args, afterDuration = 100n) {
  // Synthetic clock values test gate decisions only, never performance claims.
  const ticks = [0n, 100n, 100n, 100n + afterDuration];
  const output = [];
  const processStub = {
    argv: ['node', filename, ...args],
    hrtime: { bigint: () => ticks.shift() },
    version: process.version,
    platform: process.platform
  };
  const baseline = tf.memory().numTensors;
  try {
    vm.runInNewContext(source, {
      require, __dirname: path.dirname(filename), process: processStub,
      console: { log: value => output.push(value) }
    }, { filename });
    return { exitCode: processStub.exitCode || 0, output: output.join('\n') };
  }
  finally {
    assert.strictEqual(tf.memory().numTensors, baseline, 'benchmark leaked tensors');
  }
}

for (const duration of [100n, 91n, 90n, 80n]) {
  const result = run(['1', '2', '1'], duration);
  const passed = duration <= 90n;
  assert.strictEqual(result.exitCode, passed ? 0 : 1);
  assert.match(result.output, new RegExp(`SPEED_GATE: ${passed ? 'PASS' : 'FAIL'}`));
  console.log(`GATE_CONTROL: PASS synthetic_after=${duration} expected=${passed ? 'PASS' : 'FAIL'}`);
}
for (const [index, name] of ['calls', 'batchSize', 'repeats'].entries()) {
  for (const invalid of ['0', '-1', '1.5', 'NaN', 'Infinity']) {
    const args = ['1', '2', '1'];
    args[index] = invalid;
    assert.throws(() => run(args), new RegExp(`${name} must be a positive safe integer`));
  }
  console.log(`WORKLOAD_CONTROL: PASS ${name} rejected=5`);
}
console.log('Benchmark gate controls passed (synthetic clock; not speed evidence)');
