const { loadAiScripts } = require('./smokeHarness');
const { runCheckpointSmoke } = require('./tests/checkpoint-smoke.cjs');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function key(coord) {
  return coord.x + ':' + coord.y;
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
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
      units: (player.units || []).map((unit) => ({
        type: unitTypeName(unit),
        x: unit.x,
        y: unit.y
      })),
      suburbs: player.suburbs || [],
      farms: player.farms || [],
      barracks: player.barracks || []
    })),
    goldmines: map.goldmines || [],
    lakes: map.lakes || [],
    mountains: map.mountains || [],
    bushes: map.bushes || []
  });
}

function validateStage9Objects(map, seed, occupied) {
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    const suburbKeys = new Set(player.suburbs[0].cells.map(key));
    const townKeys = new Set(player.towns.map(key));
    assert((player.farms || []).length >= 1,
      'advanced stage 10 should preserve stage 9 farms', { seed, playerIndex, farms: player.farms });
    assert((player.barracks || []).length >= 1,
      'advanced stage 10 should preserve stage 9 barracks', { seed, playerIndex, barracks: player.barracks });

    for (const field of ['farms', 'barracks']) {
      for (const building of player[field] || []) {
        assert(suburbKeys.has(key(building)),
          'advanced stage 10 ' + field + ' must remain on owned captured suburbs',
          { seed, playerIndex, building, suburbs: player.suburbs[0].cells });
        assert(!townKeys.has(key(building)),
          'advanced stage 10 ' + field + ' must not overlap towns', { seed, playerIndex, building });
        assert(!occupied.has(key(building)),
          'advanced stage 10 ' + field + ' overlaps another exclusive object',
          { seed, playerIndex, building, overlaps: occupied.get(key(building)) });
        occupied.set(key(building), field);
      }
    }
  }
}

function validateUnits(map, seed, observedTypes, observedLayouts) {
  const supportedTypes = new Set(['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']);
  const occupied = new Map();
  const townKeys = new Set();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    for (const town of map.players[playerIndex].towns) {
      townKeys.add(key(town));
      occupied.set(key(town), 'town');
    }
  }

  validateStage9Objects(map, seed, occupied);

  const redUnits = map.players[1].units || [];
  const blueUnits = map.players[2].units || [];
  assert(redUnits.length >= 1 && redUnits.length === blueUnits.length,
    'advanced stage 10 should place mirrored unit counts for both players',
    { seed, redUnits, blueUnits });

  const allUnitKeys = [];
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    for (const unit of player.units || []) {
      const typeName = unitTypeName(unit);
      assert(supportedTypes.has(typeName),
        'advanced stage 10 generated an unsupported unit type',
        { seed, playerIndex, unit, typeName });
      assert(unit.x >= 0 && unit.y >= 0 && unit.x < 9 && unit.y < 9,
        'advanced stage 10 unit is outside the 9x9 map', { seed, playerIndex, unit });
      assert(!occupied.has(key(unit)),
        'advanced stage 10 unit overlaps an exclusive object',
        { seed, playerIndex, unit, overlaps: occupied.get(key(unit)) });
      occupied.set(key(unit), 'unit');
      observedTypes.add(typeName);
      allUnitKeys.push(playerIndex + ':' + key(unit) + ':' + typeName);
    }
  }
  observedLayouts.add(JSON.stringify(allUnitKeys.sort()));

  const unitPairs = map.economyGenerator.unitPairs || [];
  assert(unitPairs.length === redUnits.length,
    'advanced stage 10 unit-pair metadata has the wrong length',
    { seed, unitPairs, redUnits });
  for (let i = 0; i < redUnits.length; i += 1) {
    const red = redUnits[i];
    const blue = blueUnits[i];
    const pair = unitPairs[i];
    assert(pair.red.x === red.x && pair.red.y === red.y &&
      pair.blue.x === blue.x && pair.blue.y === blue.y &&
      pair.type === unitTypeName(red) &&
      pair.type === unitTypeName(blue),
      'advanced stage 10 unit metadata should match paired unit placements and types',
      { seed, index: i, pair, red, blue });
  }

  assert(map.economyObjects.units === redUnits.length + blueUnits.length,
    'advanced stage 10 economy summary has the wrong unit count',
    { seed, economyObjects: map.economyObjects, redUnits, blueUnits });
  assert(map.economyGenerator.unitCountPerPlayer === redUnits.length,
    'advanced stage 10 generator metadata has the wrong unit count',
    { seed, economyGenerator: map.economyGenerator, redUnits });
}

