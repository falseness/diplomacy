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
      pendingFarms: player.pendingFarms || [],
      pendingBarracks: player.pendingBarracks || [],
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
      'advanced stage 9 should configure one suburb layout per player', { seed, playerIndex });
    const layout = player.suburbs[0];
    const town = player.towns[0];
    assert(key(layout.town) === key(town),
      'advanced stage 9 suburb layout references the wrong town', { seed, playerIndex, layout });
    assert(layout.cells.length >= 3,
      'advanced stage 9 should preserve enough captured suburb cells for farms and barracks',
      { seed, playerIndex, cells: layout.cells });

    const connected = {};
    connected[key(town)] = true;
    for (const cell of layout.cells) {
      assert(cell.x >= 0 && cell.y >= 0 && cell.x < 9 && cell.y < 9,
        'advanced stage 9 suburb cell is outside the 9x9 map', { seed, playerIndex, cell });
      assert(!claimed.has(key(cell)) || key(cell) === key(town),
        'advanced stage 9 suburb cell is claimed by multiple players',
        { seed, playerIndex, cell, claimedBy: claimed.get(key(cell)) });
      claimed.set(key(cell), playerIndex);
      if (key(cell) !== key(town)) {
        assert(!townKeys.has(key(cell)),
          'advanced stage 9 captured suburb overlaps a town', { seed, playerIndex, cell });
        assert(layout.cells.some((other) =>
          connected[key(other)] && distance(other, cell) === 1),
        'advanced stage 9 captured suburb is disconnected from its town',
        { seed, playerIndex, cell, layout });
      }
      connected[key(cell)] = true;
    }
  }
}

function validatePlayerBuildings(map, seed, playerIndex, occupied) {
  const player = map.players[playerIndex];
  const layout = player.suburbs[0];
  const suburbKeys = new Set(layout.cells.map(key));
  const townKeys = new Set(player.towns.map(key));
  const buildingGroups = [
    { field: 'farms', label: 'farm' },
    { field: 'barracks', label: 'barrack' }
  ];

  for (const group of buildingGroups) {
    assert((player[group.field] || []).length >= 1,
      'advanced stage 9 should place at least one ' + group.label + ' per player',
      { seed, playerIndex, field: group.field, player });
    for (const building of player[group.field] || []) {
      assert(building.x >= 0 && building.y >= 0 && building.x < 9 && building.y < 9,
        'advanced stage 9 ' + group.label + ' is outside the 9x9 map',
        { seed, playerIndex, building });
      assert(suburbKeys.has(key(building)),
        'advanced stage 9 ' + group.label + ' is not on an owned suburb cell',
        { seed, playerIndex, building, suburbs: layout.cells });
      assert(!townKeys.has(key(building)),
        'advanced stage 9 ' + group.label + ' overlaps a town',
        { seed, playerIndex, building });
      assert(player.towns.some((town) => key(town) === key(building.town)),
        'advanced stage 9 ' + group.label + ' references a town owned by another player',
        { seed, playerIndex, building, towns: player.towns });
      assert(!occupied.has(key(building)),
        'advanced stage 9 ' + group.label + ' overlaps another object',
        { seed, playerIndex, building, overlaps: occupied.get(key(building)) });
      occupied.set(key(building), group.label);
    }
  }
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'advanced stage 9 must be a deterministic 9x9 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'advanced stage 9 should include neutral plus two players', { seed });
  assert(map.advancedEconomyStage === 9,
    'advanced stage 9 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-9',
    'advanced stage 9 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.stage8RequirementsPreserved === true,
    'advanced stage 9 should preserve stage 8 farm-suburb requirements',
    { seed, economyGenerator: map.economyGenerator });

  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'red player should use AIPlayerWithEconomy', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'blue player should use SimpleAiPlayerWithEconomy', { seed, playerType: map.players[2].playerType });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 9 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });

  const redTown = map.players[1].towns[0];
  const blueTown = map.players[2].towns[0];
  assert(redTown.y + blueTown.y === 8 && redTown.x === blueTown.x,
    'advanced stage 9 towns should remain mirrored across the center lane',
    { seed, redTown, blueTown });
  assert(map.players[1].gold === map.players[2].gold,
    'advanced stage 9 should not give either player extra starting gold',
    { seed, redGold: map.players[1].gold, blueGold: map.players[2].gold });

  validateSuburbs(map, seed);

  assert((map.goldmines || []).length === 0 &&
    (map.lakes || []).length === 0 &&
    (map.mountains || []).length === 0 &&
    (map.bushes || []).length === 0,
    'advanced stage 9 should not generate terrain or goldmine blockers',
    { seed, goldmines: map.goldmines, lakes: map.lakes, mountains: map.mountains, bushes: map.bushes });
  for (let playerIndex = 0; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const field of ['units', 'pendingFarms', 'pendingBarracks', 'towers', 'bastions', 'walls']) {
      assert(objectCount(player, field) === 0,
        'advanced stage 9 should not generate player ' + field,
        { seed, playerIndex, field, value: player[field] });
    }
  }

  const occupied = new Map();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    for (const town of map.players[playerIndex].towns) {
      occupied.set(key(town), 'town');
    }
  }
  validatePlayerBuildings(map, seed, 1, occupied);
  validatePlayerBuildings(map, seed, 2, occupied);

  const totalFarms = (map.players[1].farms || []).length + (map.players[2].farms || []).length;
  const totalBarracks = (map.players[1].barracks || []).length + (map.players[2].barracks || []).length;
  assert(map.economyObjects && map.economyObjects.towns === 2 &&
    map.economyObjects.units === 0 &&
    map.economyObjects.goldmines === 0 &&
    map.economyObjects.farms === totalFarms &&
    map.economyObjects.barracks === totalBarracks &&
    map.economyObjects.productionActions === totalFarms + totalBarracks &&
    map.economyObjects.capturedSuburbs >= 4,
    'advanced stage 9 economy object summary is incorrect',
    { seed, economyObjects: map.economyObjects, totalFarms, totalBarracks });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage9TrainingMap: context.generateAdvancedEconomyStage9TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage9TrainingMap === 'function',
  'generateAdvancedEconomyStage9TrainingMap must be exported to the AI script context');

