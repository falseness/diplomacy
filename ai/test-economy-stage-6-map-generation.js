const { loadAiScripts } = require('./smokeHarness');
const { runCheckpointSmoke } = require('./tests/checkpoint-smoke.cjs');

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
        'stage 6 building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 6 building overlaps ' + occupied.get(key), { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 6 unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 6 unit overlaps ' + occupied.get(key), { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function assertMirrored(left, right, mapSize, message, details) {
  assert(left.x + right.x === mapSize.x - 1 && left.y === right.y,
    message, Object.assign({ left, right, mapSize }, details || {}));
}

function validateStage6Map(map, stage5Map, seed) {
  assert(map.mapSize.x === stage5Map.mapSize.x && map.mapSize.y === stage5Map.mapSize.y,
    'stage 6 should keep the stage 5 footprint', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 6 map should include neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 6 player 1 should be AIPlayerWithEconomy', { seed, player: map.players[1] });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 6 player 2 should be SimpleAiPlayerWithEconomy', { seed, player: map.players[2] });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 6 && metadata && metadata.stage === 6,
    'stage 6 generator metadata is missing', { seed, metadata });
  assert(metadata.defensiveBuildingsPerPlayer === 2,
    'stage 6 should keep stage 4/5 defensive-building complexity', { seed, metadata });
  assert(Array.isArray(metadata.buildingTypes) &&
    metadata.buildingTypes.includes('tower') &&
    metadata.buildingTypes.includes('bastion'),
    'stage 6 should keep tower and bastion coverage', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 6 HP bounds should remain 2-5', { seed, metadata });
  assert(metadata.archersPerPlayer >= 1 && metadata.archersPerPlayer <= 2,
    'stage 6 should keep randomized archer complexity', { seed, metadata });
  assert(metadata.catapultsPerPlayer >= 1,
    'stage 6 should include catapults', { seed, metadata });
  assert(metadata.noobsPerPlayer + metadata.archersPerPlayer + metadata.catapultsPerPlayer === metadata.unitsPerPlayer,
    'stage 6 unit counts should be internally consistent', { seed, metadata });
  assert(metadata.archerRatio === metadata.archersPerPlayer + '/' + metadata.unitsPerPlayer,
    'stage 6 archer ratio metadata is inconsistent', { seed, metadata });
  assert(metadata.catapultRatio === metadata.catapultsPerPlayer + '/' + metadata.unitsPerPlayer,
    'stage 6 catapult ratio metadata is inconsistent', { seed, metadata });
  assert(Array.isArray(metadata.catapultIndexes) &&
    metadata.catapultIndexes.length === metadata.catapultsPerPlayer,
    'stage 6 catapult index metadata should match catapult count', { seed, metadata });

  const left = map.players[1];
  const right = map.players[2];
  assert(left.gold === right.gold,
    'stage 6 sides should receive equal starting gold', { seed, left: left.gold, right: right.gold });
  assertMirrored(left.towns[0], right.towns[0], map.mapSize,
    'stage 6 towns should be mirrored', { seed });
  assertMirrored(left.towers[0], right.towers[0], map.mapSize,
    'stage 6 towers should be mirrored', { seed });
  assertMirrored(left.bastions[0], right.bastions[0], map.mapSize,
    'stage 6 bastions should be mirrored', { seed });

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const archers = player.units.filter((unit) => unitTypeName(unit) === 'Archer');
    const catapults = player.units.filter((unit) => unitTypeName(unit) === 'Catapult');
    const noobs = player.units.filter((unit) => unitTypeName(unit) === 'Noob');
    assert(archers.length === metadata.archersPerPlayer,
      'stage 6 archer count should match metadata', { seed, playerIndex, archers, metadata });
    assert(catapults.length === metadata.catapultsPerPlayer,
      'stage 6 catapult count should match metadata', { seed, playerIndex, catapults, metadata });
    assert(noobs.length === metadata.noobsPerPlayer,
      'stage 6 noob count should match metadata', { seed, playerIndex, noobs, metadata });
    assert(player.units.length === archers.length + noobs.length + catapults.length,
      'stage 6 should only include noobs, archers, and catapults',
      { seed, playerIndex, units: player.units });
    assert((player.towers || []).length === 1 && (player.bastions || []).length === 1,
      'stage 6 should generate one tower and one bastion for each player',
      { seed, playerIndex, towers: player.towers, bastions: player.bastions });
  }

  for (let index = 0; index < left.units.length; index += 1) {
    assert(unitTypeName(left.units[index]) === unitTypeName(right.units[index]),
      'stage 6 mirrored unit types should match by index',
      { seed, index, left: left.units[index], right: right.units[index] });
    assertMirrored(left.units[index], right.units[index], map.mapSize,
      'stage 6 unit placements should be mirrored by index', { seed, index });
  }

  assert(map.economyObjects.archers === metadata.archersPerPlayer * 2,
    'stage 6 economy summary should record all archers', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.catapults === metadata.catapultsPerPlayer * 2,
    'stage 6 economy summary should record all catapults', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.noobs === metadata.noobsPerPlayer * 2,
    'stage 6 economy summary should record all noobs', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.towers === 2 && map.economyObjects.bastions === 2,
    'stage 6 economy summary should keep two towers and two bastions', { seed, economyObjects: map.economyObjects });

  validateNoOverlap(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage5TrainingMap: context.generateEconomyStage5TrainingMap,
  generateEconomyStage6TrainingMap: context.generateEconomyStage6TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage5TrainingMap === 'function',
  'generateEconomyStage5TrainingMap must remain exported for comparison');
