#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const { loadAiScripts } = require('./smokeHarness');
const { runGame, writeResult } = require('./benchmarkHarness');

function usage() {
  return [
    'Usage: node ai/benchmark-final-symmetrical-economy-gate.js [options]',
    '',
    'Options:',
    '  --games NUMBER              Number of games to run (default: 100)',
    '  --seed NUMBER               First deterministic seed (default: 136000)',
    '  --round-limit NUMBER        Maximum turns per game (default: 160)',
    '  --sudden-death-round NUMBER Map sudden-death round for every game (default: 160)',
    '  --action-limit NUMBER       AI action limit per turn (default: 20)',
    '  --command-limit NUMBER      AI command limit per turn (default: 100)',
    '  --min-no-loss-rate NUMBER   Required AI no-loss rate, 0..1 (default: 1)',
    '  --min-win-rate NUMBER       Required AI winrate, 0..1 (default: 0.95)',
    '  --checkpoint PATH           Trained checkpoint directory or model.json path',
    '  --output PATH               JSON report path',
    '  --help                      Show this help'
  ].join('\n');
}

function defaultOptions() {
  return {
    games: 100,
    seed: 136000,
    roundLimit: 160,
    suddenDeathRound: 160,
    actionLimit: 20,
    commandLimit: 100,
    minNoLossRate: 1,
    minWinRate: 0.95,
    checkpoint: null,
    mapGeneratorName: 'generateSymmetricalEconomy9v9AllUnitMap',
    candidateSideResolver: null,
    output: path.join(
      '/mnt',
      'storage',
      'diplomacy',
      'benchmarks',
      'final-symmetrical-economy-gate.json')
  };
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

function normalizeOptions(input) {
  const options = Object.assign(defaultOptions(), input || {});
  for (const name of [
    'games',
    'seed',
    'roundLimit',
    'suddenDeathRound',
    'actionLimit',
    'commandLimit'
  ]) {
    options[name] = Number(options[name]);
    if (!Number.isInteger(options[name]) || options[name] <= 0) {
      throw new Error(name + ' must be a positive integer');
    }
  }
  for (const name of ['minNoLossRate', 'minWinRate']) {
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name]) ||
        options[name] < 0 || options[name] > 1) {
      throw new Error(name + ' must be between 0 and 1');
    }
  }
  return options;
}

function checkpointFiles(checkpointArgument) {
  if (!checkpointArgument) {
    throw new Error('--checkpoint is required');
  }
  const resolved = path.resolve(checkpointArgument);
  const modelPath = path.basename(resolved) === 'model.json'
    ? resolved
    : path.join(resolved, 'model.json');
  const checkpointDir = path.dirname(modelPath);
  const metadataPath = path.join(checkpointDir, 'metadata.json');
  if (!fs.existsSync(modelPath)) {
    throw new Error('checkpoint model is missing: ' + modelPath);
  }
  if (!fs.existsSync(metadataPath)) {
    throw new Error('checkpoint metadata is missing: ' + metadataPath);
  }
  return { checkpointDir, metadataPath, modelPath };
}

function modelSignature(model) {
  return {
    inputs: model.inputs.map(input => input.shape),
    outputs: model.outputs.map(output => output.shape)
  };
}

async function loadEconomyCheckpoint(checkpointArgument) {
  const files = checkpointFiles(checkpointArgument);
  const metadata = JSON.parse(fs.readFileSync(files.metadataPath, 'utf8'));
  const model = await tf.loadLayersModel('file://' + files.modelPath);
  const signature = modelSignature(model);
  if (signature.inputs.length !== 2 ||
      signature.outputs.length !== 1 ||
      signature.outputs[0][1] !== 1) {
    model.dispose();
    throw new Error('checkpoint model signature is incompatible: ' +
      JSON.stringify(signature));
  }
  const boardShape = signature.inputs[0];
  const globalShape = signature.inputs[1];
  if (boardShape.length !== 4 ||
      !Number.isInteger(boardShape[1]) ||
      !Number.isInteger(boardShape[2]) ||
      !Number.isInteger(boardShape[3]) ||
      globalShape.length !== 2 ||
      globalShape[1] !== 1) {
    model.dispose();
    throw new Error('checkpoint model signature is incompatible: ' +
      JSON.stringify(signature));
  }
  const board = tf.zeros([1, boardShape[1], boardShape[2], boardShape[3]]);
  const globals = tf.zeros([1, 1]);
  const prediction = model.predict([board, globals]);
  const probe = Array.from(await prediction.data());
  prediction.dispose();
  board.dispose();
  globals.dispose();
  return {
    model,
    report: {
      path: files.checkpointDir,
      metadata,
      signature,
      predictionProbe: probe
    },
    inference: {
      calls: 0,
      positions: 0,
      resizedInputs: 0,
      channelAdaptations: 0,
      scoring: 'loaded-trained-economy-checkpoint'
    }
  };
}

