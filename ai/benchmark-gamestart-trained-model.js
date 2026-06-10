#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');

if (require.main === module && !process.env.DIPLOMACY_BENCHMARK_HEAP) {
  const result = childProcess.spawnSync(
    process.execPath,
    ['--max-old-space-size=4096', __filename].concat(process.argv.slice(2)),
    {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { DIPLOMACY_BENCHMARK_HEAP: '1' })
    }
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status === null ? 1 : result.status);
}

const tf = require('@tensorflow/tfjs-node');

const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_CHECKPOINT =
  '/mnt/storage/diplomacy/task046-corrected-feature-model';
const DEFAULT_OUTPUT =
  '/mnt/storage/diplomacy/benchmarks/task037-gamestart-trained-vs-simple.json';
const DEFAULT_FAILURE_DIR =
  '/mnt/storage/diplomacy/benchmarks/task037-failures';
const DEFAULT_SEEDS_PER_SIDE = 1;
const DEFAULT_FIRST_SEED = 37002;
const DEFAULT_ROUND_LIMIT = 1200;
const DEFAULT_ACTION_LIMIT = 30;
const DEFAULT_COMMAND_LIMIT = 60;
const DEFAULT_MIN_WIN_RATE = 1;
const GENERATED_BENCHMARK_SEED = Number(
  process.env.DIPLOMACY_GENERATED_BENCHMARK_SEED || 36001);
function usage() {
  return [
    'Usage: node ai/benchmark-gamestart-trained-model.js [options]',
    '',
    'Options:',
    '  --checkpoint PATH       Trained checkpoint directory or model.json path',
    '  --seeds NUMBER          Seeds per candidate side and map (default: ' + DEFAULT_SEEDS_PER_SIDE + ')',
    '  --seed NUMBER           First deterministic seed (default: ' + DEFAULT_FIRST_SEED + ')',
    '  --round-limit NUMBER    Max nextTurn calls per game (default: ' + DEFAULT_ROUND_LIMIT + ')',
    '  --action-limit NUMBER   Max candidate actions per turn (default: ' + DEFAULT_ACTION_LIMIT + ')',
    '  --command-limit NUMBER  Max scored commands per action (default: ' + DEFAULT_COMMAND_LIMIT + ')',
    '  --map-limit NUMBER      Limit covered 1v1 maps for smoke tests',
    '  --map-offset NUMBER     Skip covered 1v1 maps before applying --map-limit',
    '  --output PATH           JSON report path',
    '  --failure-dir PATH      Directory for non-win state JSON files',
    '  --tasks PATH            tasks.json path for follow-up ticket creation',
    '  --no-followups          Do not append follow-up tickets on failures',
    '  --min-win-rate NUMBER   Required completed-game win rate (default: ' + DEFAULT_MIN_WIN_RATE + ')',
    '  --help                  Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    checkpoint: DEFAULT_CHECKPOINT,
    seeds: DEFAULT_SEEDS_PER_SIDE,
    seed: DEFAULT_FIRST_SEED,
    roundLimit: DEFAULT_ROUND_LIMIT,
    actionLimit: DEFAULT_ACTION_LIMIT,
    commandLimit: DEFAULT_COMMAND_LIMIT,
    output: DEFAULT_OUTPUT,
    failureDir: DEFAULT_FAILURE_DIR,
    tasksPath: path.join(repoRoot, 'tasks.json'),
    createFollowups: true,
    minWinRate: DEFAULT_MIN_WIN_RATE,
    mapLimit: undefined,
    mapOffset: 0
  };
  const names = {
    '--checkpoint': 'checkpoint',
    '--seeds': 'seeds',
    '--seed': 'seed',
    '--round-limit': 'roundLimit',
    '--action-limit': 'actionLimit',
    '--command-limit': 'commandLimit',
    '--output': 'output',
    '--failure-dir': 'failureDir',
    '--tasks': 'tasksPath',
    '--min-win-rate': 'minWinRate',
    '--map-limit': 'mapLimit',
    '--map-offset': 'mapOffset'
  };
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--no-followups') {
      options.createFollowups = false;
      continue;
    }
    const name = names[argument];
    if (!name || index + 1 >= argv.length) {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
    options[name] = argv[++index];
  }
  for (const name of [
    'seeds',
    'seed',
    'roundLimit',
    'actionLimit',
    'commandLimit',
    'minWinRate',
    'mapLimit',
    'mapOffset'
  ]) {
    if (options[name] === undefined) {
      continue;
    }
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name])) {
      throw new Error(name + ' must be numeric');
    }
  }
  if (!Number.isInteger(options.seeds) || options.seeds <= 0) {
    throw new Error('seeds must be a positive integer');
  }
  if (!Number.isInteger(options.roundLimit) || options.roundLimit <= 0) {
    throw new Error('round-limit must be a positive integer');
  }
  if (!Number.isInteger(options.actionLimit) || options.actionLimit <= 0) {
    throw new Error('action-limit must be a positive integer');
  }
  if (!Number.isInteger(options.commandLimit) || options.commandLimit <= 0) {
    throw new Error('command-limit must be a positive integer');
  }
  if (options.minWinRate < 0 || options.minWinRate > 1) {
    throw new Error('min-win-rate must be between 0 and 1');
  }
  if (options.mapLimit !== undefined &&
      (!Number.isInteger(options.mapLimit) || options.mapLimit <= 0)) {
    throw new Error('map-limit must be a positive integer');
  }
  if (!Number.isInteger(options.mapOffset) || options.mapOffset < 0) {
    throw new Error('map-offset must be a non-negative integer');
  }
  return options;
}

