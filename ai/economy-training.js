const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs-node');
const {
  getBrowserScriptCacheStats,
  loadBrowserScripts,
  resetBrowserScriptCache
} = require('./browserScriptCache');
const { scoreFinalEconomyVector } =
  require('./benchmark-final-symmetrical-economy-gate');

const CELL_VECTOR_SIZE = 78;
const ECONOMY_MODEL_WIDTH = 9;
const ECONOMY_MODEL_HEIGHT = 9;
const ACTION_CATEGORIES = [
  'unit-command',
  'unit-training',
  'suburb-expansion',
  'building-placement'
];
let reusableTrainingContext = null;

function parseArgs(argv) {
  const options = {
    storageDir: process.env.DIPLOMACY_STORAGE_DIR || '/mnt/storage/diplomacy',
    runId: `economy-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    games: 1,
    epochs: 1,
    seed: 36000,
    checkpointInterval: 1,
    playerCounts: [2, 3, 4],
    mapSource: 'town'
  };
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!argument.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (name === 'storage-dir') options.storageDir = value;
    else if (name === 'run-id') options.runId = value;
    else if (name === 'games') options.games = Number(value);
    else if (name === 'epochs') options.epochs = Number(value);
    else if (name === 'seed') options.seed = Number(value);
    else if (name === 'checkpoint-interval') options.checkpointInterval = Number(value);
    else if (name === 'player-count') options.playerCounts = [Number(value)];
    else if (name === 'player-counts') {
      options.playerCounts = value.split(',').map(entry => Number(entry.trim()));
    }
    else if (name === 'map-source') options.mapSource = value;
    else throw new Error(`unknown argument: ${argument}`);
  }
  for (const name of ['games', 'epochs', 'seed', 'checkpointInterval']) {
    if (!Number.isInteger(options[name]) || options[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.runId)) {
    throw new Error('run-id contains unsupported characters');
  }
  if (!Array.isArray(options.playerCounts) || options.playerCounts.length === 0 ||
      options.playerCounts.some(count => !Number.isInteger(count) || count < 2 || count > 4)) {
    throw new Error('playerCounts must contain only 2, 3, or 4');
  }
  if (!['town', 'final-symmetrical-economy'].includes(options.mapSource)) {
    throw new Error('map-source must be town or final-symmetrical-economy');
  }
  options.storageDir = path.resolve(options.storageDir);
  return options;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function removePath(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

function createModel(height, width) {
  const boardInput = tf.input({
    shape: [height, width, CELL_VECTOR_SIZE],
    name: 'board'
  });
  const globalInput = tf.input({ shape: [1], name: 'global_variables' });
  const flattened = tf.layers.flatten().apply(boardInput);
  const merged = tf.layers.concatenate().apply([flattened, globalInput]);
  const hidden1 = tf.layers.dense({ units: 256, activation: 'relu' }).apply(merged);
  const hidden2 = tf.layers.dense({ units: 128, activation: 'relu' }).apply(hidden1);
  const hidden3 = tf.layers.dense({ units: 64, activation: 'relu' }).apply(hidden2);
  const hidden4 = tf.layers.dense({ units: 32, activation: 'relu' }).apply(hidden3);
  const output = tf.layers.dense({
    units: 1,
    activation: 'linear',
    name: 'value_output'
  }).apply(hidden4);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError'
  });
  return model;
}

function adaptBoard(board, expectedWidth, expectedHeight) {
  const width = board.length;
  const height = board[0] ? board[0].length : 0;
  if (width === expectedWidth && height === expectedHeight) {
    return board;
  }
  const adapted = new Array(expectedWidth);
  for (let x = 0; x < expectedWidth; x += 1) {
    adapted[x] = new Array(expectedHeight);
    const sourceX = Math.min(width - 1, Math.floor(x * width / expectedWidth));
    for (let y = 0; y < expectedHeight; y += 1) {
      const sourceY = Math.min(height - 1, Math.floor(y * height / expectedHeight));
      adapted[x][y] = board[sourceX][sourceY].slice(0, CELL_VECTOR_SIZE);
    }
  }
  return adapted;
}

function trainingMapSizeForSeed(seed) {
  const sizes = ['tiny', 'medium', 'big'];
  return sizes[Math.abs(seed) % sizes.length];
}

function trainingPlayerCountForSeed(seed, playerCounts) {
  const counts = Array.isArray(playerCounts) && playerCounts.length ?
    playerCounts : [2, 3, 4];
  return counts[Math.abs(seed) % counts.length];
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

function createRuntimeContext(seed) {
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
    __resetHarnessStorage() {
      for (const key of Object.keys(storage)) {
        delete storage[key];
      }
    },
    io() { return {}; },
    tf: {},
    saveAs() {},
    __scoreFinalEconomyVector: scoreFinalEconomyVector
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function resetRuntimeContext(context, seed) {
  const seededMath = Object.create(Math);
  let randomState = seed >>> 0;
  seededMath.random = function() {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  context.Math = seededMath;
  if (typeof context.__resetHarnessStorage === 'function') {
    context.__resetHarnessStorage();
  }
}

function getTrainingRuntimeContext(seed) {
  if (process.env.DIPLOMACY_DISABLE_BROWSER_SCRIPT_CACHE === '1') {
    const context = createRuntimeContext(seed);
    loadBrowserScripts(context, { disableBrowserScriptCache: true });
    return context;
  }
  if (!reusableTrainingContext) {
    reusableTrainingContext = createRuntimeContext(seed);
    loadBrowserScripts(reusableTrainingContext);
  }
  resetRuntimeContext(reusableTrainingContext, seed);
  return reusableTrainingContext;
}

function resetTrainingRuntimeCache() {
  reusableTrainingContext = null;
  resetBrowserScriptCache();
}

function createTrainingBatch(seed, playerCounts, mapSource = 'town') {
  const context = getTrainingRuntimeContext(seed);
  context.__trainingSeed = seed;
  context.__trainingMapSize = trainingMapSizeForSeed(seed);
  context.__trainingPlayerCount = trainingPlayerCountForSeed(seed, playerCounts);
  context.__trainingMapSource = mapSource;
  context.__actionCategories = ACTION_CATEGORIES;
  context.__trainingCandidateLimit = 48;
  context.__trainingRounds = mapSource === 'final-symmetrical-economy' ? 8 : 4;
  const result = new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = false
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
    let map
    if (__trainingMapSource == 'final-symmetrical-economy') {
      map = generateSymmetricalEconomy9v9AllUnitMap({
        seed: __trainingSeed,
        suddenDeathRound: 160
      })
      map.players[1].playerType = 'AIPlayerWithEconomy'
      map.players[2].playerType = 'SimpleAiPlayerWithEconomy'
    }
    else {
      map = generateTownTrainingMap({
        size: __trainingMapSize,
        seed: __trainingSeed,
        playerCount: __trainingPlayerCount,
        buildingDensity: 'dense',
        barrackDensity: 0.2,
        pendingBarrackProbability: 0,
        farmDensity: 0.2,
        pendingFarmProbability: 0,
        externalDensity: 1,
        suburbDensity: 1,
        suburbDistance: __trainingMapSize == 'tiny' ? 1 : 2,
        unitComposition: 'all',
        unitsPerPlayer: 1,
        goldmineCount: 5,
        startingGoldMin: 500,
        startingGoldMax: 500
      })
      for (let playerIndex = 1; playerIndex < map.players.length; ++playerIndex) {
        map.players[playerIndex].playerType = 'AIPlayerWithEconomy'
      }
    }
    map.start(manager, false)
    suddenDeathRound = 2000

    function liveUnits(player) {
      return player.units.filter(function(unit) { return !unit.killed }).length
    }
    function score(playerIndex) {
      let player = players[playerIndex]
      if (player.isLost) return -1
      let activeOpponents = 0
      let opponentTownTotal = 0
      let opponentUnitTotal = 0
      let opponentGoldTotal = 0
      let opponentIncomeTotal = 0
      for (let opponentIndex = 1; opponentIndex < players.length; ++opponentIndex) {
        if (opponentIndex == playerIndex || players[opponentIndex].isLost) {
          continue
        }
        let opponent = players[opponentIndex]
        activeOpponents += 1
        opponentTownTotal += opponent.towns.filter(function(town) {
          return !town.killed
        }).length
        opponentUnitTotal += liveUnits(opponent)
        opponentGoldTotal += opponent.gold
        opponentIncomeTotal += opponent.income
      }
      if (!activeOpponents) return 1
      let scale = activeOpponents
      let material =
        (player.towns.filter(function(town) { return !town.killed }).length -
          opponentTownTotal / scale) * 0.45 +
        (liveUnits(player) - opponentUnitTotal / scale) * 0.14 +
        (player.gold - opponentGoldTotal / scale) / 800 +
        (player.income - opponentIncomeTotal / scale) / 80
      return Math.max(-1, Math.min(1, material))
    }
    function modelValueLabel(vector) {
      let tacticalScore = __scoreFinalEconomyVector(vector)
      return tacticalScore / 240000
    }
    function commandCategory(command) {
      return command.type == 'economy' ? command.category : 'unit-command'
    }

    let examples = []
    let labels = []
    let actionCounts = {}
    let turnsPlayed = 0
    for (let round = 0; round < __trainingRounds; ++round) {
      for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
        if (players[playerIndex].isLost) {
          continue
        }
        whooseTurn = playerIndex
        let player = players[playerIndex]
        player.nextTurn()
        if (__trainingMapSource == 'final-symmetrical-economy' &&
            player.constructor.name != 'AIPlayerWithEconomy') {
          actionManager.clear()
          turnsPlayed += 1
          continue
        }
        let commands = player.getPrioritizedActionCommands ?
          player.getPrioritizedActionCommands(__trainingCandidateLimit) :
          player.getActionCommands().slice(0, __trainingCandidateLimit)
        let bestCommand = null
        let bestLabel = -Infinity
        for (let index = 0; index < commands.length; ++index) {
          if (!player.applyActionCommand(commands[index])) {
            continue
          }
          let vector = vectoriseGrid()
          let label = modelValueLabel(vector)
          let category = commandCategory(commands[index])
          examples.push({
            playerIndex,
            turn: turnsPlayed + 1,
            category,
            product: commands[index].product || null,
            board: vector[0],
            global: vector[1]
          })
          labels.push(label)
          actionCounts[category] = (actionCounts[category] || 0) + 1
          if (label > bestLabel) {
            bestLabel = label
            bestCommand = commands[index]
          }
          actionManager.undo()
        }
        if (bestCommand) {
          player.applyActionCommand(bestCommand)
        }
        actionManager.clear()
        turnsPlayed += 1
      }
      gameRound += 1
    }

    return {
      mapSize: map.mapSize,
      playerCount: players.length - 1,
      seed: __trainingSeed,
      generatedMapProvenance: {
        generator: __trainingMapSource == 'final-symmetrical-economy' ?
          'generateSymmetricalEconomy9v9AllUnitMap' : 'generateTownTrainingMap',
        generated: true,
        fixedGamestartMap: __trainingMapSource == 'final-symmetrical-economy',
        size: __trainingMapSource == 'final-symmetrical-economy' ?
          'symmetrical-economy-9v9' : __trainingMapSize,
        seed: __trainingSeed,
        playerCount: players.length - 1
      },
      players: players.slice(1).map(function(player) {
        return player.constructor.name
      }),
      examples,
      labels,
      actionCounts,
      turnsPlayed,
      finalState: players.slice(1).map(function(player) {
        return {
          gold: player.gold,
          towns: player.towns.length,
          units: liveUnits(player),
          lost: player.isLost
        }
      }),
      winner: (() => {
        let active = []
        for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
          if (!players[playerIndex].isLost) {
            active.push(playerIndex)
          }
        }
        return active.length == 1 ? active[0] : null
      })(),
      mapFeatures: (() => {
        let features = {
          generatedSize: __trainingMapSize,
          towns: 0,
          neutralTowns: 0,
          goldmines: goldmines.length,
          units: 0,
          farms: 0,
          barracks: 0,
          external: external.length
        }
        for (let playerIndex = 0; playerIndex < players.length; ++playerIndex) {
          let player = players[playerIndex]
          features.towns += player.towns.length
          if (playerIndex == 0) {
            features.neutralTowns += player.towns.length
          }
          features.units += player.units.length
          for (let townIndex = 0; townIndex < player.towns.length; ++townIndex) {
            let buildings = player.towns[townIndex].buildings || []
            for (let buildingIndex = 0; buildingIndex < buildings.length; ++buildingIndex) {
              let building = buildings[buildingIndex]
              if (building.name == 'farm') {
                features.farms += 1
              }
              else if (building.name == 'barrack') {
                features.barracks += 1
              }
            }
          }
        }
        return features
      })()
    }
  })()`, { filename: 'economy-training-self-play.js' }).runInContext(context);

  for (const category of ACTION_CATEGORIES) {
    if (mapSource !== 'final-symmetrical-economy' &&
        !result.actionCounts[category]) {
      throw new Error(
        `real self-play did not apply ${category}: ${JSON.stringify(result.actionCounts)}`
      );
    }
  }
  if (mapSource === 'final-symmetrical-economy' &&
      result.players.join(',') !==
        'AIPlayerWithEconomy,SimpleAiPlayerWithEconomy') {
    throw new Error(`unexpected final-gate players: ${result.players.join(', ')}`);
  }
  if (mapSource !== 'final-symmetrical-economy' &&
      result.players.some(name => name !== 'AIPlayerWithEconomy')) {
    throw new Error(`unexpected self-play players: ${result.players.join(', ')}`);
  }
  return {
    map: {
      mapSize: result.mapSize,
      playerCount: result.playerCount,
      seed: result.seed,
      provenance: result.generatedMapProvenance
    },
    boards: result.examples.map(example =>
      adaptBoard(example.board, ECONOMY_MODEL_WIDTH, ECONOMY_MODEL_HEIGHT)),
    globals: result.examples.map(example => example.global),
    labels: result.labels,
    actionCounts: result.actionCounts,
    turnsPlayed: result.turnsPlayed,
    appliedActions: result.examples.map(example => ({
      playerIndex: example.playerIndex,
      turn: example.turn,
      category: example.category,
      product: example.product
    })),
    finalState: result.finalState,
    winner: result.winner,
    mapFeatures: result.mapFeatures
  };
}

