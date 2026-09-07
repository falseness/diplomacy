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
    reportCase(details) { console.log(JSON.stringify(details)); },
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

  function setup(seed) {
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
    let map = generateTownTrainingMap({
      size: 'big',
      seed: seed,
      playerCount: 2,
      unitsPerPlayer: 10,
      unitComposition: 'all',
      barrackDensity: 0,
      farmDensity: 0,
      externalDensity: 0,
      goldmineCount: 0,
      suburbDensity: 0.4,
      startingGoldMin: 90,
      startingGoldMax: 90
    })
    map.start(manager, false)
    whooseTurn = 1
    suddenDeathRound = 40
    otherSettings.moveCameraToUndoTarget = false
  }

  function unitTypeByName(unitName) {
    let unitTypes = {
      noob: Noob,
      archer: Archer,
      KOHb: KOHb,
      normchel: Normchel,
      catapult: Catapult
    }
    return unitTypes[unitName]
  }

  function sourceForCombatUnit(unitName) {
    if (unitName == 'archer') {
      return {x: 3, y: 3}
    }
    if (unitName == 'catapult') {
      return {x: 2, y: 3}
    }
    return {x: 4, y: 3}
  }

  function createCombatMap(testCase) {
    let source = sourceForCombatUnit(testCase.unitName)
    let target = {x: 5, y: 3}
    let playerOneTown = {x: 1, y: 1}
    let playerTwoTown = testCase.targetKind.startsWith('town') ?
      target : {x: 8, y: 5}
    let playerTwo = {
      rgb: {r: 40, g: 120, b: 220},
      gold: 100,
      towns: [playerTwoTown],
      units: []
    }

    if (testCase.targetKind == 'unit-damage') {
      playerTwo.units.push({
        x: target.x,
        y: target.y,
        type: Normchel,
        hp: Normchel.maxHP
      })
    }
    if (testCase.targetKind == 'unit-kill') {
      playerTwo.units.push({
        x: target.x,
        y: target.y,
        type: Archer,
        hp: 1
      })
    }

    if (testCase.targetKind != 'unit-damage' &&
        testCase.targetKind != 'unit-kill' &&
        !testCase.targetKind.startsWith('town')) {
      playerTwo.suburbs = [{
        town: playerTwoTown,
        cells: [playerTwoTown, target]
      }]
    }
    if (testCase.targetKind == 'farm') {
      playerTwo.farms = [{
        x: target.x,
        y: target.y,
        town: playerTwoTown
      }]
    }
    if (testCase.targetKind == 'barrack') {
      playerTwo.barracks = [{
        x: target.x,
        y: target.y,
        town: playerTwoTown
      }]
    }
    if (testCase.targetKind == 'pending-farm') {
      playerTwo.pendingFarms = [{
        x: target.x,
        y: target.y,
        town: playerTwoTown,
        turns: 1
      }]
    }
    if (testCase.targetKind == 'pending-barrack') {
      playerTwo.pendingBarracks = [{
        x: target.x,
        y: target.y,
        town: playerTwoTown,
        turns: 1
      }]
    }
    if (testCase.targetKind == 'wall') {
      playerTwo.walls = [target]
    }
    if (testCase.targetKind == 'bastion') {
      playerTwo.bastions = [target]
    }
    if (testCase.targetKind == 'tower') {
      playerTwo.towers = [target]
    }

    let map = new GameMap(
      {x: 10, y: 7},
      [
        {rgb: {r: 160, g: 160, b: 160}, towns: []},
        {
          rgb: {r: 220, g: 60, b: 60},
          gold: 100,
          towns: [playerOneTown],
          units: [{
            x: source.x,
            y: source.y,
            type: unitTypeByName(testCase.unitName)
          }]
        },
        playerTwo
      ],
      [],
      [],
      []
    )
    map.start({
      clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        gameExit = false
      }
    }, false)
    if (testCase.targetKind == 'town-capture') {
      // GameMap starts towns with a garrison; this case targets an unguarded town.
      grid.setUnit(new Empty(), target)
      players[2].units = players[2].units.filter(function(unit) {
        return !sameCoord(unit.coord, target)
      })
      let town = grid.getBuilding(target)
      let attacker = grid.getCell(source).unit
      town.hit(town.hp - attacker.dmg)
      assert(town.hp > 0 && !town.isStandable,
        'capture fixture must require a damaging attack', testCase)
    }
    grid.getHexagon(source).firstpaint(1)
    grid.getHexagon(source).isSuburb = false
    if (testCase.targetKind == 'pending-wall') {
      let pending = new ExternalProduction(
        production.wall.turns,
        production.wall.cost,
        Wall,
        'wall'
      )
      pending.coord = target
      externalProduction.push(pending)
      grid.setBuilding(pending, target)
    }
    whooseTurn = 1
    suddenDeathRound = 40
    otherSettings.moveCameraToUndoTarget = false
  }

  function snapshotGrid() {
    let snapshot = {
      whooseTurn: whooseTurn,
      gameRound: gameRound,
      cells: []
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

  function collectCases(seed) {
    setup(seed)
    let cases = []
    let seenTypes = {}
    let units = players[1].units.slice()
    for (let i = 0; i < units.length; ++i) {
      let unit = units[i]
      if (unit.killed || unit.moves <= 0 || !unit.isMyTurn) {
        continue
      }
      seenTypes[unit.name] = true
      cases.push({
        seed: seed,
        kind: 'skip',
        unitName: unit.name,
        source: coordCopy(unit.coord),
        destination: coordCopy(unit.coord)
      })
      let moveCommands = unit.getAvailableMoveCommands()
      for (let j = 0; j < moveCommands.length; ++j) {
        let command = moveCommands[j]
        if (!sameCoord(command.whoDoCommandCoord, command.destinationCoord)) {
          cases.push({
            seed: seed,
            kind: 'movement',
            unitName: unit.name,
            source: coordCopy(command.whoDoCommandCoord),
            destination: coordCopy(command.destinationCoord)
          })
        }
      }
    }
    return {
      cases: cases,
      unitTypes: Object.keys(seenTypes).sort()
    }
  }

  function compareOrThrow(expected, actual, metadata, phase) {
    let comparison = compareVectorGridResults(expected, actual, {limit: 5})
    assert(comparison.equal, 'fast unit action vector mismatch', {
      phase: phase,
      metadata: metadata,
      seed: metadata.seed,
      attacker: metadata.unitName,
      target: metadata.targetKind || metadata.kind,
      command: metadata.command,
      vectorPath: comparison.mismatches.length ?
        comparison.mismatches[0].location : undefined,
      mismatches: comparison.mismatches
    })
  }

  function assertCombatSideEffects(testCase) {
    if (testCase.kind != 'combat') {
      return
    }
    let attacker = grid.getCell(testCase.source).unit
    if (testCase.targetKind == 'town-capture') {
      let town = grid.getBuilding(testCase.destination)
      assert(town.hp == 0 && town.wasHitted, 'capture attack did not exhaust town hp', testCase)
      assert(town.playerColor == 1 && town.isRecentlyCaptured,
        'town ownership/capture flag did not change', testCase)
      assert(grid.getCell(testCase.destination).unit.playerColor == 1,
        'capturing attacker did not occupy town', testCase)
      assert(actionManager.lastAction.isBuildingCaptured,
        'capture undo metadata missing', testCase)
    }
    if (testCase.targetKind == 'unit-damage') {
      let target = grid.getCell(testCase.destination).unit
      assert(target.notEmpty(), 'damage combat target was unexpectedly removed', testCase)
      assert(target.hp < target.maxHP, 'unit attack did not damage target hp', {
        seed: testCase.seed,
        attacker: testCase.unitName,
        target: testCase.targetKind,
        command: testCase.command,
        targetHp: target.hp,
        targetMaxHp: target.maxHP
      })
      assert(!target.killed, 'damage combat target was unexpectedly killed', testCase)
      assert(target.wasHitted, 'damage combat target was not marked hit', testCase)
    }
    if (testCase.targetKind == 'unit-kill') {
      let target = grid.getCell(testCase.destination).unit
      assert(target.isEmpty() || target.playerColor != 2,
        'unit kill attack left enemy target on grid', {
        seed: testCase.seed,
        attacker: testCase.unitName,
        target: testCase.targetKind,
        command: testCase.command,
        targetUnit: target.toJSON()
      })
    }
    if (testCase.unitName == 'catapult' &&
        (testCase.targetKind == 'unit-damage' ||
        testCase.targetKind == 'unit-kill')) {
      assert(attacker.moves == 0, 'catapult unit attack did not consume moves', {
        seed: testCase.seed,
        attacker: testCase.unitName,
        target: testCase.targetKind,
        command: testCase.command,
        attackerMoves: attacker.moves
      })
    }
  }

  function runCase(testCase) {
    if (testCase.kind == 'combat') {
      createCombatMap(testCase)
    }
    else {
      setup(testCase.seed)
    }
    let initialSnapshot = snapshotGrid()
    let initialVectorGrid = vectoriseGrid()
    let mutableGrid = createMutableVectorGrid(initialVectorGrid)
    let command = {
      type: 'unit',
      whoDoCommandCoord: coordCopy(testCase.source),
      destinationCoord: coordCopy(testCase.destination)
    }
    testCase.command = {
      type: command.type,
      whoDoCommandCoord: coordCopy(command.whoDoCommandCoord),
      destinationCoord: coordCopy(command.destinationCoord)
    }
    let unit = grid.getCell(command.whoDoCommandCoord).unit
    assert(unit && unit.name == testCase.unitName, 'test unit not found', testCase)
    let availableCommands = unit.getAvailableCommands()
    let isAvailable = false
    for (let i = 0; i < availableCommands.length; ++i) {
      if (sameCoord(availableCommands[i].destinationCoord,
              command.destinationCoord)) {
        isAvailable = true
        break
      }
    }
    assert(isAvailable, 'combat invariant command is not legal', testCase)
    let initialMoves = unit.moves
    unit.select()
    if (testCase.kind == 'skip') {
      unit.skipMoves()
    }
    else {
      unit.sendInstructions(grid.getCell(command.destinationCoord))
    }
    if (testCase.kind == 'combat') {
      assert(unit.moves < initialMoves, 'combat did not consume moves', testCase)
    }
    assertCombatSideEffects(testCase)
    let applied = applyFastAction(mutableGrid, command)
    compareOrThrow(vectoriseGrid(), mutableGrid, testCase, 'after-apply')

    undoFastAction(mutableGrid, applied)
    compareOrThrow(initialVectorGrid, mutableGrid, testCase, 'after-fast-undo')

    actionManager.undo()
    compareOrThrow(initialVectorGrid, vectoriseGrid(), testCase, 'after-normal-undo')
    assert(snapshotGrid() == initialSnapshot,
      'normal actionManager undo did not restore grid snapshot', testCase)
    if (testCase.kind == 'combat') {
      reportCase({status: 'PASS', seed: testCase.seed, attacker: testCase.unitName,
        target: testCase.targetKind, command: command,
        checks: 'side-effects apply fast-undo normal-undo grid-restore'})
    }
  }

  function combatCase(unitName, targetKind) {
    return {
      seed: 90090,
      kind: 'combat',
      unitName: unitName,
      targetKind: targetKind,
      source: sourceForCombatUnit(unitName),
      destination: {x: 5, y: 3}
    }
  }

  let allCases = []
  let allTypes = {}
  let seeds = [89089, 89090, 89091, 89092, 89093]
  for (let i = 0; i < seeds.length; ++i) {
    let collected = collectCases(seeds[i])
    allCases = allCases.concat(collected.cases)
    collected.unitTypes.forEach(function(unitType) {
      allTypes[unitType] = true
    })
  }
  let expectedTypes = ['archer', 'catapult', 'KOHb', 'noob', 'normchel']
  for (let i = 0; i < expectedTypes.length; ++i) {
    assert(allTypes[expectedTypes[i]], 'missing unit type in fast movement suite', {
      unitType: expectedTypes[i],
      seen: Object.keys(allTypes).sort()
    })
  }
  let movementCases = allCases.filter(function(testCase) {
    return testCase.kind == 'movement'
  })
  let skipCases = allCases.filter(function(testCase) {
    return testCase.kind == 'skip'
  })
  assert(movementCases.length >= expectedTypes.length,
    'not enough movement cases generated', {movementCases: movementCases.length})
  assert(skipCases.length >= expectedTypes.length,
    'not enough skip cases generated', {skipCases: skipCases.length})

  for (let i = 0; i < allCases.length; ++i) {
    runCase(allCases[i])
  }

  let combatCases = []
  let unitCombatTargets = ['unit-damage', 'unit-kill']
  let unitAttackers = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
  for (let i = 0; i < unitAttackers.length; ++i) {
    for (let j = 0; j < unitCombatTargets.length; ++j) {
      combatCases.push(combatCase(unitAttackers[i], unitCombatTargets[j]))
    }
  }
  let buildingTargets = [
    'town',
    'farm',
    'barrack',
    'wall',
    'bastion',
    'tower',
    'pending-farm',
    'pending-barrack',
    'pending-wall'
  ]
  let buildingAttackers = ['noob', 'archer', 'KOHb', 'normchel', 'catapult']
  for (let i = 0; i < buildingAttackers.length; ++i) {
    for (let j = 0; j < buildingTargets.length; ++j) {
      combatCases.push(combatCase(buildingAttackers[i], buildingTargets[j]))
    }
  }
  for (let unitName of ['noob', 'KOHb', 'normchel']) {
    combatCases.push(combatCase(unitName, 'town-capture'))
  }
  // Exercise the real mismatch formatter with a deliberately different vector.
  let diagnosticCase = combatCases[0]
  diagnosticCase.command = {type: 'unit', whoDoCommandCoord: diagnosticCase.source,
    destinationCoord: diagnosticCase.destination}
  let diagnosticMessage = ''
  try {
    compareOrThrow([0], [1], diagnosticCase, 'negative-control')
  } catch (error) {
    diagnosticMessage = error.message
  }
  for (let field of ['seed', 'attacker', 'target', 'command', 'vectorPath']) {
    assert(diagnosticMessage.includes('"' + field + '"'),
      'mismatch diagnostic missing field', {field: field, message: diagnosticMessage})
  }
  reportCase({status: 'PASS', check: 'mismatch-diagnostics', message: diagnosticMessage})
  for (let i = 0; i < combatCases.length; ++i) {
    runCase(combatCases[i])
  }

  return {
    seeds: seeds,
    totalCases: allCases.length,
    movementCases: movementCases.length,
    skipCases: skipCases.length,
    combatCases: combatCases.length,
    combatUnitAttackers: unitAttackers,
    combatBuildingAttackers: buildingAttackers,
    combatBuildingTargets: buildingTargets,
    unitTypes: Object.keys(allTypes).sort()
  }
})()`, { filename: 'task090-fast-unit-actions.js' }).runInContext(context);

check(result.totalCases > 0, 'fast unit action suite produced no cases', result);
console.log(
  'Fast unit action invariant suite passed for ' +
  result.totalCases + ' cases across seeds ' + result.seeds.join(', ') +
  ', ' + result.combatCases + ' combat cases, and unit types ' +
  result.unitTypes.join(', ')
);

console.log(JSON.stringify(result));
