const fs = require('fs');
const path = require('path');
const vm = require('vm');
const tf = require('@tensorflow/tfjs-node');
const {
  createBrowserContext,
  detachBrowserResult,
  getBrowserScriptCacheStats,
  loadBrowserScripts,
  resetBrowserScriptCache
} = require('./browserScriptCache');
const { scoreFinalEconomyVector } =
  require('./benchmark-final-symmetrical-economy-gate');

const CELL_VECTOR_SIZE = 82;
const ECONOMY_MODEL_WIDTH = 9;
const ECONOMY_MODEL_HEIGHT = 9;
const ECONOMY_CONV_FILTERS = 16;
const ECONOMY_HIDDEN_UNITS = 64;
const ACTION_CATEGORIES = [
  'unit-command',
  'unit-training',
  'suburb-expansion',
  'building-placement'
];
const NATIVE_STAGE_COUNT = 8;
const NATIVE_MAP_GENERATORS = Object.fromEntries(
  Array.from({ length: NATIVE_STAGE_COUNT }, (_, index) => [
    `stage-${index + 1}-native`, `generateEconomyStage${index + 1}TrainingMap`
  ])
);
const MAP_SOURCES = [
  'town',
  ...Object.keys(NATIVE_MAP_GENERATORS),
  'final-symmetrical-economy',
  'advanced-9x9-economy',
  'advanced-20x20-economy'
];
const ADVANCED_9X9_STAGES = [7, 8, 9, 10, 11, 12];
let compiledTrainingRuntimeScript = null;