async function saveCheckpoint(model, directory, metadata) {
  const temporary = `${directory}.tmp-${process.pid}`;
  removePath(temporary);
  await model.save(`file://${temporary}`);
  writeJson(path.join(temporary, 'metadata.json'), metadata);
  removePath(directory);
  fs.renameSync(temporary, directory);
}

function createCandidate(options, checkpointRoot, bestCheckpoint) {
  if (!bestCheckpoint) return null;
  const candidatePath = path.join(
    checkpointRoot,
    `step-${String(bestCheckpoint.game).padStart(8, '0')}`
  );
  return {
    runId: options.runId,
    selectedBy: 'lowest-training-loss',
    checkpoint: path.relative(options.storageDir, candidatePath),
    game: bestCheckpoint.game,
    loss: bestCheckpoint.loss
  };
}

function summarizeTrainingPlateau(metrics, candidate) {
  const losses = metrics
    .filter(metric => Number.isFinite(metric.loss))
    .map(metric => ({ game: metric.game, loss: metric.loss }));
  if (!losses.length) {
    return null;
  }
  const best = losses.reduce((currentBest, entry) =>
    entry.loss < currentBest.loss ? entry : currentBest, losses[0]);
  const selectedLoss = candidate && Number.isFinite(candidate.loss) ?
    candidate.loss : best.loss;
  const postBestLosses = losses
    .filter(entry => entry.game > best.game)
    .map(entry => entry.loss);
  return {
    evidence: postBestLosses.length > 0,
    selectedBy: candidate ? candidate.selectedBy : 'lowest-training-loss',
    selectedGame: candidate ? candidate.game : best.game,
    selectedLoss,
    bestGame: best.game,
    bestLoss: best.loss,
    finalLoss: losses[losses.length - 1].loss,
    gamesObserved: losses.length,
    postBestLosses,
    note: postBestLosses.length > 0 ?
      'Training continued after the selected low-loss checkpoint without finding a lower loss.' :
      'No post-selection training games were available to confirm a plateau.'
  };
}

