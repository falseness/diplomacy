const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs-node');
const { loadAiScripts, readRepoFile } = require('./smokeHarness');

const CELL_VECTOR_SIZE = 78;
const UNIT_PRODUCTS = ['noob', 'archer', 'KOHb', 'normchel', 'catapult'];
const BUILDING_PRODUCTS = ['suburb', 'farm', 'barrack', 'wall', 'bastion', 'tower'];

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
    fs.rmdirSync(filePath, { recursive: true });
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

function addFeature(board, width, height, coord, channel, value = 1) {
  if (!coord || coord.x < 0 || coord.y < 0 || coord.x >= width || coord.y >= height) {
    return;
  }
  board[(coord.y * width + coord.x) * CELL_VECTOR_SIZE + channel] = value;
}

function createBoardVector(map, playerIndex) {
  const width = map.mapSize.x;
  const height = map.mapSize.y;
  const board = new Float32Array(width * height * CELL_VECTOR_SIZE);
  const opponentIndex = playerIndex === 1 ? 2 : 1;
  const encodePlayer = (configured, relation) => {
    for (const town of configured.towns || []) addFeature(board, width, height, town, 7, relation);
    for (const unit of configured.units || []) {
      const unitName = unit.type && unit.type.name ? unit.type.name : String(unit.type);
      addFeature(board, width, height, unit, 20 + UNIT_PRODUCTS.indexOf(unitName), relation);
    }
    for (const layout of configured.suburbs || []) {
      for (const suburb of layout.cells || []) addFeature(board, width, height, suburb, 50, relation);
      for (const expansion of layout.expansionCells || []) addFeature(board, width, height, expansion, 51, relation);
    }
    const collections = [
      ['barracks', 30],
      ['pendingBarracks', 31],
      ['farms', 32],
      ['pendingFarms', 33],
      ['walls', 34],
      ['bastions', 35],
      ['towers', 36]
    ];
    for (const [name, channel] of collections) {
      for (const item of configured[name] || []) addFeature(board, width, height, item, channel, relation);
    }
  };
  encodePlayer(map.players[playerIndex], 1);
  encodePlayer(map.players[opponentIndex], -1);
  for (const mine of map.goldmines || []) {
    const relation = mine.owner === playerIndex ? 1 : (mine.owner === opponentIndex ? -1 : 0.5);
    addFeature(board, width, height, mine, 42, relation);
    addFeature(board, width, height, mine, 43, mine.income / 100);
  }
  for (const coord of map.lakes || []) addFeature(board, width, height, coord, 2);
  for (const coord of map.mountains || []) addFeature(board, width, height, coord, 3);
  return board;
}

function actionDestination(command) {
  return command.destinationCoord || command.producerCoord || { x: 0, y: 0 };
}

function vectorAfterAction(baseBoard, map, command) {
  const result = new Float32Array(baseBoard);
  const categoryChannels = {
    'unit-command': 60,
    'unit-training': 61,
    'suburb-expansion': 62,
    'building-placement': 63
  };
  const category = command.type === 'economy' ? command.category : 'unit-command';
  addFeature(
    result,
    map.mapSize.x,
    map.mapSize.y,
    actionDestination(command),
    categoryChannels[category]
  );
  return result;
}

function actionTarget(command) {
  if (command.type !== 'economy') return 0.25;
  if (command.product === 'farm' || command.product === 'suburb') return 0.9;
  if (command.product === 'barrack') return 0.7;
  if (UNIT_PRODUCTS.includes(command.product)) return 0.6;
  return 0.4;
}

function makeProducer(name, coord, destinations) {
  return {
    name,
    coord: { x: coord.x, y: coord.y },
    killed: false,
    isBadlyDamaged: false,
    isPreparingUnit: false,
    buildings: [],
    notEmpty() { return true; },
    needInstructions() { return false; },
    getAvailableProductionCells(product) {
      return destinations[product] || [];
    }
  };
}

function createActionContext(map, playerIndex) {
  const configured = map.players[playerIndex];
  const destinations = {};
  for (const product of BUILDING_PRODUCTS) destinations[product] = [];
  for (const layout of configured.suburbs || []) {
    const expansion = (layout.expansionCells || [])[0];
    if (expansion) destinations.suburb.push(expansion);
    const owned = (layout.cells || []).filter(coord =>
      coord.x !== layout.town.x || coord.y !== layout.town.y);
    for (let index = 0; index < BUILDING_PRODUCTS.length; index += 1) {
      const product = BUILDING_PRODUCTS[index];
      if (product !== 'suburb' && owned[index % Math.max(owned.length, 1)]) {
        destinations[product].push(owned[index % owned.length]);
      }
    }
  }
  const towns = (configured.towns || []).map(coord => makeProducer('town', coord, destinations));
  for (let index = 0; index < (configured.barracks || []).length; index += 1) {
    const barrack = makeProducer('barrack', configured.barracks[index], destinations);
    towns[index % towns.length].buildings.push(barrack);
  }
  const units = (configured.units || []).map((unit, index) => ({
    killed: false,
    moves: 1,
    coord: { x: unit.x, y: unit.y },
    getAvailableCommands() {
      return [{
        type: 'unit',
        whoDoCommandCoord: this.coord,
        destinationCoord: {
          x: Math.min(map.mapSize.x - 1, this.coord.x + (index % 2)),
          y: this.coord.y
        }
      }];
    }
  }));
  const production = {};
  for (const product of UNIT_PRODUCTS.concat(BUILDING_PRODUCTS)) {
    production[product] = {
      cost: UNIT_PRODUCTS.includes(product) ? 20 : 10,
      production: class MockProduction {
        static isUnitProduction() {
          return UNIT_PRODUCTS.includes(product);
        }
      }
    };
  }
  const context = vm.createContext({
    console,
    Math,
    production,
    gameSettings: { testAI: false },
    Player: class Player {
      constructor(color, gold) {
        this.color = color;
        this.gold = gold;
        this.towns = [];
        this.units = [];
      }
      nextTurn() {}
      updateUnits() {}
    },
    BestEnemyTargetForAI: class BestEnemyTargetForAI {},
    assert(condition) {
      if (!condition) throw new Error('AIPlayerWithEconomy assertion failed');
    },
    grid: {},
    actionManager: {},
    areCoordsEqual(left, right) {
      return left.x === right.x && left.y === right.y;
    }
  });
  new vm.Script(readRepoFile('ai/players.js'), {
    filename: 'ai/players.js'
  }).runInContext(context);
  context.__towns = towns;
  context.__units = units;
  context.__gold = configured.gold;
  return new vm.Script(`
    (() => {
      const player = new AIPlayerWithEconomy({r: 255, g: 0, b: 0}, __gold)
      player.towns = __towns
      player.units = __units
      return player.getActionCommands()
    })()
  `).runInContext(context);
}

