const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadAiScripts } = require('./smokeHarness');

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function normalizeStageGMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    combatStageProgress: map.combatStageProgress,
    playerNoobCounts: map.playerNoobCounts,
    playerNormchelCounts: map.playerNormchelCounts,
    playerKOHbCounts: map.playerKOHbCounts,
    playerArcherCounts: map.playerArcherCounts,
    combatMetrics: map.combatMetrics,
    players: map.players.map((player) => ({
      towns: player.towns || [],
      units: (player.units || []).map((unit) => ({
        type: unitTypeName(unit),
        x: unit.x,
        y: unit.y
      })),
      barracks: player.barracks || [],
      pendingBarracks: player.pendingBarracks || [],
      farms: player.farms || [],
      pendingFarms: player.pendingFarms || [],
      walls: player.walls || [],
      bastions: player.bastions || [],
      towers: player.towers || []
    })),
    goldmines: map.goldmines,
    lakes: map.lakes,
    mountains: map.mountains,
    bushes: map.bushes,
    hills: map.hills
  });
}

function assertEmptyList(value, label) {
  assert(Array.isArray(value), label + ' should be an array');
  assert(value.length === 0, label + ' should be empty');
}

function validateCombatOnly(map, label) {
  for (const terrain of ['goldmines', 'lakes', 'mountains', 'bushes', 'hills']) {
    assertEmptyList(map[terrain] || [], label + ' ' + terrain);
  }
  for (let playerIndex = 0; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    assertEmptyList(player.towns || [], label + ' player ' + playerIndex + ' towns');
    for (const property of [
      'barracks',
      'pendingBarracks',
      'farms',
      'pendingFarms',
      'walls',
      'bastions',
      'towers'
    ]) {
      assertEmptyList(player[property] || [],
        label + ' player ' + playerIndex + ' ' + property);
    }
  }
  for (const [name, count] of Object.entries(map.economyObjects || {})) {
    assert(count === 0, label + ' economy object count is not zero for ' + name);
  }
}

function validateStageGMap(map, seed, progress) {
  const label = 'seed ' + seed + ' progress ' + progress;
  assert(map.combatStage === 'G', label + ' missing Stage G label');
  assert(map.combatOnly === true, label + ' is not marked combat-only');
  assert(map.suddenDeathRound === 10,
    label + ' should preserve the post-Stage-C sudden death schedule');
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    label + ' should use stable 9x9 bounds');
  assert(map.players.length === 3,
    label + ' should include neutral plus two non-neutral players');
  validateCombatOnly(map, label);
  assert(map.combatMetrics &&
    map.combatMetrics.newlyUnlockedMechanic === 'Archer',
    label + ' did not record Archer as the Stage G unlock');
  assert((map.combatMetrics.previouslyUnlockedUnitTypes || []).includes('Noob') &&
      (map.combatMetrics.previouslyUnlockedUnitTypes || []).includes('Normchel') &&
      (map.combatMetrics.previouslyUnlockedUnitTypes || []).includes('KOHb'),
    label + ' did not record previously unlocked unit types');
  assert((map.combatMetrics.actionEnumerationMechanics || []).some((mechanic) =>
    /range/i.test(mechanic)),
    label + ' did not record Archer range action enumeration');
  assert((map.combatMetrics.actionEnumerationMechanics || []).some((mechanic) =>
    /line-of-sight/i.test(mechanic)),
    label + ' did not record Archer line-of-sight action enumeration');

  const occupied = {};
  let archerCount = 0;
  let KOHbCount = 0;
  let normchelCount = 0;
  let noobCount = 0;
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.ai === true, label + ' player ' + playerIndex + ' should be AI-controlled');
    assert(player.units.length >= 1,
      label + ' player ' + playerIndex + ' should have combat units');
    for (const unit of player.units) {
      const typeName = unitTypeName(unit);
      assert(['Noob', 'Normchel', 'KOHb', 'Archer'].includes(typeName),
        label + ' introduced an unexpected unit: ' + typeName);
      if (typeName === 'Archer') {
        archerCount += 1;
      }
      if (typeName === 'KOHb') {
        KOHbCount += 1;
      }
      if (typeName === 'Normchel') {
        normchelCount += 1;
      }
      if (typeName === 'Noob') {
        noobCount += 1;
      }
      assert(unit.x >= 0 && unit.y >= 0 &&
        unit.x < map.mapSize.x && unit.y < map.mapSize.y,
        label + ' player ' + playerIndex + ' unit outside map');
      const key = unit.x + ':' + unit.y;
      assert(!occupied[key], label + ' has overlapping units at ' + key);
      occupied[key] = true;
    }
  }
  assert(archerCount ===
      map.playerArcherCounts.playerOne + map.playerArcherCounts.playerTwo,
    label + ' Archer count metadata is wrong');
  assert(KOHbCount === map.playerKOHbCounts.playerOne + map.playerKOHbCounts.playerTwo,
    label + ' KOHb count metadata is wrong');
  assert(normchelCount ===
      map.playerNormchelCounts.playerOne + map.playerNormchelCounts.playerTwo,
    label + ' Normchel count metadata is wrong');
  assert(noobCount === map.playerNoobCounts.playerOne + map.playerNoobCounts.playerTwo,
    label + ' Noob count metadata is wrong');
  return { archerCount, KOHbCount, normchelCount, noobCount };
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
    getContext() { return createCanvasContext(); },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
  };
}

