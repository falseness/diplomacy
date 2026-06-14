const { loadAiScripts } = require('./smokeHarness');

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

function assertMirrored(left, right, mapSize, message, details) {
  assert(left.x + right.x === mapSize.x - 1 && left.y === right.y,
    message, Object.assign({ left, right, mapSize }, details || {}));
}

function validateLegalPlacement(map, seed) {
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
        'stage 6 validation building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 6 validation building overlaps ' + occupied.get(key),
        { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 6 validation unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 6 validation unit overlaps ' + occupied.get(key),
        { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function validateStage6Map(map, seed) {
  assert(map.economyStage === 6 && map.economyGenerator && map.economyGenerator.stage === 6,
    'stage 6 validation requires stage metadata', { seed, metadata: map.economyGenerator });
  assert(map.players.length === 3,
    'stage 6 validation expected neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 6 player 1 should be AIPlayerWithEconomy', { seed, player: map.players[1] });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 6 player 2 should be SimpleAiPlayerWithEconomy', { seed, player: map.players[2] });

  const metadata = map.economyGenerator;
  assert(metadata.unitsPerPlayer === 4,
    'stage 6 validation expected four units per player', { seed, metadata });
  assert(metadata.catapultsPerPlayer >= 1,
    'stage 6 validation expected catapult coverage', { seed, metadata });
  assert(metadata.archersPerPlayer >= 1 && metadata.archersPerPlayer <= 2,
    'stage 6 validation should preserve archer coverage', { seed, metadata });
  assert(metadata.noobsPerPlayer >= 1,
    'stage 6 validation should keep noobs available', { seed, metadata });
  assert(metadata.noobsPerPlayer + metadata.archersPerPlayer + metadata.catapultsPerPlayer ===
    metadata.unitsPerPlayer,
    'stage 6 validation unit metadata is inconsistent', { seed, metadata });
  assert(metadata.catapultRatio === metadata.catapultsPerPlayer + '/' + metadata.unitsPerPlayer,
    'stage 6 validation catapult ratio metadata is inconsistent', { seed, metadata });
  assert(Array.isArray(metadata.catapultIndexes) &&
    metadata.catapultIndexes.length === metadata.catapultsPerPlayer,
    'stage 6 validation catapult index metadata should match catapult count', { seed, metadata });
  assert(metadata.catapultIndexes.every((index) => index >= 0 && index < metadata.unitsPerPlayer),
    'stage 6 validation catapult indexes are out of bounds', { seed, metadata });

  assert(metadata.defensiveBuildingsPerPlayer === 2,
    'stage 6 should preserve stage 4/5 defensive building count', { seed, metadata });
  assert(Array.isArray(metadata.buildingTypes) &&
    metadata.buildingTypes.includes('tower') &&
    metadata.buildingTypes.includes('bastion'),
    'stage 6 should preserve tower and bastion defensive-building coverage', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 6 defensive building HP bounds should remain 2-5', { seed, metadata });
  assert(metadata.hpByType.tower >= metadata.hpMin && metadata.hpByType.tower <= metadata.hpMax,
    'stage 6 tower HP is outside documented bounds', { seed, metadata });
  assert(metadata.hpByType.bastion >= metadata.hpMin && metadata.hpByType.bastion <= metadata.hpMax,
    'stage 6 bastion HP is outside documented bounds', { seed, metadata });

  const left = map.players[1];
  const right = map.players[2];
  assert(left.gold === right.gold,
    'stage 6 sides should have equal starting gold', { seed, leftGold: left.gold, rightGold: right.gold });
  assert(left.towns.length === 1 && right.towns.length === 1,
    'stage 6 should give each player exactly one town', { seed, left: left.towns, right: right.towns });
  assertMirrored(left.towns[0], right.towns[0], map.mapSize,
    'stage 6 towns should be mirrored', { seed });
  assertMirrored(left.towers[0], right.towers[0], map.mapSize,
    'stage 6 towers should be mirrored', { seed });
  assertMirrored(left.bastions[0], right.bastions[0], map.mapSize,
    'stage 6 bastions should be mirrored', { seed });

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const catapults = (player.units || []).filter((unit) => unitTypeName(unit) === 'Catapult');
    const archers = (player.units || []).filter((unit) => unitTypeName(unit) === 'Archer');
    const noobs = (player.units || []).filter((unit) => unitTypeName(unit) === 'Noob');
    assert(catapults.length === metadata.catapultsPerPlayer,
      'stage 6 catapult count should match metadata', { seed, playerIndex, catapults, metadata });
    assert(archers.length === metadata.archersPerPlayer,
      'stage 6 archer count should match metadata', { seed, playerIndex, archers, metadata });
    assert(noobs.length === metadata.noobsPerPlayer,
      'stage 6 noob count should match metadata', { seed, playerIndex, noobs, metadata });
    assert(player.units.length === catapults.length + archers.length + noobs.length,
      'stage 6 should only include noobs, archers, and catapults',
      { seed, playerIndex, units: player.units });
    assert((player.towers || []).length === 1 && (player.bastions || []).length === 1,
      'stage 6 should keep one tower and one bastion per player',
      { seed, playerIndex, towers: player.towers, bastions: player.bastions });
    assert(player.towers[0].hp === metadata.hpByType.tower,
      'stage 6 tower HP should match metadata', { seed, playerIndex, tower: player.towers[0], metadata });
    assert(player.bastions[0].hp === metadata.hpByType.bastion,
      'stage 6 bastion HP should match metadata', { seed, playerIndex, bastion: player.bastions[0], metadata });
  }

  for (let index = 0; index < left.units.length; index += 1) {
    assert(unitTypeName(left.units[index]) === unitTypeName(right.units[index]),
      'stage 6 mirrored unit types should match by index',
      { seed, index, left: left.units[index], right: right.units[index] });
    assertMirrored(left.units[index], right.units[index], map.mapSize,
      'stage 6 unit placements should be mirrored by index', { seed, index });
  }

  assert(map.economyObjects.catapults === metadata.catapultsPerPlayer * 2,
    'stage 6 economy summary should record all catapults', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.archers === metadata.archersPerPlayer * 2,
    'stage 6 economy summary should record all archers', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.noobs === metadata.noobsPerPlayer * 2,
    'stage 6 economy summary should record all noobs', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.towers === 2 && map.economyObjects.bastions === 2,
    'stage 6 economy summary should keep two towers and two bastions',
    { seed, economyObjects: map.economyObjects });

  validateLegalPlacement(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage6TrainingMap: context.generateEconomyStage6TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage6TrainingMap === 'function',
  'generateEconomyStage6TrainingMap must be exported');

const seeds = [
  12900, 12901, 12902, 12903, 12904, 12905, 12906, 12907,
  12908, 12909, 12910, 12911, 12912, 12913, 12914, 12915
];
const catapultCounts = new Set();
const archerCounts = new Set();
const noobCounts = new Set();
const catapultIndexes = new Set();
const towerHpValues = new Set();
const bastionHpValues = new Set();
const observedUnitTypes = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage6TrainingMap({ seed });
  validateStage6Map(map, seed);

  catapultCounts.add(map.economyGenerator.catapultsPerPlayer);
  archerCounts.add(map.economyGenerator.archersPerPlayer);
  noobCounts.add(map.economyGenerator.noobsPerPlayer);
  towerHpValues.add(map.economyGenerator.hpByType.tower);
  bastionHpValues.add(map.economyGenerator.hpByType.bastion);
  for (const index of map.economyGenerator.catapultIndexes) {
    catapultIndexes.add(index);
  }
  for (const unit of map.players[1].units) {
    observedUnitTypes.add(unitTypeName(unit));
  }
}

assert(catapultCounts.has(1),
  'stage 6 validation should observe one catapult per player across seeds',
  { seeds, catapultCounts: Array.from(catapultCounts) });
assert(observedUnitTypes.has('Catapult') && observedUnitTypes.has('Archer') && observedUnitTypes.has('Noob'),
  'stage 6 validation should represent catapults and prior unit types',
  { seeds, observedUnitTypes: Array.from(observedUnitTypes) });
assert(archerCounts.size >= 2 && noobCounts.size >= 2,
  'stage 6 validation should preserve earlier archer/noob variation',
  { seeds, archerCounts: Array.from(archerCounts), noobCounts: Array.from(noobCounts) });
assert(catapultIndexes.size >= 2,
  'stage 6 validation should cover multiple legal catapult slots',
  { seeds, catapultIndexes: Array.from(catapultIndexes) });
assert(towerHpValues.size >= 2 && bastionHpValues.size >= 2,
  'stage 6 validation should preserve defensive HP variation across seeds',
  {
    seeds,
    towerHpValues: Array.from(towerHpValues),
    bastionHpValues: Array.from(bastionHpValues)
  });

const replaySeed = seeds[9];
const first = api.generateEconomyStage6TrainingMap({ seed: replaySeed });
const second = api.generateEconomyStage6TrainingMap({ seed: replaySeed });
assert(normalizedMap(first) === normalizedMap(second),
  'stage 6 validation expected deterministic replay for seed ' + replaySeed);

console.log('Economy stage 6 validation test passed for ' + seeds.length + ' deterministic seeds');
