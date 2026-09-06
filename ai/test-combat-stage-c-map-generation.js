const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function normalizeStageCMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    combatStageProgress: map.combatStageProgress,
    floodedCellCount: map.floodedCellCount,
    playableCellCount: map.playableCellCount,
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
  for (const terrain of ['goldmines', 'mountains', 'bushes', 'hills']) {
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

function validateStageCMap(map, seed, progress, bound) {
  const label = 'bound ' + bound + ' seed ' + seed + ' progress ' + progress;
  assert(map.combatStage === 'C', label + ' missing Stage C label');
  assert(map.combatOnly === true, label + ' is not marked combat-only');
  assert(map.suddenDeathRound >= 0, label + ' should not use negative sudden death');
  assert(map.suddenDeathRound === Math.round(progress * 10),
    label + ' suddenDeathRound does not follow the Stage C schedule');
  assert(map.mapSize.x === bound && map.mapSize.y === bound,
    label + ' should preserve the configured bounds');
  assert(map.players.length === 3,
    label + ' should include neutral plus two non-neutral players');
  validateCombatOnly(map, label);

  const totalCells = map.mapSize.x * map.mapSize.y;
  const flooded = map.lakes || [];
  const floodedKeys = new Set(flooded.map(coordKey));
  assert(flooded.length === floodedKeys.size,
    label + ' has duplicate flooded cells');
  assert(flooded.length === map.floodedCellCount,
    label + ' floodedCellCount metadata is wrong');
  assert(totalCells - flooded.length === map.playableCellCount,
    label + ' playableCellCount metadata is wrong');
  assert(map.playableCellCount >= 2,
    label + ' leaves too few playable combat cells');
  if (progress === 0) {
    assert(flooded.length > 0, label + ' should start with flooded cells');
  }
  if (progress === 1) {
    assert(map.suddenDeathRound === 10,
      label + ' final Stage C should use suddenDeathRound=10');
  }

  const occupied = {};
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.ai === true, label + ' player ' + playerIndex + ' should be AI-controlled');
    assert(player.units.length === 1,
      label + ' player ' + playerIndex + ' should have one unit');
    const unit = player.units[0];
    assert(unitTypeName(unit) === 'Noob',
      label + ' player ' + playerIndex + ' unit is not Noob');
    assert(unit.x >= 0 && unit.y >= 0 &&
      unit.x < map.mapSize.x && unit.y < map.mapSize.y,
      label + ' player ' + playerIndex + ' unit outside map');
    assert(!floodedKeys.has(unit.x + ':' + unit.y),
      label + ' player ' + playerIndex + ' unit starts on a flooded cell');
    assert(!occupied[unit.x + ':' + unit.y],
      label + ' has overlapping units');
    occupied[unit.x + ':' + unit.y] = true;
  }
}

function startInHeadlessHarness(map, seed, progress, bound) {
  const label = 'bound ' + bound + ' seed ' + seed + ' progress ' + progress;
  const runtime = map.start();
  assert(runtime.players.length === 3,
    label + ' headless start lost players');
  assert(runtime.players[1].units.length === 1 &&
    runtime.players[2].units.length === 1,
    label + ' headless start lost Noob units');
  map.advanceTurns(2);
  assert(runtime.turn === 2,
    label + ' headless harness did not advance');
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateCombatStageCTrainingMap: context.generateCombatStageCTrainingMap
};`)(context);

assert(api.generateCombatStageCTrainingMap,
  'generateCombatStageCTrainingMap is not exported to the AI script context');

const progressValues = [0, 0.5, 1];
const summaries = [];
for (let bound = 3; bound <= 9; bound += 1) {
  const playableCounts = [];
  const floodedCounts = [];
  const suddenDeathRounds = [];
  for (let index = 0; index < progressValues.length; index += 1) {
    const progress = progressValues[index];
    const seed = 71071 + bound * 10 + index;
    const options = { seed, progress, bound };
    const map = api.generateCombatStageCTrainingMap(options);
    validateStageCMap(map, seed, progress, bound);
    startInHeadlessHarness(map, seed, progress, bound);
    playableCounts.push(map.playableCellCount);
    floodedCounts.push(map.floodedCellCount);
    suddenDeathRounds.push(map.suddenDeathRound);

    const repeated = api.generateCombatStageCTrainingMap(options);
    assert(normalizeStageCMap(map) === normalizeStageCMap(repeated),
      'Stage C map generation is not deterministic for bound ' + bound +
      ' seed ' + seed);
  }

  assert(playableCounts[0] < playableCounts[1] &&
    playableCounts[1] < playableCounts[2],
    'Stage C progression should increase playable cells for bound ' + bound);
  assert(floodedCounts[0] > floodedCounts[1] &&
    floodedCounts[1] > floodedCounts[2],
    'Stage C progression should reduce flooded cells for bound ' + bound);
  assert(suddenDeathRounds[0] === 0 && suddenDeathRounds[1] === 5 &&
    suddenDeathRounds[2] === 10,
    'Stage C sudden-death schedule should progress from 0 to 10 for bound ' + bound);
  summaries.push(bound + 'x' + bound + ':playable=' + playableCounts.join('/') +
    ',flooded=' + floodedCounts.join('/') +
    ',suddenDeath=' + suddenDeathRounds.join('/'));
}

console.log('Stage C full-bound progression: ' + summaries.join('; '));
console.log('Combat Stage C map generation smoke passed for bounds=3-9 at early, middle, and final progression');
console.log('Stage C constraints passed: scenarios=21 deterministic=true economyObjects=0 unitTypes=Noob negativeSuddenDeath=0 finalSuddenDeathRound=10');
