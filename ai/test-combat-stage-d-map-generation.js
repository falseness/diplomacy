const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function normalizeStageDMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    combatStageProgress: map.combatStageProgress,
    playerNoobCounts: map.playerNoobCounts,
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

function validateStageDMap(map, seed, progress) {
  const label = 'seed ' + seed + ' progress ' + progress;
  assert(map.combatStage === 'D', label + ' missing Stage D label');
  assert(map.combatOnly === true, label + ' is not marked combat-only');
  assert(map.suddenDeathRound === 10,
    label + ' should inherit the post-Stage-C sudden death schedule');
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    label + ' should use stable 9x9 bounds for group-size progression');
  assert(map.players.length === 3,
    label + ' should include neutral plus two non-neutral players');
  validateCombatOnly(map, label);

  const playerOneUnits = map.players[1].units || [];
  const playerTwoUnits = map.players[2].units || [];
  assert(playerOneUnits.length !== playerTwoUnits.length,
    label + ' should intentionally use unequal Noob counts');
  assert(map.playerNoobCounts.playerOne === playerOneUnits.length,
    label + ' player one count metadata is wrong');
  assert(map.playerNoobCounts.playerTwo === playerTwoUnits.length,
    label + ' player two count metadata is wrong');
  assert(Math.max(playerOneUnits.length, playerTwoUnits.length) <= 4,
    label + ' exceeds the Stage D four-Noob cap');
  if (progress === 1) {
    assert(Math.max(playerOneUnits.length, playerTwoUnits.length) === 4,
      label + ' late Stage D should reach four Noobs on one side');
  }

  const occupied = {};
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.ai === true, label + ' player ' + playerIndex + ' should be AI-controlled');
    for (const unit of player.units) {
      assert(unitTypeName(unit) === 'Noob',
        label + ' player ' + playerIndex + ' has a non-Noob unit');
      assert(unit.x >= 0 && unit.y >= 0 &&
        unit.x < map.mapSize.x && unit.y < map.mapSize.y,
        label + ' player ' + playerIndex + ' unit outside map');
      const key = unit.x + ':' + unit.y;
      assert(!occupied[key], label + ' has overlapping units at ' + key);
      occupied[key] = true;
    }
  }
}

function startInHeadlessHarness(map, seed, progress) {
  const runtime = map.start();
  const expectedOne = map.playerNoobCounts.playerOne;
  const expectedTwo = map.playerNoobCounts.playerTwo;
  assert(runtime.players.length === 3,
    'seed ' + seed + ' progress ' + progress + ' headless start lost players');
  assert(runtime.players[1].units.length === expectedOne &&
    runtime.players[2].units.length === expectedTwo,
    'seed ' + seed + ' progress ' + progress + ' headless start lost Noob units');
  map.advanceTurns(2);
  assert(runtime.turn === 2,
    'seed ' + seed + ' progress ' + progress + ' headless harness did not advance');
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateCombatStageDTrainingMap: context.generateCombatStageDTrainingMap
};`)(context);

assert(api.generateCombatStageDTrainingMap,
  'generateCombatStageDTrainingMap is not exported to the AI script context');

const progressValues = [0, 0.5, 1];
const maxCounts = [];
const totalCounts = [];
for (let index = 0; index < progressValues.length; index += 1) {
  const progress = progressValues[index];
  const seed = 72072 + index;
  const map = api.generateCombatStageDTrainingMap({ seed, progress });
  validateStageDMap(map, seed, progress);
  startInHeadlessHarness(map, seed, progress);
  const playerOneCount = map.players[1].units.length;
  const playerTwoCount = map.players[2].units.length;
  maxCounts.push(Math.max(playerOneCount, playerTwoCount));
  totalCounts.push(playerOneCount + playerTwoCount);

  const repeated = api.generateCombatStageDTrainingMap({ seed, progress });
  assert(normalizeStageDMap(map) === normalizeStageDMap(repeated),
    'Stage D map generation is not deterministic for seed ' + seed);
}

assert(maxCounts[0] < maxCounts[1] && maxCounts[1] < maxCounts[2],
  'Stage D progression should increase the largest side Noob count');
assert(totalCounts[0] < totalCounts[1] && totalCounts[1] < totalCounts[2],
  'Stage D progression should increase total Noob count');

console.log('Combat Stage D map generation smoke passed for early, middle, and late progression maps');