function writeBenchmarkSnapshot(
  options,
  snapshotPath,
  checkpointRoot,
  metricsPath,
  finalDir,
  metrics,
  bestCheckpoint,
  status
) {
  const candidate = createCandidate(options, checkpointRoot, bestCheckpoint);
  const mapGenerator = options.mapSource === 'final-symmetrical-economy'
    ? 'generateSymmetricalEconomy9v9AllUnitMap'
    : 'generateTownTrainingMap';
  writeJson(snapshotPath, {
    runId: options.runId,
    status,
    trainer: 'AIPlayerWithEconomy',
    playerCounts: options.playerCounts,
    dataSource: 'real-runtime-self-play',
    mapSource: options.mapSource,
    mapGenerator,
    generatedMapProvenance: {
      generator: mapGenerator,
      generated: true,
      fixedGamestartMap: options.mapSource === 'final-symmetrical-economy'
    },
    cellVectorSize: CELL_VECTOR_SIZE,
    completedGames: metrics.length,
    plannedGames: options.games,
    games: metrics,
    candidate,
    plateau: summarizeTrainingPlateau(metrics, candidate),
    updatedAt: new Date().toISOString(),
    artifacts: {
      checkpoints: path.relative(options.storageDir, checkpointRoot),
      metrics: path.relative(options.storageDir, metricsPath),
      finalModel: path.relative(options.storageDir, finalDir)
    }
  });
  return candidate;
}

