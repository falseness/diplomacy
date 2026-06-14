const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function normalizedMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    economyStage: map.economyStage,
    economyGenerator: map.economyGenerator,
    economyObjects: map.economyObjects,
    players: map.players.map((player) => ({
      playerType: player.playerType,
      gold: player.gold,
      towns: player.towns || [],
      units: (player.units || []).map((unit) => ({
        type: unitTypeName(unit),
        x: unit.x,
        y: unit.y,
        hp: unit.hp
      })),
      suburbs: player.suburbs || [],
      towers: player.towers || [],
      bastions: player.bastions || []
    })),
    lakes: map.lakes || [],
    mountains: map.mountains || []
  });
}

function assertInBounds(coord, mapSize, message, details) {
  assert(coord.x >= 0 && coord.x < mapSize.x && coord.y >= 0 && coord.y < mapSize.y,
    message, Object.assign({ coord, mapSize }, details || {}));
}

function validateNoOverlap(map, seed) {
  const occupied = new Map();
  for (const coord of [].concat(map.lakes || [], map.mountains || [])) {
    occupied.set(coordKey(coord), 'terrain');
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const buildings = [].concat(
      player.towns || [],
      player.towers || [],
      player.bastions || [],
      player.walls || [],
      player.barracks || [],
      player.farms || []
    );

    for (const building of buildings) {
      assertInBounds(building, map.mapSize,
        'stage 7 building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 7 building overlaps ' + occupied.get(key), { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 7 unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 7 unit overlaps ' + occupied.get(key), { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function assertMirrored(left, right, mapSize, message, details) {
  assert(left.x + right.x === mapSize.x - 1 && left.y === right.y,
    message, Object.assign({ left, right, mapSize }, details || {}));
}

function validateStage7Map(map, seed) {
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'stage 7 should generate a 9v9 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 7 map should include neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 7 player 1 should be AIPlayerWithEconomy', { seed, player: map.players[1] });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 7 player 2 should be SimpleAiPlayerWithEconomy', { seed, player: map.players[2] });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 7 && metadata && metadata.stage === 7,
    'stage 7 generator metadata is missing', { seed, metadata });
  assert(metadata.defensiveBuildingsPerPlayer === 2,
    'stage 7 should include two defensive buildings per player', { seed, metadata });
  assert(Array.isArray(metadata.buildingTypes) &&
    metadata.buildingTypes.includes('tower') &&
    metadata.buildingTypes.includes('bastion'),
    'stage 7 should include tower and bastion coverage', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 7 HP bounds should remain 2-5', { seed, metadata });
  assert(metadata.hpByType.tower >= metadata.hpMin && metadata.hpByType.tower <= metadata.hpMax,
    'stage 7 tower HP is outside documented bounds', { seed, metadata });
  assert(metadata.hpByType.bastion >= metadata.hpMin && metadata.hpByType.bastion <= metadata.hpMax,
    'stage 7 bastion HP is outside documented bounds', { seed, metadata });

  const expectedTypes = ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'];
  assert(metadata.unitsPerPlayer === expectedTypes.length,
    'stage 7 should generate one slot for each supported unit type', { seed, metadata });
  for (const type of expectedTypes) {
    assert(metadata.unitTypes.includes(type),
      'stage 7 metadata is missing unit type ' + type, { seed, metadata });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.gold === right.gold,
    'stage 7 sides should receive equal starting gold', { seed, left: left.gold, right: right.gold });
  assertMirrored(left.towns[0], right.towns[0], map.mapSize,
    'stage 7 towns should be mirrored', { seed });
  assertMirrored(left.towers[0], right.towers[0], map.mapSize,
    'stage 7 towers should be mirrored', { seed });
  assertMirrored(left.bastions[0], right.bastions[0], map.mapSize,
    'stage 7 bastions should be mirrored', { seed });

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const observedTypes = new Set((player.units || []).map(unitTypeName));
    for (const type of expectedTypes) {
      assert(observedTypes.has(type),
        'stage 7 player is missing supported unit type ' + type,
        { seed, playerIndex, units: player.units });
    }
    assert((player.towers || []).length === 1 && (player.bastions || []).length === 1,
      'stage 7 should generate one tower and one bastion for each player',
      { seed, playerIndex, towers: player.towers, bastions: player.bastions });
    assert(player.towers[0].hp === metadata.hpByType.tower,
      'stage 7 tower HP should match metadata', { seed, playerIndex, tower: player.towers[0], metadata });
    assert(player.bastions[0].hp === metadata.hpByType.bastion,
      'stage 7 bastion HP should match metadata', { seed, playerIndex, bastion: player.bastions[0], metadata });
  }

  for (let index = 0; index < left.units.length; index += 1) {
    assert(unitTypeName(left.units[index]) === unitTypeName(right.units[index]),
      'stage 7 mirrored unit types should match by index',
      { seed, index, left: left.units[index], right: right.units[index] });
    assertMirrored(left.units[index], right.units[index], map.mapSize,
      'stage 7 unit placements should be mirrored by index', { seed, index });
  }

  assert(map.economyObjects.noobs === 2 &&
    map.economyObjects.archers === 2 &&
    map.economyObjects.KOHbs === 2 &&
    map.economyObjects.normchels === 2 &&
    map.economyObjects.catapults === 2,
    'stage 7 economy summary should record all supported units', { seed, economyObjects: map.economyObjects });
  assert(map.economyObjects.towers === 2 && map.economyObjects.bastions === 2,
    'stage 7 economy summary should record defensive buildings', { seed, economyObjects: map.economyObjects });

  validateNoOverlap(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage7TrainingMap: context.generateEconomyStage7TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage7TrainingMap === 'function',
  'generateEconomyStage7TrainingMap must be exported independently');

const seeds = [13000, 13001, 13002, 13003, 13004, 13005, 13006, 13007, 13008, 13009, 13010, 13011];
const towerHpValues = new Set();
const bastionHpValues = new Set();
const offsets = new Set();
const observedTypes = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage7TrainingMap({ seed });
  validateStage7Map(map, seed);
  towerHpValues.add(map.economyGenerator.hpByType.tower);
  bastionHpValues.add(map.economyGenerator.hpByType.bastion);
  offsets.add(map.economyGenerator.unitTypeOffset);
  for (const unit of map.players[1].units) {
    observedTypes.add(unitTypeName(unit));
  }

  const repeated = api.generateEconomyStage7TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 7 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (const type of ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']) {
    assert(runtime.players[1].units.some((unit) => unit.name === type),
      'stage 7 headless runtime did not create player 1 ' + type);
    assert(runtime.players[2].units.some((unit) => unit.name === type),
      'stage 7 headless runtime did not create player 2 ' + type);
  }
}

for (const type of ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']) {
  assert(observedTypes.has(type),
    'stage 7 fixed seeds did not cover supported unit type ' + type,
    { seeds, observedTypes: Array.from(observedTypes) });
}
assert(towerHpValues.size >= 2 && bastionHpValues.size >= 2,
  'stage 7 defensive HP values should vary across fixed seeds',
  {
    seeds,
    towerHpValues: Array.from(towerHpValues),
    bastionHpValues: Array.from(bastionHpValues)
  });
assert(offsets.size >= 2,
  'stage 7 unit type slot ordering should vary across fixed seeds',
  { seeds, offsets: Array.from(offsets) });

const smokeMap = api.generateEconomyStage7TrainingMap({ seed: 13042, suddenDeathRound: 14 });
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 13042,
  roundLimit: 4,
  actionLimit: 3,
  commandLimit: 24
});

assert(!smokeResult.crash, 'short economy smoke crashed', smokeResult);
assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
  'short smoke did not run AIPlayerWithEconomy', smokeResult);
assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
  'short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
assert(smokeResult.turnCount > 0,
  'short smoke game did not advance with runtime players', smokeResult);

console.log('Economy stage 7 map generation smoke passed');
