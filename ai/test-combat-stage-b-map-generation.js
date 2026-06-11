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

function normalizeStageBMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    combatStageProgress: map.combatStageProgress,
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

function validateStageBMap(map, seed, progress) {
  const label = 'seed ' + seed + ' progress ' + progress;
  assert(map.combatStage === 'B', label + ' missing Stage B label');
  assert(map.combatOnly === true, label + ' is not marked combat-only');
  assert(map.suddenDeathRound === 0, label + ' should use already-active sudden death');
  assert(map.mapSize.x >= 3 && map.mapSize.y >= 3,
    label + ' bounds are smaller than Stage B minimum');
  assert(map.mapSize.x <= 9 && map.mapSize.y <= 9,
    label + ' bounds exceed 9x9');
  assert(map.mapSize.x === map.mapSize.y,
    label + ' should use square progression bounds');
  assert(map.players.length === 3,
    label + ' should include neutral plus two non-neutral players');
  validateCombatOnly(map, label);

  const totalCells = map.mapSize.x * map.mapSize.y;
  const flooded = map.lakes || [];
  const floodedKeys = new Set(flooded.map(coordKey));
  assert(flooded.length > 0, label + ' should have flooded cells');
  assert(flooded.length < totalCells - 2, label + ' leaves no playable combat cells');
  assert(flooded.length === floodedKeys.size,
    label + ' has duplicate flooded cells');
  assert(flooded.length === map.floodedCellCount,
    label + ' floodedCellCount metadata is wrong');
  assert(totalCells - flooded.length === map.playableCellCount,
    label + ' playableCellCount metadata is wrong');
  if (progress === 0) {
    assert(flooded.length / totalCells > 0.5,
      label + ' should keep most cells flooded or unavailable');
  }

  const playableByColumn = [];
  for (let x = 0; x < map.mapSize.x; x += 1) {
    let count = 0;
    for (let y = 0; y < map.mapSize.y; y += 1) {
      if (!floodedKeys.has(x + ':' + y)) {
        count += 1;
      }
    }
    playableByColumn.push(count);
  }
  const playableRows = new Set();
  for (let y = 0; y < map.mapSize.y; y += 1) {
    for (let x = 0; x < map.mapSize.x; x += 1) {
      if (!floodedKeys.has(x + ':' + y)) {
        playableRows.add(y);
      }
    }
  }
  assert(playableByColumn.every((count) => count > 0 && count < map.mapSize.y),
    label + ' footprint should not include a full rectangular column');
  assert(playableRows.size > 1,
    label + ' footprint should be irregular across rows');

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

function startInHeadlessHarness(map, seed, progress) {
  const runtime = map.start();
  assert(runtime.players.length === 3,
    'seed ' + seed + ' progress ' + progress + ' headless start lost players');
  assert(runtime.players[1].units.length === 1 &&
    runtime.players[2].units.length === 1,
    'seed ' + seed + ' progress ' + progress + ' headless start lost Noob units');
  map.advanceTurns(2);
  assert(runtime.turn === 2,
    'seed ' + seed + ' progress ' + progress + ' headless harness did not advance');
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateCombatStageBTrainingMap: context.generateCombatStageBTrainingMap
};`)(context);

assert(api.generateCombatStageBTrainingMap,
  'generateCombatStageBTrainingMap is not exported to the AI script context');

const progressValues = [0, 0.5, 1];
const sizes = [];
for (let index = 0; index < progressValues.length; index += 1) {
  const progress = progressValues[index];
  const seed = 70070 + index;
  const map = api.generateCombatStageBTrainingMap({ seed, progress });
  validateStageBMap(map, seed, progress);
  startInHeadlessHarness(map, seed, progress);
  sizes.push(map.mapSize.x);

  const repeated = api.generateCombatStageBTrainingMap({ seed, progress });
  assert(normalizeStageBMap(map) === normalizeStageBMap(repeated),
    'Stage B map generation is not deterministic for seed ' + seed);
}

assert(sizes[0] < sizes[1] && sizes[1] < sizes[2],
  'Stage B progression should increase bounds from early to late');
assert(sizes[2] === 9, 'Stage B late progression should reach 9x9 bounds');

console.log('Combat Stage B map generation smoke passed for early, middle, and late progression maps');
