const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function normalizeStageAMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
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

function validateStageAMap(map, seed) {
  assert(map.mapSize.x === 2 && map.mapSize.y === 2,
    'seed ' + seed + ' Stage A map is not 2x2');
  assert(map.players.length === 3,
    'seed ' + seed + ' should include neutral plus two non-neutral players');
  assert(map.players.slice(1).length === 2,
    'seed ' + seed + ' does not have exactly two non-neutral players');
  assert(map.suddenDeathRound === 0,
    'seed ' + seed + ' should use immediate sudden death');
  assert(map.combatStage === 'A', 'seed ' + seed + ' missing Stage A label');
  assert(map.combatOnly === true, 'seed ' + seed + ' is not marked combat-only');

  for (const label of ['goldmines', 'lakes', 'mountains', 'bushes', 'hills']) {
    assertEmptyList(map[label] || [], 'seed ' + seed + ' ' + label);
  }

  for (let playerIndex = 0; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    assertEmptyList(player.towns || [], 'seed ' + seed + ' player ' + playerIndex + ' towns');
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
        'seed ' + seed + ' player ' + playerIndex + ' ' + property);
    }
  }

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.ai === true,
      'seed ' + seed + ' player ' + playerIndex + ' should be AI-controlled');
    assert(player.units.length === 1,
      'seed ' + seed + ' player ' + playerIndex + ' should have one unit');
    const unit = player.units[0];
    assert(unitTypeName(unit) === 'Noob',
      'seed ' + seed + ' player ' + playerIndex + ' unit is not Noob');
    assert(unit.x >= 0 && unit.y >= 0 && unit.x < 2 && unit.y < 2,
      'seed ' + seed + ' player ' + playerIndex + ' unit outside 2x2 map');
  }

  const occupied = {};
  for (const player of map.players.slice(1)) {
    const unit = player.units[0];
    const key = unit.x + ':' + unit.y;
    assert(!occupied[key], 'seed ' + seed + ' has overlapping Stage A units');
    occupied[key] = true;
  }

  for (const [name, count] of Object.entries(map.economyObjects || {})) {
    assert(count === 0, 'seed ' + seed + ' economy object count is not zero for ' + name);
  }
}

function startAndCompleteInHeadlessHarness(map, seed) {
  const runtime = map.start();
  assert(runtime.players.length === 3,
    'seed ' + seed + ' headless start lost players');
  assert(runtime.players[1].units.length === 1 &&
    runtime.players[2].units.length === 1,
    'seed ' + seed + ' headless start lost Noob units');
  assert(runtime.players[1].towns.length === 0 &&
    runtime.players[2].towns.length === 0,
    'seed ' + seed + ' headless start introduced towns');
  assert(0 >= map.suddenDeathRound,
    'seed ' + seed + ' is not complete at immediate sudden death');
  map.advanceTurns(1);
  assert(runtime.turn === 1,
    'seed ' + seed + ' headless harness did not advance');
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateCombatStageATrainingMap: context.generateCombatStageATrainingMap
};`)(context);

assert(api.generateCombatStageATrainingMap,
  'generateCombatStageATrainingMap is not exported to the AI script context');

for (let seed = 69069; seed < 69079; seed += 1) {
  const map = api.generateCombatStageATrainingMap({ seed });
  validateStageAMap(map, seed);
  startAndCompleteInHeadlessHarness(map, seed);

  const repeated = api.generateCombatStageATrainingMap({ seed });
  assert(normalizeStageAMap(map) === normalizeStageAMap(repeated),
    'Stage A map generation is not deterministic for seed ' + seed);
}

console.log('Combat Stage A map generation smoke passed for 10 fixed seeds');
