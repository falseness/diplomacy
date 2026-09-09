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
      towers: player.towers || [],
      bastions: player.bastions || []
    })),
    lakes: map.lakes || [],
    mountains: map.mountains || [],
    bushes: map.bushes || []
  });
}

function terrainEntries(map) {
  return []
    .concat((map.mountains || []).map((coord) => ({ type: 'mountain', coord })))
    .concat((map.bushes || []).map((coord) => ({ type: 'bush', coord })))
    .concat((map.lakes || []).map((coord) => ({ type: 'lake', coord })));
}

function mirrorCoord(coord, mapSize) {
  return { x: mapSize.x - 1 - coord.x, y: coord.y };
}

function assertInBounds(coord, mapSize, message, details) {
  assert(coord.x >= 0 && coord.x < mapSize.x && coord.y >= 0 && coord.y < mapSize.y,
    message, Object.assign({ coord, mapSize }, details || {}));
}

function assertMirrored(left, right, mapSize, message, details) {
  assert(left.x + right.x === mapSize.x - 1 && left.y === right.y,
    message, Object.assign({ left, right, mapSize }, details || {}));
}

function assertEqualTerrainFairness(map, seed) {
  const byType = {
    mountain: new Set((map.mountains || []).map(coordKey)),
    bush: new Set((map.bushes || []).map(coordKey)),
    lake: new Set((map.lakes || []).map(coordKey))
  };

  for (const entry of terrainEntries(map)) {
    const mirrored = mirrorCoord(entry.coord, map.mapSize);
    assert(byType[entry.type].has(coordKey(mirrored)) ||
        entry.coord.x === Math.floor(map.mapSize.x / 2),
      'stage 8 validation terrain is not mirrored or centered fairly',
      { seed, entry, mirrored, terrain: terrainEntries(map) });
  }

  const leftTown = map.players[1].towns[0];
  const rightTown = map.players[2].towns[0];
  assertMirrored(leftTown, rightTown, map.mapSize,
    'stage 8 validation towns should remain mirrored', { seed });
  for (let index = 0; index < map.players[1].units.length; index += 1) {
    assert(unitTypeName(map.players[1].units[index]) === unitTypeName(map.players[2].units[index]),
      'stage 8 validation mirrored unit types should match by index', { seed, index });
    assertMirrored(map.players[1].units[index], map.players[2].units[index], map.mapSize,
      'stage 8 validation unit placements should remain mirrored by index', { seed, index });
  }
}

function assertNoOverlap(map, seed) {
  const occupied = new Map();
  for (const entry of terrainEntries(map)) {
    assertInBounds(entry.coord, map.mapSize,
      'stage 8 validation terrain is outside map bounds', { seed, entry });
    const key = coordKey(entry.coord);
    assert(!occupied.has(key),
      'stage 8 validation terrain overlaps ' + occupied.get(key), { seed, entry });
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
        'stage 8 validation building is outside map bounds', { seed, playerIndex, building });
      const key = coordKey(building);
      assert(!occupied.has(key),
        'stage 8 validation building overlaps ' + occupied.get(key),
        { seed, playerIndex, building });
      occupied.set(key, 'building');
    }

    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 8 validation unit is outside map bounds', { seed, playerIndex, unit });
      const key = coordKey(unit);
      assert(!occupied.has(key),
        'stage 8 validation unit overlaps ' + occupied.get(key),
        { seed, playerIndex, unit });
      occupied.set(key, 'unit');
    }
  }
}

