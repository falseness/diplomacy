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
    'advanced stage 8 should not generate goldmines', { seed, goldmines: map.goldmines });
  assert((map.lakes || []).length === 0,
    'advanced stage 8 should not generate lakes', { seed, lakes: map.lakes });
  assert((map.mountains || []).length === 0,
    'advanced stage 8 should not generate mountains', { seed, mountains: map.mountains });
  assert((map.bushes || []).length === 0,
    'advanced stage 8 should not generate bushes', { seed, bushes: map.bushes });

  for (let playerIndex = 0; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const field of [
      'units',
      'pendingFarms',
      'barracks',
      'pendingBarracks',
      'towers',
      'bastions',
      'walls'
    ]) {
      assert(objectCount(player, field) === 0,
        'advanced stage 8 should not generate player ' + field,
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
      'advanced stage 8 should configure one suburb layout per player', { seed, playerIndex });
    const layout = player.suburbs[0];
    const town = player.towns[0];
    assert(key(layout.town) === key(town),
      'advanced stage 8 suburb layout references the wrong town', { seed, playerIndex, layout });
    assert(layout.cells.length >= 2,
      'advanced stage 8 should preserve captured suburb cells',
      { seed, playerIndex, cells: layout.cells });

    const connected = {};
    connected[key(town)] = true;
    for (const cell of layout.cells) {
      assert(cell.x >= 0 && cell.y >= 0 && cell.x < 9 && cell.y < 9,
        'advanced stage 8 suburb cell is outside the 9x9 map', { seed, playerIndex, cell });
      assert(!claimed.has(key(cell)) || key(cell) === key(town),
        'advanced stage 8 suburb cell is claimed by multiple players',
        { seed, playerIndex, cell, claimedBy: claimed.get(key(cell)) });
      claimed.set(key(cell), playerIndex);
      if (key(cell) !== key(town)) {
        assert(!townKeys.has(key(cell)),
          'advanced stage 8 captured suburb overlaps a town', { seed, playerIndex, cell });
        assert(layout.cells.some((other) =>
          connected[key(other)] && distance(other, cell) === 1),
        'advanced stage 8 captured suburb is disconnected from its town',
        { seed, playerIndex, cell, layout });
      }
      connected[key(cell)] = true;
    }
  }
}

