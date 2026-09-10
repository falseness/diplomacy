const assert = require('assert/strict');

const SCALAR_FIELDS = ['globalValue', 'choiceSet', 'demonstrationScore', 'label'];

// Keep all candidate records and double precision. A single transferable buffer
// avoids structured-cloning thousands of nested board and policy arrays.
function packRuntimeTeacherResult(result) {
  const { examples, ...metadata } = result;
  const boardSize = examples.length ? examples[0].board.length : 0;
  const policySize = examples.length ? examples[0].policy.length : 0;
  const stride = boardSize + policySize + SCALAR_FIELDS.length;
  const values = new Float64Array(examples.length * stride);
  let offset = 0;
  for (const example of examples) {
    assert.equal(example.board.length, boardSize);
    assert.equal(example.policy.length, policySize);
    values.set(example.board, offset);
    offset += boardSize;
    for (const field of SCALAR_FIELDS) values[offset++] = example[field];
    values.set(example.policy, offset);
    offset += policySize;
  }
  return { ...metadata, packedExamples: {
    count: examples.length, boardSize, policySize, values
  } };
}

function unpackRuntimeTeacherResult(result) {
  const { packedExamples, ...metadata } = result;
  const { count, boardSize, policySize, values } = packedExamples;
  assert.equal(values.length, count * (boardSize + policySize + SCALAR_FIELDS.length));
  const examples = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const example = { board: Array.from(values.subarray(offset, offset + boardSize)) };
    offset += boardSize;
    for (const field of SCALAR_FIELDS) example[field] = values[offset++];
    example.policy = Array.from(values.subarray(offset, offset + policySize));
    offset += policySize;
    examples.push(example);
  }
  return { ...metadata, examples };
}

module.exports = { packRuntimeTeacherResult, unpackRuntimeTeacherResult };
