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

function selectedBuildings(player, buildingType) {
  return buildingType === 'tower' ? (player.towers || []) : (player.bastions || []);
}

function normalizedMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
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

function validateLegalPlacement(map, seed) {
  const occupied = new Map();
  for (const coord of [].concat(map.lakes || [], map.mountains || [])) {
    occupied.set(coordKey(coord), 'terrain');
  }

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
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
        'stage 3 building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 3 building overlaps ' + occupied.get(key), { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 3 unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 3 unit overlaps ' + occupied.get(key), { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function validateFairStage3Map(map, stage2Map, seed) {
  assert(map.economyStage === 3 && map.economyGenerator && map.economyGenerator.stage === 3,
    'stage 3 validation requires stage metadata', { seed, metadata: map.economyGenerator });
  assert(map.players.length === 3,
    'stage 3 validation expected neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 3 player 1 should be AIPlayerWithEconomy', { seed, player: map.players[1] });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 3 player 2 should be SimpleAiPlayerWithEconomy', { seed, player: map.players[2] });

  const left = map.players[1];
  const right = map.players[2];
  const metadata = map.economyGenerator;
  const stage2Noobs = stage2Map.players[1].units.filter((unit) => unitTypeName(unit) === 'Noob').length;

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const noobs = (player.units || []).filter((unit) => unitTypeName(unit) === 'Noob');
    assert(noobs.length === metadata.noobsPerPlayer,
      'stage 3 noob count should match metadata', { seed, playerIndex, noobs, metadata });
    assert(noobs.length > stage2Noobs,
      'stage 3 should increase noob count compared with stage 2',
      { seed, playerIndex, stage2Noobs, stage3Noobs: noobs.length });
    assert((player.units || []).length === noobs.length,
      'stage 3 validation expects a noob-only starting force', { seed, playerIndex, units: player.units });
    assert((player.towns || []).length === 1,
      'stage 3 player should have exactly one town', { seed, playerIndex, towns: player.towns });
    assert(selectedBuildings(player, metadata.buildingType).length === 1,
      'stage 3 player should have one selected defensive building',
      { seed, playerIndex, buildingType: metadata.buildingType, player });
  }

  assert(left.units.length === right.units.length,
    'stage 3 sides should have equal unit counts', { seed, left: left.units, right: right.units });
  assert(left.gold === right.gold,
    'stage 3 sides should have equal starting gold', { seed, leftGold: left.gold, rightGold: right.gold });
  assert(left.towns[0].x + right.towns[0].x === map.mapSize.x - 1 && left.towns[0].y === right.towns[0].y,
    'stage 3 towns should be mirrored', { seed, left: left.towns, right: right.towns });

  for (let index = 0; index < left.units.length; index += 1) {
    assert(left.units[index].x + right.units[index].x === map.mapSize.x - 1 &&
      left.units[index].y === right.units[index].y,
      'stage 3 noob placements should be mirrored by index',
      { seed, index, left: left.units[index], right: right.units[index] });
  }

  assert(map.economyObjects.noobs === left.units.length + right.units.length,
    'stage 3 economy object summary should record all noobs', { seed, economyObjects: map.economyObjects });
  validateLegalPlacement(map, seed);
}

function cloneMapData(map) {
  return JSON.parse(JSON.stringify({
    mapSize: map.mapSize,
    players: map.players.map((player) => ({
      towns: player.towns || [],
      units: (player.units || []).map((unit) => ({
        type: unitTypeName(unit),
        x: unit.x,
        y: unit.y,
        hp: unit.hp
      })),
      towers: player.towers || [],
      bastions: player.bastions || [],
      walls: player.walls || [],
      barracks: player.barracks || [],
      farms: player.farms || []
    })),
    lakes: map.lakes || [],
    mountains: map.mountains || [],
    economyGenerator: map.economyGenerator
  }));
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage2TrainingMap: context.generateEconomyStage2TrainingMap,
  generateEconomyStage3TrainingMap: context.generateEconomyStage3TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage2TrainingMap === 'function',
  'generateEconomyStage2TrainingMap must be exported');
assert(typeof api.generateEconomyStage3TrainingMap === 'function',
  'generateEconomyStage3TrainingMap must be exported');

const stage2 = api.generateEconomyStage2TrainingMap({ seed: 12300 });
const seeds = [12300, 12301, 12302, 12303, 12304, 12305, 12306, 12307, 12308, 12309, 12310, 12311];

for (const seed of seeds) {
  const map = api.generateEconomyStage3TrainingMap({ seed });
  validateFairStage3Map(map, stage2, seed);

  const repeated = api.generateEconomyStage3TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 3 validation expected deterministic replay for seed ' + seed);
}

const invalid = cloneMapData(api.generateEconomyStage3TrainingMap({ seed: seeds[0] }));
invalid.players[1].units[0] = Object.assign({}, invalid.players[1].towers[0] || invalid.players[1].bastions[0], {
  type: 'Noob'
});
let rejectedInvalidPlacement = false;
try {
  validateLegalPlacement(invalid, 'intentional-invalid-overlap');
} catch (error) {
  rejectedInvalidPlacement = /overlaps/.test(error.message);
}
assert(rejectedInvalidPlacement,
  'stage 3 legality validation should reject an intentionally overlapping unit placement');

console.log('Economy stage 3 validation test passed for ' + seeds.length + ' deterministic seeds');