const observedFarmLayouts = new Set();
const observedBarrackLayouts = new Set();
for (let seed = 14600; seed < 14760; seed += 1) {
  const map = api.generateAdvancedEconomyStage9TrainingMap({ seed });
  validateMap(map, seed);
  observedFarmLayouts.add(JSON.stringify([map.players[1].farms || [], map.players[2].farms || []]));
  observedBarrackLayouts.add(JSON.stringify([map.players[1].barracks || [], map.players[2].barracks || []]));

  const repeated = api.generateAdvancedEconomyStage9TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 9 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const generatedLayout = map.players[playerIndex].suburbs[0];
    const town = runtime.players[playerIndex].towns[0];
    assert(town.suburbs.length === generatedLayout.cells.length,
      'advanced stage 9 runtime lost configured suburb cells',
      { seed, playerIndex, expected: generatedLayout.cells, actual: town.suburbs });
    assert(runtime.players[playerIndex].farms.length === map.players[playerIndex].farms.length,
      'advanced stage 9 runtime lost configured farms',
      { seed, playerIndex, configured: map.players[playerIndex].farms, runtime: runtime.players[playerIndex].farms });
    assert(runtime.players[playerIndex].barracks.length === map.players[playerIndex].barracks.length,
      'advanced stage 9 runtime lost configured barracks',
      { seed, playerIndex, configured: map.players[playerIndex].barracks, runtime: runtime.players[playerIndex].barracks });
    assert(runtime.players[playerIndex].barracks.every((barrack) =>
      barrack.building && barrack.building.playerColor === playerIndex),
      'advanced stage 9 runtime barrack ownership is wrong',
      { seed, playerIndex, runtime: runtime.players[playerIndex].barracks });
  }
}

assert(observedFarmLayouts.size > 1,
  'advanced stage 9 fixed-seed sample did not exercise farm placement variation',
  { observedFarmLayouts: Array.from(observedFarmLayouts).slice(0, 5) });
assert(observedBarrackLayouts.size > 1,
  'advanced stage 9 fixed-seed sample did not exercise barrack placement variation',
  { observedBarrackLayouts: Array.from(observedBarrackLayouts).slice(0, 5) });

const smokeMap = api.generateAdvancedEconomyStage9TrainingMap({
  seed: 14642,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 14642,
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

console.log('Advanced economy stage 9 9x9 farm and barrack suburb map generation smoke passed');
