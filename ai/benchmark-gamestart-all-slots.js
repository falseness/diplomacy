#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');

if (require.main === module && !process.env.DIPLOMACY_ALL_SLOTS_HEAP) {
  const result = childProcess.spawnSync(
    process.execPath,
    ['--max-old-space-size=4096', __filename].concat(process.argv.slice(2)),
    {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { DIPLOMACY_ALL_SLOTS_HEAP: '1' })
    }
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status === null ? 1 : result.status);
}

const tf = require('@tensorflow/tfjs-node');

const {
  enumerateGamestartMapCoverage
} = require('./gamestart-map-coverage');
const {
  loadCheckpoint
} = require('./benchmark-gamestart-trained-model');
const {
  disableHeadlessBorderDrawing,
  loadBrowserScripts
} = require('./gamestart-simple-economy-completion');

const DEFAULT_CHECKPOINT =
  '/mnt/storage/diplomacy/checkpoints/task045-replay-corrected/step-00000005';
const DEFAULT_OUTPUT =
  '/mnt/storage/diplomacy/benchmarks/task063-all-gamestart-ai-vs-simple.json';
const DEFAULT_FAILURE_DIR =
  '/mnt/storage/diplomacy/benchmarks/task063-all-gamestart-failures';
const DEFAULT_FIRST_SEED = 63000;
const DEFAULT_SEEDS = 2;
const DEFAULT_ROUND_LIMIT = 1200;
const FORCED_SUDDEN_DEATH_ROUND = 500;
const DEFAULT_ACTION_LIMIT = 30;
const DEFAULT_COMMAND_LIMIT = 60;