function validateFarms(map, seed) {
  const occupied = new Map();
  const totalFarms = (map.players[1].farms || []).length + (map.players[2].farms || []).length;
  assert(totalFarms >= 2,
    'advanced stage 8 should place at least one farm per player',
    { seed, redFarms: map.players[1].farms, blueFarms: map.players[2].farms });
  assert(map.economyObjects.farms === totalFarms,
    'advanced stage 8 economy object summary has the wrong farm count',
    { seed, totalFarms, economyObjects: map.economyObjects });
  assert(map.economyObjects.productionActions === totalFarms,
    'advanced stage 8 production action count should match farms',
    { seed, totalFarms, economyObjects: map.economyObjects });

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const layout = player.suburbs[0];
    const suburbKeys = new Set(layout.cells.map(key));
    const townKeys = new Set(player.towns.map(key));
    for (const town of player.towns) {
      occupied.set(key(town), 'town');
    }
    for (const farm of player.farms || []) {
      assert(farm.x >= 0 && farm.y >= 0 && farm.x < 9 && farm.y < 9,
        'advanced stage 8 farm is outside the 9x9 map', { seed, playerIndex, farm });
      assert(suburbKeys.has(key(farm)),
        'advanced stage 8 farm is not on an owned suburb cell',
        { seed, playerIndex, farm, suburbs: layout.cells });
      assert(!townKeys.has(key(farm)),
        'advanced stage 8 farm overlaps a town', { seed, playerIndex, farm });
      assert(player.towns.some((town) => key(town) === key(farm.town)),
        'advanced stage 8 farm references a town owned by another player',
        { seed, playerIndex, farm, towns: player.towns });
      assert(!occupied.has(key(farm)),
        'advanced stage 8 farm overlaps another object',
        { seed, playerIndex, farm, overlaps: occupied.get(key(farm)) });
      occupied.set(key(farm), 'farm');
    }
  }
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'advanced stage 8 must be a deterministic 9x9 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'advanced stage 8 should include neutral plus two players', { seed });
  assert(map.advancedEconomyStage === 8,
    'advanced stage 8 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-8',
    'advanced stage 8 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.stage7RequirementsPreserved === true,
    'advanced stage 8 should preserve stage 7 captured-suburb requirements',
    { seed, economyGenerator: map.economyGenerator });

  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'red player should use AIPlayerWithEconomy', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'blue player should use SimpleAiPlayerWithEconomy', { seed, playerType: map.players[2].playerType });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 8 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });

  const redTown = map.players[1].towns[0];
  const blueTown = map.players[2].towns[0];
  assert(redTown.y + blueTown.y === 8 && redTown.x === blueTown.x,
    'advanced stage 8 towns should remain mirrored across the center lane',
    { seed, redTown, blueTown });
  assert(map.players[1].gold === map.players[2].gold,
    'advanced stage 8 should not give either player extra starting gold',
    { seed, redGold: map.players[1].gold, blueGold: map.players[2].gold });

  validateSuburbs(map, seed);
  validateFarms(map, seed);
  assertNoInvalidObjects(map, seed);
  assert(map.economyObjects && map.economyObjects.towns === 2 &&
    map.economyObjects.units === 0 &&
    map.economyObjects.goldmines === 0 &&
    map.economyObjects.barracks === 0 &&
    map.economyObjects.capturedSuburbs >= 2,
    'advanced stage 8 economy object summary is incorrect',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage8TrainingMap: context.generateAdvancedEconomyStage8TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage8TrainingMap === 'function',
  'generateAdvancedEconomyStage8TrainingMap must be exported to the AI script context');

const observedFarmLayouts = new Set();
const observedSuburbLayouts = new Set();
for (let seed = 14500; seed < 14660; seed += 1) {
  const map = api.generateAdvancedEconomyStage8TrainingMap({ seed });
  validateMap(map, seed);
  observedFarmLayouts.add(JSON.stringify([map.players[1].farms || [], map.players[2].farms || []]));
  observedSuburbLayouts.add(JSON.stringify(map.economyGenerator.capturedSuburbPairs));

  const repeated = api.generateAdvancedEconomyStage8TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 8 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const generatedLayout = map.players[playerIndex].suburbs[0];
    const town = runtime.players[playerIndex].towns[0];
    assert(town.suburbs.length === generatedLayout.cells.length,
      'advanced stage 8 runtime lost configured suburb cells',
      { seed, playerIndex, expected: generatedLayout.cells, actual: town.suburbs });
    assert(runtime.players[playerIndex].farms.length === map.players[playerIndex].farms.length,
      'advanced stage 8 runtime lost configured farms',
      { seed, playerIndex, configured: map.players[playerIndex].farms, runtime: runtime.players[playerIndex].farms });
    assert(runtime.players[playerIndex].farms.every((farm) =>
      farm.building && farm.building.playerColor === playerIndex),
      'advanced stage 8 runtime farm ownership is wrong',
      { seed, playerIndex, runtime: runtime.players[playerIndex].farms });
  }
}

assert(observedFarmLayouts.size > 1,
  'advanced stage 8 fixed-seed sample did not exercise farm placement variation',
  { observedFarmLayouts: Array.from(observedFarmLayouts).slice(0, 5) });
assert(observedSuburbLayouts.size > 1,
  'advanced stage 8 fixed-seed sample did not preserve suburb layout variation',
  { observedSuburbLayouts: Array.from(observedSuburbLayouts).slice(0, 5) });

const smokeMap = api.generateAdvancedEconomyStage8TrainingMap({
  seed: 14542,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 14542,
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

console.log('Advanced economy stage 8 9x9 farm suburb map generation smoke passed');
