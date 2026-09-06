#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');
const {
  BENCHMARK_MAPS,
  writeResult
} = require('./benchmarkHarness');

const repoRoot = path.resolve(__dirname, '..');
const MODEL_INFERENCE_BATCH_SIZE = 64;
const SCENARIO_POLICY = 'configured-benchmark-map-v1';

function usage() {
  return [
    'Usage: node ai/benchmark-trained-model.js --checkpoint PATH [options]',
    '',
    'Options:',
    '  --checkpoint PATH      Checkpoint directory or model.json path',
    '  --map NAME             Big benchmark map (default: big-open-field)',
    '  --games NUMBER         Balanced game count, minimum 100 (default: 100)',
    '  --seed NUMBER          First deterministic seed (default: 1)',
    '  --round-limit NUMBER   Maximum nextTurn calls per game (default: 60)',
    '  --min-win-rate NUMBER  Required clean-game win rate (default: 0.8)',
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
  if (options.candidate !== 'AIPlayerWithEconomy' ||
      options.baseline !== 'SimpleAiPlayer') {
    throw new Error(
      'trained benchmark requires unchanged AIPlayerWithEconomy versus SimpleAiPlayer'
    );
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
    inputs: model.inputs.map(input => input.shape),
    outputs: model.outputs.map(output => output.shape)
  };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function repositoryProvenance() {
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim(),
    dirtyStatus: execFileSync('git', ['status', '--short'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim().split('\n').filter(Boolean)
  };
}

async function loadCheckpoint(checkpointArgument) {
  const files = checkpointFiles(checkpointArgument);
  const metadata = JSON.parse(fs.readFileSync(files.metadataPath, 'utf8'));
  const model = await tf.loadLayersModel('file://' + files.modelPath);
  const signature = modelSignature(model);
  if (signature.inputs.length !== 2 ||
      signature.outputs.length !== 1 ||
      signature.outputs[0][1] !== 1) {
    model.dispose();
    throw new Error('checkpoint model signature is incompatible: ' + JSON.stringify(signature));
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
    throw new Error('checkpoint model signature is incompatible: ' + JSON.stringify(signature));
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
      files: {
        model: { path: files.modelPath, sha256: sha256(files.modelPath) },
        metadata: { path: files.metadataPath, sha256: sha256(files.metadataPath) }
      },
      metadata,
      signature,
      predictionProbe: probe,
      repository: repositoryProvenance(),
      sourceFiles: {
        benchmark: sha256(__filename),
        playerPolicy: sha256(path.join(repoRoot, 'ai', 'players.js')),
        modelPolicy: sha256(path.join(repoRoot, 'ai', 'model.js'))
      }
    },
    inference: {
      calls: 0,
      batches: 0,
      positions: 0,
      scoringCalls: 0,
      nonConstantScoringCalls: 0,
      chosenNonFirst: 0,
      scoring: 'runtime-player-predict-hook'
    }
  };
}

function createCanvasContext() {
  return new Proxy({
    canvas: { width: 800, height: 600 },
    measureText(text) {
      return { width: String(text).length * 8 };
    }
  }, {
    get(target, property) {
      return property in target ? target[property] : function() {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
}

function createCanvas() {
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    getContext() {
      return createCanvasContext();
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
  };
}

function createRuntimeContext(seed, predictor, model) {
  const storage = {};
  const seededMath = Object.create(Math);
  let randomState = seed >>> 0;
  seededMath.random = function() {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const context = {
    console: Object.assign({}, console, { log() {} }),
    Math: seededMath,
    Date,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    Map,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    Infinity,
    NaN,
    setTimeout,
    clearTimeout,
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    Image: class Image {},
    navigator: { userAgent: 'node' },
    innerWidth: 800,
    innerHeight: 600,
    document: {
      createElement() { return createCanvas(); },
      getElementById() { return createCanvas(); },
      querySelector() { return createCanvas(); },
      addEventListener() {}
    },
    localStorage: {
      setItem(key, value) { storage[key] = String(value); },
      getItem(key) { return storage[key] || null; },
      removeItem(key) { delete storage[key]; }
    },
    io() { return {}; },
    tf,
    saveAs() {},
    __checkpointModel: model,
    __predictFromCheckpoint: predictor
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadBrowserScripts(context) {
  const html = readRepoFile('index.html');
  const scriptPattern = /<script[^>]+src=['"]([^'"]+)['"]/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const source = match[1];
    if (/^https?:/.test(source)) {
      continue;
    }
    new vm.Script(readRepoFile(source), { filename: source }).runInContext(context);
  }
  new vm.Script(`
    ai_model = __checkpointModel
    predict = function(model, xValidateArr) {
      return __predictFromCheckpoint(model, xValidateArr)
    }
  `, { filename: 'task047-checkpoint-binding.js' }).runInContext(context);
}

function flattenBoardBatch(boards, width, height, channels) {
  const values = new Float32Array(boards.length * width * height * channels);
  let offset = 0;
  for (const board of boards) {
    for (let x = 0; x < width; ++x) {
      for (let y = 0; y < height; ++y) {
        values.set(board[x][y], offset);
        offset += channels;
      }
    }
  }
  return values;
}

function createPredictor(model, stats) {
  const inputShape = model.inputs[0].shape;
  return function predictFromCheckpoint(checkpointModel, vectors) {
    const expectedWidth = inputShape[1];
    const expectedHeight = inputShape[2];
    const expectedChannels = inputShape[3];
    const adaptedBoards = [];
    const globals = [];
    for (const vector of vectors) {
      const board = vector[0];
      const globalValue = Number(vector[1]) || 0;
      const actualWidth = board.length;
      const actualHeight = board[0] ? board[0].length : 0;
      const actualChannels = board[0] && board[0][0] ? board[0][0].length : 0;
      if (actualWidth !== expectedWidth || actualHeight !== expectedHeight ||
          actualChannels !== expectedChannels) {
        throw new Error(
          'checkpoint input must exactly match runtime map vectors: expected ' +
          [expectedWidth, expectedHeight, expectedChannels].join('x') +
          ', received ' + [actualWidth, actualHeight, actualChannels].join('x')
        );
      }
      adaptedBoards.push(board);
      globals.push([globalValue]);
    }
    stats.calls += 1;
    stats.positions += vectors.length;
    const values = [];
    for (let start = 0; start < adaptedBoards.length;
        start += MODEL_INFERENCE_BATCH_SIZE) {
      const end = Math.min(start + MODEL_INFERENCE_BATCH_SIZE, adaptedBoards.length);
      const boardBatch = adaptedBoards.slice(start, end);
      const globalBatch = globals.slice(start, end);
      const boardTensor = tf.tensor4d(
        flattenBoardBatch(
          boardBatch, expectedWidth, expectedHeight, expectedChannels),
        [boardBatch.length, expectedWidth, expectedHeight, expectedChannels]
      );
      const globalTensor = tf.tensor2d(globalBatch, [globalBatch.length, 1]);
      try {
        const prediction = checkpointModel.predict([boardTensor, globalTensor]);
        values.push(...Array.from(prediction.dataSync()));
        prediction.dispose();
        ++stats.batches;
      } finally {
        boardTensor.dispose();
        globalTensor.dispose();
      }
    }
    if (!stats.modelProbe) {
      stats.modelProbe = values.slice(0, MODEL_INFERENCE_BATCH_SIZE);
    }
    if (values.length > 1) {
      ++stats.scoringCalls;
      const firstValue = values[0];
      let maxIndex = 0;
      let isConstant = true;
      for (let index = 1; index < values.length; ++index) {
        if (values[index] !== firstValue) {
          isConstant = false;
        }
        if (values[index] > values[maxIndex]) {
          maxIndex = index;
        }
      }
      if (!isConstant) {
        ++stats.nonConstantScoringCalls;
      }
      if (maxIndex !== 0) {
        ++stats.chosenNonFirst;
      }
    }
    return values.map(score => [score]);
  };
}

function runRuntimeGame(options, loadedCheckpoint, candidateSide, seed) {
  const inferenceBefore = {
    calls: loadedCheckpoint.inference.calls,
    batches: loadedCheckpoint.inference.batches,
    positions: loadedCheckpoint.inference.positions,
    scoringCalls: loadedCheckpoint.inference.scoringCalls,
    nonConstantScoringCalls: loadedCheckpoint.inference.nonConstantScoringCalls,
    chosenNonFirst: loadedCheckpoint.inference.chosenNonFirst
  };
  const predictor = createPredictor(loadedCheckpoint.model, loadedCheckpoint.inference);
  const context = createRuntimeContext(seed, predictor, loadedCheckpoint.model);
  loadBrowserScripts(context);
  context.__task047MapName = options.mapName;
  context.__task047Map = BENCHMARK_MAPS[options.mapName];
  context.__scenarioHash = crypto.createHash('sha256')
    .update(JSON.stringify(context.__task047Map)).digest('hex');
  context.__candidateSide = candidateSide;
  context.__candidateClass = options.candidate;
  context.__baselineClass = options.baseline;
  context.__roundLimit = options.roundLimit;
  const game = new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = true
    gameSettings.isOnline = false
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    statisticsInterface = {}
    gameEvent = {
      nextTurn() {},
      selected: new Empty(),
      hideAll() {},
      removeSelection() { this.selected = new Empty() },
      screen: {moveTo() {}, moveToPlayer() {}, stop() {}}
    }
    nextTurnButton = {
      setNextPlayerColor() {},
      highlightButton: false,
      enableClick() {},
      disableClick() {}
    }
    nextTurnPauseInterface = {visible: false}
    saveManager = {save() {}}
    AiRuntime.trainFromHumanCommands = function() {}
    border = new Border()
    attackBorder = new Border()
    let manager = {
      clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        gameExit = false
      }
    }
    let configured = __task047Map
    let map = new GameMap(
      {x: configured.width, y: configured.height},
      [
        {rgb: {r: 0, g: 0, b: 0}, towns: []},
        {
          rgb: {r: 255, g: 0, b: 0},
          towns: [{x: configured.players[0].town.x, y: configured.players[0].town.y}],
          units: configured.players[0].units.map(function(unit) {
            return {x: unit.x, y: unit.y, type: Noob}
          }),
          playerType: __candidateSide == 'A' ? __candidateClass : __baselineClass
        },
        {
          rgb: {r: 98, g: 168, b: 222},
          towns: [{x: configured.players[1].town.x, y: configured.players[1].town.y}],
          units: configured.players[1].units.map(function(unit) {
            return {x: unit.x, y: unit.y, type: Noob}
          }),
          playerType: __candidateSide == 'B' ? __candidateClass : __baselineClass
        }
      ],
      [],
      [],
      configured.blocked.map(function(coord) { return {x: coord.x, y: coord.y} }),
      [],
      []
    )
    map.suddenDeathRound = configured.suddenDeathRound
    map.start(manager, false)
    suddenDeathRound = map.suddenDeathRound
    whooseTurn = 0

    let turnCount = 0
    let trajectory = []
    while (turnCount < __roundLimit &&
        gameRound < suddenDeathRound &&
        !players[1].isLost && !players[2].isLost) {
      nextTurn()
      ++turnCount
      trajectory.push({
        turnCount,
        gameRound,
        nextPlayer: whooseTurn,
        players: players.slice(1).map(function(player, index) {
          return {
            side: index == 0 ? 'A' : 'B',
            towns: player.towns.filter(function(town) { return !town.killed }).map(
              function(town) { return {x: town.coord.x, y: town.coord.y, hp: town.hp} }),
            units: player.units.filter(function(unit) { return !unit.killed }).map(
              function(unit) {
                return {x: unit.coord.x, y: unit.coord.y, hp: unit.hp, moves: unit.moves}
              })
          }
        })
      })
    }
    let winnerIndex = players[1].isLost ? 2 : (players[2].isLost ? 1 : null)
    let winnerSide = winnerIndex == 1 ? 'A' : (winnerIndex == 2 ? 'B' : null)
    let candidateWon = winnerSide == __candidateSide
    let timeout = winnerIndex == null && turnCount >= __roundLimit
    let suddenDeath = gameRound >= suddenDeathRound
    let nonResult = winnerIndex == null
    let cleanPreSuddenDeathWin = candidateWon && !timeout && !suddenDeath && !nonResult
    let suddenDeathCandidateWin = candidateWon && suddenDeath
    return {
      winner: winnerIndex == null ? null : players[winnerIndex].constructor.name,
      winnerSide,
      roundCount: gameRound,
      turnCount,
      timeout,
      suddenDeath,
      nonResult,
      mapName: __task047MapName,
      playerA: __candidateSide == 'A' ? __candidateClass : __baselineClass,
      playerB: __candidateSide == 'B' ? __candidateClass : __baselineClass,
      runtimePlayerA: players[1].constructor.name,
      runtimePlayerB: players[2].constructor.name,
      seed: ${seed},
      scenarioPolicy: '${SCENARIO_POLICY}',
      scenarioHash: __scenarioHash,
      candidateSide: __candidateSide,
      candidateWon,
      cleanPreSuddenDeathWin,
      suddenDeathCandidateWin,
      thresholdEligibleWin: cleanPreSuddenDeathWin,
      outcomeType: cleanPreSuddenDeathWin
        ? 'clean-pre-sudden-death-candidate-win'
        : (suddenDeathCandidateWin
          ? 'sudden-death-candidate-win'
          : (candidateWon ? 'candidate-win-with-benchmark-flag' : 'candidate-non-win')),
      benchmarkPolicy: 'real GameMap with runtime checkpoint inference versus SimpleAiPlayer',
      terminationReason: winnerIndex == null ?
        (timeout ? 'round-limit-timeout' :
          (suddenDeath ? 'sudden-death-non-result' : 'non-result')) :
        'opponent-eliminated',
      exactClassAssignment:
        players[1].constructor.name ==
          (__candidateSide == 'A' ? 'AIPlayerWithEconomy' : 'SimpleAiPlayer') &&
        players[2].constructor.name ==
          (__candidateSide == 'B' ? 'AIPlayerWithEconomy' : 'SimpleAiPlayer'),
      genuineOpponentElimination: candidateWon &&
        players[__candidateSide == 'A' ? 2 : 1].isLost,
      modelChoiceStats: Object.assign({}, aiModelChoiceStats, {
        minimumTopTwoGap: Number.isFinite(aiModelChoiceStats.minimumTopTwoGap) ?
          aiModelChoiceStats.minimumTopTwoGap : null
      }),
      trajectory,
      players: players.slice(1).map(function(player, index) {
        return {
          side: index == 0 ? 'A' : 'B',
          type: player.constructor.name,
          lost: player.isLost,
          gold: player.gold,
          income: player.income,
          towns: player.towns.filter(function(town) { return !town.killed }).length,
          units: player.units.filter(function(unit) { return !unit.killed }).length
        }
      })
    }
  })()`, { filename: 'task047-runtime-game.js' }).runInContext(context);
  game.gameplayInference = {
    calls: loadedCheckpoint.inference.calls - inferenceBefore.calls,
    batches: loadedCheckpoint.inference.batches - inferenceBefore.batches,
    positions: loadedCheckpoint.inference.positions - inferenceBefore.positions,
    scoringCalls: loadedCheckpoint.inference.scoringCalls - inferenceBefore.scoringCalls,
    nonConstantScoringCalls:
      loadedCheckpoint.inference.nonConstantScoringCalls -
      inferenceBefore.nonConstantScoringCalls,
    chosenNonFirst:
      loadedCheckpoint.inference.chosenNonFirst - inferenceBefore.chosenNonFirst
  };
  game.trajectoryHash = crypto.createHash('sha256')
    .update(JSON.stringify(game.trajectory)).digest('hex');
  return game;
}

function gameSeedAt(options, index) {
  return options.seed + index;
}

function gameCandidateSide(options, index) {
  return index % 2 === 0 ? 'A' : 'B';
}

function runBalancedBenchmark(options, loadedCheckpoint) {
  const games = [];
  const crashes = [];
  const gamesPerSide = options.games / 2;
  for (let index = 0; index < options.games; ++index) {
    const candidateSide = gameCandidateSide(options, index);
    const seed = gameSeedAt(options, index);
    try {
      games.push(runRuntimeGame(
        options,
        loadedCheckpoint,
        candidateSide,
        seed
      ));
    } catch (error) {
      crashes.push({
        seed,
        candidateSide,
        message: error.message,
        stack: error.stack
      });
    }
  }
  return buildBenchmarkReport(options, loadedCheckpoint, games, crashes);
}

function buildBenchmarkReport(options, loadedCheckpoint, games, crashes) {
  const gamesPerSide = options.games / 2;
  const uniqueScenarioCount = new Set(
    games.map(game => game.scenarioHash)).size;
  const uniqueTrajectoryCount = new Set(
    games.map(game => game.trajectoryHash)).size;
  const cleanGames = games.filter(game => game.cleanPreSuddenDeathWin);
  const suddenDeathCandidateWins = games.filter(game => game.suddenDeathCandidateWin);
  const completedGames = games.filter(game => game.winnerSide !== null);
  const candidateWins = completedGames.filter(game => game.candidateWon);
  const distinctSeedCount = new Set(games.map(game => game.seed)).size;
  const seenTrajectories = new Set();
  const duplicateTrajectoryGames = new Set();
  for (const game of games) {
    if (seenTrajectories.has(game.trajectoryHash)) {
      duplicateTrajectoryGames.add(game);
    }
    seenTrajectories.add(game.trajectoryHash);
  }
  const failedGames = games.filter(game =>
    !game.candidateWon ||
    game.timeout ||
    game.suddenDeath ||
    game.nonResult ||
    !game.exactClassAssignment ||
    !game.genuineOpponentElimination ||
    game.gameplayInference.calls === 0 ||
    duplicateTrajectoryGames.has(game)
  );
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
    scenarioPolicy: {
      name: SCENARIO_POLICY,
      mapSource: 'BENCHMARK_MAPS[config.mapName]',
      fairness: 'the configured benchmark map is used without coordinate changes',
      distinctScenarioInputs: uniqueScenarioCount,
      distinctRuntimeTrajectories: uniqueTrajectoryCount
    },
    candidatePolicy: {
      classification: 'trained value model ranks every bounded legal action',
      modelScoredComponents: [
        'turn-state evaluation',
        'unit movement and combat',
        'economy production and placement'
      ],
      deterministicRuntimeComponents: [
        'legal-command generation and execution',
        'normal runtime action and command limits',
        'seeded uniform tie-breaking between exactly equal model maxima'
      ],
      benchmarkOverrides: []
    },
    checkpoint: Object.assign({}, loadedCheckpoint.report, {
      gameplayInference: loadedCheckpoint.inference
    }),
    summary: {
      attemptedGames: options.games,
      completedGames: completedGames.length,
      thresholdEligibleCandidateWins: cleanGames.length,
      cleanPreSuddenDeathCandidateWins: cleanGames.length,
      cleanCandidateWins: cleanGames.length,
      candidateWins: candidateWins.length,
      candidateWinsIncludingSuddenDeath: candidateWins.length,
      suddenDeathCandidateWins: suddenDeathCandidateWins.length,
      candidateWinRate: options.games ? cleanGames.length / options.games : 0,
      cleanCandidateWinRate: options.games ? cleanGames.length / options.games : 0,
      candidateWinRateIncludingSuddenDeath: options.games ?
        candidateWins.length / options.games :
        0,
      candidateStarts: {
        A: gamesPerSide,
        B: gamesPerSide
      },
      timeouts: games.filter(game => game.timeout).length,
      suddenDeathGames: games.filter(game => game.suddenDeath).length,
      nonResults: games.filter(game => game.nonResult).length,
      crashes: crashes.length,
      nonWins: failedGames.length + crashes.length,
      runtimeGamesExecuted: games.length,
      distinctSeedCount,
      uniqueScenarioCount,
      uniqueTrajectoryCount,
      repeatedTrajectoryGames: games.length - uniqueTrajectoryCount
    },
    failedSeeds: failedGames.map(game => game.seed).concat(crashes.map(crash => crash.seed)),
    failedGames,
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
    if (result.summary.completedGames < options.games) {
      throw new Error('fewer than requested games completed');
    }
    if (result.summary.uniqueScenarioCount !== 1 ||
        result.summary.distinctSeedCount !== options.games ||
        result.summary.uniqueTrajectoryCount !== options.games) {
      throw new Error(
        'the configured map must remain fixed and every requested seed must execute ' +
        'an independently varying runtime trajectory'
      );
    }
    if (result.summary.candidateWinRate < options.minWinRate ||
        result.summary.nonWins > 0) {
      console.error(
        'Clean candidate win rate ' + result.summary.candidateWinRate.toFixed(3) +
        ' did not meet threshold ' + options.minWinRate.toFixed(3) +
        ' or non-wins were reported'
      );
      process.exitCode = 1;
    }
  } finally {
    checkpoint.model.dispose();
  }
}

if (require.main === module) {
  main().catch(function(error) {
    console.error(error.message);
    process.exitCode = 2;
  });
}

module.exports = {
  buildBenchmarkReport,
  createPredictor,
  flattenBoardBatch,
  loadCheckpoint,
  parseArgs,
  runBalancedBenchmark,
  runRuntimeGame
};
