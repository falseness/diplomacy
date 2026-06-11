const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

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
  const source = fs.readFileSync(path.join(__dirname, 'players.js'), 'utf8');
  new vm.Script(source, { filename: 'ai/players.js' }).runInContext(context);
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
    if (!player.towns || player.towns.length !== 1) {
      throw new Error('GameMap benchmark players require exactly one town');
    }
    const town = player.towns[0];
    const units = (player.units || []).map(function(unit) {
      return { x: unit.x, y: unit.y };
    });
    if (!units.length) {
      units.push({
        x: town.x + (playerIndex === 0 ? 1 : -1),
        y: town.y
      });
    }
    return {
      town: { x: town.x, y: town.y },
      units
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
    Math: createSeededMath(seed),
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
    saveAs() {},
    __benchmarkInferenceCalls: 0,
    __benchmarkInferencePositions: 0
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadBrowserScripts(context, options) {
  options = options || {};
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
  if (typeof options.predictFunction === 'function') {
    context.ai_model = options.modelIdentifier || { benchmarkInjectedModel: true };
    context.predict = function(model, xValidateArr) {
      context.__benchmarkInferenceCalls += 1;
      context.__benchmarkInferencePositions += xValidateArr.length;
      return options.predictFunction(model, xValidateArr);
    };
    context.__benchmarkInferenceSource =
      options.inferenceSource || 'injected benchmark model';
    return;
  }
  new vm.Script(`
    ai_model = { benchmarkSmokeModel: true }
    predict = function(model, xValidateArr) {
      __benchmarkInferenceCalls += 1
      __benchmarkInferencePositions += xValidateArr.length
      return xValidateArr.map(function(vector) {
        let board = vector[0]
        let score = 0
        for (let x = 0; x < board.length; ++x) {
          for (let y = 0; y < board[x].length; ++y) {
            score += Number(board[x][y][0]) || 0
            score += (Number(board[x][y][1]) || 0) * 0.1
          }
        }
        return [score]
      })
    }
    __benchmarkInferenceSource = 'benchmark smoke model for runtime AIPlayer decisions'
  `, { filename: 'benchmark-smoke-model.js' }).runInContext(context);
}

function runtimeMapScript(mapName, map, options) {
  return `
(() => {
  isFogOfWar = false
  gameSettings.testAI = true
  gameSettings.isOnline = false
  gameSettings.aiActionLimit = ${Number(options.actionLimit || 30)}
  gameSettings.aiCommandLimit = ${Number(options.commandLimit || 60)}
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
  let configured = ${JSON.stringify(map)}
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
        playerType: ${JSON.stringify(options.playerA)}
      },
      {
        rgb: {r: 98, g: 168, b: 222},
        towns: [{x: configured.players[1].town.x, y: configured.players[1].town.y}],
        units: configured.players[1].units.map(function(unit) {
          return {x: unit.x, y: unit.y, type: Noob}
        }),
        playerType: ${JSON.stringify(options.playerB)}
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
  while (turnCount < ${Number(options.roundLimit || 40)} &&
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
    timeout: winnerIndex == null && turnCount >= ${Number(options.roundLimit || 40)},
    suddenDeath: winnerIndex == null && gameRound >= suddenDeathRound,
    nonResult: winnerIndex == null,
    mapName: ${JSON.stringify(mapName)},
    playerA: ${JSON.stringify(options.playerA)},
    playerB: ${JSON.stringify(options.playerB)},
    runtimePlayerA: players[1].constructor.name,
    runtimePlayerB: players[2].constructor.name,
    seed: ${Number(options.seed)},
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

function runGame(options) {
  const mapName = options.gameMap && options.gameMap.testName ?
    options.gameMap.testName : options.mapName || 'tiny-duel';
  const map = options.gameMap ?
    benchmarkMapFromGameMap(options.gameMap) : BENCHMARK_MAPS[mapName];
  if (!map) {
    throw new Error('Unknown benchmark map "' + mapName + '"');
  }
  if (!Number.isFinite(map.suddenDeathRound) || map.suddenDeathRound <= 0) {
    throw new Error('Benchmark map requires a positive suddenDeathRound');
  }
  validatePlayerClass(options.playerA);
  validatePlayerClass(options.playerB);

  const context = createRuntimeContext(options.seed);
  loadBrowserScripts(context, options);
  return new vm.Script(
    runtimeMapScript(mapName, clone(map), options),
    { filename: 'benchmark-runtime-game.js' }
  ).runInContext(context);
}

function runBenchmark(options) {
  const repeat = Number(options.repeat || 1);
  const baseSeed = Number(options.seed || 1);
  if (!Number.isInteger(repeat) || repeat <= 0) {
    throw new Error('repeat must be a positive integer');
  }
  const crashSeeds = new Set(
    (options.simulateCrashSeeds || []).map(function(seed) {
      return Number(seed);
    })
  );
  const games = [];
  const crashes = [];
  for (let index = 0; index < repeat; ++index) {
    const seed = baseSeed + index;
    try {
      if (crashSeeds.has(seed)) {
        throw new Error('simulated benchmark failure for report-format test seed ' + seed);
      }
      games.push(runGame({
        gameMap: options.gameMap,
        mapName: options.mapName,
        playerA: options.playerA,
        playerB: options.playerB,
        roundLimit: options.roundLimit,
        actionLimit: options.actionLimit,
        commandLimit: options.commandLimit,
        seed
      }));
    } catch (error) {
      const crash = {
        seed,
        mapName: options.mapName || 'tiny-duel',
        playerA: options.playerA,
        playerB: options.playerB,
        message: error.message,
        reportFormatOnlySimulation: crashSeeds.has(seed)
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
        reportFormatOnlySimulation: crashSeeds.has(seed),
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
      reportFormatSimulations: crashSeeds.size,
      codeRevision: codeRevision()
    },
    summary: {
      games: games.length,
      attemptedGames: repeat,
      completedGames,
      playerAWins,
      playerAWinRate: completedGames ? playerAWins / completedGames : 0,
      averageGameLength,
      medianGameLength,
      timeoutCount,
      timeouts: timeoutCount,
      suddenDeathCount,
      suddenDeathGames: suddenDeathCount,
      nonResultCount,
      nonResults: nonResultCount,
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
  runBenchmark,
  runGame,
  writeResult
};