function createTrainingBatch(generateTownTrainingMap, seed) {
  const map = generateTownTrainingMap({
    size: 'tiny',
    seed,
    buildingDensity: 'dense',
    barrackDensity: 1,
    farmDensity: 1,
    externalDensity: 1,
    suburbDensity: 1,
    unitComposition: 'all',
    unitsPerPlayer: 5,
    goldmineCount: 5,
    startingGoldMin: 500,
    startingGoldMax: 500
  });
  const boards = [];
  const globals = [];
  const labels = [];
  const actionCounts = {};
  for (const playerIndex of [1, 2]) {
    const commands = createActionContext(map, playerIndex);
    const baseBoard = createBoardVector(map, playerIndex);
    const opponentIndex = playerIndex === 1 ? 2 : 1;
    const goldAdvantage = (
      map.players[playerIndex].gold - map.players[opponentIndex].gold
    ) / 1000;
    for (const command of commands) {
      const category = command.type === 'economy' ? command.category : 'unit-command';
      actionCounts[category] = (actionCounts[category] || 0) + 1;
      boards.push(vectorAfterAction(baseBoard, map, command));
      globals.push(goldAdvantage);
      labels.push(actionTarget(command));
    }
  }
  if (!actionCounts['unit-command'] ||
      !actionCounts['unit-training'] ||
      !actionCounts['suburb-expansion'] ||
      !actionCounts['building-placement']) {
    throw new Error(`incomplete AIPlayerWithEconomy action space: ${JSON.stringify(actionCounts)}`);
  }
  return { map, boards, globals, labels, actionCounts };
}

async function saveCheckpoint(model, directory, metadata) {
  const temporary = `${directory}.tmp-${process.pid}`;
  removePath(temporary);
  await model.save(`file://${temporary}`);
  writeJson(path.join(temporary, 'metadata.json'), metadata);
  removePath(directory);
  fs.renameSync(temporary, directory);
}

async function run(options) {
  const { context } = loadAiScripts();
  const generateTownTrainingMap = context.generateTownTrainingMap;
  if (typeof generateTownTrainingMap !== 'function') {
    throw new Error('economy map generator is unavailable');
  }
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
  let best = null;
  try {
    for (let game = 1; game <= options.games; game += 1) {
      const batch = createTrainingBatch(generateTownTrainingMap, options.seed + game - 1);
      const boardTensor = tf.tensor4d(
        batch.boards.flatMap(board => Array.from(board)),
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
        dataSource: 'self-play-action-enumeration',
        mapSize: batch.map.mapSize,
        cellVectorSize: CELL_VECTOR_SIZE,
        examples: batch.labels.length,
        actionCounts: batch.actionCounts,
        economyActions: batch.labels.length - batch.actionCounts['unit-command'],
        loss,
        timestamp: new Date().toISOString()
      };
      metrics.push(metric);
      appendJsonLine(metricsPath, metric);
      if (!best || loss < best.loss) best = { game, loss };
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
          loss,
          mapGenerator: 'generateTownTrainingMap'
        });
      }
    }
    await model.save(`file://${finalDir}`);
  } finally {
    model.dispose();
  }

  const candidatePath = path.join(
    checkpointRoot,
    `step-${String(best.game).padStart(8, '0')}`
  );
  const candidate = {
    runId: options.runId,
    selectedBy: 'lowest-training-loss',
    checkpoint: path.relative(options.storageDir, candidatePath),
    game: best.game,
    loss: best.loss
  };
  writeJson(path.join(checkpointRoot, 'candidate.json'), candidate);
  writeJson(snapshotPath, {
    runId: options.runId,
    trainer: 'AIPlayerWithEconomy',
    players: ['AIPlayerWithEconomy', 'AIPlayerWithEconomy'],
    dataSource: 'self-play-action-enumeration',
    mapGenerator: 'generateTownTrainingMap',
    cellVectorSize: CELL_VECTOR_SIZE,
    games: metrics,
    candidate,
    artifacts: {
      checkpoints: path.relative(options.storageDir, checkpointRoot),
      metrics: path.relative(options.storageDir, metricsPath),
      finalModel: path.relative(options.storageDir, finalDir)
    }
  });
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
