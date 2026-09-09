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
    goldmines: map.goldmines || [],
    lakes: map.lakes || [],
    mountains: map.mountains || []
  });
}

function assertInBounds(coord, mapSize, message, details) {
  assert(coord.x >= 0 && coord.x < mapSize.x && coord.y >= 0 && coord.y < mapSize.y,
    message, Object.assign({ coord, mapSize }, details || {}));
}

function validateNoOverlap(map, seed) {
  const terrain = new Set([
    ...(map.lakes || []).map(coordKey),
    ...(map.mountains || []).map(coordKey)
  ]);

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const occupiedBuildings = new Set([
      ...(player.towers || []).map(coordKey),
      ...(player.bastions || []).map(coordKey),
      ...(player.walls || []).map(coordKey),
      ...(player.barracks || []).map(coordKey),
      ...(player.farms || []).map(coordKey)
    ]);
    const occupiedUnits = new Set();

    for (const building of [...(player.towers || []), ...(player.bastions || [])]) {
      assertInBounds(building, map.mapSize,
        'stage 4 building is outside map bounds', { seed, playerIndex, building });
      assert(!terrain.has(coordKey(building)),
        'stage 4 building overlaps invalid terrain', { seed, playerIndex, building });
    }

    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 4 unit is outside map bounds', { seed, playerIndex, unit });
      assert(!terrain.has(coordKey(unit)),
        'stage 4 unit overlaps invalid terrain', { seed, playerIndex, unit });
      assert(!occupiedBuildings.has(coordKey(unit)),
        'stage 4 unit overlaps a building', { seed, playerIndex, unit });
      assert(!occupiedUnits.has(coordKey(unit)),
        'stage 4 units overlap each other', { seed, playerIndex, unit });
      occupiedUnits.add(coordKey(unit));
    }
  }
}

function validateStage4Map(map, stage3Map, seed) {
  assert(map.mapSize.x === 11 && map.mapSize.y === 9,
    'stage 4 map should keep the documented 11x9 stage-3 footprint', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 4 map should include neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'player 1 should be the learned economy AI', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'player 2 should be the simple economy baseline', { seed, playerType: map.players[2].playerType });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 4 && metadata && metadata.stage === 4,
    'stage 4 generator metadata is missing', { seed, economyStage: map.economyStage, metadata });
  assert(Array.isArray(metadata.buildingTypes) &&
    metadata.buildingTypes.includes('tower') &&
    metadata.buildingTypes.includes('bastion'),
    'stage 4 should include both tower and bastion metadata', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 4 HP bounds should be documented as 2-5', { seed, metadata });
  assert(metadata.hpByType.tower >= metadata.hpMin && metadata.hpByType.tower <= metadata.hpMax,
    'stage 4 randomized tower HP is outside the documented range', { seed, metadata });
  assert(metadata.hpByType.bastion >= metadata.hpMin && metadata.hpByType.bastion <= metadata.hpMax,
    'stage 4 randomized bastion HP is outside the documented range', { seed, metadata });
  assert(metadata.defensiveBuildingsPerPlayer > 1,
    'stage 4 should document multiple defensive buildings per player', { seed, metadata });

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const stage3Player = stage3Map.players[playerIndex];
    assert((player.units || []).length === (stage3Player.units || []).length,
      'stage 4 should preserve the stage 3 noob count', { seed, playerIndex });
    assert((player.units || []).every((unit) => unitTypeName(unit) === 'Noob'),
      'stage 4 should remain a noob-only unit setup', { seed, playerIndex, units: player.units });
    assert((player.towers || []).length === 1,
      'stage 4 player should have one tower', { seed, playerIndex, towers: player.towers });
    assert((player.bastions || []).length === 1,
      'stage 4 player should have one bastion', { seed, playerIndex, bastions: player.bastions });
    assert(player.towers[0].hp === metadata.hpByType.tower,
      'stage 4 tower HP should match metadata', { seed, playerIndex, tower: player.towers[0], metadata });
    assert(player.bastions[0].hp === metadata.hpByType.bastion,
      'stage 4 bastion HP should match metadata', { seed, playerIndex, bastion: player.bastions[0], metadata });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.gold === right.gold,
    'stage 4 sides should receive equal starting gold', { seed, left: left.gold, right: right.gold });
  assert(left.towns[0].x + right.towns[0].x === 10 && left.towns[0].y === right.towns[0].y,
    'stage 4 towns should be mirrored across the 11x9 map', { seed, left: left.towns, right: right.towns });
  assert(left.towers[0].x + right.towers[0].x === 10 && left.towers[0].y === right.towers[0].y,
    'stage 4 towers should be mirrored', { seed, left: left.towers, right: right.towers });
  assert(left.bastions[0].x + right.bastions[0].x === 10 && left.bastions[0].y === right.bastions[0].y,
    'stage 4 bastions should be mirrored', { seed, left: left.bastions, right: right.bastions });

  for (let i = 0; i < left.units.length; i += 1) {
    assert(left.units[i].x + right.units[i].x === 10 && left.units[i].y === right.units[i].y,
      'stage 4 noob placements should be mirrored by index',
      { seed, index: i, left: left.units[i], right: right.units[i] });
  }

  assert(map.economyObjects.noobs === left.units.length + right.units.length,
    'stage 4 economy object summary should record noob totals',
    { seed, economyObjects: map.economyObjects });
  assert(map.economyObjects.towers === 2 && map.economyObjects.bastions === 2,
    'stage 4 economy object summary should record two towers and two bastions',
    { seed, economyObjects: map.economyObjects });
  validateNoOverlap(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage3TrainingMap: context.generateEconomyStage3TrainingMap,
  generateEconomyStage4TrainingMap: context.generateEconomyStage4TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage3TrainingMap === 'function',
  'generateEconomyStage3TrainingMap must remain exported for comparison');
assert(typeof api.generateEconomyStage4TrainingMap === 'function',
  'generateEconomyStage4TrainingMap must be exported independently');

const stage3 = api.generateEconomyStage3TrainingMap({ seed: 12400 });
const seeds = [12400, 12401, 12402, 12403, 12404, 12405, 12406, 12407];
const hpPairs = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage4TrainingMap({ seed });
  validateStage4Map(map, stage3, seed);
  hpPairs.add(map.economyGenerator.hpByType.tower + ':' + map.economyGenerator.hpByType.bastion);

  const repeated = api.generateEconomyStage4TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 4 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].towers.length === 1 && runtime.players[1].bastions.length === 1,
    'stage 4 headless runtime did not create player 1 tower and bastion');
  assert(runtime.players[2].towers.length === 1 && runtime.players[2].bastions.length === 1,
    'stage 4 headless runtime did not create player 2 tower and bastion');
  assert(runtime.players[1].towers[0].building.hp === map.economyGenerator.hpByType.tower,
    'stage 4 runtime tower HP did not match metadata');
  assert(runtime.players[1].bastions[0].building.hp === map.economyGenerator.hpByType.bastion,
    'stage 4 runtime bastion HP did not match metadata');
  map.advanceTurns(1);
  assert(runtime.turn === 1, 'stage 4 headless runtime did not advance');
}

assert(hpPairs.size >= 2,
  'stage 4 tower/bastion HP pairs did not vary across fixed seeds',
  { seeds, hpPairs: Array.from(hpPairs) });

async function runGameplaySmoke() {
  const smokeMap = api.generateEconomyStage4TrainingMap({ seed: 12442, suddenDeathRound: 14 });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 12442,
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

  console.log('Economy stage 4 map generation smoke passed');
}

runGameplaySmoke().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
