const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function createRuntimeContext() {
  const storage = {};
  const context = {
    console: Object.assign({}, console, { log() {} }),
    Math,
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

const context = createRuntimeContext();
loadBrowserScripts(context);

const result = new vm.Script(`(() => {
  isFogOfWar = false
  entityInterface = {change() {}, hide() {}}
  townInterface = {change() {}, hide() {}}
  barrackInterface = {change() {}, hide() {}}
  gameEvent = {
    selected: new Empty(),
    hideAll() {},
    removeSelection() {
      this.selected = new Empty()
    },
    screen: {moveTo() {}, moveToPlayer() {}, stop() {}}
  }
  nextTurnButton = {
    highlightButton: false,
    setNextPlayerColor() {},
    enableClick() {},
    disableClick() {}
  }
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
  let testMap = createTinyEconomyAiTestMap()
  testMap.start(testManager, false)
  whooseTurn = 1

  let player = players[1]
  Object.setPrototypeOf(player, AIPlayerWithEconomy.prototype)
  player.gold = 200
  let command = player.getEconomyCommands().find(function(candidate) {
    return candidate.product == 'wall'
  })
  if (!command) {
    throw new Error('real runtime did not enumerate a legal wall action')
  }

  let town = grid.getBuilding(command.producerCoord)
  let before = {
    gold: player.gold,
    externalProduction: externalProduction.length,
    town: JSON.stringify(town.toUndoJSON())
  }
  if (!player.applyEconomyCommand(command)) {
    throw new Error('real runtime rejected the legal wall action')
  }
  let during = {
    externalProduction: externalProduction.length,
    placedWallProduction:
      grid.getBuilding(command.destinationCoord).name == 'wall' &&
      !grid.getBuilding(command.destinationCoord).killed
  }
  actionManager.undo()
  let restoredTown = grid.getBuilding(command.producerCoord)

  return {
    addedExternalProduction:
      during.externalProduction == before.externalProduction + 1,
    placedWallProduction: during.placedWallProduction,
    goldRestored: player.gold == before.gold,
    townRestored: JSON.stringify(restoredTown.toUndoJSON()) == before.town,
    externalProductionRestored:
      externalProduction.length == before.externalProduction,
    killedExternalProduction:
      externalProduction.some(function(production) {
        return production.killed
      }),
    destinationCleared:
      grid.getBuilding(command.destinationCoord).isEmpty()
  }
})()`, {
  filename: 'action-manager-economy-undo-scenario.js'
}).runInContext(context);

check(result.addedExternalProduction,
  'wall placement did not add external production');
check(result.placedWallProduction,
  'wall production was not placed on the runtime grid');
check(result.goldRestored, 'wall undo did not restore player gold');
check(result.townRestored, 'wall undo did not restore the producing town');
check(result.externalProductionRestored,
  'wall undo did not restore externalProduction length');
check(!result.killedExternalProduction,
  'wall undo left killed external production in the global list');
check(result.destinationCleared,
  'wall undo did not clear the production destination');

console.log('Real ActionManager economy undo smoke passed');