function usage() {
  return [
    'Usage: node ai/benchmark-gamestart-all-slots.js [options]',
    '',
    'Options:',
    '  --checkpoint PATH       Trained checkpoint directory or model.json path',
    '  --seed NUMBER           First deterministic seed (default: ' + DEFAULT_FIRST_SEED + ')',
    '  --seeds NUMBER          Seeds per map and candidate slot (default: ' + DEFAULT_SEEDS + ')',
  '  --round-limit NUMBER    Max nextTurn calls per game (default: ' + DEFAULT_ROUND_LIMIT + ')',
  '  --sudden-death NUMBER   Forced runtime sudden-death round (default: ' + FORCED_SUDDEN_DEATH_ROUND + ')',
  '  --action-limit NUMBER   Max AI actions per turn (default: ' + DEFAULT_ACTION_LIMIT + ')',
  '  --command-limit NUMBER  Max movement commands considered per unit (default: ' + DEFAULT_COMMAND_LIMIT + ')',
    '  --output PATH           JSON report path',
    '  --failure-dir PATH      Directory for non-win state JSON files',
    '  --map-limit NUMBER      Limit selected maps for smoke tests',
    '  --map-offset NUMBER     Skip maps before applying --map-limit',
    '  --require-100           Exit nonzero unless every attempted game is a candidate win',
    '  --help                  Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    checkpoint: DEFAULT_CHECKPOINT,
    seed: DEFAULT_FIRST_SEED,
    seeds: DEFAULT_SEEDS,
    roundLimit: DEFAULT_ROUND_LIMIT,
    suddenDeathRound: FORCED_SUDDEN_DEATH_ROUND,
    actionLimit: DEFAULT_ACTION_LIMIT,
    commandLimit: DEFAULT_COMMAND_LIMIT,
    output: DEFAULT_OUTPUT,
    failureDir: DEFAULT_FAILURE_DIR,
    mapLimit: undefined,
    mapOffset: 0,
    require100: false
  };
  const names = {
    '--checkpoint': 'checkpoint',
    '--seed': 'seed',
    '--seeds': 'seeds',
    '--round-limit': 'roundLimit',
    '--sudden-death': 'suddenDeathRound',
    '--action-limit': 'actionLimit',
    '--command-limit': 'commandLimit',
    '--output': 'output',
    '--failure-dir': 'failureDir',
    '--map-limit': 'mapLimit',
    '--map-offset': 'mapOffset'
  };
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--require-100') {
      options.require100 = true;
      continue;
    }
    const name = names[argument];
    if (!name || index + 1 >= argv.length) {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
    options[name] = argv[++index];
  }
  ['seed', 'seeds', 'roundLimit', 'suddenDeathRound', 'actionLimit', 'commandLimit', 'mapLimit', 'mapOffset'].forEach(name => {
    if (options[name] === undefined) {
      return;
    }
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name])) {
      throw new Error(name + ' must be numeric');
    }
  });
  if (!Number.isInteger(options.seed)) {
    throw new Error('seed must be an integer');
  }
  if (!Number.isInteger(options.seeds) || options.seeds <= 0) {
    throw new Error('seeds must be a positive integer');
  }
  if (!Number.isInteger(options.roundLimit) || options.roundLimit <= 0) {
    throw new Error('round-limit must be a positive integer');
  }
  if (!Number.isInteger(options.suddenDeathRound) || options.suddenDeathRound <= 0) {
    throw new Error('sudden-death must be a positive integer');
  }
  if (!Number.isInteger(options.actionLimit) || options.actionLimit <= 0) {
    throw new Error('action-limit must be a positive integer');
  }
  if (!Number.isInteger(options.commandLimit) || options.commandLimit <= 0) {
    throw new Error('command-limit must be a positive integer');
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

function bindCheckpoint(context) {
  new vm.Script(`
    ai_model = __checkpointModel
    predict = function(model, xValidateArr) {
      return __predictFromCheckpoint(model, xValidateArr)
    }
  `, { filename: 'task063-checkpoint-binding.js' }).runInContext(context);
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
      return values.map(score => [score]);
    } finally {
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

function selectedMaps(coverage, options) {
  let maps = coverage.maps.slice(options.mapOffset);
  if (options.mapLimit) {
    maps = maps.slice(0, options.mapLimit);
  }
  return maps;
}

function candidateSlots(mapEntry) {
  const slots = [];
  for (let slot = 1; slot <= mapEntry.nonNeutralPlayerCount; ++slot) {
    slots.push(slot);
  }
  return slots;
}

function safeFilePart(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function conciseGame(game) {
  const copy = Object.assign({}, game);
  if (copy.candidateWon && !copy.timeout && !copy.suddenDeath) {
    copy.players = copy.players.map(player => {
      const playerCopy = Object.assign({}, player);
      delete playerCopy.townCoords;
      delete playerCopy.unitCoords;
      return playerCopy;
    });
  }
  return copy;
}

function runRuntimeScenario(mapEntry, candidateSlot, seed, options, checkpoint) {
  const predictor = createPredictor(checkpoint.model, checkpoint.inference);
  const context = createRuntimeContext(seed, predictor, checkpoint.model);
  loadBrowserScripts(context);
  disableHeadlessBorderDrawing(context);
  bindCheckpoint(context);
  context.__task063MapEntry = mapEntry;
  context.__task063CandidateSlot = candidateSlot;
  context.__task063Seed = seed;
  context.__task063RoundLimit = options.roundLimit;
  context.__task063ForcedSuddenDeathRound = options.suddenDeathRound;
  context.__task063ActionLimit = options.actionLimit;
  context.__task063CommandLimit = options.commandLimit;
  return new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = true
    gameSettings.isOnline = false
    gameSettings.aiActionLimit = __task063ActionLimit
    gameSettings.aiCommandLimit = __task063CommandLimit
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
    let map = __task063MapEntry.sourceType == 'standalone-factory' ?
      globalThis[__task063MapEntry.sourceName]() :
      maps[__task063MapEntry.groupName][__task063MapEntry.variantIndex]
    let configuredSuddenDeathRound = map.suddenDeathRound ||
      __task063MapEntry.suddenDeathRound || null
    map.suddenDeathRound = __task063ForcedSuddenDeathRound
    let opponentSlots = []
    for (let slot = 1; slot < map.players.length; ++slot) {
      if (slot == __task063CandidateSlot) {
        map.players[slot].playerType = 'AIPlayerWithEconomy'
      } else {
        map.players[slot].playerType = 'SimpleAiPlayerWithEconomy'
        opponentSlots.push(slot)
      }
    }
    map.start(manager, false)
    suddenDeathRound = __task063ForcedSuddenDeathRound
    whooseTurn = (__task063CandidateSlot - 1 + players.length - 1) % players.length
    nextTurn()
    for (let slot = 1; slot < players.length; ++slot) {
      if (slot != __task063CandidateSlot && players[slot].concede) {
        players[slot].concede()
      }
    }
    whooseTurn = 0

    function activeNonNeutralPlayers() {
      return players.slice(1).filter(function(player) {
        return !player.isLost
      })
    }
    let turnCount = 0
    while (turnCount < __task063RoundLimit &&
        gameRound < suddenDeathRound &&
        activeNonNeutralPlayers().length > 1 &&
        !players[__task063CandidateSlot].isLost) {
      nextTurn()
      ++turnCount
    }
    let activePlayers = activeNonNeutralPlayers()
    let winner = activePlayers.length == 1 ? players.indexOf(activePlayers[0]) : null
    let runtimePlayers = players.slice(1).map(function(player, index) {
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
    let candidatePlayers = runtimePlayers.filter(function(player) {
      return player.type == 'AIPlayerWithEconomy'
    })
    let opponentPlayers = runtimePlayers.filter(function(player) {
      return player.type == 'SimpleAiPlayerWithEconomy'
    })
    return {
      mapName: __task063MapEntry.name,
      groupName: __task063MapEntry.groupName,
      variantIndex: __task063MapEntry.variantIndex,
      sourceType: __task063MapEntry.sourceType,
      sourceName: __task063MapEntry.sourceName,
      playerGroup: __task063MapEntry.playerGroup,
      playerCount: __task063MapEntry.nonNeutralPlayerCount,
      candidateSlot: __task063CandidateSlot,
      opponentSlots,
      seed: __task063Seed,
      winner,
      roundCount: gameRound,
      turnCount,
      crash: null,
      timeout: winner == null && turnCount >= __task063RoundLimit,
      suddenDeath: winner == null && gameRound >= suddenDeathRound,
      suddenDeathRound,
      configuredSuddenDeathRound,
      forcedSuddenDeathRound: __task063ForcedSuddenDeathRound,
      candidateWon: winner == __task063CandidateSlot,
      candidateLost: players[__task063CandidateSlot].isLost,
      exactClassAssignment:
        candidatePlayers.length == 1 &&
        candidatePlayers[0].side == __task063CandidateSlot &&
        opponentPlayers.length == opponentSlots.length,
      benchmarkPolicy:
        'real gamestart map with one runtime AIPlayerWithEconomy candidate slot and SimpleAiPlayerWithEconomy opponents',
      runtimeLoop: 'GameMap.start + nextTurn',
      players: runtimePlayers
    }
  })()`, { filename: 'task063-runtime-scenario.js' }).runInContext(context);
}

function scenarioCount(maps, seeds) {
  return maps.reduce((total, map) =>
    total + map.nonNeutralPlayerCount * seeds, 0);
}

function summarize(games, crashes) {
  const candidateWins = games.filter(game => game.candidateWon).length;
  const nonWins = games.filter(game => !game.candidateWon).length + crashes.length;
  return {
    attemptedGames: games.length + crashes.length,
    completedGames: games.filter(game => game.winner !== null).length,
    candidateWins,
    candidateWinRate: games.length ? candidateWins / games.length : 0,
    nonWins,
    losses: games.filter(game => game.winner !== null && !game.candidateWon).length,
    nonResults: games.filter(game => game.winner === null).length,
    timeouts: games.filter(game => game.timeout).length,
    suddenDeathGames: games.filter(game => game.suddenDeath).length,
    crashes: crashes.length,
    classAssignmentFailures: games.filter(game => !game.exactClassAssignment).length
  };
}

function buildReport(coverage, maps, options, checkpoint, games, crashes, status) {
  const summary = summarize(games, crashes);
  return {
    status,
    config: {
      checkpoint: options.checkpoint,
      seed: options.seed,
      seedsPerMapCandidateSlot: options.seeds,
      roundLimit: options.roundLimit,
      suddenDeathRound: options.suddenDeathRound,
      actionLimit: options.actionLimit,
      commandLimit: options.commandLimit,
      mapOffset: options.mapOffset,
      mapLimit: options.mapLimit,
      require100: options.require100
    },
    checkpoint: Object.assign({}, checkpoint.report, {
      gameplayInference: checkpoint.inference
    }),
    mapCoverage: {
      source: coverage.source,
      totalMaps: coverage.totalMaps,
      selectedMaps: maps.map(map => ({
        name: map.name,
        groupName: map.groupName,
        variantIndex: map.variantIndex,
        sourceType: map.sourceType,
        sourceName: map.sourceName,
        playerGroup: map.playerGroup,
        playerCount: map.nonNeutralPlayerCount,
        candidateSlots: candidateSlots(map)
      })),
      expectedGames: scenarioCount(maps, options.seeds)
    },
    benchmarkPolicy:
      'real runtime all-gamestart benchmark: one AIPlayerWithEconomy candidate in every non-neutral slot, SimpleAiPlayerWithEconomy in every other slot',
    summary,
    failedGames: games.filter(game => !game.candidateWon || game.timeout ||
      game.suddenDeath || !game.exactClassAssignment),
    crashes,
    games: games.map(conciseGame)
  };
}

async function runBenchmark(options) {
  const coverage = enumerateGamestartMapCoverage();
  const maps = selectedMaps(coverage, options);
  const checkpoint = await loadCheckpoint(options.checkpoint);
  checkpoint.inference = {
    calls: 0,
    positions: 0,
    resizedInputs: 0,
    scoring: 'checkpoint-model-direct'
  };

  try {
    const games = [];
    const crashes = [];
    let nextSeed = options.seed;
    for (const mapEntry of maps) {
      for (const candidateSlot of candidateSlots(mapEntry)) {
        for (let seedIndex = 0; seedIndex < options.seeds; ++seedIndex) {
          const seed = nextSeed++;
          try {
            const game = runRuntimeScenario(
              mapEntry, candidateSlot, seed, options, checkpoint);
            games.push(game);
            console.error(
              'TASK-063 game ' + (games.length + crashes.length) + ': ' +
              game.mapName + ' seed ' + seed +
              ' candidateSlot=' + candidateSlot +
              ' winner=' + game.winner +
              ' candidateWon=' + game.candidateWon +
              ' round=' + game.roundCount
            );
            if (!game.candidateWon || game.timeout || game.suddenDeath ||
                !game.exactClassAssignment) {
              const failurePath = path.join(
                options.failureDir,
                safeFilePart(game.mapName) +
                  '-slot-' + candidateSlot +
                  '-seed-' + seed + '.json'
              );
              game.failurePath = failurePath;
              writeJson(failurePath, game);
            }
            writeJson(options.output, buildReport(
              coverage, maps, options, checkpoint, games, crashes, 'running'));
          } catch (error) {
            const crash = {
              mapName: mapEntry.name,
              groupName: mapEntry.groupName,
              variantIndex: mapEntry.variantIndex,
              sourceType: mapEntry.sourceType,
              sourceName: mapEntry.sourceName,
              playerGroup: mapEntry.playerGroup,
              playerCount: mapEntry.nonNeutralPlayerCount,
              candidateSlot,
              opponentSlots: candidateSlots(mapEntry).filter(slot => slot !== candidateSlot),
              seed,
              winner: null,
              roundCount: null,
              crash: {
                message: error.message,
                stack: error.stack
              },
              timeout: false,
              suddenDeath: false,
              candidateWon: false
            };
            const failurePath = path.join(
              options.failureDir,
              safeFilePart(mapEntry.name) +
                '-slot-' + candidateSlot +
                '-seed-' + seed + '-crash.json'
            );
            crash.failurePath = failurePath;
            writeJson(failurePath, crash);
            crashes.push(crash);
            writeJson(options.output, buildReport(
              coverage, maps, options, checkpoint, games, crashes, 'running'));
            console.error(
              'TASK-063 crash ' + (games.length + crashes.length) + ': ' +
              mapEntry.name + ' seed ' + seed +
              ' candidateSlot=' + candidateSlot +
              ' message=' + error.message
            );
          }
        }
      }
    }
    const report = buildReport(
      coverage, maps, options, checkpoint, games, crashes, 'complete');
    writeJson(options.output, report);
    return report;
  } finally {
    checkpoint.model.dispose();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await runBenchmark(options);
  console.log(JSON.stringify(report.summary));
  console.log('All-gamestart AI benchmark report: ' + path.resolve(options.output));
  if (options.require100 &&
      (report.summary.nonWins > 0 ||
        report.summary.classAssignmentFailures > 0 ||
        report.summary.attemptedGames !== report.mapCoverage.expectedGames)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

module.exports = {
  candidateSlots,
  parseArgs,
  runBenchmark,
  runRuntimeScenario,
  selectedMaps,
  summarize
};
