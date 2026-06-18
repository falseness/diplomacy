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

function assertNoOverlaps(map, seed) {
  const occupied = new Map();
  for (const coord of [].concat(map.goldmines || [], map.lakes || [], map.mountains || [], map.bushes || [])) {
    occupied.set(key(coord), 'terrain');
  }
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const town of player.towns || []) {
      assert(!occupied.has(key(town)),
        'advanced stage 5 town overlaps another object', { seed, playerIndex, town });
      occupied.set(key(town), 'town');
    }
  }
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const barrack of player.barracks || []) {
      assert(!occupied.has(key(barrack)),
        'advanced stage 5 barrack overlaps another object',
        { seed, playerIndex, barrack, overlaps: occupied.get(key(barrack)) });
      occupied.set(key(barrack), 'barrack');
    }
  }
}

function validateBarracks(map, seed) {
  let totalBarracks = 0;
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const layout = player.suburbs[0];
    const suburbKeys = new Set(layout.cells.map(key));
    const townKeys = new Set(player.towns.map(key));
    const barracks = player.barracks || [];
    assert(barracks.length >= 1,
      'advanced stage 5 should place at least one barrack per player',
      { seed, playerIndex, barracks, suburbs: layout.cells });
    for (const barrack of barracks) {
      assert(suburbKeys.has(key(barrack)),
        'advanced stage 5 barrack is not on an owned suburb cell',
        { seed, playerIndex, barrack, suburbs: layout.cells });
      assert(!townKeys.has(key(barrack)),
        'advanced stage 5 barrack overlaps a town', { seed, playerIndex, barrack });
      assert(player.towns.some((town) => key(town) === key(barrack.town)),
        'advanced stage 5 barrack references a town owned by another player',
        { seed, playerIndex, barrack, towns: player.towns });
    }
    totalBarracks += barracks.length;
  }
  assert(map.economyObjects.barracks === totalBarracks,
    'advanced stage 5 economy object summary has the wrong barrack count',
    { seed, economyObjects: map.economyObjects, totalBarracks });
}

function validateMap(map, seed) {
  assert(map.mapSize.x === 5 && map.mapSize.y === 5,
    'advanced stage 5 must be a deterministic 5x5 map', { seed, mapSize: map.mapSize });
  assert(map.advancedEconomyStage === 5,
    'advanced stage 5 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-5',
    'advanced stage 5 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.stage4RequirementsPreserved === true,
    'advanced stage 5 should preserve captured-suburb requirements from stage 4',
    { seed, economyGenerator: map.economyGenerator });
  assert(map.players[1].towns.length === 1 && map.players[2].towns.length === 1,
    'advanced stage 5 should contain exactly one red town and one blue town',
    { seed, redTowns: map.players[1].towns, blueTowns: map.players[2].towns });
  assert((map.goldmines || []).length === 0 &&
    (map.lakes || []).length === 0 &&
    (map.mountains || []).length === 0 &&
    (map.bushes || []).length === 0,
    'advanced stage 5 should not introduce blockers or goldmines yet',
    { seed, goldmines: map.goldmines, lakes: map.lakes, mountains: map.mountains, bushes: map.bushes });
  validateBarracks(map, seed);
  assertNoOverlaps(map, seed);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage5TrainingMap: context.generateAdvancedEconomyStage5TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage5TrainingMap === 'function',
  'generateAdvancedEconomyStage5TrainingMap must be exported to the AI script context');

const observedBarrackLayouts = new Set();
for (let seed = 14200; seed < 14320; seed += 1) {
  const map = api.generateAdvancedEconomyStage5TrainingMap({ seed });
  validateMap(map, seed);
  observedBarrackLayouts.add(JSON.stringify([
    map.players[1].barracks || [],
    map.players[2].barracks || []
  ]));

  const repeated = api.generateAdvancedEconomyStage5TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 5 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    assert(runtime.players[playerIndex].barracks.length === map.players[playerIndex].barracks.length,
      'advanced stage 5 runtime lost configured barracks',
      { seed, playerIndex, configured: map.players[playerIndex].barracks, runtime: runtime.players[playerIndex].barracks });
    assert(runtime.players[playerIndex].barracks.every((barrack) =>
      barrack.building && barrack.building.playerColor === playerIndex),
      'advanced stage 5 runtime barrack ownership is wrong',
      { seed, playerIndex, runtime: runtime.players[playerIndex].barracks });
  }
}

assert(observedBarrackLayouts.size > 1,
  'advanced stage 5 fixed-seed sample did not exercise barrack placement variation',
  { observedBarrackLayouts: Array.from(observedBarrackLayouts).slice(0, 5) });

const smokeMap = api.generateAdvancedEconomyStage5TrainingMap({
  seed: 14242,
  suddenDeathRound: 12
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: 14242,
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

console.log('Advanced economy stage 5 barrack-suburb map generation smoke passed');
