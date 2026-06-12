const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
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
  function assert(condition, message, details) {
    if (!condition) {
      throw new Error(message + (details ? ': ' + JSON.stringify(details) : ''))
    }
  }

  function coordCopy(coord) {
    return {x: coord.x, y: coord.y}
  }

  function sameCoord(left, right) {
    return left.x == right.x && left.y == right.y
  }

  function manager() {
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
    AiRuntime.trainFromHumanCommands = function() {}
    border = new Border()
    attackBorder = new Border()
    suddenDeathRound = 40
    otherSettings.moveCameraToUndoTarget = false
  }

  function setupProductionMap() {
    resetRuntime()
    let playerOneTown = {x: 2, y: 2}
    let playerTwoTown = {x: 7, y: 4}
    let playerOneBarrack = {x: 2, y: 3, town: playerOneTown}
    let map = new GameMap(
      {x: 10, y: 7},
      [
        {rgb: {r: 160, g: 160, b: 160}, towns: []},
        {
          rgb: {r: 220, g: 60, b: 60},
          gold: 500,
          towns: [playerOneTown],
          units: [],
          barracks: [playerOneBarrack],
          suburbs: [{
            town: playerOneTown,
            cells: [
              playerOneTown,
              {x: 1, y: 2},
              {x: 2, y: 3},
              {x: 3, y: 2},
              {x: 2, y: 1}
            ]
          }]
        },
        {
          rgb: {r: 40, g: 120, b: 220},
          gold: 100,
          towns: [playerTwoTown],
          units: [],
          suburbs: [{
            town: playerTwoTown,
            cells: [playerTwoTown, {x: 6, y: 4}, {x: 7, y: 5}]
          }]
        }
      ],
      [],
      [],
      []
    )
    map.start(manager(), false)
    whooseTurn = 1
    Object.setPrototypeOf(players[1], AIPlayerWithEconomy.prototype)
    players[1].gold = 500
    return {
      town: grid.getBuilding(playerOneTown),
      barrack: grid.getBuilding(playerOneBarrack)
    }
  }

  function snapshotGrid() {
    let snapshot = {
      whooseTurn: whooseTurn,
      gameRound: gameRound,
      players: [],
      cells: []
    }
    for (let i = 0; i < players.length; ++i) {
      snapshot.players[i] = {
        gold: players[i].gold,
        units: players[i].units.map(function(unit) {
          return coordCopy(unit.coord)
        }),
        towns: players[i].towns.map(function(town) {
          return coordCopy(town.coord)
        })
      }
    }
    for (let x = 0; x < grid.arr.length; ++x) {
      snapshot.cells[x] = []
      for (let y = 0; y < grid.arr[x].length; ++y) {
        let cell = grid.arr[x][y]
        snapshot.cells[x][y] = {
          playerColor: cell.playerColor,
          isSuburb: Boolean(cell.hexagon.isSuburb),
          unit: cell.unit.toJSON(),
          building: cell.building.toJSON()
        }
      }
    }
    return JSON.stringify(snapshot)
  }

  function compareOrThrow(expected, actual, metadata, phase) {
    let comparison = compareVectorGridResults(expected, actual, {limit: 8})
    assert(comparison.equal, 'fast unit-production vector mismatch', {
      phase: phase,
      metadata: metadata,
      vectorPath: comparison.mismatches.length ?
        comparison.mismatches[0].location : undefined,
      mismatches: comparison.mismatches
    })
  }

  function producerKind(producer) {
    return producer.name == 'town' ? 'town' : 'barrack'
  }

  function collectUnitTrainingCases() {
    setupProductionMap()
    let commands = players[1].getActionCommands().filter(function(command) {
      return command.type == 'economy' && command.category == 'unit-training'
    })
    let cases = []
    for (let i = 0; i < commands.length; ++i) {
      let command = commands[i]
      let producer = grid.getBuilding(command.producerCoord)
      cases.push({
        product: command.product,
        producerKind: producerKind(producer),
        producerCoord: coordCopy(command.producerCoord)
      })
    }
    return cases
  }

  function findCommand(testCase) {
    let commands = players[1].getActionCommands().filter(function(command) {
      return command.type == 'economy' &&
        command.category == 'unit-training' &&
        command.product == testCase.product &&
        sameCoord(command.producerCoord, testCase.producerCoord)
    })
    return commands[0]
  }

  function assertConcreteSideEffects(testCase, producer, beforeGold) {
    assert(players[1].gold == beforeGold - production[testCase.product].cost,
      'unit production did not spend the configured gold cost', {
        testCase: testCase,
        beforeGold: beforeGold,
        afterGold: players[1].gold,
        cost: production[testCase.product].cost
      })
    assert(producer.isPreparingUnit,
      'unit production did not mark producer as preparing a unit', testCase)
    assert(producer.unitProduction.notEmpty() &&
        producer.unitProduction.name == testCase.product,
      'producer unitProduction does not match requested product', {
        testCase: testCase,
        unitProduction: producer.unitProduction.toJSON()
      })
  }

  function runCase(testCase) {
    setupProductionMap()
    let initialSnapshot = snapshotGrid()
    let initialVectorGrid = vectoriseGrid()
    let mutableGrid = createMutableVectorGrid(initialVectorGrid)
    let command = findCommand(testCase)
    assert(command, 'unit-training command was not re-enumerated', testCase)
    let producer = grid.getBuilding(command.producerCoord)
    assert(producer.notEmpty(), 'producer not found', testCase)
    assert(producerKind(producer) == testCase.producerKind,
      'producer kind changed while rebuilding test case', testCase)
    let beforeGold = players[1].gold
    assert(players[1].applyActionCommand(command),
      'runtime rejected legal unit-training command', testCase)
    assertConcreteSideEffects(testCase, producer, beforeGold)
    let afterVectorGrid = vectoriseGrid()

    let applied = applyFastAction(mutableGrid, command)
    compareOrThrow(afterVectorGrid, mutableGrid, testCase, 'after-apply')

    undoFastAction(mutableGrid, applied)
    compareOrThrow(initialVectorGrid, mutableGrid, testCase, 'after-fast-undo')

    actionManager.undo()
    compareOrThrow(initialVectorGrid, vectoriseGrid(), testCase, 'after-normal-undo')
    assert(snapshotGrid() == initialSnapshot,
      'normal actionManager undo did not restore unit-production grid snapshot',
      testCase)
  }

  let cases = collectUnitTrainingCases()
  let productsByProducer = {}
  for (let i = 0; i < cases.length; ++i) {
    let key = cases[i].producerKind
    if (!productsByProducer[key]) {
      productsByProducer[key] = {}
    }
    productsByProducer[key][cases[i].product] = true
  }
  let expectedProducts = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
  let expectedProducers = ['town', 'barrack']
  for (let i = 0; i < expectedProducers.length; ++i) {
    let producer = expectedProducers[i]
    for (let j = 0; j < expectedProducts.length; ++j) {
      let product = expectedProducts[j]
      assert(productsByProducer[producer] &&
          productsByProducer[producer][product],
        'missing unit-training command coverage', {
          producer: producer,
          product: product,
          productsByProducer: productsByProducer
        })
    }
  }

  for (let i = 0; i < cases.length; ++i) {
    runCase(cases[i])
  }

  return {
    totalCases: cases.length,
    producers: expectedProducers,
    products: expectedProducts,
    productsByProducer: productsByProducer
  }
})()`, { filename: 'task092-fast-unit-production-actions.js' }).runInContext(context);

check(result.totalCases === 10,
  'fast unit-production suite did not cover every producer/product pair',
  result);
console.log(
  'Fast unit-production invariant suite passed for ' +
  result.totalCases + ' town/barrack cases and products ' +
  result.products.join(', ')
);
