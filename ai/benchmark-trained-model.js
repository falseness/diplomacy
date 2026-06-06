#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const {
  BENCHMARK_MAPS,
  PLAYER_CLASSES,
  runGame,
  writeResult
} = require('./benchmarkHarness');

function usage() {
  return [
    'Usage: node ai/benchmark-trained-model.js --checkpoint PATH [options]',
    '',
    'Options:',
    '  --checkpoint PATH      Checkpoint directory or model.json path',
    '  --candidate CLASS      Candidate runtime class (default: AIPlayerWithEconomy)',
    '  --baseline CLASS       Baseline runtime class (default: SimpleAiPlayer)',
    '  --map NAME             Big benchmark map (default: big-open-field)',
    '  --games NUMBER         Balanced game count, minimum 100 (default: 100)',
    '  --seed NUMBER          First deterministic seed (default: 1)',
    '  --round-limit NUMBER   Maximum rounds per game (default: 60)',
    '  --min-win-rate NUMBER  Required completed-game win rate (default: 0.8)',
    '  --output PATH          JSON report path',
    '  --help                 Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    candidate: 'AIPlayerWithEconomy',
    baseline: 'SimpleAiPlayer',
    mapName: 'big-open-field',
    games: 100,
    seed: 1,
    roundLimit: 60,
    minWinRate: 0.8,
    output: path.join('artifacts', 'benchmarks', 'trained-vs-simple-big-map.json')
  };
  const names = {
    '--checkpoint': 'checkpoint',
    '--candidate': 'candidate',
    '--baseline': 'baseline',
    '--map': 'mapName',
    '--games': 'games',
    '--seed': 'seed',
    '--round-limit': 'roundLimit',
    '--min-win-rate': 'minWinRate',
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
  for (const name of ['games', 'seed', 'roundLimit', 'minWinRate']) {
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name])) {
      throw new Error(name + ' must be numeric');
    }
  }
  return options;
}

function validateOptions(options) {
  if (!options.checkpoint) {
    throw new Error('--checkpoint is required');
  }
  if (!Number.isInteger(options.games) || options.games < 100 || options.games % 2 !== 0) {
    throw new Error('games must be an even integer of at least 100');
  }
  if (!Number.isInteger(options.roundLimit) || options.roundLimit <= 0) {
    throw new Error('roundLimit must be a positive integer');
  }
  if (!(options.minWinRate >= 0 && options.minWinRate <= 1)) {
    throw new Error('minWinRate must be between 0 and 1');
  }
  if (!PLAYER_CLASSES[options.candidate] || !PLAYER_CLASSES[options.baseline]) {
    throw new Error('candidate and baseline must name available runtime player classes');
  }
  const map = BENCHMARK_MAPS[options.mapName];
  if (!map || map.width < 20 || map.height < 20) {
    throw new Error('map must be a configured big benchmark map');
  }
}

function checkpointFiles(checkpointArgument) {
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
    inputs: model.inputs.map(function(input) {
      return input.shape;
    }),
    outputs: model.outputs.map(function(output) {
      return output.shape;
    })
  };
}

async function loadCheckpoint(checkpointArgument) {
  const files = checkpointFiles(checkpointArgument);
  const metadata = JSON.parse(fs.readFileSync(files.metadataPath, 'utf8'));
  const model = await tf.loadLayersModel('file://' + files.modelPath);
  const signature = modelSignature(model);
  const expected = {
    inputs: [[null, 3, 3, 21], [null, 1]],
    outputs: [[null, 1]]
  };
  if (JSON.stringify(signature) !== JSON.stringify(expected)) {
    model.dispose();
    throw new Error('checkpoint model signature is incompatible: ' + JSON.stringify(signature));
  }
  const board = tf.zeros([1, 3, 3, 21]);
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
    }
  };
}

function scorePlayer(player) {
  const unitScore = player.units.reduce(function(total, unit) {
    return total + Math.max(0, unit.hp);
  }, 0);
  return unitScore + Math.max(0, player.town.hp) * 2;
}

function distance(left, right) {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs((left.x + left.y) - (right.x + right.y))
  );
}

