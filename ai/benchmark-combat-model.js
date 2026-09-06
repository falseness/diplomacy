#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const { runGame, writeResult } = require('./benchmarkHarness');

function usage() {
  return [
    'Usage: node ai/benchmark-combat-model.js [options]',
    '',
    'Options:',
    '  --seed NUMBER              First deterministic seed (default: 66066)',
    '  --maps NUMBER              Number of generated combat maps (default: 4)',
    '  --stage NAME               Combat map stage label (default: combat-random)',
    '  --round-limit NUMBER       Maximum turns per game (default: 80)',
    '  --weak-threshold NUMBER    Minimum required model win rate, 0..1 (default: 0.8)',
    '  --checkpoint PATH          Required learned combat checkpoint directory',
    '  --output PATH              JSON report path',
    '  --help                     Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    seed: 66066,
    maps: 4,
    stage: 'combat-random',
    roundLimit: 80,
    weakThreshold: 0.8,
    checkpoint: null,
    output: path.join('/mnt', 'storage', 'diplomacy', 'benchmarks', 'combat-model-vs-simple.json')
  };
  const names = {
    '--seed': 'seed',
    '--maps': 'maps',
    '--stage': 'stage',
    '--round-limit': 'roundLimit',
    '--weak-threshold': 'weakThreshold',
    '--checkpoint': 'checkpoint',
    '--output': 'output'
  };
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    const name = names[argument];
    if (!name || index + 1 >= argv.length) {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
    options[name] = argv[++index];
  }
  for (const name of ['seed', 'maps', 'roundLimit', 'weakThreshold']) {
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name])) {
      throw new Error(name + ' must be numeric');
    }
  }
  if (!Number.isInteger(options.maps) || options.maps <= 0) {
    throw new Error('maps must be a positive integer');
  }
  if (!Number.isInteger(options.seed) || options.seed <= 0) {
    throw new Error('seed must be a positive integer');
  }
  if (!Number.isInteger(options.roundLimit) || options.roundLimit <= 0) {
    throw new Error('roundLimit must be a positive integer');
  }
  if (options.weakThreshold < 0 || options.weakThreshold > 1) {
    throw new Error('weakThreshold must be between 0 and 1');
  }
  if (!options.checkpoint) {
    throw new Error('--checkpoint is required');
  }
  return options;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function checkpointFiles(checkpointPath) {
  const checkpointDir = path.resolve(checkpointPath);
  const modelPath = path.join(checkpointDir, 'model.json');
  const metadataPath = path.join(checkpointDir, 'metadata.json');
  if (!fs.existsSync(modelPath)) {
    throw new Error('combat model checkpoint is missing: ' + modelPath);
  }
  if (!fs.existsSync(metadataPath)) {
    throw new Error('combat model checkpoint metadata is missing: ' + metadataPath);
  }
  return { checkpointDir, modelPath, metadataPath };
}

function tensorSignature(tensors) {
  return tensors.map((tensor) => ({
    name: tensor.name.replace(/:\d+$/, '').split('/')[0].replace(/_\d+$/, ''),
    shape: tensor.shape
  }));
}

function valueTensor(prediction) {
  if (!Array.isArray(prediction)) return prediction;
  const value = prediction.find((tensor) =>
    tensor.shape.length === 2 && tensor.shape[1] === 1);
  if (!value) throw new Error('combat checkpoint has no scalar value output');
  return value;
}

function disposePrediction(prediction) {
  for (const tensor of Array.isArray(prediction) ? prediction : [prediction]) {
    if (tensor) tensor.dispose();
  }
}

