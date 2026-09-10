const assert = require('assert/strict');
const { Worker } = require('worker_threads');
const { once } = require('events');
const path = require('path');
const { collectRuntimeCombatTeacherGame } = require('../cloud-train-runner');
const { packRuntimeTeacherResult, unpackRuntimeTeacherResult } =
  require('../runtime-teacher-transfer');

async function verifyRuntimeTeacherTransfer() {
  const serial = collectRuntimeCombatTeacherGame(10600, 0, 1);
  const worker = new Worker(path.resolve(__dirname, '../cloud-train-runner.js'));
  try {
    const received = once(worker, 'message');
    worker.postMessage({ id: 1, type: 'runtime-teacher-game',
      job: { seed: 10600, stageIndex: 0, game: 1 } });
    const [message] = await received;
    assert.equal(message.id, 1);
    assert.equal(message.error, undefined);
    assert(message.result.packedExamples.values instanceof Float64Array);
    assert.deepEqual(unpackRuntimeTeacherResult(message.result), serial);
    console.log('Worker transferable transport passed: seed=' + serial.seed +
      ' examples=' + serial.examples.length +
      ' bytes=' + message.result.packedExamples.values.byteLength);
  } finally {
    await worker.terminate();
  }
  // Transport preserves every scalar, including values JSON comparisons hide.
  serial.examples[0].board[0] = -0;
  serial.examples[0].board[1] = Number.MIN_VALUE;
  serial.examples[0].demonstrationScore = NaN;
  serial.examples[0].globalValue = Infinity;
  const packed = packRuntimeTeacherResult(serial);
  const transferred = structuredClone(packed, { transfer: [packed.packedExamples.values.buffer] });
  assert.equal(packed.packedExamples.values.byteLength, 0);
  assert.deepEqual(unpackRuntimeTeacherResult(transferred), serial);
  assert.deepEqual(unpackRuntimeTeacherResult(packRuntimeTeacherResult({
    ...serial, examples: []
  })), { ...serial, examples: [] });
  console.log('Worker transport precision and ownership passed: full records, detached buffer, empty result');
}

module.exports = { verifyRuntimeTeacherTransfer };
