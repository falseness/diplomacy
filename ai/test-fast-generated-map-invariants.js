const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    return fallback;
  }
  return args[index + 1];
}

function numericArg(name, fallback) {
  const parsed = Number(argValue(name, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const stressMs = numericArg('--stress-ms',
  Number(process.env.FAST_INVARIANT_STRESS_MS || 0));
const seedStart = numericArg('--seed-start',
  Number(process.env.FAST_INVARIANT_SEED_START || 98000));
const reportPath = path.join(
  '/mnt/storage/diplomacy/benchmarks',
  argValue('--report-name',
    stressMs > 0
      ? 'task098-fast-action-invariant-stress.json'
      : 'task097-fast-generated-map-invariants.json')
);

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
context.__fastInvariantOptions = {
  stressMs,
  seedStart
};
loadBrowserScripts(context);

const report = new vm.Script(`(() => {
  function assert(condition, message, details) {
    if (!condition) {
      throw new Error(message + (details ? ': ' + JSON.stringify(details) : ''))
    }
  }

  function coordCopy(coord) {
    return {x: coord.x, y: coord.y}
  }

  function sameCoord(left, right) {
    if (!left || !right) {
      return !left && !right
    }
    return left.x == right.x && left.y == right.y
  }

  function increment(object, key, amount) {
    object[key] = (object[key] || 0) + (amount || 1)
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
    AiRuntime.trainFromHumanCommands = function() {}
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
      goldmineCount: 5,
      startingGoldMin: 1000,
      startingGoldMax: 1000
    }, testMap.options || {}))
  }

  function setup(testMap, playerIndex) {
    resetRuntime()
    let map = createGeneratedMap(testMap)
    map.start(manager(), false)
    whooseTurn = playerIndex
    Object.setPrototypeOf(players[playerIndex], AIPlayerWithEconomy.prototype)
    players[playerIndex].gold = 1000
    return map
  }

  function commandSummary(command) {
    return {
      type: command.type || null,
      category: fastActionCommandCategory(command),
      product: command.product || null,
      producerCoord: command.producerCoord || null,
      whoDoCommandCoord: command.whoDoCommandCoord || null,
      destinationCoord: command.destinationCoord || null
    }
  }

  function commandKey(command) {
    return JSON.stringify(commandSummary(command))
  }

  function findEquivalentCommand(commands, summary) {
    for (let i = 0; i < commands.length; ++i) {
      let candidate = commandSummary(commands[i])
      if (candidate.type == summary.type &&
          candidate.category == summary.category &&
          candidate.product == summary.product &&
          sameCoord(candidate.producerCoord, summary.producerCoord) &&
          sameCoord(candidate.whoDoCommandCoord, summary.whoDoCommandCoord) &&
          sameCoord(candidate.destinationCoord, summary.destinationCoord)) {
        return commands[i]
      }
    }
    return null
  }

  function enumerateUniqueCommands(player) {
    let commands = player.getActionCommands()
    let seen = {}
    let unique = []
    for (let i = 0; i < commands.length; ++i) {
      let key = commandKey(commands[i])
      if (seen[key]) {
        continue
      }
      seen[key] = true
      unique.push(commands[i])
    }
    return unique
  }

  function applyCommand(player, command) {
    if (command.type == 'economy') {
      return player.applyActionCommand(command)
    }
    return applyLiveAiCommandUnit(player, command)
  }

  function serializeEntity(entity) {
    if (!entity || !entity.toJSON) {
      return null
    }
    return entity.toJSON()
  }

  function serializeGridEntity(entity) {
    if (!entity || !entity.toJSON) {
      return null
    }
    let packed = entity.toJSON()
    delete packed.buildings
    delete packed.buildingProduction
    delete packed.suburbs
    return packed
  }

  function serializeTownEntity(town) {
    let packed = serializeEntity(town)
    delete packed.buildings
    delete packed.buildingProduction
    delete packed.suburbs
    return packed
  }

  function sortPackedEntities(items) {
    return items.slice().sort(function(left, right) {
      let leftCoord = left && left.coord ? left.coord : {x: -1, y: -1}
      let rightCoord = right && right.coord ? right.coord : {x: -1, y: -1}
      return String(left && left.name).localeCompare(String(right && right.name)) ||
        leftCoord.x - rightCoord.x ||
        leftCoord.y - rightCoord.y
    })
  }

  function snapshotGrid0() {
    let snapshot = {
      whooseTurn: whooseTurn,
      gameRound: gameRound,
      gameExit: gameExit,
      players: [],
      cells: [],
      external: external.map(serializeEntity),
      externalProduction: externalProduction.map(serializeEntity),
      nature: nature.map(serializeEntity),
      goldmines: goldmines.map(serializeEntity)
    }
    for (let i = 0; i < players.length; ++i) {
      snapshot.players[i] = {
        gold: players[i].gold,
        income: players[i].income,
        isLost: Boolean(players[i].isLost),
        units: players[i].units.map(serializeEntity),
        towns: players[i].towns.map(function(town) {
          return {
            entity: serializeTownEntity(town),
            buildings: sortPackedEntities(town.buildings.map(serializeEntity)),
            buildingProduction:
              sortPackedEntities(town.buildingProduction.map(serializeEntity)),
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
          unit: serializeGridEntity(cell.unit),
          building: serializeGridEntity(cell.building)
        }
      }
    }
    return JSON.stringify(snapshot)
  }

  function firstMismatchPath(comparison) {
    if (!comparison || !comparison.mismatches || !comparison.mismatches.length) {
      return null
    }
    return comparison.mismatches[0].location
  }

  function compareVectorOrThrow(expected, actual, metadata, phase) {
    let comparison = compareVectorGridResults(expected, actual, {limit: 8})
    assert(comparison.equal, 'generated-map invariant vector mismatch', {
      seed: metadata.seed,
      player: metadata.player,
      phase: phase,
      actionCategory: metadata.actionCategory,
      command: metadata.command,
      mismatchPath: firstMismatchPath(comparison),
      mismatches: comparison.mismatches
    })
  }

  function assertGridRestored(expectedSnapshot, metadata) {
    let actual = snapshotGrid0()
    let mismatchPath = firstSnapshotMismatch(
      JSON.parse(expectedSnapshot), JSON.parse(actual), 'grid0')
    assert(!mismatchPath, 'generated-map invariant grid0 mismatch', {
      seed: metadata.seed,
      player: metadata.player,
      actionCategory: metadata.actionCategory,
      command: metadata.command,
      mismatchPath: mismatchPath || 'grid0-snapshot'
    })
  }

  function firstSnapshotMismatch(expected, actual, path) {
    if (expected === actual) {
      return null
    }
    if (expected === null || actual === null ||
        typeof expected != 'object' || typeof actual != 'object') {
      return path
    }
    if (Array.isArray(expected) || Array.isArray(actual)) {
      if (!Array.isArray(expected) || !Array.isArray(actual)) {
        return path
      }
      if (expected.length != actual.length) {
        return path + '.length'
      }
      for (let i = 0; i < expected.length; ++i) {
        let child = firstSnapshotMismatch(
          expected[i], actual[i], path + '[' + i + ']')
        if (child) {
          return child
        }
      }
      return null
    }
    let expectedKeys = Object.keys(expected).sort()
    let actualKeys = Object.keys(actual).sort()
    if (expectedKeys.join('|') != actualKeys.join('|')) {
      return path + '.keys'
    }
    for (let i = 0; i < expectedKeys.length; ++i) {
      let key = expectedKeys[i]
      let child = firstSnapshotMismatch(
        expected[key], actual[key], path + '.' + key)
      if (child) {
        return child
      }
    }
    return null
  }

  function updateObjectCoverage(summary) {
    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
      increment(summary.objectCoverage.players, playerIndex)
      if (players[playerIndex].gold > 0) {
        increment(summary.objectCoverage.economyState, 'player-gold')
      }
      if (players[playerIndex].income > 0) {
        increment(summary.objectCoverage.economyState, 'player-income')
      }
      for (let i = 0; i < players[playerIndex].units.length; ++i) {
        let unit = players[playerIndex].units[i]
        if (!unit.killed && unit.name) {
          increment(summary.objectCoverage.units, unit.name)
        }
      }
      for (let i = 0; i < players[playerIndex].towns.length; ++i) {
        let town = players[playerIndex].towns[i]
        increment(summary.objectCoverage.buildings, 'town')
        for (let j = 0; j < town.suburbs.length; ++j) {
          if (town.suburbs[j].isSuburb) {
            increment(summary.objectCoverage.buildings, 'suburb')
          }
        }
        for (let j = 0; j < town.buildings.length; ++j) {
          let building = town.buildings[j]
          if (!building.killed && building.name) {
            increment(summary.objectCoverage.buildings, building.name)
          }
        }
        for (let j = 0; j < town.buildingProduction.length; ++j) {
          let pending = town.buildingProduction[j]
          if (!pending.killed && pending.name) {
            increment(summary.objectCoverage.pendingProductions, pending.name)
          }
        }
      }
    }
    for (let i = 0; i < external.length; ++i) {
      if (!external[i].killed && external[i].name) {
        increment(summary.objectCoverage.buildings, external[i].name)
      }
    }
    for (let i = 0; i < externalProduction.length; ++i) {
      if (!externalProduction[i].killed && externalProduction[i].name) {
        increment(summary.objectCoverage.pendingProductions,
          externalProduction[i].name)
      }
    }
    for (let i = 0; i < goldmines.length; ++i) {
      if (!goldmines[i].killed) {
        increment(summary.objectCoverage.buildings, 'goldmine')
        increment(summary.objectCoverage.economyState, 'goldmine-income')
      }
    }
  }

  function auditCommand(testMap, playerIndex, player, command, summary) {
    let metadata = {
      seed: testMap.seed,
      sourceName: testMap.name,
      player: playerIndex,
      actionCategory: fastActionCommandCategory(command),
      command: commandSummary(command)
    }
    let initialSnapshot = snapshotGrid0()
    let initialVectorGrid = vectoriseGrid()
    let mutableGrid = createMutableVectorGrid(initialVectorGrid)

    assert(applyCommand(player, command), 'runtime rejected generated-map legal action', {
      seed: metadata.seed,
      sourceName: metadata.sourceName,
      player: metadata.player,
      actionCategory: metadata.actionCategory,
      command: metadata.command,
      mismatchPath: 'runtime-apply'
    })
    let afterApplyVectorGrid = vectoriseGrid()
    let applied = applyFastAction(mutableGrid, command)
    compareVectorOrThrow(afterApplyVectorGrid, mutableGrid, metadata, 'after-apply')

    undoFastAction(mutableGrid, applied)
    compareVectorOrThrow(initialVectorGrid, mutableGrid, metadata, 'after-fast-undo')

    actionManager.undo()
    compareVectorOrThrow(initialVectorGrid, vectoriseGrid(), metadata, 'after-normal-undo')
    assertGridRestored(initialSnapshot, metadata)

    increment(summary.actionCategories, metadata.actionCategory)
    if (command.type == 'economy') {
      increment(summary.economyProducts, command.product)
    }
    else {
      increment(summary.combatCommands, 'unit')
    }
    ++summary.commandsAudited
  }

  function auditSeed(testMap, summary) {
    setup(testMap, 1)
    updateObjectCoverage(summary)
    summary.generatedMaps.push({
      seed: testMap.seed,
      name: testMap.name,
      mapSize: {x: grid.arr.length, y: grid.arr[0].length},
      players: players.length - 1
    })
    let playerCommands = []
    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
      setup(testMap, playerIndex)
      playerCommands.push({
        player: playerIndex,
        playerObject: players[playerIndex],
        commands: enumerateUniqueCommands(players[playerIndex])
      })
      for (let j = 0; j < playerCommands[playerCommands.length - 1].commands.length; ++j) {
        auditCommand(
          testMap,
          playerIndex,
          players[playerIndex],
          playerCommands[playerCommands.length - 1].commands[j],
          summary)
      }
    }
  }

  let summary = {
    source: __fastInvariantOptions.stressMs > 0
      ? 'TASK-098 long fast-action invariant stress verification'
      : 'TASK-097 generated-map fast-action invariant suite',
    startedAt: new Date().toISOString(),
    stressTargetMs: __fastInvariantOptions.stressMs,
    seedStart: __fastInvariantOptions.seedStart,
    generatedMaps: [],
    commandsAudited: 0,
    vectorMismatches: 0,
    undoMismatches: 0,
    gridRestorationMismatches: 0,
    actionCategories: {},
    economyProducts: {},
    combatCommands: {},
    objectCoverage: {
      players: {},
      units: {},
      buildings: {},
      pendingProductions: {},
      economyState: {}
    }
  }
  let baseMaps = [
    {
      name: 'all-unit-actions',
      seed: 97097,
      options: {
        unitsPerPlayer: 5,
        externalDensity: 1
      }
    },
    {
      name: 'completed-farms',
      seed: 97000,
      options: {
        farmDensity: 1,
        pendingFarmProbability: 0
      }
    },
    {
      name: 'pending-farms',
      seed: 97000,
      options: {
        farmDensity: 1,
        pendingFarmProbability: 1
      }
    },
    {
      name: 'completed-barracks',
      seed: 97000,
      options: {
        barrackDensity: 1,
        pendingBarrackProbability: 0
      }
    },
    {
      name: 'pending-barracks',
      seed: 97000,
      options: {
        barrackDensity: 1,
        pendingBarrackProbability: 1
      }
    },
    {
      name: 'completed-defenses',
      seed: 97097,
      options: {
        externalDensity: 1
      }
    }
  ]
  function buildStressMaps(seedBase) {
    let maps = []
    for (let i = 0; i < baseMaps.length; ++i) {
      maps.push(Object.assign({}, baseMaps[i], {
        name: baseMaps[i].name + '-stress-' + seedBase,
        seed: seedBase + i * 97
      }))
    }
    return maps
  }

  let testMaps = baseMaps
  if (__fastInvariantOptions.stressMs > 0) {
    testMaps = []
    let deadline = Date.now() + __fastInvariantOptions.stressMs
    let seedBase = __fastInvariantOptions.seedStart
    do {
      let waveMaps = buildStressMaps(seedBase)
      for (let i = 0; i < waveMaps.length; ++i) {
        auditSeed(waveMaps[i], summary)
        testMaps.push(waveMaps[i])
      }
      seedBase += 1000
    } while (Date.now() < deadline)
  }
  else {
    for (let i = 0; i < testMaps.length; ++i) {
      auditSeed(testMaps[i], summary)
    }
  }
  summary.seeds = testMaps.map(function(testMap) { return testMap.seed })
  summary.seedCount = summary.seeds.length
  summary.testMaps = testMaps.map(function(testMap) {
    return {name: testMap.name, seed: testMap.seed}
  })
  summary.finishedAt = new Date().toISOString()
  summary.runtimeMs = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt)
  return summary
})()`, { filename: 'task097-fast-generated-map-invariants.js' }).runInContext(context);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

for (const unit of ['noob', 'archer', 'KOHb', 'normchel', 'catapult']) {
  check(report.objectCoverage.units[unit] > 0,
    'generated-map invariant suite did not cover unit ' + unit, report);
}
for (const object of [
  'town',
  'suburb',
  'barrack',
  'farm',
  'goldmine',
  'wall',
  'bastion',
  'tower'
]) {
  check(report.objectCoverage.buildings[object] > 0,
    'generated-map invariant suite did not cover object ' + object, report);
}
for (const pending of ['barrack', 'farm']) {
  check(report.objectCoverage.pendingProductions[pending] > 0,
    'generated-map invariant suite did not cover pending ' + pending, report);
}
for (const state of ['player-gold', 'player-income', 'goldmine-income']) {
  check(report.objectCoverage.economyState[state] > 0,
    'generated-map invariant suite did not cover economy state ' + state,
    report);
}
for (const category of [
  'unit',
  'unit-training',
  'suburb-expansion',
  'building-placement'
]) {
  check(report.actionCategories[category] > 0,
    'generated-map invariant suite did not cover action category ' + category,
    report);
}
for (const product of [
  'noob',
  'archer',
  'KOHb',
  'normchel',
  'catapult',
  'suburb',
  'farm',
  'barrack',
  'wall',
  'bastion',
  'tower'
]) {
  check(report.economyProducts[product] > 0,
    'generated-map invariant suite did not cover economy product ' + product,
    report);
}
check(report.commandsAudited > 0,
  'generated-map invariant suite did not audit any legal actions', report);
check(report.vectorMismatches === 0,
  'generated-map invariant suite reported vector mismatches', report);
check(report.undoMismatches === 0,
  'generated-map invariant suite reported undo mismatches', report);
check(report.gridRestorationMismatches === 0,
  'generated-map invariant suite reported grid restoration mismatches', report);

console.log('Generated-map fast-action invariant suite passed');
console.log(JSON.stringify({
  reportPath,
  source: report.source,
  runtimeMs: report.runtimeMs,
  seedCount: report.seedCount,
  seeds: report.seeds,
  generatedMapCount: report.generatedMaps.length,
  commandsAudited: report.commandsAudited,
  vectorMismatches: report.vectorMismatches,
  undoMismatches: report.undoMismatches,
  gridRestorationMismatches: report.gridRestorationMismatches,
  actionCategories: report.actionCategories,
  economyProducts: report.economyProducts,
  objectCoverage: report.objectCoverage
}, null, 2));