async function loadCombatCheckpoint(checkpointPath) {
  const files = checkpointFiles(checkpointPath);
  const metadata = JSON.parse(fs.readFileSync(files.metadataPath, 'utf8'));
  if (!metadata.architecture || metadata.architecture.combatOnly !== true ||
      metadata.architecture.vectorCompatibility.economyFeatures !== false) {
    throw new Error('checkpoint metadata does not identify a combat-only model');
  }
  const model = await tf.loadLayersModel('file://' + files.modelPath);
  const signature = {
    inputs: tensorSignature(model.inputs),
    outputs: tensorSignature(model.outputs)
  };
  const boardShape = model.inputs[0] && model.inputs[0].shape;
  const globalShape = model.inputs[1] && model.inputs[1].shape;
  if (model.inputs.length !== 2 || !boardShape || boardShape.length !== 4 ||
      boardShape.slice(1).some((value) => !Number.isInteger(value)) ||
      !globalShape || globalShape.length !== 2 || globalShape[1] !== 1 ||
      !model.outputs.some((output) => output.shape.length === 2 && output.shape[1] === 1)) {
    model.dispose();
    throw new Error('combat checkpoint model signature is incompatible: ' +
      JSON.stringify(signature));
  }
  const weightFiles = (JSON.parse(fs.readFileSync(files.modelPath, 'utf8'))
    .weightsManifest || []).flatMap((group) => group.paths || []);
  return {
    model,
    boardShape: boardShape.slice(1),
    report: {
      path: files.checkpointDir,
      metadata,
      signature,
      files: [files.modelPath, files.metadataPath]
        .concat(weightFiles.map((name) => path.join(files.checkpointDir, name)))
        .map((filePath) => ({ path: filePath, sha256: sha256(filePath) }))
    }
  };
}

const projectionCache = new Map();

function projectionBuckets(width, height, targetWidth, targetHeight) {
  const key = [width, height, targetWidth, targetHeight].join('x');
  if (projectionCache.has(key)) return projectionCache.get(key);
  const result = [];
  for (let targetX = 0; targetX < targetWidth; ++targetX) {
    for (let targetY = 0; targetY < targetHeight; ++targetY) {
      result.push({
        xStart: Math.floor(targetX * width / targetWidth),
        xEnd: Math.max(1, Math.floor((targetX + 1) * width / targetWidth)),
        yStart: Math.floor(targetY * height / targetHeight),
        yEnd: Math.max(1, Math.floor((targetY + 1) * height / targetHeight))
      });
    }
  }
  projectionCache.set(key, result);
  return result;
}

function projectRuntimeBoard(board, targetShape) {
  const [targetWidth, targetHeight, targetChannels] = targetShape;
  const width = board.length;
  const height = width && board[0] ? board[0].length : 0;
  if (!width || !height) throw new Error('runtime model vector has an empty board');
  if (width === targetWidth && height === targetHeight &&
      board[0][0].length === targetChannels) return board.flat(2);
  if (targetChannels !== 21) {
    throw new Error('runtime map vector does not match checkpoint input: expected ' +
      targetShape.join('x') + ', received ' +
      [width, height, board[0][0].length].join('x'));
  }
  const projected = new Array(targetWidth * targetHeight * targetChannels).fill(0);
  const buckets = projectionBuckets(width, height, targetWidth, targetHeight);
  buckets.forEach((bucket, bucketIndex) => {
    const offset = bucketIndex * targetChannels;
    for (let x = bucket.xStart; x < Math.min(width, bucket.xEnd); ++x) {
      for (let y = bucket.yStart; y < Math.min(height, bucket.yEnd); ++y) {
        const cell = board[x][y] || [];
        const unitOwner = Number(cell[1]) || 0;
        const townOwner = Number(cell[13]) || 0;
        if (unitOwner > 0) {
          projected[offset] += 1;
          projected[offset + 2] += Number(cell[11]) || 0;
          projected[offset + 4] += Number(cell[9]) || 0;
          projected[offset + 6] += Number(cell[10]) || 0;
          projected[offset + 12] += Number(cell[7]) || 0;
        } else if (unitOwner < 0) {
          projected[offset + 1] += 1;
          projected[offset + 3] += Number(cell[11]) || 0;
          projected[offset + 5] += Number(cell[9]) || 0;
          projected[offset + 7] += Number(cell[10]) || 0;
          projected[offset + 13] += Number(cell[7]) || 0;
        }
        if (townOwner > 0) {
          projected[offset + 8] += 1;
          projected[offset + 10] += Number(cell[14]) || 0;
        } else if (townOwner < 0) {
          projected[offset + 9] += 1;
          projected[offset + 11] += Number(cell[14]) || 0;
        }
      }
    }
    projected[offset + 14] = targetWidth === 1 ? 0 :
      Math.floor(bucketIndex / targetHeight) / (targetWidth - 1);
    projected[offset + 15] = targetHeight === 1 ? 0 :
      (bucketIndex % targetHeight) / (targetHeight - 1);
  });
  return projected;
}

