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
    mountains: map.mountains || [],
    bushes: map.bushes || []
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

function terrainEntries(map) {
  return []
    .concat((map.mountains || []).map((coord) => ({ type: 'mountain', coord })))
    .concat((map.bushes || []).map((coord) => ({ type: 'bush', coord })))
    .concat((map.lakes || []).map((coord) => ({ type: 'lake', coord })));
}

function assertTerrainDoesNotTrapMap(map, seed) {
  const terrain = new Set(terrainEntries(map).map((entry) => coordKey(entry.coord)));
  const neighbours = [
    {x: -1, y: 0},
    {x: 1, y: 0},
    {x: 0, y: -1},
    {x: 0, y: 1},
    {x: -1, y: 1},
    {x: 1, y: -1}
  ];
  const leftTown = map.players[1].towns[0];
  const rightTown = map.players[2].towns[0];
  const queue = [leftTown];
  const seen = new Set([coordKey(leftTown)]);

  while (queue.length) {
    const current = queue.shift();
    for (const offset of neighbours) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      const key = coordKey(next);
      if (next.x < 0 || next.y < 0 ||
          next.x >= map.mapSize.x || next.y >= map.mapSize.y ||
          terrain.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      queue.push(next);
    }
  }
  assert(seen.has(coordKey(rightTown)),
    'stage 8 terrain blocks town-to-town pathing', { seed, terrain: Array.from(terrain) });

  for (const playerIndex of [1, 2]) {
    for (const unit of map.players[playerIndex].units || []) {
      const openNeighbour = neighbours.some((offset) => {
        const next = { x: unit.x + offset.x, y: unit.y + offset.y };
        return next.x >= 0 && next.y >= 0 &&
          next.x < map.mapSize.x && next.y < map.mapSize.y &&
          !terrain.has(coordKey(next));
      });
      assert(openNeighbour,
        'stage 8 terrain traps a required unit', { seed, playerIndex, unit, terrain: Array.from(terrain) });
    }
  }
}

