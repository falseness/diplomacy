const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function normalizeStageFMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    combatStageProgress: map.combatStageProgress,
    playerNoobCounts: map.playerNoobCounts,
    playerNormchelCounts: map.playerNormchelCounts,
    playerKOHbCounts: map.playerKOHbCounts,
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

function validateStageFMap(map, seed, progress) {
  const label = 'seed ' + seed + ' progress ' + progress;
  assert(map.combatStage === 'F', label + ' missing Stage F label');
  assert(map.combatOnly === true, label + ' is not marked combat-only');
  assert(map.suddenDeathRound === 10,
    label + ' should preserve the post-Stage-C sudden death schedule');
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    label + ' should use stable 9x9 bounds');
  assert(map.players.length === 3,
    label + ' should include neutral plus two non-neutral players');
  validateCombatOnly(map, label);
  assert(map.combatMetrics &&
    map.combatMetrics.newlyUnlockedMechanic === 'KOHb',
    label + ' did not record KOHb as the Stage F unlock');
  assert((map.combatMetrics.blockedUnitTypes || []).includes('Archer'),
    label + ' did not record Archer as blocked');

  const occupied = {};
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
      assert(typeName === 'Noob' || typeName === 'Normchel' || typeName === 'KOHb',
        label + ' introduced an unexpected unit: ' + typeName);
      assert(typeName !== 'Archer',
        label + ' introduced forbidden Stage F Archer unit');
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
  assert(KOHbCount === map.playerKOHbCounts.playerOne + map.playerKOHbCounts.playerTwo,
    label + ' KOHb count metadata is wrong');
  assert(normchelCount ===
      map.playerNormchelCounts.playerOne + map.playerNormchelCounts.playerTwo,
    label + ' Normchel count metadata is wrong');
  assert(noobCount === map.playerNoobCounts.playerOne + map.playerNoobCounts.playerTwo,
    label + ' Noob count metadata is wrong');
  return KOHbCount;
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
  generateCombatStageFTrainingMap: context.generateCombatStageFTrainingMap
};`)(context);

assert(api.generateCombatStageFTrainingMap,
  'generateCombatStageFTrainingMap is not exported to the AI script context');

let blocked = false;
try {
  api.generateCombatStageFTrainingMap({
    seed: 74074,
    progress: 1,
    curriculum: {
      currentStageIndex: 4,
      currentStage: 'combat-stage-4',
      gateHistory: []
    }
  });
} catch (error) {
  blocked = /Stage F is unavailable/.test(error.message);
}
assert(blocked, 'Stage F generation should be blocked before a passed Stage E gate');

const passedStageEGate = {
  currentStageIndex: 5,
  currentStage: 'combat-stage-5',
  gateHistory: [{
    stageIndex: 4,
    stage: 'combat-stage-4',
    decision: 'advance',
    advancedToStageIndex: 5,
    advancedToStage: 'combat-stage-5'
  }]
};

const seeds = [74074, 74075, 74076, 74077, 74078];
let generatedKOHb = false;
for (let index = 0; index < seeds.length; index += 1) {
  const seed = seeds[index];
  const progress = index === 0 ? 0 : 1;
  const map = api.generateCombatStageFTrainingMap({
    seed,
    progress,
    curriculum: passedStageEGate
  });
  const KOHbCount = validateStageFMap(map, seed, progress);
  generatedKOHb = generatedKOHb || KOHbCount > 0;
  startInHeadlessHarness(map, seed, progress);

  const repeated = api.generateCombatStageFTrainingMap({
    seed,
    progress,
    curriculum: passedStageEGate
  });
  assert(normalizeStageFMap(map) === normalizeStageFMap(repeated),
    'Stage F map generation is not deterministic for seed ' + seed);
}

assert(generatedKOHb, 'Stage F fixed seeds did not generate any KOHb units');

console.log('Combat Stage F map generation smoke passed with gated KOHb unlocks');