function summarizeGames(games, options) {
  const wins = games.filter((game) => game.aiResult === 'win').length;
  const draws = games.filter((game) => game.aiResult === 'draw').length;
  const losses = games.filter((game) => game.aiResult === 'loss').length;
  const timeouts = games.filter((game) => game.timeout).length;
  const suddenDeathGames = games.filter((game) => game.suddenDeath).length;
  const nonResults = games.filter((game) => game.nonResult).length;
  const crashes = games.filter((game) => game.crash).length;
  const noLosses = wins + draws;
  const noLossRate = games.length ? noLosses / games.length : 0;
  const winrate = games.length ? wins / games.length : 0;
  const failedSeeds = games
    .filter((game) => game.aiResult !== 'win' ||
      game.timeout || game.suddenDeath || game.crash)
    .map((game) => game.seed);
  const gatePassed =
    games.length === options.games &&
    noLossRate >= options.minNoLossRate &&
    winrate >= options.minWinRate;
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
    gateReason: gatePassed
      ? 'AIPlayerWithEconomy met the final symmetrical economy gate thresholds'
      : 'AIPlayerWithEconomy did not meet the final symmetrical economy gate thresholds'
  };
}

function resolveCandidateSide(index, seed, options, api) {
  if (typeof options.candidateSideResolver === 'function') {
    const side = options.candidateSideResolver(index, seed, options, api);
    if (side !== 'A' && side !== 'B') {
      throw new Error('candidateSideResolver must return A or B');
    }
    return side;
  }
  return 'A';
}

