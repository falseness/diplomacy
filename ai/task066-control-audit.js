#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const { runGame, writeResult } = require('./benchmarkHarness');
const {
  generatedCombatGameMap,
  loadCombatCheckpoint
} = require('./benchmark-combat-model');

function parseArgs(argv) {
  const options = { seed: 66670, maps: 4, roundLimit: 40 };
  const names = {
    '--checkpoint': 'checkpoint',
    '--output-dir': 'outputDir',
    '--seed': 'seed',
    '--maps': 'maps',
    '--round-limit': 'roundLimit'
  };
  for (let index = 0; index < argv.length; ++index) {
    const name = names[argv[index]];
    if (!name || index + 1 >= argv.length) {
      throw new Error('unknown or incomplete argument: ' + argv[index]);
    }
    options[name] = argv[++index];
  }
  for (const name of ['seed', 'maps', 'roundLimit']) {
    options[name] = Number(options[name]);
    if (!Number.isInteger(options[name]) || options[name] <= 0) {
      throw new Error(name + ' must be a positive integer');
    }
  }
  if (!options.checkpoint || !options.outputDir) {
    throw new Error('--checkpoint and --output-dir are required');
  }
  return options;
}

function seededValues(size, seed) {
  let state = seed >>> 0;
  const values = new Float32Array(size);
  for (let index = 0; index < size; ++index) {
    state = (1664525 * state + 1013904223) >>> 0;
    values[index] = (state / 0x100000000 - 0.5) * 0.1;
  }
  return values;
}

async function saveControl(source, outputPath, kind) {
  const model = await tf.loadLayersModel('file://' + path.join(source, 'model.json'));
  const oldWeights = model.getWeights();
  const newWeights = oldWeights.map((weight, index) => {
    if (kind === 'zero') return tf.zeros(weight.shape);
    if (/moving_variance/i.test(weight.name)) return tf.ones(weight.shape);
    return tf.tensor(seededValues(weight.size, 6606600 + index), weight.shape);
  });
  try {
    model.setWeights(newWeights);
    fs.mkdirSync(outputPath, { recursive: true });
    await model.save('file://' + outputPath);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'metadata.json'), 'utf8'));
    metadata.control = {
      kind,
      sourceCheckpoint: path.resolve(source),
      deterministicSeed: kind === 'randomized' ? 6606600 : null
    };
    fs.writeFileSync(path.join(outputPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2) + '\n');
  } finally {
    newWeights.forEach((weight) => weight.dispose());
    model.dispose();
  }
}

function heuristicPredictor(_identifier, vectors) {
  return vectors.map((vector) => {
    let score = 0;
    for (const column of vector[0]) {
      for (const cell of column) {
        score += (Number(cell[2]) || 0) - (Number(cell[3]) || 0);
      }
    }
    return [Math.max(-1, Math.min(1, score / 10))];
  });
}

function heuristicReport(options) {
  const games = [];
  for (let index = 0; index < options.maps; ++index) {
    const seed = options.seed + index;
    const modelSide = index % 2 === 0 ? 'A' : 'B';
    const game = runGame({
      gameMap: generatedCombatGameMap(seed, 'task066-predeclared-holdout'),
      playerA: modelSide === 'A' ? 'AIPlayer' : 'SimpleAiPlayer',
      playerB: modelSide === 'B' ? 'AIPlayer' : 'SimpleAiPlayer',
      seed,
      roundLimit: options.roundLimit,
      actionLimit: 30,
      commandLimit: 60,
      predictFunction: heuristicPredictor,
      inferenceSource: 'deterministic hp-difference heuristic-only control',
      modelIdentifier: 'heuristic-only-no-checkpoint'
    });
    games.push(Object.assign({}, game, {
      seed,
      modelSide,
      modelWon: game.winnerSide === modelSide
    }));
  }
  const modelWins = games.filter((game) => game.modelWon).length;
  return {
    config: options,
    summary: {
      games: games.length,
      modelWins,
      nonWins: games.length - modelWins,
      modelWinrate: modelWins / games.length,
      sideDistribution: {
        modelA: games.filter((game) => game.modelSide === 'A').length,
        modelB: games.filter((game) => game.modelSide === 'B').length
      }
    },
    games,
    artifacts: {}
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadCombatCheckpoint(options.checkpoint);
  loaded.model.dispose();
  const outputDir = path.resolve(options.outputDir);
  await saveControl(options.checkpoint, path.join(outputDir, 'zeroed-checkpoint'), 'zero');
  await saveControl(options.checkpoint, path.join(outputDir, 'randomized-checkpoint'), 'randomized');
  const reportPath = writeResult(heuristicReport(options),
    path.join(outputDir, 'heuristic-control-report.json'));
  console.log('ZEROED_CHECKPOINT=' + path.join(outputDir, 'zeroed-checkpoint'));
  console.log('RANDOMIZED_CHECKPOINT=' + path.join(outputDir, 'randomized-checkpoint'));
  console.log('HEURISTIC_CONTROL_REPORT=' + reportPath);
  console.log('CONTROL_AUDIT_GENERATION=PASS');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