function parseArgs(argv) {
  const options = {
    storageDir: process.env.DIPLOMACY_STORAGE_DIR || '/mnt/storage/diplomacy',
    runId: `economy-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    games: 1,
    epochs: 1,
    seed: 36000,
    checkpointInterval: 1,
    playerCounts: [2, 3, 4],
    mapSource: 'town',
    initialCheckpoint: null
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
    else if (name === 'initial-checkpoint') options.initialCheckpoint = path.resolve(value);
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
  if (!MAP_SOURCES.includes(options.mapSource)) {
    throw new Error('map-source must be one of ' + MAP_SOURCES.join(', '));
  }
  if (options.initialCheckpoint) {
    const modelPath = path.basename(options.initialCheckpoint) === 'model.json'
      ? options.initialCheckpoint
      : path.join(options.initialCheckpoint, 'model.json');
    if (!fs.existsSync(modelPath)) {
      throw new Error(`initial checkpoint model is missing: ${modelPath}`);
    }
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

function createModel(width, height) {
  const boardInput = tf.input({
    shape: [width, height, CELL_VECTOR_SIZE],
    name: 'board'
  });
  const globalInput = tf.input({ shape: [1], name: 'global_variables' });
  const spatialFeatures = tf.layers.conv2d({
    filters: ECONOMY_CONV_FILTERS,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(boardInput);
  const flattened = tf.layers.flatten().apply(spatialFeatures);
  const merged = tf.layers.concatenate().apply([flattened, globalInput]);
  const hidden = tf.layers.dense({
    units: ECONOMY_HIDDEN_UNITS,
    activation: 'relu'
  }).apply(merged);
  const output = tf.layers.dense({
    units: 1,
    activation: 'linear',
    name: 'value_output'
  }).apply(hidden);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError'
  });
  return model;
}

function adaptBoard(board, expectedWidth, expectedHeight, expectedChannels = CELL_VECTOR_SIZE) {
  const width = board.length;
  const height = board[0] ? board[0].length : 0;
  const channels = board[0] && board[0][0] ? board[0][0].length : 0;
  if (width === expectedWidth && height === expectedHeight &&
      channels === expectedChannels) {
    return board;
  }
  const adapted = new Array(expectedWidth);
  for (let x = 0; x < expectedWidth; x += 1) {
    adapted[x] = new Array(expectedHeight);
    const sourceX = Math.min(width - 1, Math.floor(x * width / expectedWidth));
    for (let y = 0; y < expectedHeight; y += 1) {
      const sourceY = Math.min(height - 1, Math.floor(y * height / expectedHeight));
      adapted[x][y] = board[sourceX][sourceY].slice(0, expectedChannels);
      while (adapted[x][y].length < expectedChannels) {
        adapted[x][y].push(0);
      }
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

function advancedEconomy9x9StageForSeed(seed) {
  return ADVANCED_9X9_STAGES[Math.abs(seed) % ADVANCED_9X9_STAGES.length];
}

function isSymmetricalComparisonMapSource(mapSource) {
  return Boolean(NATIVE_MAP_GENERATORS[mapSource]) ||
    mapSource === 'final-symmetrical-economy' ||
    mapSource === 'advanced-9x9-economy' ||
    mapSource === 'advanced-20x20-economy';
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
  return createBrowserContext(context, seededMath.random);
}

function getTrainingRuntimeContext(seed) {
  const context = createRuntimeContext(seed);
  loadBrowserScripts(context);
  return context;
}

function resetTrainingRuntimeCache() {
  resetBrowserScriptCache();
}

function createTrainingBatch(
  seed,
  playerCounts,
  mapSource = 'town',
  seedBase = seed
) {
  const context = getTrainingRuntimeContext(seed);
  context.__trainingSeed = seed;
  context.__trainingSeedBase = seedBase;
  context.__trainingMapSize = trainingMapSizeForSeed(seed);
  context.__trainingPlayerCount = trainingPlayerCountForSeed(seed, playerCounts);
  context.__trainingMapSource = mapSource;
  context.__nativeMapGenerator = NATIVE_MAP_GENERATORS[mapSource] || null;
  context.__advanced9x9Stage = advancedEconomy9x9StageForSeed(seed);
  context.__actionCategories = ACTION_CATEGORIES;
  context.__trainingCandidateLimit = 48;
  context.__trainingRounds =
    mapSource === 'final-symmetrical-economy' ? 8 :
      (mapSource === 'advanced-9x9-economy' ? 6 :
        (mapSource === 'advanced-20x20-economy' ? 6 : 4));
  if (!compiledTrainingRuntimeScript) {
    compiledTrainingRuntimeScript = new vm.Script(`(() => {
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
    if (__nativeMapGenerator) {
      map = globalThis[__nativeMapGenerator]({ seed: __trainingSeed })
    }
    else if (__trainingMapSource == 'final-symmetrical-economy') {
      map = generateSymmetricalEconomy9v9AllUnitMap({
        seed: __trainingSeed,
        suddenDeathRound: 160
      })
      map.players[1].playerType = 'AIPlayerWithEconomy'
      map.players[2].playerType = 'SimpleAiPlayerWithEconomy'
    }
    else if (__trainingMapSource == 'advanced-9x9-economy') {
      let advancedOptions = {
        seed: __trainingSeed,
        suddenDeathRound: 120,
        unitComposition: 'all'
      }
      if (__advanced9x9Stage == 7) {
        map = generateAdvancedEconomyStage7TrainingMap(advancedOptions)
      }
      else if (__advanced9x9Stage == 8) {
        map = generateAdvancedEconomyStage8TrainingMap(advancedOptions)
      }
      else if (__advanced9x9Stage == 9) {
        map = generateAdvancedEconomyStage9TrainingMap(advancedOptions)
      }
      else if (__advanced9x9Stage == 10) {
        map = generateAdvancedEconomyStage10TrainingMap(advancedOptions)
      }
      else if (__advanced9x9Stage == 11) {
        map = generateAdvancedEconomyStage11TrainingMap(advancedOptions)
      }
      else if (__advanced9x9Stage == 12) {
        map = generateAdvancedEconomyStage12TrainingMap(advancedOptions)
      }
      else {
        throw new Error('unsupported advanced 9x9 economy stage ' + __advanced9x9Stage)
      }
      map.players[1].playerType = 'AIPlayerWithEconomy'
      map.players[2].playerType = 'SimpleAiPlayerWithEconomy'
    }
    else if (__trainingMapSource == 'advanced-20x20-economy') {
      let selectedSeed = __trainingSeed
      let selectedIndex = Math.max(0, __trainingSeed - __trainingSeedBase)
      let cursor = __trainingSeedBase
      for (let found = -1; found < selectedIndex; ++cursor) {
        let candidateMap = generateAdvancedEconomyStage14TrainingMap({
          seed: cursor,
          suddenDeathRound: 160,
          unitComposition: 'all'
        })
        if (candidateMap.players[1].towns.length == 1 &&
            candidateMap.players[2].towns.length == 1) {
          ++found
          selectedSeed = cursor
        }
      }
      map = generateAdvancedEconomyStage14TrainingMap({
        seed: selectedSeed,
        suddenDeathRound: 160,
        unitComposition: 'all'
      })
      __trainingSeed = selectedSeed
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
    function modelValueLabel(vector, playerIndex) {
      let tacticalScore = __scoreFinalEconomyVector(vector)
      return tacticalScore / 240000 + score(playerIndex) * 0.25
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
        if ((__nativeMapGenerator ||
            __trainingMapSource == 'final-symmetrical-economy' ||
            __trainingMapSource == 'advanced-9x9-economy' ||
            __trainingMapSource == 'advanced-20x20-economy') &&
            player.constructor.name != 'AIPlayerWithEconomy') {
          actionManager.clear()
          turnsPlayed += 1
          continue
        }
        let commands = player.getActionCommands()
        let bestCommand = null
        let bestLabel = -Infinity
        let stateLabelStart = labels.length
        for (let index = 0; index < commands.length; ++index) {
          if (!player.applyActionCommand(commands[index])) {
            continue
          }
          let vector = vectoriseGrid()
          let label = modelValueLabel(vector, playerIndex)
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
        let stateLabels = labels.slice(stateLabelStart)
        if (stateLabels.length) {
          let stateMin = Math.min(...stateLabels)
          let stateMax = Math.max(...stateLabels)
          let stateRange = stateMax - stateMin
          for (let index = stateLabelStart; index < labels.length; ++index) {
            labels[index] = stateRange > 0 ?
              (labels[index] - stateMin) / stateRange : 0.5
          }
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
        generator: __nativeMapGenerator ||
          (__trainingMapSource == 'final-symmetrical-economy' ?
          'generateSymmetricalEconomy9v9AllUnitMap' :
          (__trainingMapSource == 'advanced-9x9-economy' ?
            'generateAdvancedEconomyStage' + __advanced9x9Stage + 'TrainingMap' :
            (__trainingMapSource == 'advanced-20x20-economy' ?
              'generateAdvancedEconomyStage14TrainingMap' :
              'generateTownTrainingMap'))),
        generated: true,
        fixedGamestartMap: __trainingMapSource == 'final-symmetrical-economy',
        size: __nativeMapGenerator ?
          __trainingMapSource + '-' + map.mapSize.x + 'x' + map.mapSize.y :
          __trainingMapSource == 'final-symmetrical-economy' ?
          'symmetrical-economy-9v9' :
          (__trainingMapSource == 'advanced-9x9-economy' ?
            'advanced-economy-9x9' :
            (__trainingMapSource == 'advanced-20x20-economy' ?
              'advanced-economy-20x20' : __trainingMapSize)),
        seed: __trainingSeed,
        playerCount: players.length - 1,
        advancedEconomyStage: __trainingMapSource == 'advanced-9x9-economy' ?
          __advanced9x9Stage :
          (__trainingMapSource == 'advanced-20x20-economy' ? 14 : null)
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
          advancedEconomyStage: __trainingMapSource == 'advanced-9x9-economy' ?
            __advanced9x9Stage :
            (__trainingMapSource == 'advanced-20x20-economy' ? 14 : null),
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
  })()`, { filename: 'economy-training-self-play.js' });
  }
  const result = detachBrowserResult(compiledTrainingRuntimeScript.runInContext(context));

  for (const category of ACTION_CATEGORIES) {
    if (mapSource === 'town' &&
        !result.actionCounts[category]) {
      throw new Error(
        `real self-play did not apply ${category}: ${JSON.stringify(result.actionCounts)}`
      );
    }
  }
  if (isSymmetricalComparisonMapSource(mapSource) &&
      result.players.join(',') !== 'AIPlayerWithEconomy,SimpleAiPlayerWithEconomy') {
    throw new Error(`unexpected comparison players: ${result.players.join(', ')}`);
  }
  if (!isSymmetricalComparisonMapSource(mapSource) &&
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
    boards: result.examples.map(example => NATIVE_MAP_GENERATORS[mapSource]
      ? example.board : adaptBoard(example.board, ECONOMY_MODEL_WIDTH, ECONOMY_MODEL_HEIGHT)),
    globals: result.examples.map(example => example.global),
    labels: result.labels,
    actionCounts: result.actionCounts,
    players: result.players,
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

function combineTrainingBatches(primary, secondary) {
  if (!secondary) {
    return primary;
  }
  const actionCounts = Object.assign({}, primary.actionCounts);
  for (const [category, count] of Object.entries(secondary.actionCounts)) {
    actionCounts[category] = (actionCounts[category] || 0) + count;
  }
  return {
    map: Object.assign({}, primary.map, {
      augmentedSeeds: [primary.map.seed, secondary.map.seed]
    }),
    boards: primary.boards.concat(secondary.boards),
    globals: primary.globals.concat(secondary.globals),
    labels: primary.labels.concat(secondary.labels),
    actionCounts,
    turnsPlayed: primary.turnsPlayed + secondary.turnsPlayed,
    appliedActions: primary.appliedActions.concat(secondary.appliedActions),
    finalState: primary.finalState.concat(secondary.finalState),
    winner: primary.winner,
    mapFeatures: Object.assign({}, primary.mapFeatures, {
      augmentedMaps: 2,
      secondarySeed: secondary.map.seed
    })
  };
}

function economyCheckpointLabelScale(mapSource) {
  return isSymmetricalComparisonMapSource(mapSource) ? 1 : 180000;
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
    selectedBy: options.mapSource === 'final-symmetrical-economy' ?
      'latest-final-symmetrical-training-checkpoint' :
      (options.mapSource === 'advanced-9x9-economy' ?
        'lowest-advanced-9x9-training-loss' :
        (options.mapSource === 'advanced-20x20-economy' ?
          'lowest-advanced-20x20-training-loss' : 'lowest-training-loss')),
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
  status,
  modelShape
) {
  const candidate = createCandidate(options, checkpointRoot, bestCheckpoint);
  const mapGenerator = NATIVE_MAP_GENERATORS[options.mapSource] ||
    (options.mapSource === 'final-symmetrical-economy'
    ? 'generateSymmetricalEconomy9v9AllUnitMap'
    : (options.mapSource === 'advanced-9x9-economy'
      ? 'generateAdvancedEconomyStage7To12TrainingMap'
      : (options.mapSource === 'advanced-20x20-economy'
        ? 'generateAdvancedEconomyStage14TrainingMap'
        : 'generateTownTrainingMap')));
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
      fixedGamestartMap: options.mapSource === 'final-symmetrical-economy',
      advancedEconomyStages: options.mapSource === 'advanced-9x9-economy'
        ? ADVANCED_9X9_STAGES
        : (options.mapSource === 'advanced-20x20-economy' ? [14] : undefined)
    },
    cellVectorSize: modelShape.channels,
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

  // Infer native axes from the actual first batch; never resize native vectors.
  const nativeBatch = NATIVE_MAP_GENERATORS[options.mapSource]
    ? createTrainingBatch(options.seed, options.playerCounts, options.mapSource, options.seed)
    : null;
  const initialModelPath = options.initialCheckpoint &&
    (path.basename(options.initialCheckpoint) === 'model.json'
      ? options.initialCheckpoint
      : path.join(options.initialCheckpoint, 'model.json'));
  const model = initialModelPath
    ? await tf.loadLayersModel(`file://${initialModelPath}`)
    : createModel(
      nativeBatch ? nativeBatch.map.mapSize.x : ECONOMY_MODEL_WIDTH,
      nativeBatch ? nativeBatch.map.mapSize.y : ECONOMY_MODEL_HEIGHT);
  if (initialModelPath) {
    model.compile({ optimizer: tf.train.adam(0.0001), loss: 'meanSquaredError' });
  }
  const inputShape = model.inputs[0].shape;
  const modelShape = {
    width: inputShape[1],
    height: inputShape[2],
    channels: inputShape[3]
  };
  const metrics = [];
  let bestCheckpoint = null;
  try {
    for (let game = 1; game <= options.games; game += 1) {
      const primarySeed = options.seed + game - 1;
      let batch = game === 1 && nativeBatch ? nativeBatch : createTrainingBatch(
        primarySeed,
        options.playerCounts,
        options.mapSource,
        options.seed
      );
      if (options.mapSource === 'final-symmetrical-economy') {
        batch = combineTrainingBatches(
          batch,
          createTrainingBatch(
            primarySeed + options.games,
            options.playerCounts,
            options.mapSource,
            options.seed
          )
        );
      }
      const modelBoards = batch.boards.map(board => {
        if (nativeBatch) {
          if (modelShape.width !== batch.map.mapSize.x || modelShape.height !== batch.map.mapSize.y ||
              modelShape.channels !== CELL_VECTOR_SIZE) {
            throw new Error(options.mapSource + ' requires an unmodified ' +
              batch.map.mapSize.x + 'x' + batch.map.mapSize.y + 'x' + CELL_VECTOR_SIZE + ' model');
          }
          return board;
        }
        return adaptBoard(board, modelShape.width, modelShape.height, modelShape.channels);
      });
      const boardTensor = tf.tensor4d(
        modelBoards.flat(3),
        [
          modelBoards.length,
          modelShape.width,
          modelShape.height,
          modelShape.channels
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
        seed: primarySeed,
        augmentedSeeds: batch.map.augmentedSeeds || [primarySeed],
        playerCount: batch.map.playerCount,
        players: batch.players,
        winner: batch.winner,
        dataSource: 'real-runtime-self-play',
        generatedMapProvenance: batch.map.provenance,
        mapSize: batch.map.mapSize,
        cellVectorSize: modelShape.channels,
        examples: batch.labels.length,
        actionCounts: batch.actionCounts,
        economyActions: batch.labels.length - (batch.actionCounts['unit-command'] || 0),
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
          augmentedSeeds: metric.augmentedSeeds,
          cellVectorSize: modelShape.channels,
          modelBoardSize: {
            width: modelShape.width,
            height: modelShape.height
          },
          initialCheckpoint: options.initialCheckpoint,
          actionCounts: batch.actionCounts,
          dataSource: metric.dataSource,
          actionsApplied: metric.actionsApplied,
          playerCount: metric.playerCount,
          winner: metric.winner,
          loss,
          mapGenerator: batch.map.provenance.generator,
          mapSource: options.mapSource,
          valueFunction: 'final-symmetrical-economy-v2',
          labelScale: economyCheckpointLabelScale(options.mapSource),
          featureFusionWeight: 1,
          labelComponents: [
            'final symmetrical economy feature score',
            'real runtime player material score',
            (options.mapSource === 'final-symmetrical-economy' ||
              options.mapSource === 'advanced-9x9-economy' ||
              options.mapSource === 'advanced-20x20-economy') ?
              'low-weight trained correction for symmetrical economy actions' :
              'scaled trained economy value'
          ]
        });
        if (options.mapSource === 'final-symmetrical-economy' ||
            !bestCheckpoint || loss < bestCheckpoint.loss) {
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
        'running',
        modelShape
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
    'complete',
    modelShape
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
  createModel,
  createTrainingBatch,
  saveCheckpoint,
  getBrowserScriptCacheStats,
  parseArgs,
  resetBrowserScriptCache: resetTrainingRuntimeCache,
  run
};