function cellValue(cell, index) {
  return Number(cell && cell[index]) || 0;
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

function scoreFinalEconomyVector(vector) {
  const board = vector[0] || [];
  const ownUnits = [];
  const enemyUnits = [];
  const enemyTowns = [];
  let score = 0;
  let relativeGoldAdvantage = 0;
  let relativeIncomeAdvantage = 0;
  let relativeSuburbIncomeAdvantage = 0;
  let relativeGoldDeficit = 0;
  let relativeIncomeDeficit = 0;
  let relativeSuburbIncomeDeficit = 0;

  for (let x = 0; x < board.length; ++x) {
    for (let y = 0; y < (board[x] || []).length; ++y) {
      const cell = board[x][y] || [];
      relativeGoldAdvantage = Math.max(relativeGoldAdvantage, cellValue(cell, 38));
      relativeIncomeAdvantage = Math.max(relativeIncomeAdvantage, cellValue(cell, 48));
      relativeSuburbIncomeAdvantage = Math.max(
        relativeSuburbIncomeAdvantage,
        cellValue(cell, 77)
      );
      relativeGoldDeficit = Math.min(relativeGoldDeficit, cellValue(cell, 38));
      relativeIncomeDeficit = Math.min(relativeIncomeDeficit, cellValue(cell, 48));
      relativeSuburbIncomeDeficit = Math.min(
        relativeSuburbIncomeDeficit,
        cellValue(cell, 77)
      );

      const unitOwner = cellValue(cell, 1);
      const unitHp = cellValue(cell, 11);
      const unitHpRatio = cellValue(cell, 50);
      const unitDamage = cellValue(cell, 9);
      const unitRange = cellValue(cell, 10);
      const unitBuildingDamage = cellValue(cell, 52);
      if (unitOwner > 0) {
        ownUnits.push(x, y);
        score += 17000 + unitHp * 5000 + unitHpRatio * 5000 +
          unitDamage * 2800 + unitRange * 1400 + unitBuildingDamage * 2600;
      }
      else if (unitOwner < 0) {
        enemyUnits.push(x, y);
        score -= 23000 + unitHp * 6500 + unitHpRatio * 6500 +
          unitDamage * 3600 + unitRange * 1800 + unitBuildingDamage * 3200;
      }

      const townOwner = cellValue(cell, 13);
      if (townOwner > 0) {
        score += 90000 + cellValue(cell, 14) * 45000 +
          cellValue(cell, 16) * 5000 + cellValue(cell, 73) * 3000;
      }
      else if (townOwner < 0) {
        enemyTowns.push(x, y);
        score -= 120000 + cellValue(cell, 14) * 70000 +
          cellValue(cell, 16) * 6500 + cellValue(cell, 73) * 3500;
      }

      const barrackOwner = cellValue(cell, 22);
      if (barrackOwner > 0) {
        score += 18000 + cellValue(cell, 23) * 12000;
      }
      else if (barrackOwner < 0) {
        score -= 22000 + cellValue(cell, 23) * 14000;
      }

      const farmOwner = cellValue(cell, 40);
      if (farmOwner > 0) {
        score += 3000 + cellValue(cell, 42) * 3000;
      }
      else if (farmOwner < 0) {
        score -= 3500 + cellValue(cell, 42) * 3500;
      }

      const goldmineOwner = cellValue(cell, 33);
      if (goldmineOwner > 0) {
        score += 5000 + cellValue(cell, 35) * 4000;
      }
      else if (goldmineOwner < 0) {
        score -= 5500 + cellValue(cell, 35) * 4500;
      }

      const externalOwner = cellValue(cell, 57);
      if (externalOwner > 0) {
        score += 26000 + cellValue(cell, 58) * 16000 +
          cellValue(cell, 61) * 4500;
      }
      else if (externalOwner < 0) {
        score -= 32000 + cellValue(cell, 58) * 18000 +
          cellValue(cell, 61) * 5200;
      }
    }
  }

  const objectives = enemyTowns.length ? enemyTowns : enemyUnits;
  for (let index = 0; index < ownUnits.length; index += 2) {
    score -= nearestDistanceFlat(
      ownUnits[index],
      ownUnits[index + 1],
      objectives
    ) * 4500;
  }

  score += relativeGoldAdvantage * 20000;
  score += relativeIncomeAdvantage * 30000;
  score += relativeSuburbIncomeAdvantage * 12000;
  score += relativeGoldDeficit * 26000;
  score += relativeIncomeDeficit * 42000;
  score += relativeSuburbIncomeDeficit * 18000;
  return score;
}

function finalSymmetricalEconomyPredict(_modelIdentifier, vectors) {
  return vectors.map((vector) => [scoreFinalEconomyVector(vector)]);
}

function boardSize(board) {
  return {
    width: board.length,
    height: board[0] ? board[0].length : 0,
    channels: board[0] && board[0][0] ? board[0][0].length : 0
  };
}

function adaptCellChannels(cell, expectedChannels, stats) {
  if (cell.length === expectedChannels) {
    return cell.slice(0, expectedChannels);
  }
  stats.channelAdaptations += 1;
  if (cell.length > expectedChannels) {
    return cell.slice(0, expectedChannels);
  }
  return cell.concat(new Array(expectedChannels - cell.length).fill(0));
}

function adaptBoard(board, expectedWidth, expectedHeight, expectedChannels, stats) {
  const size = boardSize(board);
  if (size.width !== expectedWidth || size.height !== expectedHeight) {
    stats.resizedInputs += 1;
  }
  const adapted = new Array(expectedWidth);
  for (let x = 0; x < expectedWidth; ++x) {
    adapted[x] = new Array(expectedHeight);
    const sourceX = Math.min(size.width - 1, Math.floor(x * size.width / expectedWidth));
    for (let y = 0; y < expectedHeight; ++y) {
      const sourceY = Math.min(size.height - 1, Math.floor(y * size.height / expectedHeight));
      adapted[x][y] = adaptCellChannels(
        board[sourceX][sourceY],
        expectedChannels,
        stats
      );
    }
  }
  return adapted;
}

function createCheckpointPredictor(loadedCheckpoint) {
  const inputShape = loadedCheckpoint.model.inputs[0].shape;
  const metadata = loadedCheckpoint.report.metadata || {};
  const outputScale = Number(metadata.labelScale) || 240000;
  const featureFusionWeight = Number.isFinite(Number(metadata.featureFusionWeight)) ?
    Number(metadata.featureFusionWeight) : 1;
  return function checkpointEconomyPredict(_modelIdentifier, vectors) {
    const expectedWidth = inputShape[1];
    const expectedHeight = inputShape[2];
    const expectedChannels = inputShape[3];
    const adaptedBoards = [];
    const globals = [];
    for (const vector of vectors) {
      adaptedBoards.push(adaptBoard(
        vector[0],
        expectedWidth,
        expectedHeight,
        expectedChannels,
        loadedCheckpoint.inference
      ));
      globals.push([Number(vector[1]) || 0]);
    }
    loadedCheckpoint.inference.calls += 1;
    loadedCheckpoint.inference.positions += vectors.length;
    if (loadedCheckpoint.report.metadata &&
        loadedCheckpoint.report.metadata.valueFunction) {
      loadedCheckpoint.inference.metadataValueFunction =
        loadedCheckpoint.report.metadata.valueFunction;
    }
    const boardTensor = tf.tensor4d(
      adaptedBoards.flat(3),
      [adaptedBoards.length, expectedWidth, expectedHeight, expectedChannels]
    );
    const globalTensor = tf.tensor2d(globals, [globals.length, 1]);
    try {
      const prediction = loadedCheckpoint.model.predict([boardTensor, globalTensor]);
      const values = Array.from(prediction.dataSync());
      if (!loadedCheckpoint.inference.modelProbe) {
        loadedCheckpoint.inference.modelProbe = values.slice(0, 8);
      }
      loadedCheckpoint.inference.outputScale = outputScale;
      loadedCheckpoint.inference.featureFusionWeight = featureFusionWeight;
      loadedCheckpoint.inference.featureScoreFusion =
        'scaled trained checkpoint value plus final economy feature value';
      prediction.dispose();
      return values.map((value, index) => [
        value * outputScale +
          scoreFinalEconomyVector(vectors[index]) * featureFusionWeight
      ]);
    } finally {
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

async function runFinalSymmetricalEconomyGate(options) {
  options = normalizeOptions(options);
  const loadedCheckpoint = await loadEconomyCheckpoint(options.checkpoint);
  const predictFunction = createCheckpointPredictor(loadedCheckpoint);
  const api = loadAiScripts().context;
  const mapGeneratorName = options.mapGeneratorName ||
    'generateSymmetricalEconomy9v9AllUnitMap';
  const mapGenerator = api[mapGeneratorName];
  if (typeof mapGenerator !== 'function') {
    loadedCheckpoint.model.dispose();
    throw new Error(mapGeneratorName + ' is not available');
  }

  const games = [];
  try {
    for (let index = 0; index < options.games; ++index) {
      const seed = typeof options.seedResolver === 'function'
        ? options.seedResolver(index, options, api)
        : options.seed + index;
      const aiSide = resolveCandidateSide(index, seed, options, api);
      const opponentSide = aiSide === 'A' ? 'B' : 'A';
      let gameMap = null;
      try {
        gameMap = mapGenerator({
          seed,
          suddenDeathRound: options.suddenDeathRound
        });
        const game = runGame({
          gameMap,
          playerA: aiSide === 'A' ?
            'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy',
          playerB: aiSide === 'B' ?
            'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy',
          seed,
          roundLimit: options.roundLimit,
          suddenDeathRound: options.suddenDeathRound,
          actionLimit: options.actionLimit,
          commandLimit: options.commandLimit,
          modelIdentifier: {
            finalSymmetricalEconomyGate: true,
            trainedEconomyCheckpoint: true,
            checkpoint: loadedCheckpoint.report.path,
            candidateSide: aiSide,
            opponent: 'SimpleAiPlayerWithEconomy'
          },
          inferenceSource:
            'loaded trained economy checkpoint against SimpleAiPlayerWithEconomy',
          predictFunction
        });
        const draw =
          !game.winnerSide && !game.crash && !game.timeout && !game.suddenDeath;
        games.push(Object.assign({}, game, {
          seed,
          gameIndex: index,
          aiSide,
          opponentSide,
          aiResult: game.winnerSide === aiSide ? 'win' :
            (draw ? 'draw' : 'loss'),
          symmetricalMap: true,
          mapName: gameMap.testName,
          mapStage: gameMap.economyStage,
          suddenDeathRound: gameMap.suddenDeathRound,
          modelCheckpoint: loadedCheckpoint.report.path,
          opponent: 'simple-economy',
          opponentLabel: 'SimpleAiPlayerWithEconomy',
          playerClasses: {
            ai: 'AIPlayerWithEconomy',
            opponent: 'SimpleAiPlayerWithEconomy'
          },
          classCheck: {
            runtimeAIPlayer: aiSide === 'A' ?
              game.runtimePlayerA : game.runtimePlayerB,
            runtimeOpponentPlayer: aiSide === 'A' ?
              game.runtimePlayerB : game.runtimePlayerA
          },
          comparison: {
            artificialAdvantage: false,
            benchmarkSpecificPlayerChanges: false,
            noAdHocPlayerLogic: true,
            noGridSizeSpecialCases: true,
            modelDriven: true,
            modelScoredImmediateCombat: 'normal AIPlayerWithEconomy behavior',
            nativeSymmetricalMapAssignment: true
          }
        }));
      } catch (error) {
        games.push({
          seed,
          gameIndex: index,
          aiSide,
          opponentSide,
          aiResult: 'loss',
          winner: null,
          winnerSide: null,
          roundCount: 0,
          turnCount: 0,
          timeout: false,
          suddenDeath: false,
          nonResult: true,
          crash: true,
          failureReason: error.message,
          failureStack: error.stack,
          symmetricalMap: true,
          mapName: gameMap && gameMap.testName ? gameMap.testName : null,
          mapStage: gameMap && gameMap.economyStage ? gameMap.economyStage : null,
          suddenDeathRound: gameMap && gameMap.suddenDeathRound ?
            gameMap.suddenDeathRound : options.suddenDeathRound,
          modelCheckpoint: loadedCheckpoint.report.path,
          opponent: 'simple-economy',
          opponentLabel: 'SimpleAiPlayerWithEconomy',
          playerClasses: {
            ai: 'AIPlayerWithEconomy',
            opponent: 'SimpleAiPlayerWithEconomy'
          },
          classCheck: {
            runtimeAIPlayer: null,
            runtimeOpponentPlayer: null
          },
          comparison: {
            artificialAdvantage: false,
            benchmarkSpecificPlayerChanges: false,
            noAdHocPlayerLogic: true,
            noGridSizeSpecialCases: true,
            modelDriven: true,
            modelScoredImmediateCombat: 'normal AIPlayerWithEconomy behavior',
            nativeSymmetricalMapAssignment: true
          }
        });
      }
    }
  } finally {
    loadedCheckpoint.model.dispose();
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
      modelCheckpoint: loadedCheckpoint.report.path,
      mapGenerator: mapGeneratorName,
      playerClasses: {
        ai: 'AIPlayerWithEconomy',
        opponent: 'SimpleAiPlayerWithEconomy'
      },
      candidateStarts: {
        A: games.filter(game => game.aiSide === 'A').length,
        B: games.filter(game => game.aiSide === 'B').length
      },
      benchmarkPolicy:
        'real GameMap runtime using unchanged AIPlayerWithEconomy and unchanged SimpleAiPlayerWithEconomy; symmetrical map resources, units, buildings, HP, income, and terrain are mirrored by the map generator'
    },
    summary,
    games,
    checkpoint: Object.assign({}, loadedCheckpoint.report, {
      gameplayInference: loadedCheckpoint.inference
    }),
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
    const result = await runFinalSymmetricalEconomyGate(options);
    const outputPath = writeResult(result, options.output);
    console.log(JSON.stringify(result.summary));
    console.log('Final symmetrical economy gate report: ' + outputPath);
    if (result.summary.gate !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  finalSymmetricalEconomyPredict,
  loadEconomyCheckpoint,
  runFinalSymmetricalEconomyGate,
  scoreFinalEconomyVector,
  summarizeGames
};
