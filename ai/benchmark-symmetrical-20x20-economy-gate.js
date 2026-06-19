#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseArgs: parseFinalGateArgs,
  runFinalSymmetricalEconomyGate
} = require('./benchmark-final-symmetrical-economy-gate');

const DEFAULT_CHECKPOINTS = [
  path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'checkpoints',
    'task154-stage14-20260618',
    'step-00000050'),
  path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'checkpoints',
    'task154-stage14-single-20260618',
    'step-00000020'),
  path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'checkpoints',
    'verify-task153-advanced-9x9-20260618',
    'step-00000001'),
  path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'checkpoints',
    'task153-advanced-9x9-20260618',
    'step-00000001'),
  path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'checkpoints',
    'task137-augmented-calibrated-final-20260614',
    'step-00000050')
];

function hasCheckpoint(checkpointPath) {
  return checkpointPath &&
    fs.existsSync(path.join(checkpointPath, 'model.json')) &&
    fs.existsSync(path.join(checkpointPath, 'metadata.json'));
}

function defaultCheckpoint() {
  if (process.env.TASK154_CHECKPOINT) {
    return process.env.TASK154_CHECKPOINT;
  }
  return DEFAULT_CHECKPOINTS.find(hasCheckpoint) || null;
}

function parseArgs(argv) {
  const hasCheckpoint = argv.indexOf('--checkpoint') !== -1;
  const hasSeed = argv.indexOf('--seed') !== -1;
  const args = argv.slice();
  if (!hasSeed) {
    args.push('--seed', '154000');
  }
  if (!hasCheckpoint) {
    args.push('--checkpoint', defaultCheckpoint() || '');
  }
  const options = parseFinalGateArgs(args);
  options.task154Gate = true;
  options.mapGeneratorName = 'generateAdvancedEconomyStage14TrainingMap';
  return options;
}

async function runSymmetrical20x20EconomyGate(options) {
  options = Object.assign({}, options || {}, {
    mapGeneratorName: 'generateAdvancedEconomyStage14TrainingMap'
  });
  const result = await runFinalSymmetricalEconomyGate(options);
  result.config.task = 'TASK-154';
  result.config.gateName = 'symmetrical-20x20-economy-stage-14';
  result.config.requiredMap = {
    mapSize: { x: 20, y: 20 },
    generator: 'generateAdvancedEconomyStage14TrainingMap',
    advancedEconomyStage: 14,
    symmetric: true
  };
  result.summary.task = 'TASK-154';
  return result;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log([
        'Usage: node ai/benchmark-symmetrical-20x20-economy-gate.js [options]',
        '',
        'Runs the TASK-154 AIPlayerWithEconomy vs SimpleAiPlayerWithEconomy gate.',
        'Defaults to 100 games, 100% no-loss rate, and 95% winrate.',
        'Uses generateAdvancedEconomyStage14TrainingMap with fair symmetric 20x20 maps.',
        'Set TASK154_CHECKPOINT or pass --checkpoint to choose a trained model.',
        '',
        'All options from benchmark-final-symmetrical-economy-gate.js are supported.'
      ].join('\n'));
      return;
    }
    if (!options.checkpoint) {
      throw new Error('--checkpoint is required or TASK154_CHECKPOINT must be set');
    }
    const result = await runSymmetrical20x20EconomyGate(options);
    const outputPath = require('./benchmarkHarness').writeResult(
      result,
      options.output || path.join(
        '/mnt',
        'storage',
        'diplomacy',
        'benchmarks',
        'task154-symmetrical-20x20-economy-gate.json')
    );
    console.log(JSON.stringify(result.summary));
    console.log('TASK-154 symmetrical 20x20 economy gate report: ' + outputPath);
    if (result.summary.gate !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_CHECKPOINTS,
  defaultCheckpoint,
  parseArgs,
  runSymmetrical20x20EconomyGate
};
