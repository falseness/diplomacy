const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function key(coord) {
  return coord.x + ':' + coord.y;
}

function distance(a, b) {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs((a.x - b.x) + (a.y - b.y)));
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

function assertNoInvalidObjects(map, seed) {
  assert((map.goldmines || []).length === 0,
    'advanced stage 4 should not generate goldmines', { seed, goldmines: map.goldmines });
  assert((map.lakes || []).length === 0,
    'advanced stage 4 should not generate lakes', { seed, lakes: map.lakes });
  assert((map.mountains || []).length === 0,
    'advanced stage 4 should not generate mountains', { seed, mountains: map.mountains });
  assert((map.bushes || []).length === 0,
    'advanced stage 4 should not generate bushes', { seed, bushes: map.bushes });

  for (let playerIndex = 0; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const field of [
      'units',
      'farms',
      'pendingFarms',
      'barracks',
      'pendingBarracks',
      'towers',
      'bastions',
      'walls'
    ]) {
      assert(objectCount(player, field) === 0,
        'advanced stage 4 should not generate player ' + field,
        { seed, playerIndex, field, value: player[field] });
    }
  }
}

function validateSuburbs(map, seed) {
  const claimed = new Map();
  const townKeys = new Set();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    for (const town of map.players[playerIndex].towns) {
      townKeys.add(key(town));
    }
  }

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.suburbs.length === 1,
      'advanced stage 4 should configure one suburb layout per player', { seed, playerIndex });
    const layout = player.suburbs[0];
    const town = player.towns[0];
    assert(key(layout.town) === key(town),
      'advanced stage 4 suburb layout references the wrong town', { seed, playerIndex, layout });
    assert(layout.cells.length >= 2,
      'advanced stage 4 should capture at least one suburb cell per player',
      { seed, playerIndex, cells: layout.cells });

    const connected = {};
    connected[key(town)] = true;
    for (const cell of layout.cells) {
      assert(cell.x >= 0 && cell.y >= 0 && cell.x < 5 && cell.y < 5,
        'advanced stage 4 suburb cell is outside the map', { seed, playerIndex, cell });
      assert(!claimed.has(key(cell)) || key(cell) === key(town),
        'advanced stage 4 suburb cell is claimed by multiple players',
        { seed, playerIndex, cell, claimedBy: claimed.get(key(cell)) });
      claimed.set(key(cell), playerIndex);
      if (key(cell) !== key(town)) {
        assert(!townKeys.has(key(cell)),
          'advanced stage 4 captured suburb overlaps a town', { seed, playerIndex, cell });
        assert(layout.cells.some((other) =>
          connected[key(other)] && distance(other, cell) === 1),
        'advanced stage 4 captured suburb is disconnected from its town',
        { seed, playerIndex, cell, layout });
      }
      connected[key(cell)] = true;
    }
  }
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 5 && map.mapSize.y === 5,
    'advanced stage 4 must be a 5x5 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'advanced stage 4 should include neutral plus two players', { seed });
  assert(map.advancedEconomyStage === 4,
    'advanced stage 4 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-4',
    'advanced stage 4 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });

  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'red player should use AIPlayerWithEconomy', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'blue player should use SimpleAiPlayerWithEconomy', { seed, playerType: map.players[2].playerType });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 4 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });

  const redTown = map.players[1].towns[0];
  const blueTown = map.players[2].towns[0];
  assert(redTown.y + blueTown.y === 4 && redTown.x === blueTown.x,
    'advanced stage 4 towns should remain vertically mirrored',
    { seed, redTown, blueTown });
  assert(map.players[1].gold === map.players[2].gold,
    'advanced stage 4 should not give either player extra starting gold',
    { seed, redGold: map.players[1].gold, blueGold: map.players[2].gold });

  validateSuburbs(map, seed);
  assertNoInvalidObjects(map, seed);
  assert(map.economyObjects && map.economyObjects.towns === 2 &&
    map.economyObjects.units === 0 &&
    map.economyObjects.goldmines === 0 &&
    map.economyObjects.farms === 0 &&
    map.economyObjects.barracks === 0 &&
    map.economyObjects.capturedSuburbs >= 2,
    'advanced stage 4 economy object summary is incorrect',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage4TrainingMap: context.generateAdvancedEconomyStage4TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage4TrainingMap === 'function',
  'generateAdvancedEconomyStage4TrainingMap must be exported to the AI script context');

const observedLayouts = new Set();
const observedCapturedCounts = new Set();
for (let seed = 14100; seed < 14220; seed += 1) {
  const map = api.generateAdvancedEconomyStage4TrainingMap({ seed });
  validateMap(map, seed);
  observedCapturedCounts.add(map.economyGenerator.capturedSuburbCountPerPlayer);
  observedLayouts.add(JSON.stringify(map.economyGenerator.capturedSuburbPairs));

  const repeated = api.generateAdvancedEconomyStage4TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 4 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const generatedLayout = map.players[playerIndex].suburbs[0];
    const town = runtime.players[playerIndex].towns[0];
    assert(town.suburbs.length === generatedLayout.cells.length,
      'advanced stage 4 runtime lost configured suburb cells',
      { seed, playerIndex, expected: generatedLayout.cells, actual: town.suburbs });
    assert(town.suburbs.every((suburb) =>
      suburb.playerColor === playerIndex && suburb.isSuburb),
    'advanced stage 4 runtime suburb ownership does not match its town',
    { seed, playerIndex, suburbs: town.suburbs });
  }
}

assert(observedLayouts.size > 1,
  'advanced stage 4 fixed-seed sample did not exercise suburb layout variation',
  { observedLayouts: Array.from(observedLayouts).slice(0, 5) });
assert(observedCapturedCounts.size > 1,
  'advanced stage 4 fixed-seed sample did not exercise captured suburb count variation',
  { observedCapturedCounts: Array.from(observedCapturedCounts) });

const smokeMap = api.generateAdvancedEconomyStage4TrainingMap({
  seed: 14142,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 14142,
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

console.log('Advanced economy stage 4 captured-suburb map generation smoke passed');
