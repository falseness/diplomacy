const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');

const ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION = 'alphazero-lite-combat-v1';
const DEFAULT_BOARD_HEIGHT = 3;
const DEFAULT_BOARD_WIDTH = 3;
const DEFAULT_COMBAT_CHANNELS = 21;
const DEFAULT_GLOBAL_FEATURES = 1;
const DEFAULT_ACTION_SPACE_SIZE = 128;

function createMetadata(options = {}) {
  const boardHeight = options.boardHeight || DEFAULT_BOARD_HEIGHT;
  const boardWidth = options.boardWidth || DEFAULT_BOARD_WIDTH;
  const channels = options.channels || DEFAULT_COMBAT_CHANNELS;
  const globalFeatures = options.globalFeatures || DEFAULT_GLOBAL_FEATURES;
  const actionSpaceSize = options.actionSpaceSize || DEFAULT_ACTION_SPACE_SIZE;
  return {
    architectureVersion: ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
    combatOnly: true,
    vectorCompatibility: {
      kind: 'combat-only',
      boardShape: [boardHeight, boardWidth, channels],
      globalShape: [globalFeatures],
      economyFeatures: false
    },
    actionSpace: {
      kind: 'legal-combat-action-index',
      size: actionSpaceSize,
      maskRequired: true
    },
    outputs: {
      policy: 'combat_policy',
      value: 'combat_value'
    }
  };
}

function residualBlock(input, filters, name) {
  const conv1 = tf.layers.conv2d({
    filters,
    kernelSize: 3,
    padding: 'same',
    useBias: false,
    name: `${name}_conv1`
  }).apply(input);
  const bn1 = tf.layers.batchNormalization({ name: `${name}_bn1` }).apply(conv1);
  const relu1 = tf.layers.activation({
    activation: 'relu',
    name: `${name}_relu1`
  }).apply(bn1);
  const conv2 = tf.layers.conv2d({
    filters,
    kernelSize: 3,
    padding: 'same',
    useBias: false,
    name: `${name}_conv2`
  }).apply(relu1);
  const bn2 = tf.layers.batchNormalization({ name: `${name}_bn2` }).apply(conv2);
  return tf.layers.activation({
    activation: 'relu',
    name: `${name}_out`
  }).apply(tf.layers.add({ name: `${name}_add` }).apply([input, bn2]));
}

function createAlphaZeroLiteCombatModel(options = {}) {
  const metadata = createMetadata(options);
  const boardShape = metadata.vectorCompatibility.boardShape;
  const globalShape = metadata.vectorCompatibility.globalShape;
  const actionSpaceSize = metadata.actionSpace.size;
  const filters = options.filters || 32;
  const residualBlocks = options.residualBlocks || 2;
  const learningRate = options.learningRate || 0.001;

  const boardInput = tf.input({ shape: boardShape, name: 'board' });
  const globalInput = tf.input({ shape: globalShape, name: 'global_variables' });

  let trunk = tf.layers.conv2d({
    filters,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu',
    name: 'combat_trunk'
  }).apply(boardInput);
  for (let i = 0; i < residualBlocks; i += 1) {
    trunk = residualBlock(trunk, filters, `combat_residual_${i + 1}`);
  }

  const policyConv = tf.layers.conv2d({
    filters: 2,
    kernelSize: 1,
    padding: 'same',
    activation: 'relu',
    name: 'policy_conv'
  }).apply(trunk);
  const policyFlat = tf.layers.flatten({ name: 'policy_flatten' }).apply(policyConv);
  const policyHidden = tf.layers.dense({
    units: Math.max(32, Math.min(256, actionSpaceSize)),
    activation: 'relu',
    name: 'policy_hidden'
  }).apply(policyFlat);
  const policyOutput = tf.layers.dense({
    units: actionSpaceSize,
    activation: 'softmax',
    name: metadata.outputs.policy
  }).apply(policyHidden);

  const valueConv = tf.layers.conv2d({
    filters: 1,
    kernelSize: 1,
    padding: 'same',
    activation: 'relu',
    name: 'value_conv'
  }).apply(trunk);
  const valuePool = tf.layers.globalAveragePooling2d({
    name: 'value_pool'
  }).apply(valueConv);
  const valueMerged = tf.layers.concatenate({
    name: 'value_context'
  }).apply([valuePool, globalInput]);
  const valueHidden = tf.layers.dense({
    units: 32,
    activation: 'relu',
    name: 'value_hidden'
  }).apply(valueMerged);
  const valueOutput = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    name: metadata.outputs.value
  }).apply(valueHidden);

  const model = tf.model({
    inputs: [boardInput, globalInput],
    outputs: [policyOutput, valueOutput],
    name: ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION
  });
  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: {
      [metadata.outputs.policy]: 'categoricalCrossentropy',
      [metadata.outputs.value]: 'meanSquaredError'
    },
    lossWeights: {
      [metadata.outputs.policy]: 1,
      [metadata.outputs.value]: 0.5
    }
  });
  model.alphaZeroLiteCombatMetadata = metadata;
  return { model, metadata };
}

