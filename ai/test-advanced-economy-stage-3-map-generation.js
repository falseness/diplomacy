const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

const ALLOWED_INCOMES = new Set([10, 25, 50, 100]);

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function key(coord) {
  return coord.x + ':' + coord.y;
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

function assertNoExtraGeneratedObjects(map, seed) {
  assert((map.lakes || []).length === 0,
    'advanced stage 3 should not generate lakes', { seed, lakes: map.lakes });
  assert((map.mountains || []).length === 0,
    'advanced stage 3 should not generate mountains', { seed, mountains: map.mountains });
  assert((map.bushes || []).length === 0,
    'advanced stage 3 should not generate bushes', { seed, bushes: map.bushes });

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
        'advanced stage 3 should not generate player ' + field,
        { seed, playerIndex, field, value: player[field] });
    }
  }
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 5 && map.mapSize.y === 5,
    'advanced stage 3 must be a 5x5 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'advanced stage 3 should include neutral plus two players', { seed });
  assert(map.advancedEconomyStage === 3,
    'advanced stage 3 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-3',
    'advanced stage 3 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });

  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'red player should use AIPlayerWithEconomy', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'blue player should use SimpleAiPlayerWithEconomy', { seed, playerType: map.players[2].playerType });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 3 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });

  const redTown = map.players[1].towns[0];
  const blueTown = map.players[2].towns[0];
  assert(redTown.y + blueTown.y === 4 && redTown.x === blueTown.x,
    'advanced stage 3 towns should remain vertically mirrored',
    { seed, redTown, blueTown });
  assert(map.players[1].gold === map.players[2].gold,
    'advanced stage 3 should not give either player extra starting gold',
    { seed, redGold: map.players[1].gold, blueGold: map.players[2].gold });

  assert((map.goldmines || []).length === 2,
    'advanced stage 3 should generate two mirrored goldmines',
    { seed, goldmines: map.goldmines });
  const occupied = new Map();
  for (const town of [redTown, blueTown]) {
    occupied.set(key(town), 'town');
  }
  for (const mine of map.goldmines) {
    assert(mine.x >= 0 && mine.y >= 0 && mine.x < 5 && mine.y < 5,
      'goldmine is outside the 5x5 map', { seed, mine });
    assert(!occupied.has(key(mine)),
      'goldmine overlaps ' + occupied.get(key(mine)), { seed, mine });
    occupied.set(key(mine), 'goldmine');
    assert(mine.owner === 0,
      'advanced stage 3 goldmines should be neutral for fair access', { seed, mine });
    assert(ALLOWED_INCOMES.has(mine.income),
      'goldmine income is not one of the allowed stage 3 values', { seed, mine });
  }

  const first = map.goldmines[0];
  const second = map.goldmines[1];
  assert(first.x === second.x && first.y + second.y === 4,
    'advanced stage 3 goldmines should be mirrored around the town axis',
    { seed, goldmines: map.goldmines });
  assert(first.income === second.income,
    'mirrored stage 3 goldmines should have equal income',
    { seed, goldmines: map.goldmines });

  assertNoExtraGeneratedObjects(map, seed);
  assert(map.economyObjects && map.economyObjects.towns === 2 &&
    map.economyObjects.units === 0 &&
    map.economyObjects.goldmines === 2 &&
    map.economyObjects.farms === 0 &&
    map.economyObjects.barracks === 0 &&
    map.economyObjects.towers === 0 &&
    map.economyObjects.bastions === 0,
    'advanced stage 3 economy object summary is incorrect',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage3TrainingMap: context.generateAdvancedEconomyStage3TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage3TrainingMap === 'function',
  'generateAdvancedEconomyStage3TrainingMap must be exported to the AI script context');

const observedIncomes = new Set();
const observedMineLanes = new Set();
for (let seed = 14000; seed < 14120; seed += 1) {
  const map = api.generateAdvancedEconomyStage3TrainingMap({ seed });
  validateMap(map, seed);
  observedIncomes.add(map.goldmines[0].income);
  observedMineLanes.add(map.economyGenerator.goldmineLane);

  const repeated = api.generateAdvancedEconomyStage3TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 3 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].towns.length === 1 && runtime.players[2].towns.length === 1,
    'advanced stage 3 headless runtime did not initialize both towns', { seed });
}

for (const income of ALLOWED_INCOMES) {
  assert(observedIncomes.has(income),
    'fixed seed sample did not observe required goldmine income ' + income,
    { observedIncomes: Array.from(observedIncomes) });
}
assert(observedMineLanes.size > 1,
  'advanced stage 3 fixed-seed sample did not exercise goldmine placement variation',
  { observedMineLanes: Array.from(observedMineLanes) });

const smokeMap = api.generateAdvancedEconomyStage3TrainingMap({
  seed: 14042,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 14042,
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

console.log('Advanced economy stage 3 goldmine map generation smoke passed');
