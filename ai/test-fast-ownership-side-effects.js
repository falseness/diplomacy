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

  function configureCaptureMap(attackerPlayer) {
    resetRuntime()
    let defenderPlayer = attackerPlayer == 1 ? 2 : 1
    let townOne = {x: 2, y: 2}
    let townTwo = {x: 5, y: 2}
    let source = attackerPlayer == 1 ? {x: 4, y: 2} : {x: 3, y: 2}
    let target = attackerPlayer == 1 ? townTwo : townOne
    let playersConfig = [
      {rgb: {r: 160, g: 160, b: 160}, towns: []},
      {
        rgb: {r: 220, g: 60, b: 60},
        gold: 100,
        towns: [townOne],
        units: attackerPlayer == 1 ? [{
          x: source.x,
          y: source.y,
          type: Normchel
        }] : [],
        suburbs: [{
          town: townOne,
          cells: [townOne, {x: 3, y: 2}, {x: 2, y: 3}]
        }]
      },
      {
        rgb: {r: 40, g: 120, b: 220},
        gold: 100,
        towns: [townTwo],
        units: attackerPlayer == 2 ? [{
          x: source.x,
          y: source.y,
          type: Normchel
        }] : [],
        suburbs: [{
          town: townTwo,
          cells: [townTwo, {x: 4, y: 2}, {x: 5, y: 3}]
        }]
      }
    ]
    let map = new GameMap({x: 8, y: 6}, playersConfig, [], [], [])
    map.start(manager(), false)
    whooseTurn = attackerPlayer
    grid.getHexagon(source).firstpaint(attackerPlayer)
    grid.getHexagon(source).isSuburb = false

    let targetTown = grid.getBuilding(target)
    targetTown.hit(targetTown.hp)
    grid.setUnit(new Empty(), target)
    players[defenderPlayer].units = players[defenderPlayer].units.filter(function(unit) {
      return !sameCoord(unit.coord, target)
    })
    assert(targetTown.isStandable, 'target town is not standable for capture', {
      attackerPlayer: attackerPlayer,
      target: target
    })
    return {
      kind: 'town-capture',
      attackerPlayer: attackerPlayer,
      defenderPlayer: defenderPlayer,
      source: source,
      target: target,
      paintedPath: [target],
      capturedTown: target
    }
  }

  function configureSuburbPaintMap(attackerPlayer) {
    resetRuntime()
    let defenderPlayer = attackerPlayer == 1 ? 2 : 1
    let townOne = {x: 1, y: 2}
    let townTwo = {x: 5, y: 2}
    let source = attackerPlayer == 1 ? {x: 3, y: 2} : {x: 3, y: 3}
    let target = attackerPlayer == 1 ? {x: 4, y: 2} : {x: 2, y: 2}
    let playersConfig = [
      {rgb: {r: 160, g: 160, b: 160}, towns: []},
      {
        rgb: {r: 220, g: 60, b: 60},
        gold: 100,
        towns: [townOne],
        units: attackerPlayer == 1 ? [{
          x: source.x,
          y: source.y,
          type: Normchel
        }] : [],
        suburbs: [{
          town: townOne,
          cells: [townOne, {x: 2, y: 2}, {x: 1, y: 3}]
        }]
      },
      {
        rgb: {r: 40, g: 120, b: 220},
        gold: 100,
        towns: [townTwo],
        units: attackerPlayer == 2 ? [{
          x: source.x,
          y: source.y,
          type: Normchel
        }] : [],
        suburbs: [{
          town: townTwo,
          cells: [townTwo, {x: 4, y: 2}, {x: 5, y: 3}]
        }]
      }
    ]
    let map = new GameMap({x: 8, y: 6}, playersConfig, [], [], [])
    map.start(manager(), false)
    whooseTurn = attackerPlayer
    grid.getHexagon(source).firstpaint(attackerPlayer)
    grid.getHexagon(source).isSuburb = false
    assert(grid.getHexagon(target).isSuburb, 'target is not a suburb before paint', {
      attackerPlayer: attackerPlayer,
      target: target
    })
    assert(grid.getHexagon(target).playerColor == defenderPlayer,
      'target suburb is not defender-owned before paint', {
      attackerPlayer: attackerPlayer,
      target: target
    })
    return {
      kind: 'suburb-paint',
      attackerPlayer: attackerPlayer,
      defenderPlayer: defenderPlayer,
      source: source,
      target: target,
      paintedPath: [target]
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
        towns: players[i].towns.map(function(town) {
          return coordCopy(town.coord)
        }),
        units: players[i].units.map(function(unit) {
          return coordCopy(unit.coord)
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
    assert(comparison.equal, 'fast ownership side-effect vector mismatch', {
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

  function assertGlobalChannelsChanged(before, after, metadata) {
    let coord = metadata.target
    let channels = [
      CELL_VECTOR_INDEX.currentPlayerIncome,
      CELL_VECTOR_INDEX.strongestOpponentIncome,
      CELL_VECTOR_INDEX.relativeIncomeAdvantage,
      CELL_VECTOR_INDEX.currentPlayerSuburbIncome,
      CELL_VECTOR_INDEX.strongestOpponentSuburbIncome,
      CELL_VECTOR_INDEX.relativeSuburbIncomeAdvantage
    ]
    let changed = false
    for (let i = 0; i < channels.length; ++i) {
      if (channel(before, coord, channels[i]) !== channel(after, coord, channels[i])) {
        changed = true
      }
    }
    assert(changed, 'ownership side effect did not change income summary channels', {
      metadata: metadata,
      before: channels.map(function(index) { return channel(before, coord, index) }),
      after: channels.map(function(index) { return channel(after, coord, index) })
    })
  }

  function assertConcreteSideEffects(metadata, before, after) {
    let targetCell = grid.getCell(metadata.target)
    assert(targetCell.playerColor == metadata.attackerPlayer,
      'target cell was not repainted to attacker', {
      metadata: metadata,
      targetPlayerColor: targetCell.playerColor,
      targetIsSuburb: targetCell.hexagon.isSuburb,
      targetBuilding: targetCell.building.toJSON(),
      targetUnit: targetCell.unit.toJSON()
    })

    if (metadata.kind == 'town-capture') {
      let town = targetCell.building
      assert(town.isTown() && town.playerColor == metadata.attackerPlayer,
        'town was not captured by attacker', metadata)
      assert(channel(after, metadata.target, CELL_VECTOR_INDEX.townOwner) == 1,
        'captured town is not friendly from current-player perspective', metadata)
      assert(channel(after, metadata.target, CELL_VECTOR_INDEX.townSuburbCount) > 0,
        'captured town lost all valid suburbs', metadata)
      assert(channel(after, metadata.target, CELL_VECTOR_INDEX.suburbOwner) ==
        relativePlayerValue(targetCell.playerColor),
        'captured town suburb owner channel does not match ownership', metadata)
    }
    else {
      assert(!targetCell.hexagon.isSuburb,
        'captured suburb flag was not cleared by repaint', metadata)
      assert(channel(after, metadata.target, CELL_VECTOR_INDEX.isSuburb) == 0,
        'captured suburb vector flag remained set', metadata)
      assert(channel(before, metadata.target, CELL_VECTOR_INDEX.isSuburb) == 1,
        'test did not start with a suburb vector flag', metadata)
    }
    assertGlobalChannelsChanged(before, after, metadata)
  }

  function assertOpponentPerspective(metadata, defenderView) {
    if (metadata.kind == 'town-capture') {
      assert(channel(defenderView, metadata.target, CELL_VECTOR_INDEX.townOwner) == -1,
        'captured town is not enemy-owned from opponent perspective', metadata)
    }
    else {
      assert(channel(defenderView, metadata.target, CELL_VECTOR_INDEX.suburbExpansionOwner) == -1 ||
          channel(defenderView, metadata.target, CELL_VECTOR_INDEX.isSuburb) == 0,
        'painted cell did not expose opponent-relative ownership change', metadata)
    }
  }

  function runCase(metadata) {
    let initialSnapshot = snapshotGrid()
    let views = [metadata.attackerPlayer, metadata.defenderPlayer].map(function(player) {
      whooseTurn = player
      let initial = vectoriseGrid()
      return {player: player, initial: initial, mutable: createMutableVectorGrid(initial)}
    })
    whooseTurn = metadata.attackerPlayer
    let unit = grid.getCell(metadata.source).unit
    assert(unit && unit.notEmpty() && unit.playerColor == metadata.attackerPlayer,
      'attacking unit not found', metadata)
    let availableCommands = unit.getAvailableCommands()
    let isAvailable = false
    for (let i = 0; i < availableCommands.length; ++i) {
      if (sameCoord(availableCommands[i].destinationCoord, metadata.target)) {
        isAvailable = true
        break
      }
    }
    assert(isAvailable, 'ownership side-effect command is not legal', metadata)

    unit.select()
    unit.sendInstructions(grid.getCell(metadata.target))
    let command = {
      type: 'unit',
      whoDoCommandCoord: coordCopy(metadata.source),
      destinationCoord: coordCopy(metadata.target)
    }
    for (let view of views) {
      whooseTurn = view.player
      let perspectiveMetadata = Object.assign({}, metadata, {perspectivePlayer: view.player})
      let after = vectoriseGrid()
      if (view.player == metadata.attackerPlayer) {
        assertConcreteSideEffects(metadata, view.initial, after)
      }
      else {
        assertOpponentPerspective(metadata, after)
        assertGlobalChannelsChanged(view.initial, after, perspectiveMetadata)
      }
      let applied = applyFastAction(view.mutable, command)
      compareOrThrow(after, view.mutable, perspectiveMetadata, 'after-apply')
      undoFastAction(view.mutable, applied)
      compareOrThrow(view.initial, view.mutable, perspectiveMetadata, 'after-fast-undo')
    }

    // Execute and undo the real command on the attacker's turn. Only vector
    // construction and fast updates use the defender's perspective.
    whooseTurn = metadata.attackerPlayer
    actionManager.undo()
    for (let view of views) {
      whooseTurn = view.player
      compareOrThrow(view.initial, vectoriseGrid(),
        Object.assign({}, metadata, {perspectivePlayer: view.player}), 'after-normal-undo')
    }
    whooseTurn = metadata.attackerPlayer
    assert(snapshotGrid() == initialSnapshot,
      'normal actionManager undo did not restore ownership grid snapshot', metadata)
  }

  let cases = []
  for (let player = 1; player <= 2; ++player) {
    cases.push(configureCaptureMap(player))
    runCase(cases[cases.length - 1])
    cases.push(configureSuburbPaintMap(player))
    runCase(cases[cases.length - 1])
  }

  return {
    cases: cases,
    totalCases: cases.length,
    kinds: cases.map(function(testCase) { return testCase.kind }),
    players: cases.map(function(testCase) { return testCase.attackerPlayer })
  }
})()`, { filename: 'task091-fast-ownership-side-effects.js' }).runInContext(context);

check(result.totalCases === 4, 'fast ownership side-effect suite did not run all cases', result);
console.log(
  'Fast ownership side-effect invariant suite passed for ' +
  result.totalCases + ' capture/suburb cases across players ' +
  result.players.join(', ')
);

for (const testCase of result.cases) {
  for (const perspectivePlayer of [testCase.attackerPlayer, testCase.defenderPlayer]) {
    console.log(JSON.stringify({
      status: 'PASS',
      kind: testCase.kind,
      attackerPlayer: testCase.attackerPlayer,
      perspectivePlayer,
      checks: 'full-vector ownership income suburb-income apply fast-undo normal-undo grid-restore'
    }));
  }
}