function validateNoOverlap(map, seed) {
  const occupied = new Map();
  for (const entry of terrainEntries(map)) {
    assertInBounds(entry.coord, map.mapSize,
      'stage 8 terrain is outside map bounds', { seed, entry });
    const key = coordKey(entry.coord);
    assert(!occupied.has(key),
      'stage 8 terrain overlaps ' + occupied.get(key), { seed, entry });
    occupied.set(key, entry.type);
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
        'stage 8 building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 8 building overlaps ' + occupied.get(key), { seed, playerIndex, building });
      occupied.set(key, 'building');
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 8 unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 8 unit overlaps ' + occupied.get(key), { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function assertStage7RequirementsPreserved(stage7, stage8, seed) {
  assert(stage8.mapSize.x === 9 && stage8.mapSize.y === 9,
    'stage 8 should keep the 9v9 stage 7 footprint', { seed, mapSize: stage8.mapSize });
  assert(stage8.players[1].playerType === 'AIPlayerWithEconomy' &&
      stage8.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 8 should keep the stage 7 player classes', { seed, players: stage8.players });
  for (const playerIndex of [1, 2]) {
    const stage7Player = stage7.players[playerIndex];
    const stage8Player = stage8.players[playerIndex];
    assert(JSON.stringify(stage8Player.towns) === JSON.stringify(stage7Player.towns),
      'stage 8 should preserve stage 7 towns', { seed, playerIndex });
    assert(JSON.stringify(stage8Player.towers) === JSON.stringify(stage7Player.towers),
      'stage 8 should preserve stage 7 towers', { seed, playerIndex });
    assert(JSON.stringify(stage8Player.bastions) === JSON.stringify(stage7Player.bastions),
      'stage 8 should preserve stage 7 bastions', { seed, playerIndex });
    assert(JSON.stringify((stage8Player.units || []).map(unitTypeName).sort()) ===
        JSON.stringify((stage7Player.units || []).map(unitTypeName).sort()),
      'stage 8 should preserve all stage 7 unit types', { seed, playerIndex });
  }
  assert(stage8.economyObjects.noobs === stage7.economyObjects.noobs &&
      stage8.economyObjects.archers === stage7.economyObjects.archers &&
      stage8.economyObjects.KOHbs === stage7.economyObjects.KOHbs &&
      stage8.economyObjects.normchels === stage7.economyObjects.normchels &&
      stage8.economyObjects.catapults === stage7.economyObjects.catapults &&
      stage8.economyObjects.towers === stage7.economyObjects.towers &&
      stage8.economyObjects.bastions === stage7.economyObjects.bastions,
    'stage 8 should preserve stage 7 economy object counts', { seed });
}

function validateStage8Map(stage7, map, seed) {
  const metadata = map.economyGenerator;
  assert(map.economyStage === 8 && metadata && metadata.stage === 8,
    'stage 8 generator metadata is missing', { seed, metadata });
  assert(Array.isArray(metadata.terrainTypes) &&
      metadata.terrainTypes.includes('mountain') &&
      metadata.terrainTypes.includes('bush') &&
      metadata.terrainTypes.includes('lake'),
    'stage 8 metadata should list all terrain types', { seed, metadata });
  assert(metadata.terrainCounts.mountains === 2 &&
      metadata.terrainCounts.bushes === 2 &&
      metadata.terrainCounts.lakes === 1,
    'stage 8 terrain counts are incorrect', { seed, metadata });
  assert((map.mountains || []).length === 2 &&
      (map.bushes || []).length === 2 &&
      (map.lakes || []).length === 1,
    'stage 8 should generate mountains, bushes, and lakes', { seed, map });
  assertMirrored(map.mountains[0], map.mountains[1], map.mapSize,
    'stage 8 mountains should be mirrored', { seed });
  assertMirrored(map.bushes[0], map.bushes[1], map.mapSize,
    'stage 8 bushes should be mirrored', { seed });
  assert(map.lakes[0].x === Math.floor(map.mapSize.x / 2),
    'stage 8 lake should sit on the fairness axis', { seed, lake: map.lakes[0] });

  assertStage7RequirementsPreserved(stage7, map, seed);
  validateNoOverlap(map, seed);
  assertTerrainDoesNotTrapMap(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage7TrainingMap: context.generateEconomyStage7TrainingMap,
  generateEconomyStage8TrainingMap: context.generateEconomyStage8TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage7TrainingMap === 'function',
  'generateEconomyStage7TrainingMap must remain exported for comparison');
assert(typeof api.generateEconomyStage8TrainingMap === 'function',
  'generateEconomyStage8TrainingMap must be exported independently');

const seeds = [13200, 13201, 13202, 13203, 13204, 13205, 13206, 13207, 13208, 13209, 13210, 13211];
const observedTerrain = new Set();
const terrainLayouts = new Set();

for (const seed of seeds) {
  const stage7 = api.generateEconomyStage7TrainingMap({ seed });
  const map = api.generateEconomyStage8TrainingMap({ seed });
  validateStage8Map(stage7, map, seed);
  for (const entry of terrainEntries(map)) {
    observedTerrain.add(entry.type);
  }
  terrainLayouts.add(JSON.stringify({
    lakes: map.lakes,
    mountains: map.mountains,
    bushes: map.bushes
  }));

  const repeated = api.generateEconomyStage8TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 8 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (const type of ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']) {
    assert(runtime.players[1].units.some((unit) => unit.name === type),
      'stage 8 headless runtime did not create player 1 ' + type);
    assert(runtime.players[2].units.some((unit) => unit.name === type),
      'stage 8 headless runtime did not create player 2 ' + type);
  }
}

for (const type of ['mountain', 'bush', 'lake']) {
  assert(observedTerrain.has(type),
    'stage 8 fixed seeds did not generate terrain type ' + type,
    { seeds, observedTerrain: Array.from(observedTerrain) });
}
assert(terrainLayouts.size >= 2,
  'stage 8 terrain layout should vary across deterministic seeds',
  { seeds, terrainLayouts: Array.from(terrainLayouts) });

async function runGameplaySmoke() {
  const smokeMap = api.generateEconomyStage8TrainingMap({ seed: 13242, suddenDeathRound: 14 });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 13242,
    roundLimit: 4,
    actionLimit: 3,
    commandLimit: 24
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(!smokeResult.crash, 'stage 8 short economy smoke crashed', smokeResult);
  assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
    'stage 8 short smoke did not run AIPlayerWithEconomy', smokeResult);
  assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'stage 8 short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
  assert(smokeResult.turnCount > 0,
    'stage 8 short smoke game did not advance with runtime players', smokeResult);

  console.log('Economy stage 8 map generation smoke passed');
}

runGameplaySmoke().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
