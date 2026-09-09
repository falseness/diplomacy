const { loadAiScripts } = require('./smokeHarness');
const { runCheckpointSmoke } = require('./tests/checkpoint-smoke.cjs');

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
    'advanced stage 1 should not generate goldmines', { seed, goldmines: map.goldmines });
  assert((map.lakes || []).length === 0,
    'advanced stage 1 should not generate lakes', { seed, lakes: map.lakes });
  assert((map.mountains || []).length === 0,
    'advanced stage 1 should not generate mountains', { seed, mountains: map.mountains });
  assert((map.bushes || []).length === 0,
    'advanced stage 1 should not generate bushes', { seed, bushes: map.bushes });

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
        'advanced stage 1 should not generate player ' + field,
        { seed, playerIndex, field, value: player[field] });
    }
  }
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 3 && map.mapSize.y === 3,
    'advanced stage 1 must be a 3x3 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'advanced stage 1 should include neutral plus two players', { seed });
  assert(map.advancedEconomyStage === 1,
    'advanced stage 1 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-1',
    'advanced stage 1 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.emptyMap === true,
    'advanced stage 1 metadata should identify the empty map', { seed, economyGenerator: map.economyGenerator });

  assert((map.players[0].towns || []).length === 0,
    'neutral player should not have towns', { seed });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'red player should use AIPlayerWithEconomy', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'blue player should use SimpleAiPlayerWithEconomy', { seed, playerType: map.players[2].playerType });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 1 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });

  const redTown = map.players[1].towns[0];
  const blueTown = map.players[2].towns[0];
  assert(redTown.x >= 0 && redTown.y >= 0 && redTown.x < 3 && redTown.y < 3,
    'red town is outside the 3x3 map', { seed, redTown });
  assert(blueTown.x >= 0 && blueTown.y >= 0 && blueTown.x < 3 && blueTown.y < 3,
    'blue town is outside the 3x3 map', { seed, blueTown });
  assert(!(redTown.x === blueTown.x && redTown.y === blueTown.y),
    'red and blue towns overlap', { seed, redTown, blueTown });

  const mirroredHorizontally = redTown.x + blueTown.x === 2 && redTown.y === blueTown.y;
  const mirroredVertically = redTown.y + blueTown.y === 2 && redTown.x === blueTown.x;
  assert(mirroredHorizontally || mirroredVertically,
    'advanced stage 1 towns should be mirrored for fair placement',
    { seed, redTown, blueTown });
  assert(map.players[1].gold === map.players[2].gold,
    'advanced stage 1 should not give either player extra starting gold',
    { seed, redGold: map.players[1].gold, blueGold: map.players[2].gold });

  assertNoGeneratedObjects(map, seed);
  assert(map.economyObjects && map.economyObjects.towns === 2 &&
    map.economyObjects.units === 0 &&
    map.economyObjects.goldmines === 0 &&
    map.economyObjects.farms === 0 &&
    map.economyObjects.barracks === 0 &&
    map.economyObjects.towers === 0 &&
    map.economyObjects.bastions === 0,
    'advanced stage 1 economy object summary is incorrect',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage1TrainingMap: context.generateAdvancedEconomyStage1TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage1TrainingMap === 'function',
  'generateAdvancedEconomyStage1TrainingMap must be exported to the AI script context');

for (let seed = 13800; seed < 13824; seed += 1) {
  const map = api.generateAdvancedEconomyStage1TrainingMap({ seed });
  validateMap(map, seed);

  const repeated = api.generateAdvancedEconomyStage1TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 1 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].towns.length === 1 && runtime.players[2].towns.length === 1,
    'advanced stage 1 headless runtime did not initialize both towns', { seed });
}

async function runGameplaySmoke() {
  const smokeMap = api.generateAdvancedEconomyStage1TrainingMap({
    seed: 13842,
    suddenDeathRound: 12
  });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 13842,
    roundLimit: 1,
    actionLimit: 1,
    commandLimit: 5
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
    'short smoke did not run AIPlayerWithEconomy', smokeResult);
  assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
  assert(!smokeResult.crash,
    'short AIPlayerWithEconomy-vs-SimpleAiPlayerWithEconomy smoke crashed', smokeResult);

  console.log('Advanced economy stage 1 3x3 town-only map generation smoke passed');
}

runGameplaySmoke().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
