#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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
    '  --weak-threshold NUMBER    Minimum required model win rate, 0..1 (default: 0.6)',
    '  --checkpoint PATH          Model checkpoint identifier for reports',
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
    weakThreshold: 0.6,
    checkpoint: 'benchmark-smoke-model',
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
  return options;
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
    { x: 2, y: centerY - 1 },
    { x: 2, y: centerY },
    { x: 2, y: centerY + 1 },
    { x: 3, y: centerY - 1 },
    { x: 3, y: centerY + 1 }
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
  for (const player of gameMap.players.slice(1)) {
    if (!player.towns || player.towns.length !== 1) {
      throw new Error('generated combat benchmark requires exactly one objective town per side');
    }
    if (!player.units || player.units.length === 0) {
      throw new Error('generated combat benchmark requires starting combat units');
    }
  }
}

function runCombatBenchmark(options) {
  const games = [];
  for (let index = 0; index < options.maps; ++index) {
    const seed = options.seed + index;
    const gameMap = generatedCombatGameMap(seed, options.stage);
    assertCombatOnly(gameMap);
    const game = runGame({
      gameMap,
      playerA: 'AIPlayer',
      playerB: 'SimpleAiPlayer',
      seed,
      roundLimit: options.roundLimit,
      actionLimit: 30,
      commandLimit: 60
    });
    games.push(Object.assign({}, game, {
      seed,
      mapStage: options.stage,
      modelCheckpoint: options.checkpoint,
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
  const modelWins = games.filter((game) => game.winnerSide === 'A').length;
  const modelWinrate = decisiveGames.length ? modelWins / decisiveGames.length : 0;
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
    summary: {
      games: games.length,
      decisiveGames: decisiveGames.length,
      modelWins,
      simpleWins: games.filter((game) => game.winnerSide === 'B').length,
      timeouts: games.filter((game) => game.timeout).length,
      suddenDeathGames: games.filter((game) => game.suddenDeath).length,
      nonResults: games.filter((game) => game.nonResult).length,
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

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const result = runCombatBenchmark(options);
    const outputPath = writeResult(result, options.output);
    console.log(JSON.stringify(result.summary));
    console.log('Combat model benchmark report: ' + outputPath);
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
  assertCombatOnly,
  generatedCombatGameMap,
  runCombatBenchmark
};
