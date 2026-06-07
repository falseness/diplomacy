const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs-node');
const { readRepoFile } = require('./smokeHarness');

const CELL_VECTOR_SIZE = 78;
const ACTION_CATEGORIES = [
  'unit-command',
  'unit-training',
  'suburb-expansion',
  'building-placement'
];

function parseArgs(argv) {
  const options = {
    storageDir: process.env.DIPLOMACY_STORAGE_DIR || '/mnt/storage/diplomacy',
    runId: `economy-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    games: 1,
    epochs: 1,
    seed: 36000,
    checkpointInterval: 1
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
  const hidden = tf.layers.dense({ units: 32, activation: 'relu' }).apply(merged);
  const output = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    name: 'value_output'
  }).apply(hidden);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError'
  });
  return model;
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
    io() { return {}; },
    tf: {},
    saveAs() {}
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function loadBrowserScripts(context) {
  const html = readRepoFile('index.html');
  const scriptPattern = /<script[^>]+src=['"]([^'"]+)['"]/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    if (/^https?:/.test(match[1])) continue;
    new vm.Script(readRepoFile(match[1]), {
      filename: match[1]
    }).runInContext(context);
  }
}

function createTrainingBatch(seed) {
  const context = createRuntimeContext(seed);
  loadBrowserScripts(context);
  context.__trainingSeed = seed;
  context.__actionCategories = ACTION_CATEGORIES;
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
    let map = generateTownTrainingMap({
      size: 'tiny',
      seed: __trainingSeed,
      buildingDensity: 'dense',
      barrackDensity: 1,
      pendingBarrackProbability: 0,
      farmDensity: 1,
      pendingFarmProbability: 0,
      externalDensity: 1,
      suburbDensity: 1,
      unitComposition: 'all',
      unitsPerPlayer: 5,
      goldmineCount: 5,
      startingGoldMin: 500,
      startingGoldMax: 500
    })
    map.players[1].playerType = 'AIPlayerWithEconomy'
    map.players[2].playerType = 'AIPlayerWithEconomy'
    map.start(manager, false)
    suddenDeathRound = 2000

    let examples = []
    let actionCounts = {}
    let categoryCursor = 0
    let turnsPlayed = 0
    for (let round = 0; round < 12; ++round) {
      for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
        whooseTurn = playerIndex
        let player = players[playerIndex]
        player.nextTurn()
        let commands = player.getActionCommands()
        let desired = __actionCategories[
          categoryCursor % __actionCategories.length]
        let ordered = commands.filter(function(command) {
          let category = command.type == 'economy' ?
            command.category : 'unit-command'
          return category == desired
        }).concat(commands.filter(function(command) {
          let category = command.type == 'economy' ?
            command.category : 'unit-command'
          return category != desired
        }))
        let applied = null
        for (let index = 0; index < ordered.length; ++index) {
          if (player.applyActionCommand(ordered[index])) {
            applied = ordered[index]
            break
          }
        }
        if (applied) {
          let vector = vectoriseGrid()
          let category = applied.type == 'economy' ?
            applied.category : 'unit-command'
          examples.push({
            playerIndex,
            turn: turnsPlayed + 1,
            category,
            product: applied.product || null,
            board: vector[0],
            global: vector[1]
          })
          actionCounts[category] = (actionCounts[category] || 0) + 1
          categoryCursor += 1
        }
        actionManager.clear()
        turnsPlayed += 1
      }
      gameRound += 1
    }

    function liveUnits(player) {
      return player.units.filter(function(unit) { return !unit.killed }).length
    }
    function score(playerIndex) {
      let opponentIndex = playerIndex == 1 ? 2 : 1
      let player = players[playerIndex]
      let opponent = players[opponentIndex]
      if (opponent.isLost) return 1
      if (player.isLost) return -1
      let material =
        (player.towns.length - opponent.towns.length) * 0.35 +
        (liveUnits(player) - liveUnits(opponent)) * 0.08 +
        (player.gold - opponent.gold) / 1000
      return Math.max(-1, Math.min(1, material))
    }
    return {
      mapSize: map.mapSize,
      players: players.slice(1).map(function(player) {
        return player.constructor.name
      }),
      examples,
      labels: examples.map(function(example) {
        return score(example.playerIndex)
      }),
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
      mapFeatures: {
        goldmines: map.goldmines.length,
        units: map.players[1].units.length + map.players[2].units.length,
        farms: map.players[1].farms.length + map.players[2].farms.length,
        barracks:
          map.players[1].barracks.length + map.players[2].barracks.length,
        external:
          map.players[1].walls.length + map.players[2].walls.length +
          map.players[1].bastions.length + map.players[2].bastions.length +
          map.players[1].towers.length + map.players[2].towers.length
      }
    }
  })()`, { filename: 'economy-training-self-play.js' }).runInContext(context);

  for (const category of ACTION_CATEGORIES) {
    if (!result.actionCounts[category]) {
      throw new Error(
        `real self-play did not apply ${category}: ${JSON.stringify(result.actionCounts)}`
      );
    }
  }
  if (result.players.some(name => name !== 'AIPlayerWithEconomy')) {
    throw new Error(`unexpected self-play players: ${result.players.join(', ')}`);
  }
  return {
    map: { mapSize: result.mapSize },
    boards: result.examples.map(example => example.board),
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
  writeJson(snapshotPath, {
    runId: options.runId,
    status,
    trainer: 'AIPlayerWithEconomy',
    players: ['AIPlayerWithEconomy', 'AIPlayerWithEconomy'],
    dataSource: 'real-runtime-self-play',
    mapGenerator: 'generateTownTrainingMap',
    cellVectorSize: CELL_VECTOR_SIZE,
    completedGames: metrics.length,
    plannedGames: options.games,
    games: metrics,
    candidate,
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
  const runDir = path.join(options.storageDir, 'runs', options.runId);
  const checkpointRoot = path.join(options.storageDir, 'checkpoints', options.runId);
  const metricsPath = path.join(options.storageDir, 'metrics', `${options.runId}.jsonl`);
  const snapshotPath = path.join(options.storageDir, 'benchmarks', `${options.runId}.json`);
  const finalDir = path.join(options.storageDir, 'final', options.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(checkpointRoot, { recursive: true });
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });

  const model = createModel(7, 7);
  const metrics = [];
  let bestCheckpoint = null;
  try {
    for (let game = 1; game <= options.games; game += 1) {
      const batch = createTrainingBatch(options.seed + game - 1);
      const boardTensor = tf.tensor4d(
        batch.boards.flat(3),
        [batch.boards.length, 7, 7, CELL_VECTOR_SIZE]
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
        players: ['AIPlayerWithEconomy', 'AIPlayerWithEconomy'],
        dataSource: 'real-runtime-self-play',
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
          actionCounts: batch.actionCounts,
          dataSource: metric.dataSource,
          actionsApplied: metric.actionsApplied,
          loss,
          mapGenerator: 'generateTownTrainingMap'
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
  createTrainingBatch,
  parseArgs,
  run
};
