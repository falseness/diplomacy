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
      pendingBarracks: player.pendingBarracks || []
    })),
    goldmines: map.goldmines || [],
    lakes: map.lakes || [],
    mountains: map.mountains || [],
    bushes: map.bushes || []
  });
}

function assertNoOverlaps(map, seed) {
  const occupied = new Map();
  for (const coord of [].concat(map.goldmines || [], map.lakes || [], map.mountains || [], map.bushes || [])) {
    occupied.set(key(coord), 'terrain');
  }
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const town of player.towns || []) {
      assert(!occupied.has(key(town)),
        'advanced stage 6 town overlaps another object', { seed, playerIndex, town });
      occupied.set(key(town), 'town');
    }
  }
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const barrack of player.barracks || []) {
      assert(!occupied.has(key(barrack)),
        'advanced stage 6 barrack overlaps another object',
        { seed, playerIndex, barrack, overlaps: occupied.get(key(barrack)) });
      occupied.set(key(barrack), 'barrack');
    }
    for (const farm of player.farms || []) {
      assert(!occupied.has(key(farm)),
        'advanced stage 6 farm overlaps another object',
        { seed, playerIndex, farm, overlaps: occupied.get(key(farm)) });
      occupied.set(key(farm), 'farm');
    }
  }
}

function validateOwnedBuilding(map, seed, playerIndex, building, type) {
  const player = map.players[playerIndex];
  const layout = player.suburbs[0];
  const suburbKeys = new Set(layout.cells.map(key));
  const townKeys = new Set(player.towns.map(key));
  assert(suburbKeys.has(key(building)),
    'advanced stage 6 ' + type + ' is not on an owned suburb cell',
    { seed, playerIndex, building, suburbs: layout.cells });
  assert(!townKeys.has(key(building)),
    'advanced stage 6 ' + type + ' overlaps a town',
    { seed, playerIndex, building });
  assert(player.towns.some((town) => key(town) === key(building.town)),
    'advanced stage 6 ' + type + ' references a town owned by another player',
    { seed, playerIndex, building, towns: player.towns });
}

function validateBuildings(map, seed) {
  let totalBarracks = 0;
  let totalFarms = 0;
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const barracks = player.barracks || [];
    const farms = player.farms || [];
    assert(barracks.length >= 1,
      'advanced stage 6 should preserve at least one barrack per player',
      { seed, playerIndex, barracks });
    assert(farms.length >= 1,
      'advanced stage 6 should place at least one farm per player',
      { seed, playerIndex, farms, suburbs: player.suburbs[0].cells });
    for (const barrack of barracks) {
      validateOwnedBuilding(map, seed, playerIndex, barrack, 'barrack');
    }
    for (const farm of farms) {
      validateOwnedBuilding(map, seed, playerIndex, farm, 'farm');
    }
    totalBarracks += barracks.length;
    totalFarms += farms.length;
  }
  assert(map.economyObjects.barracks === totalBarracks,
    'advanced stage 6 economy object summary has the wrong barrack count',
    { seed, economyObjects: map.economyObjects, totalBarracks });
  assert(map.economyObjects.farms === totalFarms,
    'advanced stage 6 economy object summary has the wrong farm count',
    { seed, economyObjects: map.economyObjects, totalFarms });
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 5 && map.mapSize.y === 5,
    'advanced stage 6 must be a deterministic 5x5 map', { seed, mapSize: map.mapSize });
  assert(map.advancedEconomyStage === 6,
    'advanced stage 6 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-6',
    'advanced stage 6 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.stage4RequirementsPreserved === true &&
    map.economyGenerator.stage5RequirementsPreserved === true,
    'advanced stage 6 should preserve captured-suburb and barrack requirements',
    { seed, economyGenerator: map.economyGenerator });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 6 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });
  assert((map.goldmines || []).length === 0 &&
    (map.lakes || []).length === 0 &&
    (map.mountains || []).length === 0 &&
    (map.bushes || []).length === 0,
    'advanced stage 6 should not introduce blockers or goldmines yet',
    { seed, goldmines: map.goldmines, lakes: map.lakes, mountains: map.mountains, bushes: map.bushes });
  validateBuildings(map, seed);
  assertNoOverlaps(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage6TrainingMap: context.generateAdvancedEconomyStage6TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage6TrainingMap === 'function',
  'generateAdvancedEconomyStage6TrainingMap must be exported to the AI script context');

const observedFarmLayouts = new Set();
const observedBarrackLayouts = new Set();
for (let seed = 14300; seed < 14440; seed += 1) {
  const map = api.generateAdvancedEconomyStage6TrainingMap({ seed });
  validateMap(map, seed);
  observedFarmLayouts.add(JSON.stringify([
    map.players[1].farms || [],
    map.players[2].farms || []
  ]));
  observedBarrackLayouts.add(JSON.stringify([
    map.players[1].barracks || [],
    map.players[2].barracks || []
  ]));

  const repeated = api.generateAdvancedEconomyStage6TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 6 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    assert(runtime.players[playerIndex].barracks.length === map.players[playerIndex].barracks.length,
      'advanced stage 6 runtime lost configured barracks',
      { seed, playerIndex, configured: map.players[playerIndex].barracks, runtime: runtime.players[playerIndex].barracks });
    assert(runtime.players[playerIndex].farms.length === map.players[playerIndex].farms.length,
      'advanced stage 6 runtime lost configured farms',
      { seed, playerIndex, configured: map.players[playerIndex].farms, runtime: runtime.players[playerIndex].farms });
    assert(runtime.players[playerIndex].farms.every((farm) =>
      farm.building && farm.building.playerColor === playerIndex),
      'advanced stage 6 runtime farm ownership is wrong',
      { seed, playerIndex, runtime: runtime.players[playerIndex].farms });
  }
}

assert(observedFarmLayouts.size > 1,
  'advanced stage 6 fixed-seed sample did not exercise farm placement variation',
  { observedFarmLayouts: Array.from(observedFarmLayouts).slice(0, 5) });
assert(observedBarrackLayouts.size > 1,
  'advanced stage 6 fixed-seed sample did not preserve barrack placement variation',
  { observedBarrackLayouts: Array.from(observedBarrackLayouts).slice(0, 5) });

const smokeMap = api.generateAdvancedEconomyStage6TrainingMap({
  seed: 14342,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 14342,
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

console.log('Advanced economy stage 6 farm-and-barrack suburb map generation smoke passed');