function validateMap(map, seed, observedTypes, observedLayouts) {
  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'advanced stage 10 must be a deterministic 9x9 map', { seed, mapSize: map.mapSize });
  assert(map.advancedEconomyStage === 10,
    'advanced stage 10 metadata is missing', { seed, advancedEconomyStage: map.advancedEconomyStage });
  assert(map.economyGenerator && map.economyGenerator.stage === 'advanced-10',
    'advanced stage 10 generator metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.economyGenerator.stage9RequirementsPreserved === true,
    'advanced stage 10 should preserve stage 9 farm and barrack requirements',
    { seed, economyGenerator: map.economyGenerator });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy' &&
    map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'advanced stage 10 should preserve runtime economy player classes',
    { seed, players: map.players.map((player) => player.playerType) });
  assert((map.goldmines || []).length === 0 &&
    (map.lakes || []).length === 0 &&
    (map.mountains || []).length === 0 &&
    (map.bushes || []).length === 0,
    'advanced stage 10 should not introduce invalid terrain or goldmine blockers',
    { seed, goldmines: map.goldmines, lakes: map.lakes, mountains: map.mountains, bushes: map.bushes });

  validateUnits(map, seed, observedTypes, observedLayouts);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage10TrainingMap: context.generateAdvancedEconomyStage10TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage10TrainingMap === 'function',
  'generateAdvancedEconomyStage10TrainingMap must be exported to the AI script context');

const observedTypes = new Set();
const observedLayouts = new Set();
for (let seed = 14700; seed < 14880; seed += 1) {
  const map = api.generateAdvancedEconomyStage10TrainingMap({ seed });
  validateMap(map, seed, observedTypes, observedLayouts);

  const repeated = api.generateAdvancedEconomyStage10TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 10 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    assert(runtime.players[playerIndex].units.length === map.players[playerIndex].units.length + 1,
      'advanced stage 10 runtime lost configured units',
      { seed, playerIndex, configured: map.players[playerIndex].units, runtime: runtime.players[playerIndex].units });
    for (const unit of map.players[playerIndex].units) {
      assert(runtime.players[playerIndex].units.some((runtimeUnit) =>
        runtimeUnit.source === 'configured' &&
        runtimeUnit.x === unit.x &&
        runtimeUnit.y === unit.y &&
        runtimeUnit.name === unitTypeName(unit)),
      'advanced stage 10 runtime lost configured unit type or position',
      { seed, playerIndex, unit, runtime: runtime.players[playerIndex].units });
    }
  }
}

for (const typeName of ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']) {
  assert(observedTypes.has(typeName),
    'advanced stage 10 fixed-seed sample did not generate ' + typeName,
    { observedTypes: Array.from(observedTypes) });
}
assert(observedLayouts.size > 1,
  'advanced stage 10 fixed-seed sample did not exercise unit placement variation',
  { observedLayouts: Array.from(observedLayouts).slice(0, 5) });

async function runGameplaySmoke() {
  const smokeMap = api.generateAdvancedEconomyStage10TrainingMap({
    seed: 14742,
    suddenDeathRound: 12
  });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 14742,
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

  console.log('Advanced economy stage 10 9x9 random-unit economy map generation smoke passed');
}

runGameplaySmoke().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
