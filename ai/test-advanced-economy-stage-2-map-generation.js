const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function normalizeMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    economyStage: map.economyStage,
    advancedEconomyStage: map.advancedEconomyStage,
    economyGenerator: map.economyGenerator,
    economyObjects: map.economyObjects,
    players: map.players.map((player) => ({
      playerType: player.playerType,
      gold: player.gold,
      towns: player.towns || [],
      units: player.units || [],
      suburbs: player.suburbs || [],
      farms: player.farms || [],
      barracks: player.barracks || [],
      towers: player.towers || [],
      bastions: player.bastions || [],
      walls: player.walls || []
    })),
    goldmines: map.goldmines || [],
    lakes: map.lakes || [],
    mountains: map.mountains || [],
    bushes: map.bushes || []
  });
}

function objectCount(player, field) {
  return (player[field] || []).length;
}

function assertNoGeneratedObjects(map, seed) {
  assert((map.goldmines || []).length === 0,
    'advanced stage 2 should not generate goldmines', { seed, goldmines: map.goldmines });
  assert((map.lakes || []).length === 0,
    'advanced stage 2 should not generate lakes', { seed, lakes: map.lakes });
  assert((map.mountains || []).length === 0,
    'advanced stage 2 should not generate mountains', { seed, mountains: map.mountains });
  assert((map.bushes || []).length === 0,
    'advanced stage 2 should not generate bushes', { seed, bushes: map.bushes });

  for (let playerIndex = 0; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const field of [
      'units',
      'suburbs',
      'farms',
      'pendingFarms',
      'barracks',
      'pendingBarracks',
      'towers',
      'bastions',
      'walls'
    ]) {
      assert(objectCount(player, field) === 0,
        'advanced stage 2 should not generate player ' + field,
        { seed, playerIndex, field, value: player[field] });
    }
  }
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 5 && map.mapSize.y === 5,
    'advanced stage 2 must be a 5x5 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'advanced stage 2 should include neutral plus two players', { seed });
  assert(map.advancedEconomyStage === 2,
    'advanced stage 2 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-2',
    'advanced stage 2 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.emptyMap === true,
    'advanced stage 2 metadata should identify the empty map', { seed, economyGenerator: map.economyGenerator });

  assert((map.players[0].towns || []).length === 0,
    'neutral player should not have towns', { seed });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'red player should use AIPlayerWithEconomy', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'blue player should use SimpleAiPlayerWithEconomy', { seed, playerType: map.players[2].playerType });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 2 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });

  const redTown = map.players[1].towns[0];
  const blueTown = map.players[2].towns[0];
  assert(redTown.x >= 0 && redTown.y >= 0 && redTown.x < 5 && redTown.y < 5,
    'red town is outside the 5x5 map', { seed, redTown });
  assert(blueTown.x >= 0 && blueTown.y >= 0 && blueTown.x < 5 && blueTown.y < 5,
    'blue town is outside the 5x5 map', { seed, blueTown });
  assert(!(redTown.x === blueTown.x && redTown.y === blueTown.y),
    'red and blue towns overlap', { seed, redTown, blueTown });

  const mirroredHorizontally = redTown.x + blueTown.x === 4 && redTown.y === blueTown.y;
  const mirroredVertically = redTown.y + blueTown.y === 4 && redTown.x === blueTown.x;
  assert(mirroredHorizontally || mirroredVertically,
    'advanced stage 2 towns should be mirrored for fair placement',
    { seed, redTown, blueTown });
  assert(map.players[1].gold === map.players[2].gold,
    'advanced stage 2 should not give either player extra starting gold',
    { seed, redGold: map.players[1].gold, blueGold: map.players[2].gold });

  assertNoGeneratedObjects(map, seed);
  assert(map.economyObjects && map.economyObjects.towns === 2 &&
    map.economyObjects.units === 0 &&
    map.economyObjects.goldmines === 0 &&
    map.economyObjects.farms === 0 &&
    map.economyObjects.barracks === 0 &&
    map.economyObjects.towers === 0 &&
    map.economyObjects.bastions === 0,
    'advanced stage 2 economy object summary is incorrect',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage2TrainingMap: context.generateAdvancedEconomyStage2TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage2TrainingMap === 'function',
  'generateAdvancedEconomyStage2TrainingMap must be exported to the AI script context');

const observedLayouts = new Set();
for (let seed = 13900; seed < 13932; seed += 1) {
  const map = api.generateAdvancedEconomyStage2TrainingMap({ seed });
  validateMap(map, seed);
  observedLayouts.add(map.economyGenerator.townLayout + ':' + map.economyGenerator.townLane);

  const repeated = api.generateAdvancedEconomyStage2TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 2 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].towns.length === 1 && runtime.players[2].towns.length === 1,
    'advanced stage 2 headless runtime did not initialize both towns', { seed });
}

assert(observedLayouts.size > 1,
  'advanced stage 2 fixed-seed sample did not exercise seeded layout variation',
  { observedLayouts: Array.from(observedLayouts) });

const smokeMap = api.generateAdvancedEconomyStage2TrainingMap({
  seed: 13942,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 13942,
  roundLimit: 1,
  actionLimit: 1,
  commandLimit: 5
});

assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
  'short smoke did not run AIPlayerWithEconomy', smokeResult);
assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
  'short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
assert(!smokeResult.crash,
  'short AIPlayerWithEconomy-vs-SimpleAiPlayerWithEconomy smoke crashed', smokeResult);

console.log('Advanced economy stage 2 5x5 town-only map generation smoke passed');
