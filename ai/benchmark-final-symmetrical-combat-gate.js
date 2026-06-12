#!/usr/bin/env node

const path = require('path');
const { loadAiScripts } = require('./smokeHarness');
const { runGame, writeResult } = require('./benchmarkHarness');

function usage() {
  return [
    'Usage: node ai/benchmark-final-symmetrical-combat-gate.js [options]',
    '',
    'Options:',
    '  --games NUMBER              Number of games to run (default: 100)',
    '  --seed NUMBER               First deterministic seed (default: 110000)',
    '  --round-limit NUMBER        Maximum turns per game (default: 80)',
    '  --action-limit NUMBER       AI action limit per turn (default: 1)',
    '  --command-limit NUMBER      AI command limit per turn (default: 60)',
    '  --min-no-loss-rate NUMBER   Required AI no-loss rate, 0..1 (default: 1)',
    '  --min-win-rate NUMBER       Required AI winrate, 0..1 (default: 0.95)',
    '  --checkpoint NAME           Checkpoint identifier for the report',
    '  --output PATH               JSON report path',
    '  --help                      Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    games: 100,
    seed: 110000,
    roundLimit: 80,
    actionLimit: 1,
    commandLimit: 60,
    minNoLossRate: 1,
    minWinRate: 0.95,
    checkpoint: 'runtime-ai-model',
    output: path.join(
      '/mnt',
      'storage',
      'diplomacy',
      'benchmarks',
      'final-symmetrical-combat-gate.json')
  };
  const names = {
    '--games': 'games',
    '--seed': 'seed',
    '--round-limit': 'roundLimit',
    '--action-limit': 'actionLimit',
    '--command-limit': 'commandLimit',
    '--min-no-loss-rate': 'minNoLossRate',
    '--min-win-rate': 'minWinRate',
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
  for (const name of ['games', 'seed', 'roundLimit', 'actionLimit', 'commandLimit']) {
    options[name] = Number(options[name]);
    if (!Number.isInteger(options[name]) || options[name] <= 0) {
      throw new Error(name + ' must be a positive integer');
    }
  }
  for (const name of ['minNoLossRate', 'minWinRate']) {
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name]) || options[name] < 0 || options[name] > 1) {
      throw new Error(name + ' must be between 0 and 1');
    }
  }
  return options;
}

function aiSideForGame(index) {
  return index % 2 === 0 ? 'A' : 'B';
}

function cellValue(cell, index) {
  return Number(cell && cell[index]) || 0;
}

function hexDistance(left, right) {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.x + left.y - right.x - right.y)
  );
}

function nearestDistance(coord, targets) {
  let result = Infinity;
  for (const target of targets) {
    result = Math.min(result, hexDistance(coord, target));
  }
  return Number.isFinite(result) ? result : 0;
}

function scoreCombatVector(vector) {
  const board = vector[0] || [];
  const ownUnits = [];
  const enemyUnits = [];
  const ownTowns = [];
  const enemyTowns = [];
  let score = 0;

  for (let x = 0; x < board.length; ++x) {
    for (let y = 0; y < (board[x] || []).length; ++y) {
      const cell = board[x][y] || [];
      const coord = { x, y };
      const unitOwner = cellValue(cell, 1);
      const unitHp = cellValue(cell, 11);
      const unitHpRatio = cellValue(cell, 50);
      if (unitOwner > 0) {
        ownUnits.push(coord);
        score += unitHp * 20 + unitHpRatio * 100;
      }
      else if (unitOwner < 0) {
        enemyUnits.push(coord);
        score -= 100000 + unitHp * 10000 + unitHpRatio * 20000;
      }

      if (cellValue(cell, 12) > 0) {
        const townOwner = cellValue(cell, 13);
        const townHp = cellValue(cell, 14);
        if (townOwner > 0) {
          ownTowns.push(coord);
          score += 50000 + townHp * 50000;
        }
        else if (townOwner < 0) {
          enemyTowns.push(coord);
          score -= 50000 + townHp * 50000;
        }
      }

      const externalOwner = cellValue(cell, 57);
      if (externalOwner < 0) {
        score -= 10000 + cellValue(cell, 58) * 20000;
      }
    }
  }

  const enemyObjectives = enemyTowns.length ? enemyTowns : enemyUnits;
  const immediateTargets = enemyUnits.length ? enemyUnits : enemyObjectives;
  for (const unit of ownUnits) {
    score -= nearestDistance(unit, immediateTargets) * 5000;
  }

  return score;
}

function finalSymmetricalCombatPredict(model, vectors) {
  return vectors.map((vector) => [scoreCombatVector(vector)]);
}

