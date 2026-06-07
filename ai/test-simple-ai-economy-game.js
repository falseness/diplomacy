const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const failureDirectory = path.join(repoRoot, 'artifacts', 'task-033');
const defaultSeeds = [32000, 32016, 32032, 32048];

function assert(condition, message, state, failurePath) {
  if (condition) {
    return;
  }
  fs.mkdirSync(path.dirname(failurePath), { recursive: true });
  fs.writeFileSync(failurePath, JSON.stringify(state, null, 2) + '\n');
  throw new Error(message + '; state saved to ' + failurePath);
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
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const scriptPattern = /<script[^>]+src=['"]([^'"]+)['"]/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const source = match[1];
    if (/^https?:/.test(source)) {
      continue;
    }
    const code = fs.readFileSync(path.join(repoRoot, source), 'utf8');
    new vm.Script(code, { filename: source }).runInContext(context);
  }
}

function runScenario(seed) {
  const failurePath = path.join(
    failureDirectory, 'tiny-economy-ai-failure-' + seed + '.json');
  const context = createRuntimeContext(seed);
  loadBrowserScripts(context);

  new vm.Script(`
    isFogOfWar = false
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    statisticsInterface = {}
    gameEvent = {
      nextTurn() {},
      screen: {moveToPlayer() {}, stop() {}}
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

    let testManager = {
      clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        gameExit = false
      }
    }
    let task032Map = createTinyEconomyAiTestMap()
    task032Map.start(testManager, false)
    suddenDeathRound = task032Map.suddenDeathRound
    whooseTurn = 0
  `, { filename: 'task-032-runtime-setup.js' }).runInContext(context);

  const result = new vm.Script(`(() => {
    let turnCount = 0
    let initialGold = players.slice(1).map(player => player.gold)
    let initialUnits = players.slice(1).map(player => player.units.length)
    let minimumGold = initialGold.slice()
    let maximumUnits = initialUnits.slice()
    while (gameRound < suddenDeathRound &&
        !players[1].isLost && !players[2].isLost) {
      nextTurn()
      ++turnCount
      players.slice(1).forEach(function(player, index) {
        minimumGold[index] = Math.min(minimumGold[index], player.gold)
        maximumUnits[index] = Math.max(maximumUnits[index], player.units.length)
      })
    }
    let winner = players[1].isLost ? 2 : (players[2].isLost ? 1 : null)
    return {
      seed: ${seed},
      map: {
        name: task032Map.testName,
        size: task032Map.mapSize,
        suddenDeathRound: task032Map.suddenDeathRound
      },
      turnCount,
      gameRound,
      winner,
      suddenDeathStarted: gameRound >= suddenDeathRound,
      economy: {
        initialGold,
        minimumGold,
        initialUnits,
        maximumUnits
      },
      players: players.slice(1).map(function(player, index) {
        return {
          index: index + 1,
          type: player.constructor.name,
          lost: player.isLost,
          gold: player.gold,
          towns: player.towns.length,
          units: player.units.length
        }
      })
    }
  })()`, { filename: 'task-032-runtime-game.js' }).runInContext(context);

  assert(
    result.players.every(player =>
      player.type === 'SimpleAiPlayerWithEconomy'),
    'runtime game did not instantiate two economy AI players',
    result,
    failurePath
  );
  assert(
    result.map.size.x <= 9 && result.map.size.y <= 7,
    'runtime game did not use the tiny gamestart map',
    result,
    failurePath
  );
  assert(
    result.map.suddenDeathRound === 2000,
    'suddenDeathRound is not 2000',
    result,
    failurePath
  );
  assert(
    result.economy.minimumGold.some((gold, index) =>
      gold < result.economy.initialGold[index]),
    'economy AI never spent its starting gold',
    result,
    failurePath
  );
  assert(
    result.economy.maximumUnits.some((units, index) =>
      units > result.economy.initialUnits[index]),
    'economy AI never produced a replacement unit',
    result,
    failurePath
  );
  assert(
    result.winner !== null,
    'runtime game ended without a winner',
    result,
    failurePath
  );
  assert(
    !result.suddenDeathStarted,
    'runtime game reached sudden death before producing a winner',
    result,
    failurePath
  );

  if (fs.existsSync(failurePath)) {
    fs.unlinkSync(failurePath);
  }
  return result;
}

const requestedSeeds = process.env.TASK_033_SEEDS ?
  process.env.TASK_033_SEEDS.split(',').map(Number) : defaultSeeds;
const results = requestedSeeds.map(runScenario);
console.log(
  'Economy AI runtime suite passed for seeds ' +
  results.map(result => result.seed).join(', ') +
  '; winners appeared by round ' +
  Math.max(...results.map(result => result.gameRound)));