function checkpointModelPath(checkpointArgument) {
  const resolved = path.resolve(checkpointArgument);
  return path.basename(resolved) === 'model.json' ?
    resolved : path.join(resolved, 'model.json');
}

function modelSignature(model) {
  return {
    inputs: model.inputs.map(input => input.shape),
    outputs: model.outputs.map(output => output.shape)
  };
}

async function loadCheckpoint(checkpointArgument) {
  const modelPath = checkpointModelPath(checkpointArgument);
  if (!fs.existsSync(modelPath)) {
    throw new Error('checkpoint model is missing: ' + modelPath);
  }
  const model = await tf.loadLayersModel('file://' + modelPath);
  const signature = modelSignature(model);
  const channelCount = signature.inputs[0] && signature.inputs[0][3];
  if (channelCount !== 78) {
    model.dispose();
    throw new Error('checkpoint must use the 78-channel economy vector shape');
  }
  return {
    model,
    report: {
      path: path.dirname(modelPath),
      signature
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
  `, { filename: 'task037-checkpoint-binding.js' }).runInContext(context);
}

function extractGamestartMaps() {
  const context = createRuntimeContext(1, function() { return [[0]]; }, {});
  context.__generatedBenchmarkSeed = GENERATED_BENCHMARK_SEED;
  loadBrowserScripts(context);
  return new vm.Script(`(() => {
    let result = []
    if (typeof generateTownTrainingMap == 'function') {
      let generated = generateTownTrainingMap({
        size: 'medium',
        seed: __generatedBenchmarkSeed,
        unitsPerPlayer: 5,
        unitComposition: 'all',
        buildingDensity: 'dense',
        barrackDensity: 1,
        farmDensity: 1,
        externalDensity: 0.6,
        goldmineCount: 6,
        startingGoldMin: 450,
        startingGoldMax: 450
      })
      result.push({
        category: 'generated',
        index: 0,
        name: 'generated economy training map',
        oneVOne: generated.players.length == 3,
        players: generated.players.length,
        size: generated.mapSize
      })
    }
    for (let category of Object.keys(maps)) {
      for (let index = 0; index < maps[category].length; ++index) {
        let map = maps[category][index]
        result.push({
          category,
          index,
          name: category + ' #' + (index + 1),
          oneVOne: map.players.length == 3,
          players: map.players.length,
          size: map.mapSize
        })
      }
    }
    return result
  })()`, { filename: 'task037-map-list.js' }).runInContext(context);
}

function boardSize(board) {
  return {
    width: board.length,
    height: board[0] ? board[0].length : 0
  };
}

function adaptBoard(board, expectedWidth, expectedHeight) {
  const size = boardSize(board);
  const channels = board[0][0].length;
  if (size.width === expectedWidth && size.height === expectedHeight) {
    return board;
  }
  const adapted = new Array(expectedWidth);
  for (let x = 0; x < expectedWidth; ++x) {
    adapted[x] = new Array(expectedHeight);
    const sourceX = Math.min(size.width - 1, Math.floor(x * size.width / expectedWidth));
    for (let y = 0; y < expectedHeight; ++y) {
      const sourceY = Math.min(size.height - 1, Math.floor(y * size.height / expectedHeight));
      adapted[x][y] = board[sourceX][sourceY].slice(0, channels);
    }
  }
  return adapted;
}

function createPredictor(model, stats) {
  const inputShape = model.inputs[0].shape;
  return function predictFromCheckpoint(checkpointModel, vectors) {
    const expectedWidth = inputShape[1];
    const expectedHeight = inputShape[2];
    const adaptedBoards = [];
    const globals = [];
    for (const vector of vectors) {
      const board = vector[0];
      const globalValue = Number(vector[1]) || 0;
      const size = boardSize(board);
      if (size.width !== expectedWidth || size.height !== expectedHeight) {
        stats.resizedInputs += 1;
      }
      adaptedBoards.push(adaptBoard(board, expectedWidth, expectedHeight));
      globals.push([globalValue]);
    }
    stats.calls += 1;
    stats.positions += vectors.length;
    const boardTensor = tf.tensor4d(
      adaptedBoards.flat(3),
      [adaptedBoards.length, expectedWidth, expectedHeight, 78]
    );
    const globalTensor = tf.tensor2d(globals, [globals.length, 1]);
    try {
      const prediction = checkpointModel.predict([boardTensor, globalTensor]);
      const values = Array.from(prediction.dataSync());
      if (!stats.modelProbe) {
        stats.modelProbe = values.slice(0, 8);
      }
      prediction.dispose();
      return values.map(function(score) {
        return [score];
      });
    } finally {
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

function runRuntimeGame(mapInfo, candidateSide, seed, options, loadedCheckpoint) {
  const stats = loadedCheckpoint.inference;
  const predictor = createPredictor(loadedCheckpoint.model, stats);
  const context = createRuntimeContext(seed, predictor, loadedCheckpoint.model);
  context.__generatedBenchmarkSeed = GENERATED_BENCHMARK_SEED;
  loadBrowserScripts(context);
  context.__task037MapInfo = mapInfo;
  context.__candidateSide = candidateSide;
  context.__roundLimit = options.roundLimit;
  context.__task037ActionLimit = options.actionLimit;
  context.__task037CommandLimit = options.commandLimit;
  return new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = true
    gameSettings.isOnline = false
    gameSettings.aiActionLimit = __task037ActionLimit
    gameSettings.aiCommandLimit = __task037CommandLimit
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
    let map = __task037MapInfo.category == 'generated' ?
      generateTownTrainingMap({
        size: 'medium',
        seed: __generatedBenchmarkSeed,
        unitsPerPlayer: 5,
        unitComposition: 'all',
        buildingDensity: 'dense',
        barrackDensity: 1,
        farmDensity: 1,
        externalDensity: 0.6,
        goldmineCount: 6,
        startingGoldMin: 450,
        startingGoldMax: 450
      }) :
      maps[__task037MapInfo.category][__task037MapInfo.index]
    map.players[1].playerType =
      __candidateSide == 1 ? 'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy'
    map.players[2].playerType =
      __candidateSide == 2 ? 'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy'
    map.start(manager, false)
    suddenDeathRound = map.suddenDeathRound || 2000
    whooseTurn = 0

    let turnCount = 0
    while (turnCount < __roundLimit &&
        gameRound < suddenDeathRound &&
        !players[1].isLost && !players[2].isLost) {
      nextTurn()
      ++turnCount
    }
    let winner = players[1].isLost ? 2 : (players[2].isLost ? 1 : null)
    return {
      mapName: __task037MapInfo.name,
      candidateSide: __candidateSide,
      seed: ${seed},
      turnCount,
      gameRound,
      suddenDeathRound,
      winner,
      candidateWon: winner == __candidateSide,
      nonResult: winner == null,
      suddenDeath: winner == null && gameRound >= suddenDeathRound,
      timeout: winner == null && turnCount >= __roundLimit,
      adjudicated: false,
      eliminatedWinner: winner,
      limits: {
        roundLimit: __roundLimit,
        actionLimit: __task037ActionLimit,
        commandLimit: __task037CommandLimit
      },
      benchmarkPolicy: 'runtime AIPlayerWithEconomy vs SimpleAiPlayerWithEconomy',
      players: players.slice(1).map(function(player, index) {
        return {
          side: index + 1,
          type: player.constructor.name,
          lost: player.isLost,
          gold: player.gold,
          income: player.income,
          towns: player.towns.filter(function(town) { return !town.killed }).length,
          units: player.units.filter(function(unit) { return !unit.killed }).length,
          townCoords: player.towns.filter(function(town) {
            return !town.killed
          }).map(function(town) {
            return {x: town.coord.x, y: town.coord.y}
          }),
          unitCoords: player.units.filter(function(unit) {
            return !unit.killed
          }).map(function(unit) {
            return {
              type: unit.constructor.name,
              x: unit.coord.x,
              y: unit.coord.y,
              moves: unit.moves
            }
          })
        }
      })
    }
  })()`, { filename: 'task037-runtime-game.js' }).runInContext(context);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function followupExists(tasks, title) {
  return tasks.some(task => task.description && task.description.includes(title));
}

function nextTaskId(tasks) {
  let max = 0;
  for (const task of tasks) {
    const match = /^TASK-(\d+)$/.exec(task.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return 'TASK-' + String(max + 1).padStart(3, '0');
}

function appendFollowups(tasksPath, failedGames, reportPath) {
  if (!failedGames.length) {
    return [];
  }
  const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  const title = 'Investigate TASK-037 trained gamestart benchmark non-wins';
  if (followupExists(tasks, title)) {
    return [];
  }
  const failures = failedGames.slice(0, 12).map(game =>
    game.mapName + ' seed ' + game.seed + ' side ' + game.candidateSide
  ).join('; ');
  const task = {
    id: nextTaskId(tasks),
    category: 'follow-up',
    priority: 'critical',
    description:
      title + '. TASK-037 report: ' + reportPath +
      '. Initial failures: ' + failures + '.',
    acceptance_criteria: [
      'Every loss, draw, crash, timeout, or sudden-death non-result from the TASK-037 report is reproduced or explained.',
      'AIPlayerWithEconomy or its training data is improved enough to rerun TASK-037 successfully.',
      'The benchmark report for the fixed run shows no non-wins.'
    ],
    test_steps: [
      'Step 1: Open the TASK-037 benchmark report and failure state files.',
      'Step 2: Reproduce at least one listed non-win seed.',
      'Step 3: Apply a targeted fix or training update.',
      'Step 4: Rerun node ai/benchmark-gamestart-trained-model.js.'
    ],
    status: 'pending'
  };
  tasks.push(task);
  fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2) + '\n');
  return [task.id];
}

function summarize(games, crashes, skippedMaps) {
  const completedGames = games.filter(game => !game.nonResult);
  const candidateWins = completedGames.filter(game => game.candidateWon).length;
  const failedGames = games.filter(game => !game.candidateWon);
  return {
    attemptedGames: games.length + crashes.length,
    completedGames: completedGames.length,
    candidateWins,
    candidateWinRate: completedGames.length ? candidateWins / completedGames.length : 0,
    nonWins: failedGames.length + crashes.length,
    nonResults: games.filter(game => game.nonResult).length,
    losses: completedGames.filter(game => !game.candidateWon).length,
    suddenDeathGames: games.filter(game => game.suddenDeath).length,
    timeouts: games.filter(game => game.timeout).length,
    crashes: crashes.length,
    skippedMultiplayerMaps: skippedMaps.length,
    skippedBenchmarkIneligibleMaps: 0
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const checkpoint = await loadCheckpoint(options.checkpoint);
  checkpoint.inference = {
    calls: 0,
    positions: 0,
    resizedInputs: 0,
    scoring: 'checkpoint-model-direct'
  };
  try {
    const mapInventory = extractGamestartMaps();
    const allOneVOneMaps = mapInventory.filter(map => map.oneVOne);
    const benchmarkOneVOneMaps = allOneVOneMaps;
    const selectedOneVOneMaps = benchmarkOneVOneMaps.slice(options.mapOffset);
    const oneVOneMaps = options.mapLimit ?
      selectedOneVOneMaps.slice(0, options.mapLimit) : selectedOneVOneMaps;
    const skippedMaps = mapInventory.filter(map => !map.oneVOne);
    const skippedBenchmarkMaps = [];
    const games = [];
    const crashes = [];
    for (const mapInfo of oneVOneMaps) {
      for (let seedIndex = 0; seedIndex < options.seeds; ++seedIndex) {
        for (const candidateSide of [1, 2]) {
          const seed = options.seed + games.length + crashes.length;
          try {
            const game = runRuntimeGame(
              mapInfo, candidateSide, seed, options, checkpoint);
            games.push(game);
            console.error(
              'TASK-037 game ' + (games.length + crashes.length) + ': ' +
              mapInfo.name + ' seed ' + seed + ' side ' + candidateSide +
              ' winner=' + game.winner + ' candidateWon=' + game.candidateWon
            );
            if (!game.candidateWon) {
              const failurePath = path.join(
                options.failureDir,
                mapInfo.name.replace(/[^A-Za-z0-9._-]+/g, '-') +
                  '-seed-' + seed + '-side-' + candidateSide + '.json'
              );
              game.failurePath = failurePath;
              writeJson(failurePath, game);
            } else {
              for (const player of game.players) {
                delete player.townCoords;
                delete player.unitCoords;
              }
            }
          } catch (error) {
            crashes.push({
              mapName: mapInfo.name,
              candidateSide,
              seed,
              message: error.message,
              stack: error.stack
            });
            console.error(
              'TASK-037 crash ' + (games.length + crashes.length) + ': ' +
              mapInfo.name + ' seed ' + seed + ' side ' + candidateSide +
              ' message=' + error.message
            );
          }
        }
      }
    }
    const summary = summarize(games, crashes, skippedMaps);
    const report = {
      config: {
        checkpoint: options.checkpoint,
        seedsPerSidePerMap: options.seeds,
        seed: options.seed,
        roundLimit: options.roundLimit,
        actionLimit: options.actionLimit,
        commandLimit: options.commandLimit,
        mapOffset: options.mapOffset,
        mapLimit: options.mapLimit,
        minWinRate: options.minWinRate
      },
      checkpoint: Object.assign({}, checkpoint.report, {
        gameplayInference: checkpoint.inference
      }),
      mapCoverage: {
        oneVOneMaps: oneVOneMaps.map(map => ({
          name: map.name,
          category: map.category,
          index: map.index,
          size: map.size
        })),
        totalOneVOneMaps: allOneVOneMaps.length,
        eligibleOneVOneMaps: benchmarkOneVOneMaps.length,
        limited: !!options.mapLimit,
        skippedMultiplayerMaps: skippedMaps,
        skippedBenchmarkIneligibleMaps: skippedBenchmarkMaps
      },
      summary,
      failedGames: games.filter(game => !game.candidateWon),
      crashes,
      games
    };
    writeJson(options.output, report);
    const followups = options.createFollowups ?
      appendFollowups(
        options.tasksPath,
        report.failedGames.concat(crashes),
        path.resolve(options.output)
      ) : [];
    if (followups.length) {
      report.followupTasksCreated = followups;
      writeJson(options.output, report);
    }
    console.log(JSON.stringify(summary));
    console.log('Gamestart benchmark report: ' + path.resolve(options.output));
    if (summary.candidateWinRate < options.minWinRate ||
        summary.nonWins > 0 ||
        summary.completedGames === 0) {
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
  extractGamestartMaps,
  loadCheckpoint,
  parseArgs
};
