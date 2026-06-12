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

  function setupPlacementMap(activePlayer, seed) {
    resetRuntime()
    let playerOneTown = {x: 2, y: 2}
    let playerTwoTown = {x: 8, y: 4}
    let playerOneSuburbs = [
      playerOneTown,
      {x: 1, y: 2},
      {x: 2, y: 3},
      {x: 3, y: 2},
      {x: 2, y: 1},
      {x: 1, y: 3}
    ]
    let playerTwoSuburbs = [
      playerTwoTown,
      {x: 7, y: 4},
      {x: 8, y: 5},
      {x: 9, y: 4},
      {x: 8, y: 3},
      {x: 7, y: 5}
    ]
    let map = new GameMap(
      {x: 11, y: 7},
      [
        {rgb: {r: 160, g: 160, b: 160}, towns: []},
        {
          rgb: {r: 220, g: 60, b: 60},
          gold: 700 + seed,
          towns: [playerOneTown],
          units: [],
          suburbs: [{town: playerOneTown, cells: playerOneSuburbs}]
        },
        {
          rgb: {r: 40, g: 120, b: 220},
          gold: 700 + seed,
          towns: [playerTwoTown],
          units: [],
          suburbs: [{town: playerTwoTown, cells: playerTwoSuburbs}]
        }
      ],
      [],
      [],
      []
    )
    map.start(manager(), false)
    whooseTurn = activePlayer
    Object.setPrototypeOf(players[activePlayer], AIPlayerWithEconomy.prototype)
    players[activePlayer].gold = 700 + seed
    return {
      activePlayer: activePlayer,
      seed: seed,
      townCoord: activePlayer == 1 ? playerOneTown : playerTwoTown
    }
  }

  function snapshotGrid() {
    let snapshot = {
      whooseTurn: whooseTurn,
      gameRound: gameRound,
      players: [],
      cells: [],
      externalProduction: externalProduction.map(function(item) {
        return item.toJSON()
      })
    }
    for (let i = 0; i < players.length; ++i) {
      snapshot.players[i] = {
        gold: players[i].gold,
        income: players[i].income,
        towns: players[i].towns.map(function(town) {
          return {
            coord: coordCopy(town.coord),
            buildingProduction: town.buildingProduction.map(function(item) {
              return item.toJSON()
            }),
            buildings: town.buildings.map(function(building) {
              return building.toJSON()
            })
          }
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
    assert(comparison.equal, 'fast building-placement vector mismatch', {
      phase: phase,
      metadata: metadata,
      vectorPath: comparison.mismatches.length ?
        comparison.mismatches[0].location : undefined,
      mismatches: comparison.mismatches
    })
  }

  function channel(vectorGrid, coord, index) {
    return vectorGrid[0][coord.x][coord.y][index]
  }

  function collectPlacementCases(activePlayer, seed) {
    setupPlacementMap(activePlayer, seed)
    let buildingProducts = Object.keys(production).filter(function(product) {
      return product != 'suburb' &&
        !production[product].production.isUnitProduction()
    })
    let commands = players[activePlayer].getActionCommands().filter(function(command) {
      return command.type == 'economy' &&
        command.category == 'building-placement' &&
        buildingProducts.indexOf(command.product) >= 0
    })
    let firstByProduct = {}
    for (let i = 0; i < commands.length; ++i) {
      let command = commands[i]
      if (!firstByProduct[command.product]) {
        firstByProduct[command.product] = command
      }
    }
    return Object.keys(firstByProduct).map(function(product) {
      let command = firstByProduct[product]
      return {
        activePlayer: activePlayer,
        seed: seed,
        product: product,
        producerCoord: coordCopy(command.producerCoord),
        destinationCoord: coordCopy(command.destinationCoord)
      }
    })
  }

  function findCommand(testCase) {
    let commands = players[testCase.activePlayer].getActionCommands().filter(function(command) {
      return command.type == 'economy' &&
        command.category == 'building-placement' &&
        command.product == testCase.product &&
        sameCoord(command.producerCoord, testCase.producerCoord) &&
        sameCoord(command.destinationCoord, testCase.destinationCoord)
    })
    return commands[0]
  }

  function assertPendingChannels(testCase, beforeVectorGrid, afterVectorGrid, beforeGold) {
    let coord = testCase.destinationCoord
    let product = testCase.product
    let channels = pendingChannelsForProduct(product)

    assert(channel(beforeVectorGrid, coord, channels.pendingIndex) == 0,
      'test destination already had pending product channel', testCase)
    assert(channel(afterVectorGrid, coord, channels.pendingIndex) == 1,
      'pending product channel was not set after placement', testCase)
    assert(channel(afterVectorGrid, coord, channels.completedIndex) == 0,
      'completed product channel was set during pending placement', testCase)
    assert(channel(afterVectorGrid, coord, channels.ownerIndex) == 1,
      'pending product owner is not current player relative', testCase)
    assert(channel(afterVectorGrid, coord, channels.turnIndex) > 0,
      'pending product turns were not vectorized', testCase)
    assert(players[testCase.activePlayer].gold ==
        beforeGold - production[product].cost,
      'building placement did not spend the configured gold cost', {
        testCase: testCase,
        beforeGold: beforeGold,
        afterGold: players[testCase.activePlayer].gold,
        cost: production[product].cost
      })
    assert(channel(afterVectorGrid, coord, CELL_VECTOR_INDEX.currentPlayerGold) !=
        channel(beforeVectorGrid, coord, CELL_VECTOR_INDEX.currentPlayerGold),
      'player gold vector did not change after placement', testCase)
    assert(grid.getBuilding(coord).isBuildingProduction(),
      'destination is not a pending building production', testCase)
    if (isExternalProduct(product)) {
      assert(grid.getBuilding(coord).isExternalProduction(),
        'destination is not a pending external production', testCase)
      assert(externalProduction.some(function(item) {
        return sameCoord(item.coord, coord) && item.name == product && !item.killed
      }), 'externalProduction does not contain live pending product', testCase)
    }
  }

  function assertCompletedChannels(testCase, completedVectorGrid) {
    let coord = testCase.destinationCoord
    let product = testCase.product
    let channels = completedChannelsForProduct(product)

    assert(channel(completedVectorGrid, coord, channels.pendingIndex) == 0,
      'pending product channel remained after completion', testCase)
    assert(channel(completedVectorGrid, coord, channels.completedIndex) == 1,
      'completed product channel was not set after production completion', testCase)
    assert(channel(completedVectorGrid, coord, channels.ownerIndex) == 1,
      'completed product owner is not current player relative', testCase)
    assert(!grid.getBuilding(coord).isBuildingProduction(),
      'destination still contains pending production after completion', testCase)
    assert(grid.getBuilding(coord).name == product,
      'completed building name does not match product', testCase)
    if (isExternalProduct(product)) {
      assert(external.some(function(item) {
        return sameCoord(item.coord, coord) && item.name == product && !item.killed
      }), 'external list does not contain completed product', testCase)
      assert(!externalProduction.some(function(item) {
        return sameCoord(item.coord, coord) && item.name == product && !item.killed
      }), 'externalProduction retained completed product', testCase)
    }
  }

  function isExternalProduct(product) {
    return product == 'wall' || product == 'bastion' || product == 'tower'
  }

  function pendingChannelsForProduct(product) {
    if (product == 'farm') {
      return {
        pendingIndex: CELL_VECTOR_INDEX.isPendingFarm,
        completedIndex: CELL_VECTOR_INDEX.isFarm,
        ownerIndex: CELL_VECTOR_INDEX.pendingFarmOwner,
        turnIndex: CELL_VECTOR_INDEX.pendingFarmTurns
      }
    }
    if (product == 'barrack') {
      return {
        pendingIndex: CELL_VECTOR_INDEX.isPendingBarrack,
        completedIndex: CELL_VECTOR_INDEX.isBarrack,
        ownerIndex: CELL_VECTOR_INDEX.pendingBarrackOwner,
        turnIndex: CELL_VECTOR_INDEX.pendingBarrackTurns
      }
    }
    if (isExternalProduct(product)) {
      let pendingIndex = {
        wall: CELL_VECTOR_INDEX.isPendingWall,
        bastion: CELL_VECTOR_INDEX.isPendingBastion,
        tower: CELL_VECTOR_INDEX.isPendingTower
      }[product]
      let completedIndex = {
        wall: CELL_VECTOR_INDEX.isWall,
        bastion: CELL_VECTOR_INDEX.isBastion,
        tower: CELL_VECTOR_INDEX.isTower
      }[product]
      return {
        pendingIndex: pendingIndex,
        completedIndex: completedIndex,
        ownerIndex: CELL_VECTOR_INDEX.pendingExternalOwner,
        turnIndex: CELL_VECTOR_INDEX.pendingExternalTurns
      }
    }
    throw new Error('unmapped pending building product ' + product)
  }

  function completedChannelsForProduct(product) {
    let channels = pendingChannelsForProduct(product)
    if (isExternalProduct(product)) {
      channels.ownerIndex = CELL_VECTOR_INDEX.externalOwner
    }
    else if (product == 'farm') {
      channels.ownerIndex = CELL_VECTOR_INDEX.farmOwner
    }
    else if (product == 'barrack') {
      channels.ownerIndex = CELL_VECTOR_INDEX.barrackOwner
    }
    return channels
  }

  function refreshMutableGridFromFresh(mutableGrid) {
    let coords = collectAllMutableVectorGridCoords(mutableGrid)
    let previous = []
    for (let i = 0; i < coords.length; ++i) {
      let coord = coords[i]
      previous.push({
        coord: coordCopy(coord),
        vector: mutableGrid.cells[coord.x][coord.y].slice()
      })
      replaceMutableCellVectorFromGrid(mutableGrid, coord)
    }
    return previous
  }

  function restoreMutableGrid(mutableGrid, previous) {
    for (let i = 0; i < previous.length; ++i) {
      let entry = previous[i]
      mutableGrid.cells[entry.coord.x][entry.coord.y] = entry.vector.slice()
    }
  }

  function completeActivePlayerProduction(testCase, mutableGrid) {
    let completeRefreshes = []
    for (let i = 0; i < production[testCase.product].turns; ++i) {
      if (isExternalProduct(testCase.product)) {
        externalNextTurn()
      }
      else {
        players[testCase.activePlayer].nextTurn()
      }
      completeRefreshes.push(refreshMutableGridFromFresh(mutableGrid))
    }
    return completeRefreshes
  }

  function undoCompletionRefreshes(mutableGrid, completeRefreshes) {
    for (let i = completeRefreshes.length - 1; i >= 0; --i) {
      restoreMutableGrid(mutableGrid, completeRefreshes[i])
    }
  }

  function runCase(testCase) {
    setupPlacementMap(testCase.activePlayer, testCase.seed)
    let initialSnapshot = snapshotGrid()
    let initialVectorGrid = vectoriseGrid()
    let mutableGrid = createMutableVectorGrid(initialVectorGrid)
    let command = findCommand(testCase)
    assert(command, 'building-placement command was not re-enumerated', testCase)
    let beforeGold = players[testCase.activePlayer].gold

    assert(players[testCase.activePlayer].applyActionCommand(command),
      'runtime rejected legal building-placement command', testCase)
    let pendingVectorGrid = vectoriseGrid()
    assertPendingChannels(testCase, initialVectorGrid, pendingVectorGrid, beforeGold)

    let applied = applyFastAction(mutableGrid, command)
    compareOrThrow(pendingVectorGrid, mutableGrid, testCase, 'after-pending-apply')

    let completionRefreshes = completeActivePlayerProduction(testCase, mutableGrid)
    let completedVectorGrid = vectoriseGrid()
    assertCompletedChannels(testCase, completedVectorGrid)
    compareOrThrow(completedVectorGrid, mutableGrid, testCase, 'after-completion-refresh')

    undoCompletionRefreshes(mutableGrid, completionRefreshes)
    compareOrThrow(pendingVectorGrid, mutableGrid, testCase, 'after-completion-refresh-undo')

    undoFastAction(mutableGrid, applied)
    compareOrThrow(initialVectorGrid, mutableGrid, testCase, 'after-fast-undo')

    setupPlacementMap(testCase.activePlayer, testCase.seed)
    command = findCommand(testCase)
    assert(players[testCase.activePlayer].applyActionCommand(command),
      'runtime rejected legal building-placement command before normal undo',
      testCase)
    actionManager.undo()
    compareOrThrow(initialVectorGrid, vectoriseGrid(), testCase, 'after-normal-undo')
    assert(snapshotGrid() == initialSnapshot,
      'normal actionManager undo did not restore building-placement grid0 snapshot',
      testCase)
  }

  let cases = []
  let seeds = [94, 195]
  for (let i = 0; i < seeds.length; ++i) {
    for (let player = 1; player <= 2; ++player) {
      let collected = collectPlacementCases(player, seeds[i])
      for (let j = 0; j < collected.length; ++j) {
        cases.push(collected[j])
      }
    }
  }

  let coverage = {}
  for (let i = 0; i < cases.length; ++i) {
    let key = cases[i].activePlayer + ':' + cases[i].seed + ':' + cases[i].product
    coverage[key] = true
    runCase(cases[i])
  }

  return {
    totalCases: cases.length,
    products: cases.map(function(testCase) { return testCase.product }),
    players: cases.map(function(testCase) { return testCase.activePlayer }),
    seeds: seeds,
    expectedProducts: Object.keys(production).filter(function(product) {
      return product != 'suburb' &&
        !production[product].production.isUnitProduction()
    }),
    coverage: coverage
  }
})()`, { filename: 'task094-fast-building-placement-actions.js' }).runInContext(context);

check(result.totalCases === result.expectedProducts.length * 4,
  'fast building-placement suite did not cover both players, seeds, and products',
  result);
check(result.products.filter(product => product === 'farm').length === 4,
  'fast building-placement suite did not cover all farm cases',
  result);
check(result.products.filter(product => product === 'barrack').length === 4,
  'fast building-placement suite did not cover all barrack cases',
  result);
for (const product of ['wall', 'bastion', 'tower']) {
  check(result.products.filter(candidate => candidate === product).length === 4,
    'fast building-placement suite did not cover all ' + product + ' cases',
    result);
}

console.log(
  'Fast building-placement invariant suite passed for ' +
  result.totalCases + ' building-placement cases across products ' +
  result.expectedProducts.join(', ') + ', players ' +
  Array.from(new Set(result.players)).join(', ') + ' and seeds ' +
  result.seeds.join(', ')
);