function shortestPassableDistance(map, start, target) {
  const blocked = new Set(terrainEntries(map).map((entry) => coordKey(entry.coord)));
  const neighbours = [
    {x: -1, y: 0},
    {x: 1, y: 0},
    {x: 0, y: -1},
    {x: 0, y: 1},
    {x: -1, y: 1},
    {x: 1, y: -1}
  ];
  const queue = [{ coord: start, distance: 0 }];
  const seen = new Set([coordKey(start)]);

  while (queue.length) {
    const current = queue.shift();
    if (coordKey(current.coord) === coordKey(target)) {
      return current.distance;
    }
    for (const offset of neighbours) {
      const next = { x: current.coord.x + offset.x, y: current.coord.y + offset.y };
      const key = coordKey(next);
      if (next.x < 0 || next.y < 0 ||
          next.x >= map.mapSize.x || next.y >= map.mapSize.y ||
          blocked.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      queue.push({ coord: next, distance: current.distance + 1 });
    }
  }
  return Infinity;
}

function assertReachability(map, seed) {
  const leftTown = map.players[1].towns[0];
  const rightTown = map.players[2].towns[0];
  const leftDistance = shortestPassableDistance(map, leftTown, rightTown);
  const rightDistance = shortestPassableDistance(map, rightTown, leftTown);
  assert(Number.isFinite(leftDistance) && Number.isFinite(rightDistance),
    'stage 8 validation terrain makes towns unreachable',
    { seed, leftTown, rightTown, terrain: terrainEntries(map) });
  assert(leftDistance === rightDistance,
    'stage 8 validation terrain pathing is not fair between sides',
    { seed, leftDistance, rightDistance, terrain: terrainEntries(map) });

  for (const playerIndex of [1, 2]) {
    for (const unit of map.players[playerIndex].units || []) {
      const homeDistance = shortestPassableDistance(map, unit, map.players[playerIndex].towns[0]);
      const enemyDistance = shortestPassableDistance(map, unit, map.players[playerIndex === 1 ? 2 : 1].towns[0]);
      assert(Number.isFinite(homeDistance) && Number.isFinite(enemyDistance),
        'stage 8 validation terrain isolates a required unit from objectives',
        { seed, playerIndex, unit, homeDistance, enemyDistance, terrain: terrainEntries(map) });
    }
  }
}

function assertStage7Coverage(map, seed) {
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'stage 8 validation should preserve stage 7 9v9 dimensions', { seed, mapSize: map.mapSize });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy' &&
      map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 8 validation should preserve economy player setup', { seed, players: map.players });

  const expectedUnitTypes = ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'];
  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    const observed = new Set((player.units || []).map(unitTypeName));
    for (const type of expectedUnitTypes) {
      assert(observed.has(type),
        'stage 8 validation is missing stage 7 unit type ' + type,
        { seed, playerIndex, units: player.units });
    }
    assert((player.towers || []).length === 1 && (player.bastions || []).length === 1,
      'stage 8 validation should preserve stage 7 tower and bastion coverage',
      { seed, playerIndex, towers: player.towers, bastions: player.bastions });
  }

  assert(map.economyObjects.noobs === 2 &&
      map.economyObjects.archers === 2 &&
      map.economyObjects.KOHbs === 2 &&
      map.economyObjects.normchels === 2 &&
      map.economyObjects.catapults === 2 &&
      map.economyObjects.towers === 2 &&
      map.economyObjects.bastions === 2,
    'stage 8 validation should preserve stage 7 economy object counts',
    { seed, economyObjects: map.economyObjects });
}

function validateStage8Map(map, seed) {
  assert(map.economyStage === 8 && map.economyGenerator && map.economyGenerator.stage === 8,
    'stage 8 validation requires stage 8 metadata', { seed, metadata: map.economyGenerator });
  assert((map.mountains || []).length === 2 &&
      (map.bushes || []).length === 2 &&
      (map.lakes || []).length === 1,
    'stage 8 validation expected mountains, bushes, and lakes', { seed, map });
  assert(Array.isArray(map.economyGenerator.terrainTypes) &&
      map.economyGenerator.terrainTypes.includes('mountain') &&
      map.economyGenerator.terrainTypes.includes('bush') &&
      map.economyGenerator.terrainTypes.includes('lake'),
    'stage 8 validation metadata should list every terrain type',
    { seed, metadata: map.economyGenerator });

  assertStage7Coverage(map, seed);
  assertEqualTerrainFairness(map, seed);
  assertNoOverlap(map, seed);
  assertReachability(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage8TrainingMap: context.generateEconomyStage8TrainingMap
};`)(context);

async function main() {
  assert(typeof api.generateEconomyStage8TrainingMap === 'function',
    'generateEconomyStage8TrainingMap must be exported');

  const seeds = [
    13300, 13301, 13302, 13303, 13304, 13305, 13306, 13307,
    13308, 13309, 13310, 13311, 13312, 13313, 13314, 13315,
    13316, 13317, 13318, 13319, 13320, 13321, 13322, 13323
  ];
  const observedTerrain = new Set();
  const terrainLayouts = new Set();

  for (const seed of seeds) {
    const map = api.generateEconomyStage8TrainingMap({ seed });
    validateStage8Map(map, seed);
    for (const entry of terrainEntries(map)) {
      observedTerrain.add(entry.type);
    }
    terrainLayouts.add(JSON.stringify({
      mountains: map.mountains,
      bushes: map.bushes,
      lakes: map.lakes
    }));

    const repeated = api.generateEconomyStage8TrainingMap({ seed });
    assert(normalizedMap(map) === normalizedMap(repeated),
      'stage 8 validation expected deterministic replay for seed ' + seed);
  }

  for (const type of ['mountain', 'bush', 'lake']) {
    assert(observedTerrain.has(type),
      'stage 8 validation seed set did not cover terrain type ' + type,
      { seeds, observedTerrain: Array.from(observedTerrain) });
  }
  assert(terrainLayouts.size >= 2,
    'stage 8 validation should cover multiple deterministic terrain layouts',
    { seeds, terrainLayouts: Array.from(terrainLayouts) });

  const smokeMap = api.generateEconomyStage8TrainingMap({ seed: 13342, suddenDeathRound: 14 });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 13342,
    roundLimit: 4,
    actionLimit: 3,
    commandLimit: 24
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(!smokeResult.crash, 'stage 8 validation benchmark initialization crashed', smokeResult);
  assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
    'stage 8 validation benchmark did not run AIPlayerWithEconomy', smokeResult);
  assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'stage 8 validation benchmark did not run SimpleAiPlayerWithEconomy', smokeResult);
  assert(smokeResult.turnCount > 0,
    'stage 8 validation benchmark did not advance a runtime game', smokeResult);

  console.log('Economy stage 8 validation test passed for ' + seeds.length + ' deterministic seeds');

}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
