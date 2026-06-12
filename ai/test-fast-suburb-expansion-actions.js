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

  function setupSuburbMap(activePlayer, seed) {
    resetRuntime()
    let playerOneTown = {x: 2, y: 2}
    let playerTwoTown = {x: 8, y: 4}
    let playerOneSuburbs = [
      playerOneTown,
      {x: 1, y: 2},
      {x: 2, y: 3},
      {x: 3, y: 2}
    ]
    let playerTwoSuburbs = [
      playerTwoTown,
      {x: 7, y: 4},
      {x: 8, y: 5},
      {x: 9, y: 4}
    ]
    let map = new GameMap(
      {x: 11, y: 7},
      [
        {rgb: {r: 160, g: 160, b: 160}, towns: []},
        {
          rgb: {r: 220, g: 60, b: 60},
          gold: 500,
          towns: [playerOneTown],
          units: [],
          suburbs: [{town: playerOneTown, cells: playerOneSuburbs}]
        },
        {
          rgb: {r: 40, g: 120, b: 220},
          gold: 500,
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
    players[activePlayer].gold = 500 + seed
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
      cells: []
    }
    for (let i = 0; i < players.length; ++i) {
      snapshot.players[i] = {
        gold: players[i].gold,
        towns: players[i].towns.map(function(town) {
          return {
            coord: coordCopy(town.coord),
            suburbCount: town.suburbs.length,
            suburbs: town.suburbs.map(function(suburb) {
              return {
                coord: coordCopy(suburb.coord),
                isSuburb: Boolean(suburb.isSuburb),
                playerColor: suburb.playerColor
              }
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
    assert(comparison.equal, 'fast suburb-expansion vector mismatch', {
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

  function findCommands(activePlayer, seed) {
    let setup = setupSuburbMap(activePlayer, seed)
    let commands = players[activePlayer].getActionCommands().filter(function(command) {
      return command.type == 'economy' &&
        command.category == 'suburb-expansion' &&
        command.product == 'suburb'
    })
    return commands.map(function(command) {
      return {
        activePlayer: activePlayer,
        seed: seed,
        producerCoord: coordCopy(command.producerCoord),
        destinationCoord: coordCopy(command.destinationCoord),
        townCoord: coordCopy(setup.townCoord)
      }
    })
  }

  function findCommand(testCase) {
    let commands = players[testCase.activePlayer].getActionCommands().filter(function(command) {
      return command.type == 'economy' &&
        command.category == 'suburb-expansion' &&
        command.product == 'suburb' &&
        sameCoord(command.producerCoord, testCase.producerCoord) &&
        sameCoord(command.destinationCoord, testCase.destinationCoord)
    })
    return commands[0]
  }

  function assertConcreteSideEffects(testCase, before, after, beforeGold, beforeSuburbs) {
    let player = players[testCase.activePlayer]
    let town = grid.getBuilding(testCase.producerCoord)
    let destinationCell = grid.getCell(testCase.destinationCoord)
    let spentGold = beforeGold - player.gold

    assert(spentGold > 0,
      'suburb expansion did not spend gold', {
        testCase: testCase,
        beforeGold: beforeGold,
        afterGold: player.gold
      })
    assert(destinationCell.hexagon.isSuburb,
      'suburb expansion did not mark destination as suburb', testCase)
    assert(destinationCell.playerColor == testCase.activePlayer,
      'suburb expansion destination owner changed unexpectedly', {
        testCase: testCase,
        playerColor: destinationCell.playerColor
      })
    assert(town.suburbs.length == beforeSuburbs + 1,
      'town suburb list was not extended', {
        testCase: testCase,
        beforeSuburbs: beforeSuburbs,
        afterSuburbs: town.suburbs.length
      })
    assert(town.suburbs.some(function(suburb) {
      return sameCoord(suburb.coord, testCase.destinationCoord)
    }), 'town suburb list does not include expansion destination', testCase)
    assert(channel(after, testCase.destinationCoord, CELL_VECTOR_INDEX.isSuburb) == 1,
      'expanded destination vector is missing suburb flag', testCase)
    assert(channel(after, testCase.destinationCoord, CELL_VECTOR_INDEX.suburbOwner) == 1,
      'expanded destination vector is not friendly-owned', testCase)
    assert(channel(after, testCase.destinationCoord,
        CELL_VECTOR_INDEX.suburbExpansionAvailable) == 0,
      'expanded destination is still marked as an expansion opportunity', testCase)
    assert(channel(after, testCase.producerCoord,
        CELL_VECTOR_INDEX.townSuburbCount) >
      channel(before, testCase.producerCoord, CELL_VECTOR_INDEX.townSuburbCount),
      'town suburb-count vector did not increase', testCase)
    assert(channel(after, testCase.producerCoord,
        CELL_VECTOR_INDEX.townSuburbIncome) >
      channel(before, testCase.producerCoord, CELL_VECTOR_INDEX.townSuburbIncome),
      'town suburb-income vector did not increase', testCase)
    assert(channel(after, testCase.destinationCoord,
        CELL_VECTOR_INDEX.currentPlayerIncome) >
      channel(before, testCase.destinationCoord, CELL_VECTOR_INDEX.currentPlayerIncome),
      'current-player income vector did not increase', testCase)
    assert(channel(after, testCase.destinationCoord,
        CELL_VECTOR_INDEX.currentPlayerSuburbIncome) >
      channel(before, testCase.destinationCoord,
        CELL_VECTOR_INDEX.currentPlayerSuburbIncome),
      'current-player suburb-income vector did not increase', testCase)
  }

  function runCase(testCase) {
    setupSuburbMap(testCase.activePlayer, testCase.seed)
    let initialSnapshot = snapshotGrid()
    let initialVectorGrid = vectoriseGrid()
    let mutableGrid = createMutableVectorGrid(initialVectorGrid)
    let command = findCommand(testCase)
    assert(command, 'suburb-expansion command was not re-enumerated', testCase)
    let town = grid.getBuilding(command.producerCoord)
    let beforeGold = players[testCase.activePlayer].gold
    let beforeSuburbs = town.suburbs.length
    assert(!grid.getHexagon(command.destinationCoord).isSuburb,
      'test destination started as a suburb', testCase)

    assert(players[testCase.activePlayer].applyActionCommand(command),
      'runtime rejected legal suburb-expansion command', testCase)
    let afterVectorGrid = vectoriseGrid()
    assertConcreteSideEffects(
      testCase, initialVectorGrid, afterVectorGrid, beforeGold, beforeSuburbs)

    let applied = applyFastAction(mutableGrid, command)
    compareOrThrow(afterVectorGrid, mutableGrid, testCase, 'after-apply')

    undoFastAction(mutableGrid, applied)
    compareOrThrow(initialVectorGrid, mutableGrid, testCase, 'after-fast-undo')

    actionManager.undo()
    compareOrThrow(initialVectorGrid, vectoriseGrid(), testCase, 'after-normal-undo')
    assert(snapshotGrid() == initialSnapshot,
      'normal actionManager undo did not restore suburb-expansion grid snapshot',
      testCase)
  }

  let cases = []
  let seeds = [93093, 93094, 93095]
  for (let player = 1; player <= 2; ++player) {
    for (let i = 0; i < seeds.length; ++i) {
      let commands = findCommands(player, seeds[i])
      assert(commands.length > 0,
        'no legal suburb-expansion commands were generated', {
          player: player,
          seed: seeds[i]
        })
      cases.push(commands[0])
    }
  }
  for (let i = 0; i < cases.length; ++i) {
    runCase(cases[i])
  }

  return {
    totalCases: cases.length,
    players: cases.map(function(testCase) { return testCase.activePlayer }),
    seeds: seeds
  }
})()`, { filename: 'task093-fast-suburb-expansion-actions.js' }).runInContext(context);

check(result.totalCases === 6,
  'fast suburb-expansion suite did not cover both players and all seeds',
  result);
console.log(
  'Fast suburb-expansion invariant suite passed for ' +
  result.totalCases + ' cases across players ' +
  result.players.join(', ') + ' and seeds ' +
  result.seeds.join(', ')
);