function assertValidLegalActions(legalActionIndexes, actionSpaceSize) {
  if (!Array.isArray(legalActionIndexes) || legalActionIndexes.length === 0) {
    throw new Error('AlphaZero-lite combat policy target requires at least one legal combat action');
  }
  for (const actionIndex of legalActionIndexes) {
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= actionSpaceSize) {
      throw new Error(`illegal combat action index ${actionIndex} for action space ${actionSpaceSize}`);
    }
  }
}

function createPolicyTarget(legalActionIndexes, selectedActionIndex, actionSpaceSize) {
  assertValidLegalActions(legalActionIndexes, actionSpaceSize);
  if (!legalActionIndexes.includes(selectedActionIndex)) {
    throw new Error('selected combat action must be present in the legal action set');
  }
  const target = new Array(actionSpaceSize).fill(0);
  target[selectedActionIndex] = 1;
  return target;
}

function normalizePolicyTarget(policyTarget, legalActionIndexes, actionSpaceSize) {
  assertValidLegalActions(legalActionIndexes, actionSpaceSize);
  if (!Array.isArray(policyTarget) || policyTarget.length !== actionSpaceSize) {
    throw new Error(`policy target must have ${actionSpaceSize} entries`);
  }
  const legal = new Set(legalActionIndexes);
  let total = 0;
  const normalized = policyTarget.map((value, index) => {
    const maskedValue = legal.has(index) ? Number(value) : 0;
    if (!Number.isFinite(maskedValue) || maskedValue < 0) {
      throw new Error('policy target values must be finite non-negative numbers');
    }
    total += maskedValue;
    return maskedValue;
  });
  if (total <= 0) {
    throw new Error('policy target must assign positive probability to at least one legal action');
  }
  return normalized.map((value) => value / total);
}

function prepareAlphaZeroLiteCombatBatch(records, metadata) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('AlphaZero-lite combat training requires at least one replay record');
  }
  const boardShape = metadata.vectorCompatibility.boardShape;
  const globalShape = metadata.vectorCompatibility.globalShape;
  const actionSpaceSize = metadata.actionSpace.size;
  const boardValues = [];
  const globalValues = [];
  const policyTargets = [];
  const valueTargets = [];

  for (const record of records) {
    if (!record || record.type !== 'combat-replay') {
      throw new Error('AlphaZero-lite combat training accepts only combat-replay records');
    }
    if (record.board.length !== boardShape[0] ||
        record.board[0].length !== boardShape[1] ||
        record.board[0][0].length !== boardShape[2]) {
      throw new Error('combat replay board shape does not match model metadata');
    }
    if (!Array.isArray(record.global) || record.global.length !== globalShape[0]) {
      throw new Error('combat replay global feature shape does not match model metadata');
    }
    const value = Number(record.valueTarget);
    if (!Number.isFinite(value) || value < -1 || value > 1) {
      throw new Error('combat value target must be a signed result in [-1, 1]');
    }
    const policyTarget = record.policyTarget
      ? normalizePolicyTarget(record.policyTarget, record.legalActionIndexes, actionSpaceSize)
      : createPolicyTarget(record.legalActionIndexes, record.selectedActionIndex, actionSpaceSize);
    for (const row of record.board) {
      for (const cell of row) {
        for (const channel of cell) {
          boardValues.push(channel);
        }
      }
    }
    for (const globalValue of record.global) {
      globalValues.push(globalValue);
    }
    policyTargets.push(policyTarget);
    valueTargets.push([value]);
  }

  return {
    inputs: [
      tf.tensor4d(boardValues, [records.length].concat(boardShape)),
      tf.tensor2d(globalValues, [records.length].concat(globalShape))
    ],
    targets: {
      [metadata.outputs.policy]: tf.tensor2d(policyTargets, [records.length, actionSpaceSize]),
      [metadata.outputs.value]: tf.tensor2d(valueTargets, [records.length, 1])
    }
  };
}

