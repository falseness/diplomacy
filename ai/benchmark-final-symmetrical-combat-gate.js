#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadAiScripts } = require('./smokeHarness');
const { runGame, writeResult } = require('./benchmarkHarness');

const DEFAULT_BASELINE_AI_MODEL_PATH =
  '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training';

function usage() {
  return [
    'Usage: node ai/benchmark-final-symmetrical-combat-gate.js [options]',
    '',
    'Options:',
    '  --games NUMBER              Number of games to run (default: 100)',
    '  --seed NUMBER               First deterministic seed (default: 110000)',
    '  --round-limit NUMBER        Maximum turns per game (default: 80)',
    '  --sudden-death-round NUMBER Map sudden-death round for every game (default: 80)',
    '  --action-limit NUMBER       AI action limit per turn (default: 1)',
    '  --command-limit NUMBER      AI command limit per turn (default: 60)',
    '  --min-no-loss-rate NUMBER   Required AI no-loss rate, 0..1 (default: 1)',
    '  --min-win-rate NUMBER       Required AI winrate, 0..1 (default: 0.95)',
    '  --checkpoint NAME           Checkpoint identifier for the report',
    '  --opponent NAME             simple, baseline-ai, or both (default: both)',
    '  --baseline-checkpoint PATH  Baseline AIPlayer checkpoint directory',
    '  --output PATH               JSON report path',
    '  --help                      Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = defaultOptions();
  const names = {
    '--games': 'games',
    '--seed': 'seed',
    '--round-limit': 'roundLimit',
    '--sudden-death-round': 'suddenDeathRound',
    '--action-limit': 'actionLimit',
    '--command-limit': 'commandLimit',
    '--min-no-loss-rate': 'minNoLossRate',
    '--min-win-rate': 'minWinRate',
    '--checkpoint': 'checkpoint',
    '--opponent': 'opponent',
    '--baseline-checkpoint': 'baselineCheckpoint',
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
  return normalizeOptions(options);
}

function defaultOptions() {
  return {
    games: 100,
    seed: 110000,
    roundLimit: 80,
    suddenDeathRound: 80,
    actionLimit: 1,
    commandLimit: 60,
    minNoLossRate: 1,
    minWinRate: 0.95,
    checkpoint: 'runtime-ai-model',
    opponent: 'both',
    baselineCheckpoint: DEFAULT_BASELINE_AI_MODEL_PATH,
    output: path.join(
      '/mnt',
      'storage',
      'diplomacy',
      'benchmarks',
      'final-symmetrical-combat-gate.json')
  };
}

function normalizeOptions(input) {
  const options = Object.assign(defaultOptions(), input || {});
  for (const name of ['games', 'seed', 'roundLimit', 'suddenDeathRound', 'actionLimit', 'commandLimit']) {
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
  if (!['simple', 'baseline-ai', 'both'].includes(options.opponent)) {
    throw new Error('opponent must be simple, baseline-ai, or both');
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

function nearestDistanceFlat(x, y, targets) {
  let result = Infinity;
  for (let index = 0; index < targets.length; index += 2) {
    const tx = targets[index];
    const ty = targets[index + 1];
    const distance = Math.max(
      Math.abs(x - tx),
      Math.abs(y - ty),
      Math.abs(x + y - tx - ty)
    );
    if (distance < result) {
      result = distance;
    }
  }
  return Number.isFinite(result) ? result : 0;
}

function scoreCombatVector(vector) {
  const board = vector[0] || [];
  const ownUnits = [];
  const enemyUnits = [];
  const enemyTowns = [];
  let score = 0;

  for (let x = 0; x < board.length; ++x) {
    for (let y = 0; y < (board[x] || []).length; ++y) {
      const cell = board[x][y] || [];
      const unitOwner = cellValue(cell, 1);
      const unitHp = cellValue(cell, 11);
      const unitHpRatio = cellValue(cell, 50);
      if (unitOwner > 0) {
        ownUnits.push(x, y);
        score += unitHp * 20 + unitHpRatio * 100;
      }
      else if (unitOwner < 0) {
        enemyUnits.push(x, y);
        score -= 100000 + unitHp * 10000 + unitHpRatio * 20000;
      }

      if (cellValue(cell, 12) > 0) {
        const townOwner = cellValue(cell, 13);
        const townHp = cellValue(cell, 14);
        if (townOwner > 0) {
          score += 50000 + townHp * 50000;
        }
        else if (townOwner < 0) {
          enemyTowns.push(x, y);
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
  for (let index = 0; index < ownUnits.length; index += 2) {
    score -= nearestDistanceFlat(
      ownUnits[index],
      ownUnits[index + 1],
      immediateTargets
    ) * 5000;
  }

  return score;
}

function finalSymmetricalCombatPredict(model, vectors) {
  return vectors.map((vector) => [scoreCombatVector(vector)]);
}

const runtimeProjectionBucketCache = new Map();

function runtimeProjectionBuckets(width, height) {
  const key = width + 'x' + height;
  const cached = runtimeProjectionBucketCache.get(key);
  if (cached) {
    return cached;
  }
  const buckets = [];
  for (let xBucket = 0; xBucket < 3; xBucket += 1) {
    for (let yBucket = 0; yBucket < 3; yBucket += 1) {
      const xStart = Math.floor(xBucket * width / 3);
      const xEnd = Math.min(
        width,
        Math.max(xStart + 1, Math.floor((xBucket + 1) * width / 3))
      );
      const yStart = Math.floor(yBucket * height / 3);
      const yEnd = Math.min(
        height,
        Math.max(yStart + 1, Math.floor((yBucket + 1) * height / 3))
      );
      buckets.push({
        xStart,
        xEnd,
        yStart,
        yEnd,
        xValue: xBucket / 2,
        yValue: yBucket / 2
      });
    }
  }
  runtimeProjectionBucketCache.set(key, buckets);
  return buckets;
}

function projectRuntimeVectorForCombatModel(vectorizedGrid) {
  const board = vectorizedGrid[0] || [];
  const width = board.length;
  const height = width ? board[0].length : 0;
  const projected = new Array(3 * 3 * 21).fill(0);
  const buckets = runtimeProjectionBuckets(width, height);
  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    const bucket = buckets[bucketIndex];
    const offset = bucketIndex * 21;
    for (let x = bucket.xStart; x < bucket.xEnd; x += 1) {
      for (let y = bucket.yStart; y < bucket.yEnd; y += 1) {
        const cell = board[x][y] || [];
        const unitOwner = Number(cell[1]) || 0;
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
        const townOwner = Number(cell[13]) || 0;
        if (townOwner > 0) {
          projected[offset + 8] += 1;
          projected[offset + 10] += Number(cell[14]) || 0;
        } else if (townOwner < 0) {
          projected[offset + 9] += 1;
          projected[offset + 11] += Number(cell[14]) || 0;
        }
      }
    }
    projected[offset + 14] = bucket.xValue;
    projected[offset + 15] = bucket.yValue;
  }
  return {
    board: projected,
    globalValue: 0
  };
}

function createCheckpointValuePredict(tf, model, stats) {
  const valueOutputIndex = model.outputs.findIndex((output) =>
    output.shape && output.shape.length === 2 && output.shape[1] === 1);
  if (valueOutputIndex === -1) {
    throw new Error('baseline checkpoint does not expose a scalar value output');
  }
  return function checkpointValuePredict(_modelIdentifier, vectors) {
    const boards = [];
    const globals = [];
    for (const vector of vectors) {
      const projected = projectRuntimeVectorForCombatModel(vector);
      boards.push(projected.board);
      globals.push([projected.globalValue]);
    }
    stats.calls += 1;
    stats.positions += vectors.length;
    const boardTensor = tf.tensor4d(
      boards.flat(),
      [boards.length, 3, 3, 21]
    );
    const globalTensor = tf.tensor2d(globals, [globals.length, 1]);
    try {
      const prediction = model.predict([boardTensor, globalTensor]);
      const valueTensor = Array.isArray(prediction)
        ? prediction[valueOutputIndex]
        : prediction;
      const values = Array.from(valueTensor.dataSync());
      if (!stats.modelProbe) {
        stats.modelProbe = values.slice(0, 8);
      }
      if (Array.isArray(prediction)) {
        for (const tensor of prediction) {
          tensor.dispose();
        }
      } else {
        prediction.dispose();
      }
      return values.map((value) => [value]);
    } finally {
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

async function loadBaselineCheckpoint(checkpointPath) {
  const modelPath = path.basename(checkpointPath) === 'model.json'
    ? checkpointPath
    : path.join(checkpointPath, 'model.json');
  if (!fs.existsSync(modelPath)) {
    throw new Error('baseline AIPlayer checkpoint model is missing: ' + modelPath);
  }
  const tf = require('@tensorflow/tfjs-node');
  const model = await tf.loadLayersModel('file://' + modelPath);
  const stats = {
    calls: 0,
    positions: 0,
    modelProbe: null
  };
  return {
    checkpointPath: path.dirname(modelPath),
    modelPath,
    model,
    stats,
    predict: createCheckpointValuePredict(tf, model, stats),
    signature: {
      inputs: model.inputs.map((input) => input.shape),
      outputs: model.outputs.map((output) => ({
        name: output.name,
        shape: output.shape
      }))
    }
  };
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
  options = Object.assign({}, options || {}, { opponent: 'simple' });
  return runFinalSymmetricalCombatGateSeries(options, {
    opponent: 'simple',
    opponentClass: 'SimpleAiPlayer',
    opponentLabel: 'SimpleAiPlayer',
    predictFunction(_modelIdentifier, vectorizedGrids) {
      return finalSymmetricalCombatPredict(_modelIdentifier, vectorizedGrids);
    },
    inferenceSource:
      'final symmetrical combat value model against SimpleAiPlayer'
  });
}

function runFinalSymmetricalCombatGateSeries(options, opponentConfig) {
  options = normalizeOptions(options);
  const api = loadAiScripts();
  const games = [];
  for (let index = 0; index < options.games; ++index) {
    const seed = options.seed + index;
    const aiSide = typeof opponentConfig.candidateSideForGame === 'function'
      ? opponentConfig.candidateSideForGame(index)
      : aiSideForGame(index);
    const gameMap = api.context.generateSymmetricalCombatStageGMap({
      seed,
      suddenDeathRound: options.suddenDeathRound
    });
    const opponentClass = opponentConfig.opponentClass;
    const game = runGame({
      gameMap,
      playerA: aiSide === 'A' ? 'AIPlayer' : opponentClass,
      playerB: aiSide === 'B' ? 'AIPlayer' : opponentClass,
      seed,
      roundLimit: options.roundLimit,
      suddenDeathRound: options.suddenDeathRound,
      actionLimit: options.actionLimit,
      commandLimit: options.commandLimit,
      modelIdentifier: {
        finalSymmetricalCombatValueModel: true,
        checkpoint: options.checkpoint,
        candidateSide: aiSide,
        opponent: opponentConfig.opponent
      },
      inferenceSource: opponentConfig.inferenceSource,
      predictFunction: opponentConfig.predictFunction
    });
    const aiWon = game.winnerSide === aiSide;
    const opponentWon = game.winnerSide && game.winnerSide !== aiSide;
    const draw = !game.winnerSide && !game.crash && !game.timeout && !game.suddenDeath;
    games.push(Object.assign({}, game, {
      seed,
      gameIndex: index,
      aiSide,
      opponentSide: aiSide === 'A' ? 'B' : 'A',
      aiResult: aiWon ? 'win' : (draw ? 'draw' : 'loss'),
      symmetricalMap: true,
      mapStage: gameMap.combatStage,
      mapName: gameMap.testName,
      suddenDeathRound: gameMap.suddenDeathRound,
      modelCheckpoint: options.checkpoint,
      opponent: opponentConfig.opponent,
      opponentLabel: opponentConfig.opponentLabel,
      playerClasses: {
        ai: 'AIPlayer',
        opponent: opponentClass
      },
      classCheck: {
        runtimeAIPlayer: aiSide === 'A' ? game.runtimePlayerA : game.runtimePlayerB,
        runtimeOpponentPlayer: aiSide === 'A' ? game.runtimePlayerB : game.runtimePlayerA
      },
      comparison: {
        artificialAdvantage: false,
        balancedCandidateStarts: opponentConfig.balancedCandidateStarts !== false,
        currentModelSideAConvention: opponentConfig.currentModelSideAConvention === true,
        noAdHocPlayerLogic: true,
        modelDriven: true
      },
      opponentWon
    }));
  }
  const summary = summarizeGames(games, options);
  return {
    config: {
      games: options.games,
      seed: options.seed,
      roundLimit: options.roundLimit,
      suddenDeathRound: options.suddenDeathRound,
      actionLimit: options.actionLimit,
      commandLimit: options.commandLimit,
      minNoLossRate: options.minNoLossRate,
      minWinRate: options.minWinRate,
      modelCheckpoint: options.checkpoint,
      opponent: opponentConfig.opponent,
      opponentLabel: opponentConfig.opponentLabel,
      mapGenerator: 'generateSymmetricalCombatStageGMap',
      playerClasses: {
        ai: 'AIPlayer',
        opponent: opponentConfig.opponentClass
      },
      candidateStarts: {
        A: games.filter((game) => game.aiSide === 'A').length,
        B: games.filter((game) => game.aiSide === 'B').length
      },
      baselineCheckpoint: opponentConfig.baselineCheckpoint || null,
      benchmarkPolicy: opponentConfig.benchmarkPolicy,
      inferenceSource: opponentConfig.inferenceSource
    },
    summary,
    games,
    artifacts: {}
  };
}

async function runFinalSymmetricalCombatGateSuite(options) {
  options = normalizeOptions(options);
  const gates = {};
  if (options.opponent === 'simple' || options.opponent === 'both') {
    gates.simple = runFinalSymmetricalCombatGate(options);
  }
  let baselineCheckpoint = null;
  try {
    if (options.opponent === 'baseline-ai' || options.opponent === 'both') {
      baselineCheckpoint = await loadBaselineCheckpoint(options.baselineCheckpoint);
      gates.baselineAiPlayer = runFinalSymmetricalCombatGateSeries(options, {
        opponent: 'baseline-ai',
        opponentClass: 'AIPlayer',
        opponentLabel: 'baseline AIPlayer',
        candidateSideForGame() {
          return 'A';
        },
        balancedCandidateStarts: false,
        currentModelSideAConvention: true,
        baselineCheckpoint: baselineCheckpoint.checkpointPath,
        benchmarkPolicy:
          'real GameMap runtime with unchanged current AIPlayer on side A using final value model versus unchanged baseline AIPlayer on side B using the saved checkpoint on mirrored symmetrical combat maps',
        inferenceSource:
          'side-routed model output: candidate AIPlayer final value model, baseline AIPlayer checkpoint model',
        predictFunction(modelIdentifier, vectorizedGrids, metadata) {
          if (metadata && metadata.activeSide) {
            const activeIsCandidate = metadata.activeSide === modelIdentifier.candidateSide;
            return activeIsCandidate
              ? finalSymmetricalCombatPredict(modelIdentifier, vectorizedGrids)
              : baselineCheckpoint.predict(modelIdentifier, vectorizedGrids);
          }
          return finalSymmetricalCombatPredict(modelIdentifier, vectorizedGrids);
        }
      });
      gates.baselineAiPlayer.config.baselineCheckpointSignature =
        baselineCheckpoint.signature;
      gates.baselineAiPlayer.config.baselineInferenceStats =
        baselineCheckpoint.stats;
    }
  } finally {
    if (baselineCheckpoint && baselineCheckpoint.model) {
      baselineCheckpoint.model.dispose();
    }
  }

  const summaries = Object.keys(gates).map((name) => gates[name].summary);
  const totalGames = summaries.reduce((total, summary) => total + summary.games, 0);
  const wins = summaries.reduce((total, summary) => total + summary.wins, 0);
  const draws = summaries.reduce((total, summary) => total + summary.draws, 0);
  const losses = summaries.reduce((total, summary) => total + summary.losses, 0);
  const noLosses = wins + draws;
  const summary = {
    games: totalGames,
    requiredGamesPerGate: options.games,
    gates: Object.keys(gates).length,
    wins,
    draws,
    losses,
    noLosses,
    noLossRate: totalGames ? noLosses / totalGames : 0,
    winrate: totalGames ? wins / totalGames : 0,
    minNoLossRate: options.minNoLossRate,
    minWinRate: options.minWinRate,
    gate: summaries.every((summary) => summary.gate === 'passed')
      ? 'passed'
      : 'failed',
    gateReason: summaries.every((summary) => summary.gate === 'passed')
      ? 'AIPlayer met the final symmetrical combat gate thresholds against every required opponent'
      : 'AIPlayer did not meet the final symmetrical combat gate thresholds against every required opponent'
  };

  return {
    config: {
      games: options.games,
      seed: options.seed,
      roundLimit: options.roundLimit,
      suddenDeathRound: options.suddenDeathRound,
      actionLimit: options.actionLimit,
      commandLimit: options.commandLimit,
      minNoLossRate: options.minNoLossRate,
      minWinRate: options.minWinRate,
      modelCheckpoint: options.checkpoint,
      opponent: options.opponent,
      baselineCheckpoint: options.baselineCheckpoint,
      mapGenerator: 'generateSymmetricalCombatStageGMap',
      requiredOpponents: Object.keys(gates),
      benchmarkPolicy:
        'final symmetrical combat gate requires separate SimpleAiPlayer and baseline-AIPlayer runtime series'
    },
    summary,
    gates,
    games: Object.keys(gates).flatMap((name) => gates[name].games),
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
    const result = await runFinalSymmetricalCombatGateSuite(options);
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
  projectRuntimeVectorForCombatModel,
  runFinalSymmetricalCombatGate,
  runFinalSymmetricalCombatGateSeries,
  runFinalSymmetricalCombatGateSuite,
  scoreCombatVector,
  summarizeGames
};
