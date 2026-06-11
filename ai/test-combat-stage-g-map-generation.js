const { loadAiScripts, readRepoFile } = require('./smokeHarness');

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
  return { archerCount, KOHbCount, normchelCount };
}

function enumerateCombatActionMechanics(map) {
  const actions = [];
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    for (const unit of map.players[playerIndex].units || []) {
      if (unitTypeName(unit) === 'Archer') {
        actions.push({
          playerIndex,
          unitType: 'Archer',
          actionType: 'range-attack',
          range: map.combatMetrics.archerRange,
          lineOfSight: true
        });
      }
    }
  }
  return actions;
}

function assertArcherRuntimeMechanicsAreRepresented() {
  const archerSource = readRepoFile('sprites/entities/units/range/archer/archer.js');
  const interactionSource =
    readRepoFile('sprites/entities/units/range/archer/interactionWithArcher.js');
  assert(/static range = 2/.test(archerSource),
    'Archer runtime range constant changed without Stage G test update');
  assert(/ArcherRangeWay/.test(interactionSource) &&
      /standartRangeWay/.test(interactionSource),
    'Archer runtime range/line-of-sight path is not represented');
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

assertArcherRuntimeMechanicsAreRepresented();

const seeds = [75075, 75076, 75077, 75078, 75079];
let generatedArcher = false;
let generatedKOHb = false;
let generatedNormchel = false;
let enumeratedArcherAction = false;
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
  enumeratedArcherAction = enumeratedArcherAction ||
    enumerateCombatActionMechanics(map).some((action) =>
      action.unitType === 'Archer' &&
      action.actionType === 'range-attack' &&
      action.range === 2 &&
      action.lineOfSight === true);
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
assert(enumeratedArcherAction,
  'Stage G combat action enumeration did not include Archer range/line-of-sight actions');

console.log('Combat Stage G map generation smoke passed with gated Archer unlocks');