function createBrowserRuntimeContext() {
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

function enumerateRealArcherAttack() {
  const context = createBrowserRuntimeContext();
  loadBrowserScripts(context);
  return new vm.Script(`(() => {
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

    let curriculum = {
      currentStageIndex: 6,
      currentStage: 'combat-stage-6',
      gateHistory: [{
        stageIndex: 5,
        stage: 'combat-stage-5',
        decision: 'advance',
        advancedToStageIndex: 6,
        advancedToStage: 'combat-stage-6'
      }]
    }
    let map = generateCombatStageGTrainingMap({
      seed: 75075,
      progress: 1,
      bound: 5,
      curriculum: curriculum
    })
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

    let archerPlayerIndex = players[1].units.some(unit => unit.name == 'archer') ? 1 : 2
    whooseTurn = archerPlayerIndex
    suddenDeathRound = map.suddenDeathRound
    otherSettings.moveCameraToUndoTarget = false
    let archer = players[archerPlayerIndex].units.find(unit => unit.name == 'archer')
    let commands = players[archerPlayerIndex].getActionCommands()
    let attack = commands.find(command => {
      if (command.whoDoCommandCoord.x != archer.coord.x ||
          command.whoDoCommandCoord.y != archer.coord.y) {
        return false
      }
      let target = grid.getCell(command.destinationCoord).unit
      return target.notEmpty() && target.playerColor != archerPlayerIndex
    })
    if (!attack) {
      throw new Error('real AI action enumeration did not include an Archer attack')
    }
    return {
      seed: 75075,
      bound: map.mapSize.x,
      playerIndex: archerPlayerIndex,
      unitType: archer.constructor.name,
      actionType: attack.type,
      source: attack.whoDoCommandCoord,
      destination: attack.destinationCoord,
      range: archer.interaction.range,
      enumeratedDistance: archer.interaction.rangeWay.getDistance(
        attack.destinationCoord),
      lineOfSightEngine: archer.interaction.rangeWay.constructor.name,
      targetPlayerIndex: grid.getCell(attack.destinationCoord).unit.playerColor
    }
  })()`, { filename: 'stage-g-real-action-enumeration.js' }).runInContext(context);
}

function startInHeadlessHarness(map, seed, progress) {
  const runtime = map.start();
  assert(runtime.players.length === 3,
    'seed ' + seed + ' progress ' + progress + ' headless start lost players');
  map.advanceTurns(2);
  assert(runtime.turn === 2,
    'seed ' + seed + ' progress ' + progress + ' headless harness did not advance');
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateCombatStageGTrainingMap: context.generateCombatStageGTrainingMap
};`)(context);

assert(api.generateCombatStageGTrainingMap,
  'generateCombatStageGTrainingMap is not exported to the AI script context');

let blocked = false;
try {
  api.generateCombatStageGTrainingMap({
    seed: 75075,
    progress: 1,
    curriculum: {
      currentStageIndex: 5,
      currentStage: 'combat-stage-5',
      gateHistory: []
    }
  });
} catch (error) {
  blocked = /Stage G is unavailable/.test(error.message);
}
assert(blocked, 'Stage G generation should be blocked before a passed Stage F gate');

const passedStageFGate = {
  currentStageIndex: 6,
  currentStage: 'combat-stage-6',
  gateHistory: [{
    stageIndex: 5,
    stage: 'combat-stage-5',
    decision: 'advance',
    advancedToStageIndex: 6,
    advancedToStage: 'combat-stage-6'
  }]
};

const seeds = [75075, 75076, 75077, 75078, 75079];
let generatedArcher = false;
let generatedKOHb = false;
let generatedNormchel = false;
let generatedNoob = false;
for (let index = 0; index < seeds.length; index += 1) {
  const seed = seeds[index];
  const progress = index === 0 ? 0 : 1;
  const map = api.generateCombatStageGTrainingMap({
    seed,
    progress,
    curriculum: passedStageFGate
  });
  const counts = validateStageGMap(map, seed, progress);
  generatedArcher = generatedArcher || counts.archerCount > 0;
  generatedKOHb = generatedKOHb || counts.KOHbCount > 0;
  generatedNormchel = generatedNormchel || counts.normchelCount > 0;
  generatedNoob = generatedNoob || counts.noobCount > 0;
  startInHeadlessHarness(map, seed, progress);

  const repeated = api.generateCombatStageGTrainingMap({
    seed,
    progress,
    curriculum: passedStageFGate
  });
  assert(normalizeStageGMap(map) === normalizeStageGMap(repeated),
    'Stage G map generation is not deterministic for seed ' + seed);
}

assert(generatedArcher, 'Stage G fixed seeds did not generate any Archer units');
assert(generatedKOHb, 'Stage G fixed seeds did not retain any KOHb units');
assert(generatedNormchel, 'Stage G fixed seeds did not retain any Normchel units');
assert(generatedNoob, 'Stage G fixed seeds did not retain any Noob units');
const archerAction = enumerateRealArcherAttack();
assert(archerAction.unitType === 'Archer',
  'Stage G runtime action was not enumerated by an Archer');
assert(archerAction.actionType === 'unit',
  'Stage G runtime Archer action did not use the unit command path');
assert(archerAction.range === 2 && archerAction.enumeratedDistance === 2,
  'Stage G runtime Archer attack was not enumerated at Archer range 2');
assert(archerAction.lineOfSightEngine === 'ArcherRangeWay',
  'Stage G runtime Archer attack did not use the Archer line-of-sight engine');
assert(archerAction.targetPlayerIndex !== archerAction.playerIndex,
  'Stage G runtime Archer attack did not target an enemy');

console.log('Stage G pre-gate control passed: generation blocked until Stage F gate');
console.log('Stage G fixed-seed generation passed: seeds=' + seeds.join(','));
console.log('Stage G unit coverage passed: Archer,Noob,Normchel,KOHb');
console.log('Stage G metrics passed: newlyUnlockedMechanic=Archer');
console.log('Real Archer action enumeration passed: ' + JSON.stringify(archerAction));
console.log('Combat Stage G map generation smoke passed with gated Archer unlocks');
