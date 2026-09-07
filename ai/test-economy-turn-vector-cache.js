// Real game integration probe. Instrumentation observes vectors and fast dispatch;
// a deterministic prediction oracle isolates cache equivalence from model quality.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const repoRoot = path.resolve(__dirname, '..');
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

function loadBrowserScripts(context, playersPath) {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const scriptPattern = /<script[^>]+src=['"]([^'"]+)['"]/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const source = match[1];
    if (/^https?:/.test(source)) {
      continue;
    }
    const code = source === 'ai/players.js' && playersPath ?
      fs.readFileSync(playersPath, 'utf8') :
      fs.readFileSync(path.join(repoRoot, source), 'utf8');
    new vm.Script(code, { filename: source }).runInContext(context);
  }
}


const setupSource = `  function manager() {
    return {
      clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        gameExit = false
      }
    }
  }

  function resetRuntime() {
    isFogOfWar = false
    gameSettings.testAI = false
    gameSettings.withAI = false
    gameSettings.aiActionLimit = 0
    gameSettings.aiCommandLimit = 0
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    statisticsInterface = {}
    gameEvent = {
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
    border = new Border()
    attackBorder = new Border()
    suddenDeathRound = 40
    otherSettings.moveCameraToUndoTarget = false
  }

  function createGeneratedMap(testMap) {
    return generateTownTrainingMap(Object.assign({
      size: 'medium',
      seed: testMap.seed,
      playerCount: 2,
      unitComposition: 'all',
      unitsPerPlayer: 0,
      buildingDensity: 'dense',
      barrackDensity: 0,
      pendingBarrackProbability: 0,
      farmDensity: 0,
      pendingFarmProbability: 0,
      externalDensity: 0,
      suburbDensity: 1,
      suburbDistance: 1,
      goldmineCount: 5
    }, testMap.options || {}))
  }

  function setup(testMap, playerIndex) {
    resetRuntime()
    let map = createGeneratedMap(testMap)
    for (let i = 1; i < map.players.length; ++i) {
      map.players[i].playerType = 'AIPlayerWithEconomy'
    }
    map.start(manager(), false)
    whooseTurn = playerIndex
    for (let i = 1; i < players.length; ++i) {
      assert(players[i].constructor === AIPlayerWithEconomy,
        'generated-map runtime player class mismatch', {seed: testMap.seed, player: i})
      assert(players[i].gold === map.players[i].gold,
        'generated-map starting gold changed', {seed: testMap.seed, player: i})
    }
    return map
  }

`;

function run(playersPath) {
  const context = createRuntimeContext();
  let randomState = 100100;
  context.Math = Object.create(Math);
  context.Math.random = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  context.assert = assert;
  loadBrowserScripts(context, playersPath);
  return new vm.Script(`(() => {
SETUP
    let results = []
    for (let side of [1, 2]) {
      setup({seed: 100100, options: {unitsPerPlayer: 5}}, side)
      let player = players[side]
      player.nextTurn()
      let originalVector = vectoriseGrid
      let originalCreate = createMutableVectorGrid
      let originalApply = applyFastAction
      let originalUndo = undoFastAction
      let counts = {fullVectors: 0, grids: 0, applies: 0, undoes: 0, mismatches: 0}
      let categories = new Set()
      let predictionInputs = []
      let mutableGrids = new Set()
      vectoriseGrid = function() { ++counts.fullVectors; return originalVector() }
      createMutableVectorGrid = function(input) {
        ++counts.grids
        let mutable = originalCreate(input)
        mutableGrids.add(mutable)
        return mutable
      }
      applyFastAction = function(mutable, command) {
        let result = originalApply(mutable, command)
        ++counts.applies
        categories.add((command.category || command.type) + ':' + (command.product || ''))
        assert(compareVectorGridResults(originalVector(), mutable).equal,
          'real fast apply differs from fresh vector')
        return result
      }
      undoFastAction = function(mutable, action) {
        ++counts.undoes
        return originalUndo(mutable, action)
      }
      // No quality/learned-strength claim: deterministic oracle, same in both runs.
      predict = function(model, inputs) {
        predictionInputs.push(JSON.stringify(inputs))
        return inputs.map(input => [input[0].flat(2).reduce(
          (sum, value, index) => sum + value * ((index % 17) + 1), 0)])
      }
      let beforeCommands = JSON.stringify(player.getActionCommands())
      player.doActions()
      let afterCommands = JSON.stringify(player.getActionCommands())
      let finalVector = originalVector()
      if (!__baseline) {
        assert(counts.grids === 1, 'hybrid turn must create exactly one mutable grid')
        assert(counts.fullVectors === 3, 'hybrid turn only vectorizes three phase boundaries')
        assert(player.candidateScoringGrid === null, 'hybrid turn cache leaked')
        for (let mutable of mutableGrids) {
          assert(compareVectorGridResults(finalVector, mutable).equal,
            'hybrid final cache differs from authoritative state')
          assert(mutable.appliedFastActions.length === 0, 'retained undo metadata leaked')
        }
      }
      results.push({seed: 100100, side, counts, categories: [...categories].sort(),
        beforeCommands, afterCommands, finalVector,
        history: player.chosenGrids, chances: player.winningChances, predictionInputs})
      vectoriseGrid = originalVector
      createMutableVectorGrid = originalCreate
      applyFastAction = originalApply
      undoFastAction = originalUndo
    }
    return results
  })()`.replace('SETUP', setupSource)).runInContext(
    Object.assign(context, {__baseline: !!playersPath}));
}
const current = run();
if (process.env.TASK100_BASELINE_PLAYERS) {
  const baseline = run(process.env.TASK100_BASELINE_PLAYERS);
  for (let i = 0; i < current.length; ++i) {
    for (const key of ['beforeCommands', 'afterCommands', 'finalVector',
      'history', 'chances', 'predictionInputs']) {
      assert.strictEqual(JSON.stringify(current[i][key]), JSON.stringify(baseline[i][key]),
        'baseline/current disagreement: side ' + current[i].side + ' ' + key);
    }
  }
  console.log('BASELINE_EQUIVALENCE: PASS legal command ordering/filtering, prediction inputs, histories and final state on both sides');
}
for (const result of current) {
  console.log('REAL_ECONOMY_TURN: PASS ' + JSON.stringify({seed: result.seed,
    side: result.side, counts: result.counts, categories: result.categories}));
}