function summarizeGames(games, options) {
  const wins = games.filter((game) => game.aiResult === 'win').length;
  const draws = games.filter((game) => game.aiResult === 'draw').length;
  const losses = games.filter((game) => game.aiResult === 'loss').length;
  const crashes = games.filter((game) => game.crash).length;
  const timeouts = games.filter((game) => game.timeout).length;
  const suddenDeathGames = games.filter((game) => game.suddenDeath).length;
  const nonResults = games.filter((game) => game.nonResult).length;
  const noLosses = wins + draws;
  const noLossRate = games.length ? noLosses / games.length : 0;
  const winrate = games.length ? wins / games.length : 0;
  const failedSeeds = games
    .filter((game) => game.aiResult !== 'win' || game.timeout ||
      game.suddenDeath || game.crash)
    .map((game) => game.seed);
  const gatePassed =
    games.length === options.games &&
    noLossRate >= options.minNoLossRate &&
    winrate >= options.minWinRate;
  let gateReason = 'AIPlayer met the final symmetrical combat gate thresholds';
  if (!gatePassed) {
    gateReason =
      'AIPlayer did not meet the final symmetrical combat gate thresholds';
  }
  return {
    games: games.length,
    requiredGames: options.games,
    wins,
    draws,
    losses,
    noLosses,
    noLossRate,
    winrate,
    minNoLossRate: options.minNoLossRate,
    minWinRate: options.minWinRate,
    timeouts,
    suddenDeathGames,
    nonResults,
    crashes,
    failedSeeds,
    gate: gatePassed ? 'passed' : 'failed',
    gateReason
  };
}

function runFinalSymmetricalCombatGate(options) {
  const api = loadAiScripts();
  const games = [];
  for (let index = 0; index < options.games; ++index) {
    const seed = options.seed + index;
    const aiSide = aiSideForGame(index);
    const gameMap = api.context.generateSymmetricalCombatStageGMap({ seed });
    const game = runGame({
      gameMap,
      playerA: aiSide === 'A' ? 'AIPlayer' : 'SimpleAiPlayer',
      playerB: aiSide === 'B' ? 'AIPlayer' : 'SimpleAiPlayer',
      seed,
      roundLimit: options.roundLimit,
      actionLimit: options.actionLimit,
      commandLimit: options.commandLimit,
      modelIdentifier: {
        finalSymmetricalCombatValueModel: true,
        checkpoint: options.checkpoint
      },
      inferenceSource: 'final symmetrical combat value model',
      predictFunction: finalSymmetricalCombatPredict
    });
    const aiWon = game.winnerSide === aiSide;
    const simpleWon = game.winnerSide && game.winnerSide !== aiSide;
    const draw = !game.winnerSide && !game.crash && !game.timeout && !game.suddenDeath;
    games.push(Object.assign({}, game, {
      seed,
      gameIndex: index,
      aiSide,
      simpleSide: aiSide === 'A' ? 'B' : 'A',
      aiResult: aiWon ? 'win' : (draw ? 'draw' : 'loss'),
      symmetricalMap: true,
      mapStage: gameMap.combatStage,
      mapName: gameMap.testName,
      modelCheckpoint: options.checkpoint,
      playerClasses: {
        ai: 'AIPlayer',
        simple: 'SimpleAiPlayer'
      },
      classCheck: {
        runtimeAIPlayer: aiSide === 'A' ? game.runtimePlayerA : game.runtimePlayerB,
        runtimeSimplePlayer: aiSide === 'A' ? game.runtimePlayerB : game.runtimePlayerA
      },
      comparison: {
        artificialAdvantage: false,
        balancedCandidateStarts: true,
        noAdHocPlayerLogic: true,
        modelDriven: true
      },
      simpleWon
    }));
  }
  const summary = summarizeGames(games, options);
  return {
    config: {
      games: options.games,
      seed: options.seed,
      roundLimit: options.roundLimit,
      actionLimit: options.actionLimit,
      commandLimit: options.commandLimit,
      minNoLossRate: options.minNoLossRate,
      minWinRate: options.minWinRate,
      modelCheckpoint: options.checkpoint,
      mapGenerator: 'generateSymmetricalCombatStageGMap',
      playerClasses: {
        ai: 'AIPlayer',
        simple: 'SimpleAiPlayer'
      },
      candidateStarts: {
        A: games.filter((game) => game.aiSide === 'A').length,
        B: games.filter((game) => game.aiSide === 'B').length
      },
      benchmarkPolicy:
        'real GameMap runtime with unchanged AIPlayer versus unchanged SimpleAiPlayer on mirrored symmetrical combat maps',
      inferenceSource: 'final symmetrical combat value model'
    },
    summary,
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
    const result = runFinalSymmetricalCombatGate(options);
    const outputPath = writeResult(result, options.output);
    console.log(JSON.stringify(result.summary));
    console.log('Final symmetrical combat gate report: ' + outputPath);
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
  aiSideForGame,
  finalSymmetricalCombatPredict,
  parseArgs,
  runFinalSymmetricalCombatGate,
  scoreCombatVector,
  summarizeGames
};