function createCheckpointPredictor(checkpoint, stats) {
  return function predictCheckpoint(_identifier, vectors) {
    const boards = vectors.map((vector) =>
      projectRuntimeBoard(vector[0], checkpoint.boardShape));
    const globals = vectors.map((vector) => [Number(vector[1]) || 0]);
    const boardTensor = tf.tensor4d(boards.flat(), [boards.length].concat(checkpoint.boardShape));
    const globalTensor = tf.tensor2d(globals, [globals.length, 1]);
    let prediction;
    try {
      prediction = checkpoint.model.predict([boardTensor, globalTensor]);
      const values = Array.from(valueTensor(prediction).dataSync());
      stats.calls += 1;
      stats.positions += vectors.length;
      if (stats.probes.length < 8) stats.probes.push(...values.slice(0, 8 - stats.probes.length));
      return values.map((value) => [value]);
    } finally {
      disposePrediction(prediction);
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

function createRandom(seed) {
  let state = seed >>> 0;
  if (!state) {
    state = 0x9e3779b9;
  }
  return function random() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function reserve(used, coord) {
  used.add(coordKey(coord));
  return coord;
}

function generatedCombatGameMap(seed, stage) {
  const random = createRandom(seed);
  const width = randomInt(random, 7, 11);
  const height = randomInt(random, 7, 11);
  const centerY = Math.floor(height / 2);
  const used = new Set();
  const leftTown = reserve(used, { x: 1, y: centerY });
  const rightTown = reserve(used, { x: width - 2, y: centerY });
  const unitCount = randomInt(random, 2, 4);
  const leftCandidates = [
    { x: 2, y: centerY - 2 },
    { x: 2, y: centerY - 1 },
    { x: 2, y: centerY },
    { x: 2, y: centerY + 1 },
    { x: 2, y: centerY + 2 }
  ];
  const rightCandidates = leftCandidates.map((coord) => ({
    x: width - 1 - coord.x,
    y: coord.y
  }));
  const leftUnits = [];
  const rightUnits = [];
  for (let index = 0; index < unitCount; ++index) {
    leftUnits.push(reserve(used, leftCandidates[index]));
    rightUnits.push(reserve(used, rightCandidates[index]));
  }
  const blockers = [];
  const blockerCount = randomInt(random, 0, 3);
  for (let attempt = 0; attempt < 100 && blockers.length < blockerCount; ++attempt) {
    const coord = {
      x: randomInt(random, 3, width - 4),
      y: randomInt(random, 1, height - 2)
    };
    if (!used.has(coordKey(coord))) {
      blockers.push(reserve(used, coord));
    }
  }
  return {
    testName: stage + '-' + seed,
    mapSize: { x: width, y: height },
    suddenDeathRound: randomInt(random, 18, 28),
    lakes: blockers,
    mountains: [],
    bushes: [],
    hills: [],
    players: [
      { towns: [] },
      {
        towns: [leftTown],
        units: leftUnits.map((coord) => ({ x: coord.x, y: coord.y }))
      },
      {
        towns: [rightTown],
        units: rightUnits.map((coord) => ({ x: coord.x, y: coord.y }))
      }
    ],
    combatOnly: true,
    economyObjects: {
      farms: 0,
      barracks: 0,
      goldmines: 0,
      productionActions: 0,
      resources: 0
    }
  };
}

function assertCombatOnly(gameMap) {
  const economyObjects = gameMap.economyObjects || {};
  for (const [name, count] of Object.entries(economyObjects)) {
    if (count !== 0) {
      throw new Error('generated benchmark map contains economy object: ' + name);
    }
  }
  if (gameMap.players.length !== 3) {
    throw new Error('generated combat benchmark requires neutral plus two players');
  }
  const occupied = new Set();
  for (const player of gameMap.players.slice(1)) {
    if (!player.towns || player.towns.length !== 1) {
      throw new Error('generated combat benchmark requires exactly one objective town per side');
    }
    if (!player.units || player.units.length === 0) {
      throw new Error('generated combat benchmark requires starting combat units');
    }
    for (const coord of player.towns.concat(player.units)) {
      const key = coordKey(coord);
      if (occupied.has(key)) {
        throw new Error('generated combat benchmark contains overlapping entities: ' + key);
      }
      occupied.add(key);
    }
  }
  for (const coord of [].concat(gameMap.lakes || [], gameMap.mountains || [],
    gameMap.bushes || [], gameMap.hills || [])) {
    if (occupied.has(coordKey(coord))) {
      throw new Error('generated combat benchmark terrain overlaps an entity: ' + coordKey(coord));
    }
  }
}

function runCombatBenchmark(options, checkpoint) {
  const games = [];
  const inference = { calls: 0, positions: 0, probes: [] };
  const predictFunction = createCheckpointPredictor(checkpoint, inference);
  for (let index = 0; index < options.maps; ++index) {
    const seed = options.seed + index;
    const gameMap = generatedCombatGameMap(seed, options.stage);
    assertCombatOnly(gameMap);
    const modelSide = index % 2 === 0 ? 'A' : 'B';
    const game = runGame({
      gameMap,
      playerA: modelSide === 'A' ? 'AIPlayer' : 'SimpleAiPlayer',
      playerB: modelSide === 'B' ? 'AIPlayer' : 'SimpleAiPlayer',
      seed,
      roundLimit: options.roundLimit,
      actionLimit: 30,
      commandLimit: 60,
      predictFunction,
      modelIdentifier: checkpoint.report.path,
      inferenceSource: 'loaded learned combat checkpoint value output'
    });
    games.push(Object.assign({}, game, {
      seed,
      mapStage: options.stage,
      modelCheckpoint: options.checkpoint,
      modelSide,
      modelWon: game.winnerSide === modelSide,
      playerClasses: {
        model: 'AIPlayer',
        simple: 'SimpleAiPlayer'
      },
      combatOnly: true,
      economyObjects: gameMap.economyObjects,
      generatedMap: {
        width: gameMap.mapSize.x,
        height: gameMap.mapSize.y,
        unitCountPerSide: gameMap.players[1].units.length,
        blockerCount: gameMap.lakes.length,
        suddenDeathRound: gameMap.suddenDeathRound
      }
    }));
  }
  const decisiveGames = games.filter((game) => game.winnerSide !== null && !game.crash);
  const modelWins = games.filter((game) => game.modelWon).length;
  const modelWinrate = modelWins / games.length;
  const thresholdPassed = modelWinrate >= options.weakThreshold;
  return {
    config: {
      seed: options.seed,
      maps: options.maps,
      mapStage: options.stage,
      roundLimit: options.roundLimit,
      weakModelThreshold: options.weakThreshold,
      modelCheckpoint: options.checkpoint,
      playerClasses: {
        model: 'AIPlayer',
        simple: 'SimpleAiPlayer'
      },
      combatOnly: true
    },
    checkpoint: Object.assign({}, checkpoint.report, { gameplayInference: inference }),
    summary: {
      games: games.length,
      decisiveGames: decisiveGames.length,
      modelWins,
      simpleWins: games.filter((game) => game.winnerSide && !game.modelWon).length,
      timeouts: games.filter((game) => game.timeout).length,
      suddenDeathGames: games.filter((game) => game.suddenDeath).length,
      nonResults: games.filter((game) => game.nonResult).length,
      nonWins: games.length - modelWins,
      sideDistribution: {
        modelA: games.filter((game) => game.modelSide === 'A').length,
        modelB: games.filter((game) => game.modelSide === 'B').length
      },
      modelWinrate,
      weakModelThreshold: options.weakThreshold,
      gate: thresholdPassed ? 'passed' : 'failed',
      gateReason: thresholdPassed
        ? 'model winrate exceeded the configured weak-model threshold'
        : 'model winrate is near or below the configured weak-model threshold'
    },
    games,
    artifacts: {}
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const checkpoint = await loadCombatCheckpoint(options.checkpoint);
    try {
      const result = runCombatBenchmark(options, checkpoint);
      const outputPath = writeResult(result, options.output);
      console.log(JSON.stringify(result.summary));
      console.log('Combat model benchmark report: ' + outputPath);
      if (result.summary.gate !== 'passed') {
        process.exitCode = 1;
      }
    } finally {
      checkpoint.model.dispose();
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

module.exports = {
  assertCombatOnly,
  createCheckpointPredictor,
  generatedCombatGameMap,
  loadCombatCheckpoint,
  projectRuntimeBoard,
  runCombatBenchmark
};
