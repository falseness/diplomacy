const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');
const {
  createBrowserContext,
  detachBrowserResult,
  getBrowserScriptCacheStats,
  loadBrowserScript,
  loadBrowserScripts,
  resetBrowserScriptCache
} = require('./browserScriptCache');

const repoRoot = path.resolve(__dirname, '..');
let compiledBenchmarkRuntimeScript = null;
let compiledInjectedModelScript = null;

function loadPlayerClasses() {
  const context = vm.createContext({
    console,
    Math,
    Player: class Player {
      constructor(color, gold = 90) {
        this.color = color;
        this.gold = gold;
        this.units = [];
      }
    },
    BestEnemyTargetForAI: class BestEnemyTargetForAI {},
    assert(condition) {
      if (!condition) {
        throw new Error('assertion failed');
      }
    },
    gameSettings: { testAI: false }
  });
  loadBrowserScript(context, 'ai/players.js');
  return new vm.Script(`({
    SimpleAiPlayer,
    SimpleAiPlayerWithEconomy,
    AIPlayer,
    AIPlayerWithEconomy
  })`).runInContext(context);
}

const PLAYER_CLASSES = loadPlayerClasses();

const BENCHMARK_MAPS = {
  'tiny-duel': {
    width: 9,
    height: 7,
    suddenDeathRound: 16,
    blocked: [{ x: 4, y: 2 }, { x: 4, y: 4 }],
    players: [
      {
        town: { x: 1, y: 3 },
        units: [{ x: 2, y: 2 }, { x: 2, y: 4 }]
      },
      {
        town: { x: 7, y: 3 },
        units: [{ x: 6, y: 2 }, { x: 6, y: 4 }]
      }
    ]
  },
  'big-open-field': {
    width: 21,
    height: 21,
    suddenDeathRound: 45,
    blocked: [
      { x: 10, y: 7 },
      { x: 10, y: 8 },
      { x: 10, y: 12 },
      { x: 10, y: 13 }
    ],
    players: [
      {
        town: { x: 3, y: 10 },
        units: [{ x: 4, y: 8 }, { x: 4, y: 10 }, { x: 4, y: 12 }]
      },
      {
        town: { x: 17, y: 10 },
        units: [{ x: 16, y: 8 }, { x: 16, y: 10 }, { x: 16, y: 12 }]
      }
    ]
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function codeRevision() {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    return 'unknown';
  }
}

function benchmarkMapFromGameMap(gameMap) {
  if (!gameMap || !gameMap.mapSize || !Array.isArray(gameMap.players) ||
      gameMap.players.length !== 3) {
    throw new Error('GameMap benchmark requires neutral plus two players');
  }
  const players = gameMap.players.slice(1).map(function(player, playerIndex) {
    if (!player.towns) {
      throw new Error('GameMap benchmark players require towns arrays');
    }
    const towns = player.towns.map(function(town) {
      return { x: town.x, y: town.y };
    });
    const primaryTown = towns[0] || null;
    const units = (player.units || []).map(function(unit) {
      return {
        x: unit.x,
        y: unit.y,
        type: unit.type && unit.type.name ? unit.type.name : null,
        hp: unit.hp
      };
    });
    if (!units.length && primaryTown) {
      units.push({
        x: primaryTown.x + (playerIndex === 0 ? 1 : -1),
        y: primaryTown.y
      });
    }
    return {
      town: primaryTown,
      towns,
      units,
      economyEnabled: player.economyEnabled !== false,
      suburbs: player.suburbs || [],
      barracks: player.barracks || [],
      pendingBarracks: player.pendingBarracks || [],
      farms: player.farms || [],
      pendingFarms: player.pendingFarms || [],
      walls: player.walls || [],
      bastions: player.bastions || [],
      towers: player.towers || []
    };
  });
  return {
    width: gameMap.mapSize.x,
    height: gameMap.mapSize.y,
    suddenDeathRound: Number(gameMap.suddenDeathRound),
    blocked: []
      .concat(gameMap.lakes || [])
      .concat(gameMap.mountains || [])
      .concat(gameMap.bushes || [])
      .concat(gameMap.hills || []),
    goldmines: gameMap.goldmines || [],
    lakes: gameMap.lakes || [],
    mountains: gameMap.mountains || [],
    bushes: gameMap.bushes || [],
    hills: gameMap.hills || [],
    players
  };
}

function validatePlayerClass(playerClass) {
  if (!PLAYER_CLASSES[playerClass]) {
    throw new Error(
      'Unknown player class "' + playerClass + '". Expected one of: ' +
      Object.keys(PLAYER_CLASSES).join(', ')
    );
  }
}

function createSeededMath(seed) {
  const seededMath = Object.create(Math);
  let randomState = Number(seed) >>> 0;
  if (!randomState) {
    randomState = 0x9e3779b9;
  }
  seededMath.random = function() {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  return seededMath;
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
    loadSlotInfo() { return { whooseTurn: -1 }; },
    saveSlotInfo() {},
    __resetHarnessStorage() {
      for (const key of Object.keys(storage)) {
        delete storage[key];
      }
    },
    io() { return {}; },
    tf: {},
    saveAs() {},
    __benchmarkInferenceCalls: 0,
    __benchmarkInferencePositions: 0
  };
  return createBrowserContext(context, createSeededMath(seed).random);
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadBenchmarkBrowserScripts(context, options) {
  options = options || {};
  loadBrowserScripts(context, options);
  injectBenchmarkModel(context, options);
}

function injectBenchmarkModel(context, options) {
  options = options || {};
  if (typeof options.predictFunction === 'function') {
    context.__benchmarkModelIdentifier =
      options.modelIdentifier || { benchmarkInjectedModel: true };
    context.__benchmarkPredictFunction = function(model, xValidateArr,
      activePlayerIndex) {
      context.__benchmarkInferenceCalls += 1;
      context.__benchmarkInferencePositions += xValidateArr.length;
      return options.predictFunction(model, xValidateArr, {
        activePlayerIndex: Number(activePlayerIndex),
        activeSide: activePlayerIndex === 1 ? 'A' :
          (activePlayerIndex === 2 ? 'B' : null)
      });
    };
    if (!compiledInjectedModelScript) {
      compiledInjectedModelScript = new vm.Script(`
      ai_model = __benchmarkModelIdentifier
      predict = function(model, vectorizedGrids) {
        return __benchmarkPredictFunction(
          model,
          vectorizedGrids,
          typeof whooseTurn == 'undefined' ? null : whooseTurn)
      }
    `, { filename: 'benchmark-injected-model.js' });
    }
    compiledInjectedModelScript.runInContext(context);
    context.__benchmarkInferenceSource =
      options.inferenceSource || 'injected benchmark model';
    return;
  }
  context.__benchmarkInferenceSource = 'none';
}

function createLoadedRuntimeContext(seed, options) {
  const context = createRuntimeContext(seed);
  loadBenchmarkBrowserScripts(context, options);
  return context;
}

function getBenchmarkRuntimeContext(seed, options) {
  // Only immutable scripts are shared; browser globals belong to one game.
  return createLoadedRuntimeContext(seed, options);
}

function resetBenchmarkRuntimeCache() {
  resetBrowserScriptCache();
}

function runtimeMapScript() {
  return `
(() => {
  let configured = __benchmarkConfiguredMap
  let benchmarkOptions = __benchmarkOptions
  isFogOfWar = false
  gameSettings.testAI = true
  gameSettings.isOnline = false
  gameSettings.aiActionLimit = Number(benchmarkOptions.actionLimit || 30)
  gameSettings.aiCommandLimit = Number(benchmarkOptions.commandLimit || 60)
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
  nextTurnPauseInterface = {visible: false, backToMenu() {}}
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
  let unitTypes = {
    Noob: Noob,
    Archer: Archer,
    KOHb: KOHb,
    Normchel: Normchel,
    Catapult: Catapult
  }
  function configuredUnit(unit) {
    let result = {
      x: unit.x,
      y: unit.y,
      type: unitTypes[unit.type] || Noob
    }
    if (unit.hp !== undefined) {
      result.hp = unit.hp
    }
    return result
  }
  let map = new GameMap(
    {x: configured.width, y: configured.height},
    [
      {rgb: {r: 0, g: 0, b: 0}, towns: []},
      {
        rgb: {r: 255, g: 0, b: 0},
        towns: configured.players[0].towns ||
          (configured.players[0].town ? [configured.players[0].town] : []),
        units: configured.players[0].units.map(configuredUnit),
        economyEnabled: configured.players[0].economyEnabled,
        suburbs: configured.players[0].suburbs || [],
        barracks: configured.players[0].barracks || [],
        pendingBarracks: configured.players[0].pendingBarracks || [],
        farms: configured.players[0].farms || [],
        pendingFarms: configured.players[0].pendingFarms || [],
        walls: configured.players[0].walls || [],
        bastions: configured.players[0].bastions || [],
        towers: configured.players[0].towers || [],
        playerType: benchmarkOptions.playerA
      },
      {
        rgb: {r: 98, g: 168, b: 222},
        towns: configured.players[1].towns ||
          (configured.players[1].town ? [configured.players[1].town] : []),
        units: configured.players[1].units.map(configuredUnit),
        economyEnabled: configured.players[1].economyEnabled,
        suburbs: configured.players[1].suburbs || [],
        barracks: configured.players[1].barracks || [],
        pendingBarracks: configured.players[1].pendingBarracks || [],
        farms: configured.players[1].farms || [],
        pendingFarms: configured.players[1].pendingFarms || [],
        walls: configured.players[1].walls || [],
        bastions: configured.players[1].bastions || [],
        towers: configured.players[1].towers || [],
        playerType: benchmarkOptions.playerB
      }
    ],
    configured.goldmines || [],
    configured.lakes || [],
    configured.mountains || [],
    configured.bushes || [],
    configured.hills || []
  )
  map.suddenDeathRound = configured.suddenDeathRound
  map.start(manager, false)
  suddenDeathRound = map.suddenDeathRound
  whooseTurn = 0

  let turnCount = 0
  while (turnCount < Number(benchmarkOptions.roundLimit || 40) &&
      gameRound < suddenDeathRound &&
      !players[1].isLost && !players[2].isLost) {
    nextTurn()
    ++turnCount
  }
  let winnerIndex = players[1].isLost ? 2 : (players[2].isLost ? 1 : null)
  let winnerSide = winnerIndex == 1 ? 'A' : (winnerIndex == 2 ? 'B' : null)
  return {
      winner: winnerIndex == null ? null : players[winnerIndex].constructor.name,
      winnerSide,
      roundCount: gameRound,
      turnCount,
      timeout: winnerIndex == null && turnCount >= Number(benchmarkOptions.roundLimit || 40),
      suddenDeath: winnerIndex == null && gameRound >= suddenDeathRound,
      nonResult: winnerIndex == null,
      mapName: __benchmarkMapName,
      playerA: benchmarkOptions.playerA,
      playerB: benchmarkOptions.playerB,
      runtimePlayerA: players[1].constructor.name,
      runtimePlayerB: players[2].constructor.name,
      seed: Number(benchmarkOptions.seed),
      benchmarkPolicy: 'real GameMap runtime with requested player classes',
      inference: {
        source: __benchmarkInferenceSource,
        calls: __benchmarkInferenceCalls,
        positions: __benchmarkInferencePositions
      },
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
})()
`;
}

function benchmarkRuntimeScript() {
  if (!compiledBenchmarkRuntimeScript) {
    compiledBenchmarkRuntimeScript = new vm.Script(
      runtimeMapScript(),
      { filename: 'benchmark-runtime-game.js' }
    );
  }
  return compiledBenchmarkRuntimeScript;
}

function runGame(options) {
  const mapName = options.gameMap && options.gameMap.testName ?
    options.gameMap.testName : options.mapName || 'tiny-duel';
  const map = options.gameMap ?
    benchmarkMapFromGameMap(options.gameMap) : BENCHMARK_MAPS[mapName];
  if (!map) {
    throw new Error('Unknown benchmark map "' + mapName + '"');
  }
  if (!Number.isFinite(map.suddenDeathRound) || map.suddenDeathRound < 0) {
    throw new Error('Benchmark map requires a non-negative suddenDeathRound');
  }
  validatePlayerClass(options.playerA);
  validatePlayerClass(options.playerB);
  const modelPlayers = [options.playerA, options.playerB].filter(function(playerClass) {
    return playerClass === 'AIPlayer' || playerClass === 'AIPlayerWithEconomy';
  });
  if (modelPlayers.length && typeof options.predictFunction !== 'function') {
    throw new Error(
      'AI gameplay benchmark requires a real checkpoint-backed predictFunction; ' +
      'use benchmark-trained-model.js for checkpoint evaluation'
    );
  }

  const context = getBenchmarkRuntimeContext(options.seed, options);
  context.__benchmarkConfiguredMap = clone(map);
  context.__benchmarkMapName = mapName;
  context.__benchmarkOptions = {
    actionLimit: options.actionLimit,
    commandLimit: options.commandLimit,
    playerA: options.playerA,
    playerB: options.playerB,
    roundLimit: options.roundLimit,
    seed: options.seed
  };
  return detachBrowserResult(benchmarkRuntimeScript().runInContext(context));
}

function runBenchmark(options) {
  const repeat = Number(options.repeat || 1);
  const baseSeed = Number(options.seed || 1);
  if (!Number.isInteger(repeat) || repeat <= 0) {
    throw new Error('repeat must be a positive integer');
  }
  if (options.simulateCrashSeeds || options.simulatedOutcomes) {
    throw new Error(
      'synthetic outcomes are forbidden in gameplay benchmarks; ' +
      'use buildReportFormatTestResult() only in report-format tests'
    );
  }
  const games = [];
  const crashes = [];
  for (let index = 0; index < repeat; ++index) {
    const seed = baseSeed + index;
    try {
      games.push(runGame({
        gameMap: options.gameMap,
        mapName: options.mapName,
        playerA: options.playerA,
        playerB: options.playerB,
        roundLimit: options.roundLimit,
        actionLimit: options.actionLimit,
        commandLimit: options.commandLimit,
        predictFunction: options.predictFunction,
        inferenceSource: options.inferenceSource,
        modelIdentifier: options.modelIdentifier,
        seed
      }));
    } catch (error) {
      const crash = {
        seed,
        mapName: options.mapName || 'tiny-duel',
        playerA: options.playerA,
        playerB: options.playerB,
        message: error.message,
        reportFormatOnlySimulation: false
      };
      crashes.push(crash);
      games.push({
        winner: null,
        winnerSide: null,
        roundCount: 0,
        timeout: false,
        suddenDeath: false,
        nonResult: true,
        crash: true,
        failureReason: error.message,
        reportFormatOnlySimulation: false,
        mapName: crash.mapName,
        playerA: crash.playerA,
        playerB: crash.playerB,
        runtimePlayerA: null,
        runtimePlayerB: null,
        seed
      });
    }
  }
  const playerAWins = games.filter(function(game) {
    return game.winnerSide === 'A';
  }).length;
  const completedGames = games.filter(function(game) {
    return game.winnerSide !== null && !game.crash;
  }).length;
  const lengths = games
    .filter(game => !game.crash)
    .map(game => game.roundCount)
    .sort(function(left, right) {
      return left - right;
    });
  const averageGameLength = lengths.length ?
    lengths.reduce((total, value) => total + value, 0) / lengths.length : 0;
  const medianGameLength = lengths.length ?
    lengths[Math.floor((lengths.length - 1) / 2)] : 0;
  const timeoutCount = games.filter(game => game.timeout).length;
  const suddenDeathCount = games.filter(game => game.suddenDeath).length;
  const nonResultCount = games.filter(game => game.nonResult).length;
  const failedSeeds = games
    .filter(game => game.winnerSide !== 'A' || game.timeout || game.crash || game.nonResult)
    .map(game => game.seed);
  return {
    config: {
      mapName: options.mapName || (options.gameMap && options.gameMap.testName) || 'tiny-duel',
      playerA: options.playerA,
      playerB: options.playerB,
      playerClasses: {
        A: options.playerA,
        B: options.playerB
      },
      checkpointIdentifier: options.checkpointIdentifier || options.checkpoint || null,
      seed: baseSeed,
      repeat,
      roundLimit: Number(options.roundLimit || 40),
      benchmarkPolicy: 'real-runtime-requested-player-classes',
      reportFormatSimulations: 0,
      codeRevision: codeRevision()
    },
    summary: {
      games: games.length,
      attemptedGames: repeat,
      completedGames,
      playerAWins,
      playerAWinRate: repeat ? playerAWins / repeat : 0,
      averageGameLength,
      medianGameLength,
      timeoutCount,
      timeouts: timeoutCount,
      suddenDeathCount,
      suddenDeathGames: suddenDeathCount,
      nonResultCount,
      nonResults: nonResultCount,
      nonResultWithoutTimeoutCount: games.filter(function(game) {
        return game.nonResult && !game.timeout && !game.crash;
      }).length,
      crashCount: crashes.length,
      crashes: crashes.length,
      failedSeeds
    },
    failedSeeds,
    crashes,
    artifacts: {},
    games
  };
}

// This helper never runs gameplay. It exists solely to verify serialization and
// accounting of already-simulated report rows. Its output must not be used as an
// AI quality measurement or benchmark gate result.
function buildReportFormatTestResult(options, simulatedGames) {
  options = Object.assign({}, options, { repeat: simulatedGames.length });
  const labeledGames = simulatedGames.map(game => Object.assign({}, game, {
    reportFormatOnlySimulation: true
  }));
  const playerAWins = labeledGames.filter(game => game.winnerSide === 'A').length;
  const crashes = labeledGames.filter(game => game.crash);
  const timeoutCount = labeledGames.filter(game => game.timeout).length;
  const nonResultCount = labeledGames.filter(game => game.nonResult).length;
  const failedSeeds = labeledGames
    .filter(game => game.winnerSide !== 'A' || game.timeout || game.crash || game.nonResult)
    .map(game => game.seed);
  return {
    config: {
      playerA: options.playerA,
      playerB: options.playerB,
      repeat: simulatedGames.length,
      benchmarkPolicy: 'REPORT-FORMAT-TEST-ONLY-NOT-AI-QUALITY',
      reportFormatSimulations: simulatedGames.length
    },
    summary: {
      games: simulatedGames.length,
      attemptedGames: simulatedGames.length,
      completedGames: labeledGames.filter(game => game.winnerSide !== null && !game.crash).length,
      playerAWins,
      playerAWinRate: simulatedGames.length ? playerAWins / simulatedGames.length : 0,
      timeoutCount,
      nonResultCount,
      nonResultWithoutTimeoutCount: labeledGames.filter(game =>
        game.nonResult && !game.timeout && !game.crash).length,
      crashCount: crashes.length,
      failedSeeds
    },
    failedSeeds,
    crashes,
    artifacts: {},
    games: labeledGames
  };
}

function writeResult(result, outputPath) {
  const absolutePath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  result.artifacts = Object.assign({}, result.artifacts, {
    reportPath: absolutePath
  });
  fs.writeFileSync(absolutePath, JSON.stringify(result, null, 2) + '\n');
  return absolutePath;
}

module.exports = {
  BENCHMARK_MAPS,
  PLAYER_CLASSES,
  benchmarkMapFromGameMap,
  buildReportFormatTestResult,
  getBrowserScriptCacheStats,
  loadBrowserScripts: loadBenchmarkBrowserScripts,
  resetBrowserScriptCache: resetBenchmarkRuntimeCache,
  runBenchmark,
  runGame,
  writeResult
};
