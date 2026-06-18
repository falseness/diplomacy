#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  parseArgs: parseFinalGateArgs,
  runFinalSymmetricalEconomyGate
} = require('./benchmark-final-symmetrical-economy-gate');

const DEFAULT_CHECKPOINT = path.join(
  '/mnt',
  'storage',
  'diplomacy',
  'checkpoints',
  'task137-augmented-calibrated-final-20260614',
  'step-00000050'
);

function defaultCheckpoint() {
  const configured = process.env.TASK152_CHECKPOINT;
  if (configured) {
    return configured;
  }
  if (fs.existsSync(path.join(DEFAULT_CHECKPOINT, 'model.json')) &&
      fs.existsSync(path.join(DEFAULT_CHECKPOINT, 'metadata.json'))) {
    return DEFAULT_CHECKPOINT;
  }
  return null;
}

function parseArgs(argv) {
  const hasCheckpoint = argv.indexOf('--checkpoint') !== -1;
  const args = hasCheckpoint ? argv.slice() : argv.concat([
    '--checkpoint',
    defaultCheckpoint() || ''
  ]);
  const options = parseFinalGateArgs(args);
  options.task152Gate = true;
  return options;
}

async function runSymmetrical9x9AllUnitsGate(options) {
  const result = await runFinalSymmetricalEconomyGate(options);
  result.config.task = 'TASK-152';
  result.config.gateName = 'symmetrical-9x9-all-units-plus-towers-bastions';
  result.config.requiredMap = {
    mapSize: { x: 9, y: 9 },
    unitTypes: ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'],
    buildingTypes: ['tower', 'bastion']
  };
  result.summary.task = 'TASK-152';
  return result;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log([
        'Usage: node ai/benchmark-symmetrical-9x9-all-units-gate.js [options]',
        '',
        'Runs the TASK-152 AIPlayerWithEconomy vs SimpleAiPlayerWithEconomy gate.',
        'Defaults to 100 games, 100% no-loss rate, and 95% winrate.',
        'Set TASK152_CHECKPOINT or pass --checkpoint to choose a trained model.',
        '',
        'All options from benchmark-final-symmetrical-economy-gate.js are supported.'
      ].join('\n'));
      return;
    }
    if (!options.checkpoint) {
      throw new Error('--checkpoint is required or TASK152_CHECKPOINT must be set');
    }
    const result = await runSymmetrical9x9AllUnitsGate(options);
    const outputPath = require('./benchmarkHarness').writeResult(
      result,
      options.output || path.join(
        '/mnt',
        'storage',
        'diplomacy',
        'benchmarks',
        'task152-symmetrical-9x9-all-units-gate.json')
    );
    console.log(JSON.stringify(result.summary));
    console.log('TASK-152 symmetrical 9x9 all-units gate report: ' + outputPath);
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
  DEFAULT_CHECKPOINT,
  parseArgs,
  runSymmetrical9x9AllUnitsGate
};
