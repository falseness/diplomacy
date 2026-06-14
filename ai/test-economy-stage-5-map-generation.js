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
        'stage 5 building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 5 building overlaps ' + occupied.get(key), { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 5 unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 5 unit overlaps ' + occupied.get(key), { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function validateStage5Map(map, stage4Map, seed) {
  assert(map.mapSize.x === stage4Map.mapSize.x && map.mapSize.y === stage4Map.mapSize.y,
    'stage 5 should keep the stage 4 footprint', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 5 map should include neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 5 player 1 should be AIPlayerWithEconomy', { seed, player: map.players[1] });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 5 player 2 should be SimpleAiPlayerWithEconomy', { seed, player: map.players[2] });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 5 && metadata && metadata.stage === 5,
    'stage 5 generator metadata is missing', { seed, metadata });
  assert(metadata.defensiveBuildingsPerPlayer === 2,
    'stage 5 should keep previous defensive-building complexity', { seed, metadata });
  assert(Array.isArray(metadata.buildingTypes) &&
    metadata.buildingTypes.includes('tower') &&
    metadata.buildingTypes.includes('bastion'),
    'stage 5 should keep tower and bastion coverage', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 5 HP bounds should remain 2-5', { seed, metadata });
  assert(metadata.archersPerPlayer >= 1 && metadata.archersPerPlayer <= 2,
    'stage 5 should document a randomized one-or-two archer ratio', { seed, metadata });
  assert(metadata.archerRatio === metadata.archersPerPlayer + '/' + metadata.unitsPerPlayer,
    'stage 5 archer ratio metadata is inconsistent', { seed, metadata });

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const stage4Player = stage4Map.players[playerIndex];
    assert((player.units || []).length === (stage4Player.units || []).length,
      'stage 5 should preserve the stage 4 unit count', { seed, playerIndex });
    const archers = player.units.filter((unit) => unitTypeName(unit) === 'Archer');
    const noobs = player.units.filter((unit) => unitTypeName(unit) === 'Noob');
    assert(archers.length === metadata.archersPerPlayer,
      'stage 5 archer count should match metadata', { seed, playerIndex, archers, metadata });
    assert(noobs.length === metadata.noobsPerPlayer,
      'stage 5 noob count should match metadata', { seed, playerIndex, noobs, metadata });
    assert(player.units.length === archers.length + noobs.length,
      'stage 5 should only include noobs and archers at this stage', { seed, playerIndex, units: player.units });
    assert((player.towers || []).length === 1 && (player.bastions || []).length === 1,
      'stage 5 should generate one tower and one bastion for each player',
      { seed, playerIndex, towers: player.towers, bastions: player.bastions });
    assert(player.towers[0].hp === metadata.hpByType.tower,
      'stage 5 tower HP should match metadata', { seed, playerIndex, tower: player.towers[0], metadata });
    assert(player.bastions[0].hp === metadata.hpByType.bastion,
      'stage 5 bastion HP should match metadata', { seed, playerIndex, bastion: player.bastions[0], metadata });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.gold === right.gold,
    'stage 5 sides should receive equal starting gold', { seed, left: left.gold, right: right.gold });
  assert(left.towns[0].x + right.towns[0].x === map.mapSize.x - 1 &&
    left.towns[0].y === right.towns[0].y,
    'stage 5 towns should be mirrored', { seed, left: left.towns, right: right.towns });
  assert(left.towers[0].x + right.towers[0].x === map.mapSize.x - 1 &&
    left.towers[0].y === right.towers[0].y,
    'stage 5 towers should be mirrored', { seed, left: left.towers, right: right.towers });
  assert(left.bastions[0].x + right.bastions[0].x === map.mapSize.x - 1 &&
    left.bastions[0].y === right.bastions[0].y,
    'stage 5 bastions should be mirrored', { seed, left: left.bastions, right: right.bastions });

  for (let index = 0; index < left.units.length; index += 1) {
    assert(unitTypeName(left.units[index]) === unitTypeName(right.units[index]),
      'stage 5 mirrored unit types should match by index',
      { seed, index, left: left.units[index], right: right.units[index] });
    assert(left.units[index].x + right.units[index].x === map.mapSize.x - 1 &&
      left.units[index].y === right.units[index].y,
      'stage 5 unit placements should be mirrored by index',
      { seed, index, left: left.units[index], right: right.units[index] });
  }

  assert(map.economyObjects.archers === metadata.archersPerPlayer * 2,
    'stage 5 economy summary should record all archers', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.noobs === metadata.noobsPerPlayer * 2,
    'stage 5 economy summary should record all noobs', { seed, economyObjects: map.economyObjects, metadata });
  assert(map.economyObjects.towers === 2 && map.economyObjects.bastions === 2,
    'stage 5 economy summary should keep two towers and two bastions', { seed, economyObjects: map.economyObjects });

  validateNoOverlap(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage4TrainingMap: context.generateEconomyStage4TrainingMap,
  generateEconomyStage5TrainingMap: context.generateEconomyStage5TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage4TrainingMap === 'function',
  'generateEconomyStage4TrainingMap must remain exported for comparison');
assert(typeof api.generateEconomyStage5TrainingMap === 'function',
  'generateEconomyStage5TrainingMap must be exported independently');

const stage4 = api.generateEconomyStage4TrainingMap({ seed: 12600 });
const seeds = [12600, 12601, 12602, 12603, 12604, 12605, 12606, 12607, 12608, 12609, 12610, 12611];
const archerCounts = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage5TrainingMap({ seed });
  validateStage5Map(map, stage4, seed);
  archerCounts.add(map.economyGenerator.archersPerPlayer);

  const repeated = api.generateEconomyStage5TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 5 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].units.some((unit) => unit.name === 'Archer'),
    'stage 5 headless runtime did not create player 1 archers');
  assert(runtime.players[2].units.some((unit) => unit.name === 'Archer'),
    'stage 5 headless runtime did not create player 2 archers');
}

assert(archerCounts.size >= 2,
  'stage 5 archer ratio did not vary across fixed seeds',
  { seeds, archerCounts: Array.from(archerCounts) });

const smokeMap = api.generateEconomyStage5TrainingMap({ seed: 12642, suddenDeathRound: 14 });
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 12642,
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

console.log('Economy stage 5 map generation smoke passed');
