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

function selectedBuildings(player, buildingType) {
  return buildingType === 'tower' ? (player.towers || []) : (player.bastions || []);
}

function unselectedBuildings(player, buildingType) {
  return buildingType === 'tower' ? (player.bastions || []) : (player.towers || []);
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

    for (const unit of player.units || []) {
      assertInBounds(unit, map.mapSize,
        'stage 3 unit is outside map bounds', { seed, playerIndex, unit });
      assert(!terrain.has(coordKey(unit)),
        'stage 3 unit overlaps invalid terrain', { seed, playerIndex, unit });
      assert(!occupiedBuildings.has(coordKey(unit)),
        'stage 3 unit overlaps a building', { seed, playerIndex, unit });
      assert(!occupiedUnits.has(coordKey(unit)),
        'stage 3 units overlap each other', { seed, playerIndex, unit });
      occupiedUnits.add(coordKey(unit));
    }

    for (const building of selectedBuildings(player, map.economyGenerator.buildingType)) {
      assertInBounds(building, map.mapSize,
        'stage 3 building is outside map bounds', { seed, playerIndex, building });
      assert(!terrain.has(coordKey(building)),
        'stage 3 building overlaps invalid terrain', { seed, playerIndex, building });
    }
  }
}

function validateStage3Map(map, stage2Map, seed) {
  assert(map.mapSize.x === 11 && map.mapSize.y === 9,
    'stage 3 map should use the documented 11x9 size', { seed, mapSize: map.mapSize });
  assert(map.mapSize.x > stage2Map.mapSize.x && map.mapSize.y > stage2Map.mapSize.y,
    'stage 3 map should be bigger than stage 2', {
      seed,
      stage2: stage2Map.mapSize,
      stage3: map.mapSize
    });
  assert(map.players.length === 3,
    'stage 3 map should include neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'player 1 should be the learned economy AI', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'player 2 should be the simple economy baseline', { seed, playerType: map.players[2].playerType });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 3 && metadata && metadata.stage === 3,
    'stage 3 generator metadata is missing', { seed, economyStage: map.economyStage, metadata });
  assert(['tower', 'bastion'].includes(metadata.buildingType),
    'stage 3 should select only tower or bastion', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 3 HP bounds should remain documented as 2-5', { seed, metadata });
  assert(metadata.hp >= metadata.hpMin && metadata.hp <= metadata.hpMax,
    'stage 3 randomized HP is outside the documented range', { seed, metadata });

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const stage2Player = stage2Map.players[playerIndex];
    assert((player.towns || []).length === 1,
      'stage 3 player should have exactly one town', { seed, playerIndex });
    assert((player.units || []).length > (stage2Player.units || []).length,
      'stage 3 should increase noob count compared with stage 2',
      { seed, playerIndex, stage2Units: stage2Player.units, stage3Units: player.units });
    assert((player.units || []).length === metadata.noobsPerPlayer &&
      player.units.every((unit) => unitTypeName(unit) === 'Noob'),
      'stage 3 player should have the documented noob-only force',
      { seed, playerIndex, units: player.units, metadata });
    assert((player.suburbs || []).length === 1 && player.suburbs[0].cells.length > 7,
      'stage 3 player should have expanded economy suburb access', { seed, playerIndex });

    const intended = selectedBuildings(player, metadata.buildingType);
    const unintended = unselectedBuildings(player, metadata.buildingType);
    assert(intended.length === 1,
      'stage 3 player should have one selected defensive building',
      { seed, playerIndex, buildingType: metadata.buildingType, intended });
    assert(unintended.length === 0,
      'stage 3 player should not have the unselected defensive building type',
      { seed, playerIndex, buildingType: metadata.buildingType, unintended });
    assert(intended[0].hp === metadata.hp,
      'stage 3 building HP should match generator metadata',
      { seed, playerIndex, building: intended[0], metadata });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.units.length === right.units.length,
    'stage 3 sides should receive equal noob counts', { seed, left: left.units, right: right.units });
  assert(left.gold === right.gold,
    'stage 3 sides should receive equal starting gold', { seed, left: left.gold, right: right.gold });
  assert(left.towns[0].x + right.towns[0].x === 10 && left.towns[0].y === right.towns[0].y,
    'stage 3 towns should be mirrored across the 11x9 map', { seed, left: left.towns, right: right.towns });
  assert(selectedBuildings(left, metadata.buildingType)[0].x +
    selectedBuildings(right, metadata.buildingType)[0].x === 10,
    'stage 3 defensive buildings should be mirrored', { seed });

  for (let i = 0; i < left.units.length; i += 1) {
    assert(left.units[i].x + right.units[i].x === 10 && left.units[i].y === right.units[i].y,
      'stage 3 noob placements should be mirrored by index',
      { seed, index: i, left: left.units[i], right: right.units[i] });
  }

  assert(map.economyObjects.noobs === left.units.length + right.units.length,
    'stage 3 economy object summary should record noob totals',
    { seed, economyObjects: map.economyObjects });
  assert(map.economyObjects.towers + map.economyObjects.bastions === 2,
    'stage 3 economy object summary should record exactly two defensive buildings',
    { seed, economyObjects: map.economyObjects });
  validateNoOverlap(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage2TrainingMap: context.generateEconomyStage2TrainingMap,
  generateEconomyStage3TrainingMap: context.generateEconomyStage3TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage2TrainingMap === 'function',
  'generateEconomyStage2TrainingMap must remain exported for comparison');
assert(typeof api.generateEconomyStage3TrainingMap === 'function',
  'generateEconomyStage3TrainingMap must be exported independently');

const stage2 = api.generateEconomyStage2TrainingMap({ seed: 12200 });
const seeds = [12200, 12201, 12202, 12203, 12204, 12205, 12206, 12207];
const hpValues = new Set();
const buildingTypes = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage3TrainingMap({ seed });
  validateStage3Map(map, stage2, seed);
  hpValues.add(map.economyGenerator.hp);
  buildingTypes.add(map.economyGenerator.buildingType);

  const repeated = api.generateEconomyStage3TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 3 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].units.length === map.players[1].units.length + 1,
    'stage 3 headless runtime did not create player 1 configured noobs plus town unit');
  assert(runtime.players[2].units.length === map.players[2].units.length + 1,
    'stage 3 headless runtime did not create player 2 configured noobs plus town unit');
  assert(runtime.players[1].towers.length + runtime.players[1].bastions.length === 1,
    'stage 3 headless runtime did not create player 1 building');
  assert(runtime.players[2].towers.length + runtime.players[2].bastions.length === 1,
    'stage 3 headless runtime did not create player 2 building');
  map.advanceTurns(1);
  assert(runtime.turn === 1, 'stage 3 headless runtime did not advance');
}

assert(hpValues.size >= 2,
  'stage 3 tower/bastion HP did not vary across fixed seeds',
  { seeds, hpValues: Array.from(hpValues) });
assert(buildingTypes.has('tower') && buildingTypes.has('bastion'),
  'stage 3 should produce both tower and bastion variants across fixed seeds',
  { seeds, buildingTypes: Array.from(buildingTypes) });

const smokeMap = api.generateEconomyStage3TrainingMap({ seed: 12242, suddenDeathRound: 14 });
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 12242,
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

console.log('Economy stage 3 map generation smoke passed');
