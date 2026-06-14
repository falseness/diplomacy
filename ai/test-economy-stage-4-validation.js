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

function validateFairPlacement(map, seed) {
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
        'stage 4 building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 4 building overlaps ' + occupied.get(key), { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 4 unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 4 unit overlaps ' + occupied.get(key), { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function validateStage4Map(map, seed) {
  assert(map.economyStage === 4 && map.economyGenerator && map.economyGenerator.stage === 4,
    'stage 4 validation requires stage metadata', { seed, metadata: map.economyGenerator });
  assert(map.players.length === 3,
    'stage 4 validation expected neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 4 player 1 should be AIPlayerWithEconomy', { seed, player: map.players[1] });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 4 player 2 should be SimpleAiPlayerWithEconomy', { seed, player: map.players[2] });

  const metadata = map.economyGenerator;
  assert(metadata.defensiveBuildingsPerPlayer === 2,
    'stage 4 should document two defensive buildings per player', { seed, metadata });
  assert(Array.isArray(metadata.buildingTypes) &&
    metadata.buildingTypes.includes('tower') &&
    metadata.buildingTypes.includes('bastion'),
    'stage 4 should document tower and bastion coverage', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 4 HP bounds should remain 2-5', { seed, metadata });
  assert(metadata.hpByType.tower >= metadata.hpMin && metadata.hpByType.tower <= metadata.hpMax,
    'stage 4 tower HP is outside documented bounds', { seed, metadata });
  assert(metadata.hpByType.bastion >= metadata.hpMin && metadata.hpByType.bastion <= metadata.hpMax,
    'stage 4 bastion HP is outside documented bounds', { seed, metadata });

  const left = map.players[1];
  const right = map.players[2];
  assert(left.gold === right.gold,
    'stage 4 sides should have equal starting gold', { seed, leftGold: left.gold, rightGold: right.gold });
  assert(left.towns.length === 1 && right.towns.length === 1,
    'stage 4 should give each player exactly one town', { seed, left: left.towns, right: right.towns });
  assert(left.towns[0].x + right.towns[0].x === map.mapSize.x - 1 && left.towns[0].y === right.towns[0].y,
    'stage 4 towns should be mirrored', { seed, left: left.towns, right: right.towns });

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const noobs = (player.units || []).filter((unit) => unitTypeName(unit) === 'Noob');
    assert(noobs.length === metadata.noobsPerPlayer,
      'stage 4 noob count should match metadata', { seed, playerIndex, noobs, metadata });
    assert(player.units.length === noobs.length,
      'stage 4 validation expects a noob-only starting force', { seed, playerIndex, units: player.units });
    assert((player.towers || []).length === 1 && (player.bastions || []).length === 1,
      'stage 4 should generate one tower and one bastion for each player',
      { seed, playerIndex, towers: player.towers, bastions: player.bastions });
    assert(player.towers[0].hp === metadata.hpByType.tower,
      'stage 4 tower HP should match metadata', { seed, playerIndex, tower: player.towers[0], metadata });
    assert(player.bastions[0].hp === metadata.hpByType.bastion,
      'stage 4 bastion HP should match metadata', { seed, playerIndex, bastion: player.bastions[0], metadata });
  }

  assert(left.towers[0].x + right.towers[0].x === map.mapSize.x - 1 &&
    left.towers[0].y === right.towers[0].y,
    'stage 4 towers should be mirrored', { seed, left: left.towers, right: right.towers });
  assert(left.bastions[0].x + right.bastions[0].x === map.mapSize.x - 1 &&
    left.bastions[0].y === right.bastions[0].y,
    'stage 4 bastions should be mirrored', { seed, left: left.bastions, right: right.bastions });

  for (let index = 0; index < left.units.length; index += 1) {
    assert(left.units[index].x + right.units[index].x === map.mapSize.x - 1 &&
      left.units[index].y === right.units[index].y,
      'stage 4 noob placements should be mirrored by index',
      { seed, index, left: left.units[index], right: right.units[index] });
  }

  assert(map.economyObjects.towers === 2 && map.economyObjects.bastions === 2,
    'stage 4 economy summary should record two towers and two bastions',
    { seed, economyObjects: map.economyObjects });
  assert(map.economyObjects.noobs === left.units.length + right.units.length,
    'stage 4 economy summary should record all noobs', { seed, economyObjects: map.economyObjects });

  validateFairPlacement(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage4TrainingMap: context.generateEconomyStage4TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage4TrainingMap === 'function',
  'generateEconomyStage4TrainingMap must be exported');

const seeds = [12500, 12501, 12502, 12503, 12504, 12505, 12506, 12507, 12508, 12509, 12510, 12511];
const towerHpValues = new Set();
const bastionHpValues = new Set();
const hpPairs = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage4TrainingMap({ seed });
  validateStage4Map(map, seed);
  towerHpValues.add(map.economyGenerator.hpByType.tower);
  bastionHpValues.add(map.economyGenerator.hpByType.bastion);
  hpPairs.add(map.economyGenerator.hpByType.tower + ':' + map.economyGenerator.hpByType.bastion);
}

assert(towerHpValues.size >= 2,
  'stage 4 validation should observe randomized tower HP across fixed seeds',
  { seeds, towerHpValues: Array.from(towerHpValues) });
assert(bastionHpValues.size >= 2,
  'stage 4 validation should observe randomized bastion HP across fixed seeds',
  { seeds, bastionHpValues: Array.from(bastionHpValues) });
assert(hpPairs.size >= 2,
  'stage 4 validation should observe varied tower/bastion HP pairs',
  { seeds, hpPairs: Array.from(hpPairs) });

const replaySeed = seeds[5];
const first = api.generateEconomyStage4TrainingMap({ seed: replaySeed });
const second = api.generateEconomyStage4TrainingMap({ seed: replaySeed });
assert(normalizedMap(first) === normalizedMap(second),
  'stage 4 validation expected deterministic replay for seed ' + replaySeed);

console.log('Economy stage 4 validation test passed for ' + seeds.length + ' deterministic seeds');