async function trainAlphaZeroLiteCombatBatch(model, records, metadata, options = {}) {
  const batch = prepareAlphaZeroLiteCombatBatch(records, metadata);
  try {
    return await model.fit(batch.inputs, batch.targets, {
      epochs: options.epochs || 1,
      batchSize: options.batchSize || records.length,
      shuffle: false,
      verbose: options.verbose || 0
    });
  } finally {
    for (const tensor of batch.inputs) {
      tensor.dispose();
    }
    Object.values(batch.targets).forEach((tensor) => tensor.dispose());
  }
}

function validateMetadata(metadata) {
  if (!metadata || metadata.architectureVersion !== ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION) {
    throw new Error('incompatible AlphaZero-lite combat checkpoint: expected architecture ' +
      `${ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION}`);
  }
  if (!metadata.combatOnly ||
      !metadata.vectorCompatibility ||
      metadata.vectorCompatibility.kind !== 'combat-only') {
    throw new Error('incompatible AlphaZero-lite combat checkpoint: missing combat-only vector metadata');
  }
  if (!metadata.outputs ||
      metadata.outputs.policy !== 'combat_policy' ||
      metadata.outputs.value !== 'combat_value') {
    throw new Error('incompatible AlphaZero-lite combat checkpoint: missing policy/value output metadata');
  }
}

function validateModelOutputs(model, metadata) {
  const outputNames = model.outputs.map((output) =>
    output.name.replace(/:\d+$/, '').split('/')[0]);
  if (!outputNames.includes(metadata.outputs.policy) ||
      !outputNames.includes(metadata.outputs.value) ||
      model.outputs.length !== 2) {
    throw new Error('incompatible AlphaZero-lite combat checkpoint: model must have separate policy and value heads');
  }
}

async function saveAlphaZeroLiteCombatModel(model, directory, metadata) {
  validateMetadata(metadata);
  validateModelOutputs(model, metadata);
  const destination = path.resolve(directory);
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  await model.save(`file://${temporary}`);
  fs.writeFileSync(
    path.join(temporary, 'metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(temporary, destination);
}

async function loadAlphaZeroLiteCombatModel(directory) {
  const destination = path.resolve(directory);
  const metadataPath = path.join(destination, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error('incompatible AlphaZero-lite combat checkpoint: metadata.json is missing');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  validateMetadata(metadata);
  const model = await tf.loadLayersModel(`file://${path.join(destination, 'model.json')}`);
  validateModelOutputs(model, metadata);
  model.alphaZeroLiteCombatMetadata = metadata;
  return { model, metadata };
}

module.exports = {
  ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
  DEFAULT_ACTION_SPACE_SIZE,
  createAlphaZeroLiteCombatModel,
  createPolicyTarget,
  prepareAlphaZeroLiteCombatBatch,
  trainAlphaZeroLiteCombatBatch,
  saveAlphaZeroLiteCombatModel,
  loadAlphaZeroLiteCombatModel,
  validateMetadata
};
