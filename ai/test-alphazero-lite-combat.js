const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const {
  ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
  createAlphaZeroLiteCombatModel,
  trainAlphaZeroLiteCombatBatch,
  saveAlphaZeroLiteCombatModel,
  loadAlphaZeroLiteCombatModel
} = require('./alphazero-lite-combat');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function syntheticBoard(sample, metadata) {
  const [height, width, channels] = metadata.vectorCompatibility.boardShape;
  const board = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      const cell = [];
      for (let channel = 0; channel < channels; channel += 1) {
        cell.push(((sample + 1) * (x + 2) + (y + 3) + channel) % 7 / 7);
      }
      row.push(cell);
    }
    board.push(row);
  }
  return board;
}

function replayRecords(metadata) {
  return [
    {
      type: 'combat-replay',
      board: syntheticBoard(0, metadata),
      global: [0],
      legalActionIndexes: [0, 3, 5],
      selectedActionIndex: 3,
      valueTarget: 1
    },
    {
      type: 'combat-replay',
      board: syntheticBoard(1, metadata),
      global: [1],
      legalActionIndexes: [2, 4, 7],
      policyTarget: new Array(metadata.actionSpace.size).fill(0).map((_, index) =>
        index === 2 ? 0.25 : (index === 7 ? 0.75 : 0)),
      valueTarget: -1
    }
  ];
}

async function createOldValueOnlyCheckpoint(directory) {
  const boardInput = tf.input({ shape: [3, 3, 21], name: 'board' });
  const globalInput = tf.input({ shape: [1], name: 'global_variables' });
  const flat = tf.layers.flatten().apply(boardInput);
  const merged = tf.layers.concatenate().apply([flat, globalInput]);
  const output = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    name: 'value_output'
  }).apply(merged);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  await model.save(`file://${directory}`);
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({
    modelVersion: 1,
    modelSignature: {
      outputs: [{ name: 'value_output', shape: [null, 1] }]
    }
  }, null, 2));
  model.dispose();
}

async function main() {
  const workDir = path.join('/mnt/storage/diplomacy', `task067-alphazero-lite-${process.pid}`);
  const checkpointDir = path.join(workDir, 'checkpoint');
  const oldCheckpointDir = path.join(workDir, 'old-value-only');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const { model, metadata } = createAlphaZeroLiteCombatModel({
      boardHeight: 3,
      boardWidth: 3,
      channels: 21,
      actionSpaceSize: 8,
      residualBlocks: 1,
      filters: 8,
      learningRate: 0.01
    });
    check(metadata.architectureVersion === ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
      'architecture metadata is missing the AlphaZero-lite combat version');
    check(metadata.combatOnly === true, 'metadata does not identify combat-only compatibility');
    check(model.outputs.length === 2, 'model does not expose separate policy and value heads');
    const outputNames = model.outputs.map((output) =>
      output.name.replace(/:\d+$/, '').split('/')[0]);
    check(outputNames.includes('combat_policy'), 'policy output head is missing');
    check(outputNames.includes('combat_value'), 'value output head is missing');

    const records = replayRecords(metadata);
    const history = await trainAlphaZeroLiteCombatBatch(model, records, metadata, {
      epochs: 2,
      batchSize: 2
    });
    check(history.history.combat_policy_loss.length === 2,
      'synthetic policy training did not run');
    check(history.history.combat_value_loss.length === 2,
      'synthetic value training did not run');

    const [policyPrediction, valuePrediction] = model.predict([
      tf.tensor4d([].concat(...records.map((record) =>
        record.board.flat(2))), [2, 3, 3, 21]),
      tf.tensor2d(records.map((record) => record.global), [2, 1])
    ]);
    check(policyPrediction.shape[1] === metadata.actionSpace.size,
      'policy prediction shape does not match legal action space');
    check(valuePrediction.shape[1] === 1,
      'value prediction shape is not a scalar signed result');
    policyPrediction.dispose();
    valuePrediction.dispose();

    await saveAlphaZeroLiteCombatModel(model, checkpointDir, metadata);
    model.dispose();
    const loaded = await loadAlphaZeroLiteCombatModel(checkpointDir);
    check(loaded.metadata.architectureVersion === ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
      'loaded metadata lost architecture version');
    check(loaded.model.outputs.length === 2, 'loaded model lost one of its heads');
    loaded.model.dispose();

    await createOldValueOnlyCheckpoint(oldCheckpointDir);
    let incompatibleFailed = false;
    try {
      await loadAlphaZeroLiteCombatModel(oldCheckpointDir);
    } catch (error) {
      incompatibleFailed = /incompatible AlphaZero-lite combat checkpoint/.test(error.message);
    }
    check(incompatibleFailed,
      'old value-only checkpoint did not fail with a clear incompatibility error');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log('AlphaZero-lite combat model smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
