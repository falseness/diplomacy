const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const reportPath = path.join(
  '/mnt/storage/diplomacy/benchmarks',
  'task096-fast-action-coverage.json'
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
loadBrowserScripts(context);

const report = new vm.Script(`(() => {
  function assert(condition, message, details) {
    if (!condition) {
      throw new Error(message + (details ? ': ' + JSON.stringify(details) : ''))
    }
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

  function commandKey(command) {
    return JSON.stringify({
      type: command.type || null,
      category: command.category || null,
      product: command.product || null,
      producerCoord: command.producerCoord || null,
      whoDoCommandCoord: command.whoDoCommandCoord || null,
      destinationCoord: command.destinationCoord || null
    })
  }

  function logicalCategory(command) {
    return command.type == 'economy' ? command.category : 'combat'
  }

  function handlerCategory(command) {
    return fastActionCommandCategory(command)
  }

  function increment(object, key, amount) {
    object[key] = (object[key] || 0) + (amount || 1)
  }

  function sanitizeCommand(command) {
    return {
      type: command.type || null,
      category: command.category || null,
      product: command.product || null,
      producerCoord: command.producerCoord || null,
      whoDoCommandCoord: command.whoDoCommandCoord || null,
      destinationCoord: command.destinationCoord || null
    }
  }

  function ensureRuntimePlayer(playerIndex, PlayerClass, gold) {
    Object.setPrototypeOf(players[playerIndex], PlayerClass.prototype)
    players[playerIndex].gold = gold
    return players[playerIndex]
  }

  function enumeratePlayerCommands(player) {
    assert(typeof player.getActionCommands == 'function',
      player.constructor.name + ' does not expose getActionCommands')
    let commands = player.getActionCommands()
    let seen = {}
    let unique = []
    for (let i = 0; i < commands.length; ++i) {
      let key = commandKey(commands[i])
      if (!seen[key]) {
        seen[key] = true
        unique.push(commands[i])
      }
    }
    return unique
  }

  function applyCommandForAudit(player, command) {
    if (command.type == 'economy') {
      return player.applyActionCommand(command)
    }
    return applyLiveAiCommandUnit(player, command)
  }

  function auditCommands(player, commands, sourceName, summary) {
    let validatedByCategory = {}
    for (let i = 0; i < commands.length; ++i) {
      let command = commands[i]
      let category = logicalCategory(command)
      let fastCategory = handlerCategory(command)
      increment(summary.logicalCategoryCounts, category)
      increment(summary.fastHandlerCategoryCounts, fastCategory)
      if (command.type == 'economy') {
        increment(summary.economyProductCounts, command.product)
      }
      else {
        increment(summary.combatCommandCounts, 'unit-command')
      }
      if (!summary.examples[category]) {
        summary.examples[category] = sanitizeCommand(command)
      }
      if (validatedByCategory[fastCategory]) {
        continue
      }
      let initialVectorGrid = vectoriseGrid()
      let mutableGrid = createMutableVectorGrid(initialVectorGrid)
      if (!applyCommandForAudit(player, command)) {
        continue
      }
      let applied = applyFastAction(mutableGrid, command)
      undoFastAction(mutableGrid, applied)
      actionManager.undo()
      let comparison = compareVectorGridResults(initialVectorGrid, vectoriseGrid())
      assert(comparison.equal, 'normal undo did not restore audit scenario', {
        sourceName: sourceName,
        category: category,
        command: sanitizeCommand(command),
        mismatches: comparison.mismatches
      })
      validatedByCategory[fastCategory] = true
      summary.validatedHandlerCategories[fastCategory] = true
    }
  }

  function auditPrioritizedCommands(player, sourceName, summary) {
    if (typeof player.getPrioritizedActionCommands != 'function') {
      return
    }
    let commands = player.getPrioritizedActionCommands(120)
    for (let i = 0; i < commands.length; ++i) {
      increment(summary.prioritizedCategoryCounts, logicalCategory(commands[i]))
      increment(summary.prioritizedFastHandlerCategoryCounts,
        handlerCategory(commands[i]))
    }
    auditCommands(player, commands, sourceName + ':prioritized', summary)
  }

  function auditGeneratedMap(seed, summary) {
    resetRuntime()
    let map = generateTownTrainingMap({
      size: 'medium',
      seed: seed,
      playerCount: 4,
      unitComposition: 'all',
      unitsPerPlayer: 5,
      buildingDensity: 'dense',
      barrackDensity: 1,
      farmDensity: 1,
      externalDensity: 1,
      suburbDensity: 1,
      goldmineCount: 6,
      startingGoldMin: 900,
      startingGoldMax: 900
    })
    map.start(manager(), false)
    let sourceName = 'generated-all-feature-' + seed
    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
      whooseTurn = playerIndex
      let economyPlayer = ensureRuntimePlayer(
        playerIndex, AIPlayerWithEconomy, 900)
      let economyCommands = enumeratePlayerCommands(economyPlayer)
      auditCommands(economyPlayer, economyCommands, sourceName, summary)
      auditPrioritizedCommands(economyPlayer, sourceName, summary)

      let combatPlayer = ensureRuntimePlayer(playerIndex, AIPlayer, 900)
      let combatCommands = enumeratePlayerCommands(combatPlayer)
      auditCommands(combatPlayer, combatCommands, sourceName, summary)
    }
    summary.generatedMaps.push({
      seed: seed,
      mapSize: map.mapSize,
      players: players.length - 1
    })
  }

  function gamestartEntries() {
    let entries = []
    for (let groupName in maps) {
      for (let index = 0; index < maps[groupName].length; ++index) {
        entries.push({
          sourceName: groupName + ' #' + (index + 1),
          map: maps[groupName][index]
        })
      }
    }
    if (typeof createTinyEconomyAiTestMap == 'function') {
      entries.push({
        sourceName: 'createTinyEconomyAiTestMap',
        map: createTinyEconomyAiTestMap()
      })
    }
    return entries
  }

  function auditGamestartMap(entry, summary) {
    resetRuntime()
    entry.map.start(manager(), false)
    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
      if (players[playerIndex].isNeutral || players[playerIndex].isLost) {
        continue
      }
      whooseTurn = playerIndex
      let economyPlayer = ensureRuntimePlayer(
        playerIndex, AIPlayerWithEconomy, 900)
      auditCommands(
        economyPlayer,
        enumeratePlayerCommands(economyPlayer),
        entry.sourceName,
        summary)
      auditPrioritizedCommands(economyPlayer, entry.sourceName, summary)
      let combatPlayer = ensureRuntimePlayer(playerIndex, AIPlayer, 900)
      auditCommands(
        combatPlayer,
        enumeratePlayerCommands(combatPlayer),
        entry.sourceName,
        summary)
    }
    summary.gamestartMaps.push({
      name: entry.sourceName,
      mapSize: entry.map.mapSize,
      players: players.length - 1
    })
  }

  function assertDeliberatelyMissingHandlerFails() {
    resetRuntime()
    let map = generateTownTrainingMap({
      size: 'tiny',
      seed: 96096,
      unitComposition: 'all',
      unitsPerPlayer: 2,
      buildingDensity: 'dense',
      barrackDensity: 1,
      farmDensity: 1,
      startingGoldMin: 900,
      startingGoldMax: 900
    })
    map.start(manager(), false)
    whooseTurn = 1
    let player = ensureRuntimePlayer(1, AIPlayerWithEconomy, 900)
    let command = enumeratePlayerCommands(player).find(function(candidate) {
      return candidate.category == 'building-placement'
    })
    assert(command, 'missing-handler fixture did not find a building command')
    let dispatcher = createFastActionDispatcher({
      unit: unitFastActionHandler,
      'unit-training': unitProductionFastActionHandler,
      'suburb-expansion': suburbExpansionFastActionHandler
    })
    let failed = false
    try {
      dispatcher.apply(createMutableVectorGrid(vectoriseGrid()), command)
    }
    catch (error) {
      failed = error.message.indexOf('Missing fast-action apply handler') !== -1 &&
        error.message.indexOf('building-placement') !== -1
    }
    assert(failed, 'deliberately unregistered handler did not fail')
  }

  let summary = {
    generatedMaps: [],
    gamestartMaps: [],
    logicalCategoryCounts: {},
    fastHandlerCategoryCounts: {},
    prioritizedCategoryCounts: {},
    prioritizedFastHandlerCategoryCounts: {},
    economyProductCounts: {},
    combatCommandCounts: {},
    validatedHandlerCategories: {},
    examples: {}
  }

  auditGeneratedMap(96096, summary)
  auditGeneratedMap(96097, summary)
  let fixed = gamestartEntries()
  for (let i = 0; i < fixed.length; ++i) {
    auditGamestartMap(fixed[i], summary)
  }
  assertDeliberatelyMissingHandlerFails()

  let requiredFastCategories = [
    'unit',
    'unit-training',
    'suburb-expansion',
    'building-placement'
  ]
  for (let i = 0; i < requiredFastCategories.length; ++i) {
    let category = requiredFastCategories[i]
    assert(summary.fastHandlerCategoryCounts[category] > 0,
      'fast-action audit did not enumerate category ' + category, summary)
    assert(summary.validatedHandlerCategories[category],
      'fast-action audit did not validate handler ' + category, summary)
  }
  for (let i = 0; i < requiredFastCategories.length; ++i) {
    let category = requiredFastCategories[i]
    assert(summary.prioritizedFastHandlerCategoryCounts[category] > 0,
      'prioritized command path did not enumerate category ' + category, summary)
  }
  let requiredProducts = [
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
  ]
  for (let i = 0; i < requiredProducts.length; ++i) {
    let product = requiredProducts[i]
    assert(summary.economyProductCounts[product] > 0,
      'fast-action audit did not count economy product ' + product, summary)
  }
  assert(summary.gamestartMaps.length >= 19,
    'fixed gamestart map audit did not cover all known maps', summary)
  return {
    source: 'TASK-096 fast-action coverage audit',
    generatedMapCount: summary.generatedMaps.length,
    gamestartMapCount: summary.gamestartMaps.length,
    logicalCategoryCounts: summary.logicalCategoryCounts,
    fastHandlerCategoryCounts: summary.fastHandlerCategoryCounts,
    prioritizedCategoryCounts: summary.prioritizedCategoryCounts,
    prioritizedFastHandlerCategoryCounts:
      summary.prioritizedFastHandlerCategoryCounts,
    economyProductCounts: summary.economyProductCounts,
    combatCommandCounts: summary.combatCommandCounts,
    validatedHandlerCategories: Object.keys(summary.validatedHandlerCategories).sort(),
    examples: summary.examples
  }
})()`, { filename: 'task096-fast-action-coverage.js' }).runInContext(context);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

check(report.fastHandlerCategoryCounts.unit > 0, 'missing combat fast-action coverage', report);
check(report.fastHandlerCategoryCounts['unit-training'] > 0, 'missing unit-training coverage', report);
check(report.fastHandlerCategoryCounts['suburb-expansion'] > 0, 'missing suburb-expansion coverage', report);
check(report.fastHandlerCategoryCounts['building-placement'] > 0, 'missing building-placement coverage', report);

console.log('Fast-action coverage audit passed');
console.log(JSON.stringify({
  reportPath,
  generatedMapCount: report.generatedMapCount,
  gamestartMapCount: report.gamestartMapCount,
  fastHandlerCategoryCounts: report.fastHandlerCategoryCounts,
  economyProductCounts: report.economyProductCounts
}, null, 2));
