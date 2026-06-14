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

function validateStage2Map(map, seed) {
  assert(map.mapSize.x === 9 && map.mapSize.y === 7,
    'stage 2 map should be the expected 9x7 size', { seed, mapSize: map.mapSize });
  assert(map.mapSize.x > 7 && map.mapSize.y > 5,
    'stage 2 map should be bigger than stage 1', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 2 map should include neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'player 1 should be the learned economy AI', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'player 2 should be the simple economy baseline', { seed, playerType: map.players[2].playerType });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 2 && metadata && metadata.stage === 2,
    'stage 2 generator metadata is missing', { seed, economyStage: map.economyStage, metadata });
  assert(['tower', 'bastion'].includes(metadata.buildingType),
    'stage 2 should select only tower or bastion', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 2 HP bounds should remain documented as 2-5', { seed, metadata });
  assert(metadata.hp >= metadata.hpMin && metadata.hp <= metadata.hpMax,
    'stage 2 randomized HP is outside the documented range', { seed, metadata });

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert((player.towns || []).length === 1,
      'stage 2 player should have exactly one town', { seed, playerIndex });
    assert((player.units || []).length === 2 &&
      player.units.every((unit) => unitTypeName(unit) === 'Noob'),
      'stage 2 player should keep the 1v1 noob economy setup',
      { seed, playerIndex, units: player.units });
    assert((player.suburbs || []).length === 1 && player.suburbs[0].cells.length >= 7,
      'stage 2 player should have larger economy suburb access', { seed, playerIndex });

    const intended = selectedBuildings(player, metadata.buildingType);
    const unintended = unselectedBuildings(player, metadata.buildingType);
    assert(intended.length === 1,
      'stage 2 player should have one selected defensive building',
      { seed, playerIndex, buildingType: metadata.buildingType, intended });
    assert(unintended.length === 0,
      'stage 2 player should not have the unselected defensive building type',
      { seed, playerIndex, buildingType: metadata.buildingType, unintended });
    assert(intended[0].hp === metadata.hp,
      'stage 2 building HP should match generator metadata',
      { seed, playerIndex, building: intended[0], metadata });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.towns[0].x + right.towns[0].x === 8 && left.towns[0].y === right.towns[0].y,
    'stage 2 towns should be mirrored across the 9x7 map', { seed, left: left.towns, right: right.towns });
  assert(selectedBuildings(left, metadata.buildingType)[0].x +
    selectedBuildings(right, metadata.buildingType)[0].x === 8,
    'stage 2 defensive buildings should be mirrored', { seed });
  assert(map.economyObjects.towers + map.economyObjects.bastions === 2,
    'stage 2 economy object summary should record exactly two defensive buildings',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage1TrainingMap: context.generateEconomyStage1TrainingMap,
  generateEconomyStage2TrainingMap: context.generateEconomyStage2TrainingMap
};`)(context);

assert(typeof api.generateEconomyStage1TrainingMap === 'function',
  'generateEconomyStage1TrainingMap must remain exported for comparison');
assert(typeof api.generateEconomyStage2TrainingMap === 'function',
  'generateEconomyStage2TrainingMap must be exported independently');

const stage1 = api.generateEconomyStage1TrainingMap({ seed: 12000 });
const seeds = [12000, 12001, 12002, 12003, 12004, 12005, 12006, 12007];
const hpValues = new Set();
const buildingTypes = new Set();

for (const seed of seeds) {
  const map = api.generateEconomyStage2TrainingMap({ seed });
  validateStage2Map(map, seed);
  assert(map.mapSize.x > stage1.mapSize.x && map.mapSize.y > stage1.mapSize.y,
    'stage 2 dimensions should be larger than generated stage 1 dimensions',
    { seed, stage1: stage1.mapSize, stage2: map.mapSize });
  hpValues.add(map.economyGenerator.hp);
  buildingTypes.add(map.economyGenerator.buildingType);

  const repeated = api.generateEconomyStage2TrainingMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'stage 2 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].towers.length + runtime.players[1].bastions.length === 1,
    'stage 2 headless runtime did not create player 1 building');
  assert(runtime.players[2].towers.length + runtime.players[2].bastions.length === 1,
    'stage 2 headless runtime did not create player 2 building');
  map.advanceTurns(1);
  assert(runtime.turn === 1, 'stage 2 headless runtime did not advance');
}

assert(hpValues.size >= 2,
  'stage 2 tower/bastion HP did not vary across fixed seeds',
  { seeds, hpValues: Array.from(hpValues) });
assert(buildingTypes.has('tower') && buildingTypes.has('bastion'),
  'stage 2 should produce both tower and bastion variants across fixed seeds',
  { seeds, buildingTypes: Array.from(buildingTypes) });

const smokeMap = api.generateEconomyStage2TrainingMap({ seed: 12042, suddenDeathRound: 12 });
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 12042,
  roundLimit: 4,
  actionLimit: 3,
  commandLimit: 20
});

assert(!smokeResult.crash, 'short economy smoke crashed', smokeResult);
assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
  'short smoke did not run AIPlayerWithEconomy', smokeResult);
assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
  'short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
assert(smokeResult.turnCount > 0,
  'short smoke game did not advance with runtime players', smokeResult);

console.log('Economy stage 2 map generation smoke passed');