async function run(options) {
  options = Object.assign({
    playerCounts: [2, 3, 4],
    mapSource: 'town'
  }, options);
  const runDir = path.join(options.storageDir, 'runs', options.runId);
  const checkpointRoot = path.join(options.storageDir, 'checkpoints', options.runId);
  const metricsPath = path.join(options.storageDir, 'metrics', `${options.runId}.jsonl`);
  const snapshotPath = path.join(options.storageDir, 'benchmarks', `${options.runId}.json`);
  const finalDir = path.join(options.storageDir, 'final', options.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(checkpointRoot, { recursive: true });
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });

  const model = createModel(ECONOMY_MODEL_WIDTH, ECONOMY_MODEL_HEIGHT);
  const metrics = [];
  let bestCheckpoint = null;
  try {
    for (let game = 1; game <= options.games; game += 1) {
      const batch = createTrainingBatch(
        options.seed + game - 1,
        options.playerCounts,
        options.mapSource
      );
      const boardTensor = tf.tensor4d(
        batch.boards.flat(3),
        [
          batch.boards.length,
          ECONOMY_MODEL_WIDTH,
          ECONOMY_MODEL_HEIGHT,
          CELL_VECTOR_SIZE
        ]
      );
      const globalTensor = tf.tensor2d(batch.globals, [batch.globals.length, 1]);
      const labelTensor = tf.tensor2d(batch.labels, [batch.labels.length, 1]);
      let history;
      try {
        history = await model.fit(
          [boardTensor, globalTensor],
          labelTensor,
          { epochs: options.epochs, batchSize: 32, shuffle: false, verbose: 0 }
        );
      } finally {
        boardTensor.dispose();
        globalTensor.dispose();
        labelTensor.dispose();
      }
      const loss = history.history.loss[history.history.loss.length - 1];
      const metric = {
        type: 'economy-training-game',
        runId: options.runId,
        game,
        seed: options.seed + game - 1,
        playerCount: batch.map.playerCount,
        players: options.mapSource === 'final-symmetrical-economy'
          ? ['AIPlayerWithEconomy', 'SimpleAiPlayerWithEconomy']
          : new Array(batch.map.playerCount).fill('AIPlayerWithEconomy'),
        winner: batch.winner,
        dataSource: 'real-runtime-self-play',
        generatedMapProvenance: batch.map.provenance,
        mapSize: batch.map.mapSize,
        cellVectorSize: CELL_VECTOR_SIZE,
        examples: batch.labels.length,
        actionCounts: batch.actionCounts,
        economyActions: batch.labels.length - batch.actionCounts['unit-command'],
        actionsApplied: batch.appliedActions.length,
        turnsPlayed: batch.turnsPlayed,
        appliedActions: batch.appliedActions,
        finalState: batch.finalState,
        mapFeatures: batch.mapFeatures,
        loss,
        timestamp: new Date().toISOString()
      };
      metrics.push(metric);
      appendJsonLine(metricsPath, metric);
      if (game % options.checkpointInterval === 0 || game === options.games) {
        const checkpointDir = path.join(
          checkpointRoot,
          `step-${String(game).padStart(8, '0')}`
        );
        await saveCheckpoint(model, checkpointDir, {
          trainer: 'AIPlayerWithEconomy',
          game,
          seed: metric.seed,
          cellVectorSize: CELL_VECTOR_SIZE,
          modelBoardSize: {
            width: ECONOMY_MODEL_WIDTH,
            height: ECONOMY_MODEL_HEIGHT
          },
          actionCounts: batch.actionCounts,
          dataSource: metric.dataSource,
          actionsApplied: metric.actionsApplied,
          playerCount: metric.playerCount,
          winner: metric.winner,
          loss,
          mapGenerator: batch.map.provenance.generator,
          mapSource: options.mapSource,
          valueFunction: 'final-symmetrical-economy-v1'
        });
        if (!bestCheckpoint || loss < bestCheckpoint.loss) {
          bestCheckpoint = { game, loss };
        }
      }
      writeBenchmarkSnapshot(
        options,
        snapshotPath,
        checkpointRoot,
        metricsPath,
        finalDir,
        metrics,
        bestCheckpoint,
        'running'
      );
      if (options.onGameComplete) {
        await options.onGameComplete({ game, snapshotPath, finalDir });
      }
    }
    await model.save(`file://${finalDir}`);
  } finally {
    model.dispose();
  }

  const candidate = createCandidate(options, checkpointRoot, bestCheckpoint);
  writeJson(path.join(checkpointRoot, 'candidate.json'), candidate);
  writeBenchmarkSnapshot(
    options,
    snapshotPath,
    checkpointRoot,
    metricsPath,
    finalDir,
    metrics,
    bestCheckpoint,
    'complete'
  );
  writeJson(path.join(runDir, 'manifest.json'), {
    runId: options.runId,
    status: 'complete',
    configuration: options,
    candidate,
    snapshot: path.relative(options.storageDir, snapshotPath)
  });
  return { candidate, metrics, snapshotPath };
}

module.exports = {
    CELL_VECTOR_SIZE,
    ECONOMY_MODEL_WIDTH,
    ECONOMY_MODEL_HEIGHT,
  createTrainingBatch,
  getBrowserScriptCacheStats,
  parseArgs,
  resetBrowserScriptCache: resetTrainingRuntimeCache,
  run
};