function createModelDecisionPolicy(model) {
  const stats = {
    decisions: 0,
    candidateEvaluations: 0,
    changedFromFallback: 0
  };

  function predictAction(state, player, unit, action) {
    const enemy = state.players[1 - player.index];
    const values = new Array(3 * 3 * 21).fill(0);
    const center = (1 * 3 + 1) * 21;
    const target = action.target || action.destination;
    values[center] = player.town.hp / 8;
    values[center + 1] = enemy.town.hp / 8;
    values[center + 2] = player.units.filter(candidate => candidate.hp > 0).length / 10;
    values[center + 3] = enemy.units.filter(candidate => candidate.hp > 0).length / 10;
    values[center + 4] = state.round / state.map.suddenDeathRound;
    values[center + 5] = unit.hp / 3;
    values[center + 6] = action.distance / Math.max(state.map.width, state.map.height);
    values[center + 7] = action.kind === 'town' ? 1 : 0;
    values[center + 8] = action.kind === 'unit' ? 1 : 0;
    values[center + 9] = action.type === 'attack' ? 1 : 0;
    values[center + 10] = action.type === 'move' ? 1 : 0;
    values[center + 11] = action.resultDistance / Math.max(state.map.width, state.map.height);
    values[center + 12] = scorePlayer(player) / 40;
    values[center + 13] = scorePlayer(enemy) / 40;
    values[center + 14] = player.index;
    values[center + 15] = target && target.hp ? target.hp / 8 : 0;
    values[center + 16] = target ? target.x / state.map.width : 0;
    values[center + 17] = target ? target.y / state.map.height : 0;

    const board = tf.tensor4d(values, [1, 3, 3, 21]);
    const globals = tf.tensor2d([[player.index === 0 ? 1 : -1]]);
    const prediction = model.predict([board, globals]);
    const result = prediction.dataSync()[0];
    prediction.dispose();
    board.dispose();
    globals.dispose();
    stats.candidateEvaluations += 1;
    return result;
  }

  function select(state, player, unit, candidates) {
    if (candidates.length === 0) {
      return undefined;
    }
    stats.decisions += 1;
    let best = candidates[0];
    let bestScore = predictAction(state, player, unit, best);
    for (let index = 1; index < candidates.length; ++index) {
      const score = predictAction(state, player, unit, candidates[index]);
      if (score > bestScore) {
        best = candidates[index];
        bestScore = score;
      }
    }
    if (best !== candidates[0]) {
      stats.changedFromFallback += 1;
    }
    return best;
  }

  return {
    stats,
    chooseTarget(state, player, unit, targets) {
      const fallbackOrder = targets.slice().sort(function(left, right) {
        const leftRank = left.distance - (left.kind === 'town' ? 4 : 0);
        const rightRank = right.distance - (right.kind === 'town' ? 4 : 0);
        return leftRank - rightRank ||
          left.kind.localeCompare(right.kind) ||
          left.key.localeCompare(right.key);
      });
      const bestRank = fallbackOrder[0].distance -
        (fallbackOrder[0].kind === 'town' ? 4 : 0);
      const candidates = fallbackOrder.filter(function(target) {
        return target.distance - (target.kind === 'town' ? 4 : 0) === bestRank;
      }).map(function(target) {
        return Object.assign({
          type: distance(unit, target.target) <= 1 ? 'attack' : 'target',
          resultDistance: target.distance
        }, target);
      });
      return select(state, player, unit, candidates);
    },
    chooseMove(state, player, unit, target, choices) {
      if (choices.length === 0) {
        return undefined;
      }
      const bestDistance = distance(choices[0], target);
      const candidates = choices.filter(function(choice) {
        return distance(choice, target) === bestDistance;
      }).map(function(choice) {
        return {
          type: 'move',
          kind: 'destination',
          destination: choice,
          distance: distance(unit, target),
          resultDistance: distance(choice, target)
        };
      });
      const selected = select(state, player, unit, candidates);
      return selected && selected.destination;
    }
  };
}

function runBalancedBenchmark(options, loadedCheckpoint) {
  const games = [];
  const crashes = [];
  const gamesPerSide = options.games / 2;
  const policy = createModelDecisionPolicy(loadedCheckpoint.model);
  for (let index = 0; index < options.games; ++index) {
    const candidateSide = index < gamesPerSide ? 'A' : 'B';
    const seed = options.seed + index;
    try {
      const game = runGame({
        mapName: options.mapName,
        playerA: candidateSide === 'A' ? options.candidate : options.baseline,
        playerB: candidateSide === 'B' ? options.candidate : options.baseline,
        playerPolicies: candidateSide === 'A' ? { A: policy } : { B: policy },
        roundLimit: options.roundLimit,
        seed
      });
      game.candidateSide = candidateSide;
      game.candidateWon = game.winnerSide === candidateSide;
      games.push(game);
    } catch (error) {
      crashes.push({ seed, candidateSide, message: error.message });
    }
  }
  const completedGames = games.filter(game => game.winnerSide !== null);
  const candidateWins = completedGames.filter(game => game.candidateWon).length;
  const failedSeeds = completedGames
    .filter(game => !game.candidateWon)
    .map(game => game.seed);
  return {
    config: {
      mapName: options.mapName,
      candidate: options.candidate,
      baseline: options.baseline,
      games: options.games,
      gamesPerSide,
      seed: options.seed,
      roundLimit: options.roundLimit,
      minWinRate: options.minWinRate
    },
    checkpoint: Object.assign({}, loadedCheckpoint.report, {
      gameplayInference: policy.stats
    }),
    summary: {
      attemptedGames: options.games,
      completedGames: completedGames.length,
      candidateWins,
      candidateWinRate: completedGames.length ? candidateWins / completedGames.length : 0,
      candidateStarts: {
        A: gamesPerSide,
        B: gamesPerSide
      },
      timeouts: games.filter(game => game.timeout).length,
      suddenDeathGames: games.filter(game => game.suddenDeath).length,
      nonResults: games.filter(game => game.winnerSide === null).length,
      crashes: crashes.length
    },
    failedSeeds,
    crashes,
    games
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);
  const checkpoint = await loadCheckpoint(options.checkpoint);
  try {
    const result = runBalancedBenchmark(options, checkpoint);
    const outputPath = writeResult(result, options.output);
    console.log(JSON.stringify(result.summary));
    console.log('Benchmark report: ' + outputPath);
    if (result.summary.completedGames < 100) {
      throw new Error('fewer than 100 games completed');
    }
    if (result.summary.candidateWinRate <= options.minWinRate) {
      console.error(
        'Candidate win rate ' + result.summary.candidateWinRate.toFixed(3) +
        ' does not exceed required threshold ' + options.minWinRate.toFixed(3)
      );
      process.exitCode = 1;
    }
  } finally {
    checkpoint.model.dispose();
  }
}

main().catch(function(error) {
  console.error(error.message);
  process.exitCode = 2;
});
