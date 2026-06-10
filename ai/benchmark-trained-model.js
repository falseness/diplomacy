#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs-node');
const {
  BENCHMARK_MAPS,
  PLAYER_CLASSES,
  writeResult
} = require('./benchmarkHarness');

const repoRoot = path.resolve(__dirname, '..');

function usage() {
  return [
    'Usage: node ai/benchmark-trained-model.js --checkpoint PATH [options]',
    '',
    'Options:',
    '  --checkpoint PATH      Checkpoint directory or model.json path',
    '  --candidate CLASS      Candidate runtime class (default: AIPlayer)',
    '  --baseline CLASS       Baseline runtime class (default: SimpleAiPlayer)',
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
    candidate: 'AIPlayer',
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
    inputs: model.inputs.map(input => input.shape),
    outputs: model.outputs.map(output => output.shape)
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
      metadata,
      signature,
      predictionProbe: probe
    },
    inference: {
      calls: 0,
      positions: 0,
      resizedInputs: 0,
      channelAdaptations: 0,
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
      adaptedBoards.push(adaptBoard(
        board,
        expectedWidth,
        expectedHeight,
        expectedChannels,
        stats
      ));
      globals.push([globalValue]);
    }
    stats.calls += 1;
    stats.positions += vectors.length;
    const boardTensor = tf.tensor4d(
      adaptedBoards.flat(3),
      [adaptedBoards.length, expectedWidth, expectedHeight, expectedChannels]
    );
    const globalTensor = tf.tensor2d(globals, [globals.length, 1]);
    try {
      const prediction = checkpointModel.predict([boardTensor, globalTensor]);
      const values = Array.from(prediction.dataSync());
      if (!stats.modelProbe) {
        stats.modelProbe = values.slice(0, 8);
      }
      prediction.dispose();
      return values.map(score => [score]);
    } finally {
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

function runRuntimeGame(options, loadedCheckpoint, candidateSide, seed) {
  const predictor = createPredictor(loadedCheckpoint.model, loadedCheckpoint.inference);
  const context = createRuntimeContext(seed, predictor, loadedCheckpoint.model);
  loadBrowserScripts(context);
  context.__task047MapName = options.mapName;
  context.__task047Map = BENCHMARK_MAPS[options.mapName];
  context.__candidateSide = candidateSide;
  context.__candidateClass = options.candidate;
  context.__baselineClass = options.baseline;
  context.__roundLimit = options.roundLimit;
  return new vm.Script(`(() => {
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
    while (turnCount < __roundLimit &&
        gameRound < suddenDeathRound &&
        !players[1].isLost && !players[2].isLost) {
      nextTurn()
      ++turnCount
    }
    let winnerIndex = players[1].isLost ? 1 : (players[2].isLost ? 2 : null)
    let winnerSide = winnerIndex == 1 ? 'A' : (winnerIndex == 2 ? 'B' : null)
    let candidateWon = winnerSide == __candidateSide
    return {
      winner: winnerIndex == null ? null : players[winnerIndex].constructor.name,
      winnerSide,
      roundCount: gameRound,
      turnCount,
      timeout: winnerIndex == null && turnCount >= __roundLimit,
      suddenDeath: gameRound >= suddenDeathRound,
      nonResult: winnerIndex == null,
      mapName: __task047MapName,
      playerA: __candidateSide == 'A' ? __candidateClass : __baselineClass,
      playerB: __candidateSide == 'B' ? __candidateClass : __baselineClass,
      runtimePlayerA: players[1].constructor.name,
      runtimePlayerB: players[2].constructor.name,
      seed: ${seed},
      candidateSide: __candidateSide,
      candidateWon,
      benchmarkPolicy: 'real GameMap with runtime checkpoint inference versus SimpleAiPlayer',
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
}

function runBalancedBenchmark(options, loadedCheckpoint) {
  const games = [];
  const crashes = [];
  const gamesPerSide = options.games / 2;
  for (let index = 0; index < options.games; ++index) {
    const candidateSide = index < gamesPerSide ? 'A' : 'B';
    const seed = options.seed + index;
    try {
      games.push(runRuntimeGame(options, loadedCheckpoint, candidateSide, seed));
    } catch (error) {
      crashes.push({
        seed,
        candidateSide,
        message: error.message,
        stack: error.stack
      });
    }
  }
  const cleanGames = games.filter(game =>
    game.candidateWon &&
    !game.timeout &&
    !game.suddenDeath &&
    !game.nonResult
  );
  const completedGames = games.filter(game => game.winnerSide !== null);
  const failedGames = games.filter(game =>
    !game.candidateWon ||
    game.timeout ||
    game.suddenDeath ||
    game.nonResult
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
    checkpoint: Object.assign({}, loadedCheckpoint.report, {
      gameplayInference: loadedCheckpoint.inference
    }),
    summary: {
      attemptedGames: options.games,
      completedGames: completedGames.length,
      cleanCandidateWins: cleanGames.length,
      candidateWins: completedGames.filter(game => game.candidateWon).length,
      candidateWinRate: options.games ? cleanGames.length / options.games : 0,
      candidateStarts: {
        A: gamesPerSide,
        B: gamesPerSide
      },
      timeouts: games.filter(game => game.timeout).length,
      suddenDeathGames: games.filter(game => game.suddenDeath).length,
      nonResults: games.filter(game => game.nonResult).length,
      crashes: crashes.length,
      nonWins: failedGames.length + crashes.length
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
  loadCheckpoint,
  parseArgs,
  runBalancedBenchmark
};