assert(typeof api.generateEconomyStage6TrainingMap === 'function',
  'generateEconomyStage6TrainingMap must be exported independently');

const stage5 = api.generateEconomyStage5TrainingMap({ seed: 12800 });
const seeds = [12800, 12801, 12802, 12803, 12804, 12805, 12806, 12807, 12808, 12809, 12810, 12811];
const archerCounts = new Set();
const catapultCounts = new Set();
const catapultIndexes = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage6TrainingMap({ seed });
  validateStage6Map(map, stage5, seed);
  archerCounts.add(map.economyGenerator.archersPerPlayer);
  catapultCounts.add(map.economyGenerator.catapultsPerPlayer);
  for (const index of map.economyGenerator.catapultIndexes) {
    catapultIndexes.add(index);
  }

  const repeated = api.generateEconomyStage6TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 6 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].units.some((unit) => unit.name === 'Catapult'),
    'stage 6 headless runtime did not create player 1 catapults');
  assert(runtime.players[2].units.some((unit) => unit.name === 'Catapult'),
    'stage 6 headless runtime did not create player 2 catapults');
}

assert(archerCounts.size >= 2,
  'stage 6 archer ratio did not vary across fixed seeds',
  { seeds, archerCounts: Array.from(archerCounts) });
assert(catapultCounts.has(1),
  'stage 6 catapult ratio should be documented as one catapult per player',
  { seeds, catapultCounts: Array.from(catapultCounts) });
assert(catapultIndexes.size >= 2,
  'stage 6 catapult placement should vary across fixed seeds',
  { seeds, catapultIndexes: Array.from(catapultIndexes) });

async function runGameplaySmoke() {
  const smokeMap = api.generateEconomyStage6TrainingMap({ seed: 12842, suddenDeathRound: 14 });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 12842,
    roundLimit: 4,
    actionLimit: 3,
    commandLimit: 24
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(!smokeResult.crash, 'short economy smoke crashed', smokeResult);
  assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
    'short smoke did not run AIPlayerWithEconomy', smokeResult);
  assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
  assert(smokeResult.turnCount > 0,
    'short smoke game did not advance with runtime players', smokeResult);

  console.log('Economy stage 6 map generation smoke passed');
}

runGameplaySmoke().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
