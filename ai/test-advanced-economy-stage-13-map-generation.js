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
        y: unit.y,
        hp: unit.hp
      })),
      suburbs: player.suburbs || [],
      farms: player.farms || [],
      barracks: player.barracks || [],
      towers: player.towers || [],
      bastions: player.bastions || []
    }))
  });
}

const unitMaxHp = {
  Noob: 2,
  Archer: 1,
  KOHb: 3,
  Normchel: 5,
  Catapult: 1
};
const buildingMaxHp = {
  towns: 10,
  farms: 1,
  barracks: 1,
  towers: 5,
  bastions: 5
};

function assertHp(entity, maxHp, message, details) {
  assert(Number.isInteger(entity.hp) && entity.hp >= 1 && entity.hp <= maxHp,
    message, Object.assign({ entity, maxHp }, details || {}));
}

function validateMap(map, seed, observed) {
  assert(map.mapSize.x === 20 && map.mapSize.y === 20,
    'advanced stage 13 must generate 20x20 maps', { seed, mapSize: map.mapSize });
  assert(map.advancedEconomyStage === 13 &&
    map.economyGenerator && map.economyGenerator.stage === 'advanced-13' &&
    map.economyGenerator.baseStage === 'advanced-11',
    'advanced stage 13 metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.players.length === 3,
    'advanced stage 13 should include neutral plus two players', { seed });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy' &&
    map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'advanced stage 13 should preserve economy runtime player classes',
    { seed, players: map.players.map((player) => player.playerType) });

  const counted = {
    towns: 0,
    units: 0,
    farms: 0,
    barracks: 0,
    towers: 0,
    bastions: 0,
    capturedSuburbs: 0
  };
  const occupied = new Map();
  const claimed = new Map();

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.towns.length >= 0 && player.towns.length <= 3,
      'advanced stage 13 town count must stay within 0 to 3',
      { seed, playerIndex, towns: player.towns });
    observed.townCounts.add(player.towns.length);
    counted.towns += player.towns.length;

    for (const town of player.towns) {
      assert(town.x > 0 && town.y > 0 && town.x < 19 && town.y < 19,
        'advanced stage 13 town should stay away from map edges', { seed, playerIndex, town });
      assertHp(town, buildingMaxHp.towns,
        'advanced stage 13 town hp is outside 1..maxHp', { seed, playerIndex });
      assert(!occupied.has(key(town)),
        'advanced stage 13 town overlaps another exclusive object',
        { seed, playerIndex, town, overlaps: occupied.get(key(town)) });
      occupied.set(key(town), 'town');
      observed.hpValues.add('town:' + town.hp);
    }

    for (const layout of player.suburbs || []) {
      assert(player.towns.some((town) => key(town) === key(layout.town)),
        'advanced stage 13 suburb layout references a missing town',
        { seed, playerIndex, layout, towns: player.towns });
      assert(layout.cells.length >= 2,
        'advanced stage 13 should create captured cells around generated towns',
        { seed, playerIndex, layout });
      for (const cell of layout.cells) {
        assert(cell.x >= 0 && cell.y >= 0 && cell.x < 20 && cell.y < 20,
          'advanced stage 13 captured cell is outside the map', { seed, playerIndex, cell });
        assert(!claimed.has(key(cell)),
          'advanced stage 13 captured cell is claimed by multiple players',
          { seed, playerIndex, cell, claimedBy: claimed.get(key(cell)) });
        claimed.set(key(cell), playerIndex);
        counted.capturedSuburbs += 1;
      }
    }

    const ownedBuildCells = new Set();
    for (const layout of player.suburbs || []) {
      for (const cell of layout.cells) {
        ownedBuildCells.add(key(cell));
      }
    }
    const townKeys = new Set(player.towns.map(key));
    for (const field of ['farms', 'barracks', 'towers', 'bastions']) {
      for (const building of player[field] || []) {
        assert(building.x >= 0 && building.y >= 0 && building.x < 20 && building.y < 20,
          'advanced stage 13 ' + field + ' building is outside the map',
          { seed, playerIndex, building });
        assert(ownedBuildCells.has(key(building)) && !townKeys.has(key(building)),
          'advanced stage 13 ' + field + ' building must be on a captured owned non-town cell',
          { seed, playerIndex, building, ownedBuildCells: Array.from(ownedBuildCells) });
        assertHp(building, buildingMaxHp[field],
          'advanced stage 13 ' + field + ' hp is outside 1..maxHp', { seed, playerIndex });
        assert(!occupied.has(key(building)),
          'advanced stage 13 ' + field + ' overlaps another exclusive object',
          { seed, playerIndex, building, overlaps: occupied.get(key(building)) });
        occupied.set(key(building), field);
        counted[field] += 1;
        observed[field] = true;
        observed.hpValues.add(field + ':' + building.hp);
      }
    }

    for (const unit of player.units || []) {
      const typeName = unitTypeName(unit);
      assert(unitMaxHp[typeName],
        'advanced stage 13 generated an unsupported unit type',
        { seed, playerIndex, unit, typeName });
      assert(unit.x >= 0 && unit.y >= 0 && unit.x < 20 && unit.y < 20,
        'advanced stage 13 unit is outside the map', { seed, playerIndex, unit });
      assertHp(unit, unitMaxHp[typeName],
        'advanced stage 13 unit hp is outside 1..maxHp', { seed, playerIndex, typeName });
      assert(!occupied.has(key(unit)),
        'advanced stage 13 unit overlaps another exclusive object',
        { seed, playerIndex, unit, overlaps: occupied.get(key(unit)) });
      occupied.set(key(unit), 'unit');
      counted.units += 1;
      observed.unitTypes.add(typeName);
      observed.hpValues.add(typeName + ':' + unit.hp);
    }
  }

  for (const field of Object.keys(counted)) {
    assert(map.economyObjects[field] === counted[field],
      'advanced stage 13 economy object summary is incorrect for ' + field,
      { seed, expected: counted[field], actual: map.economyObjects[field], economyObjects: map.economyObjects });
  }
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage13TrainingMap: context.generateAdvancedEconomyStage13TrainingMap
};`)(context);

async function main() {
  assert(typeof api.generateAdvancedEconomyStage13TrainingMap === 'function',
    'generateAdvancedEconomyStage13TrainingMap must be exported to the AI script context');

  const observed = {
    townCounts: new Set(),
    unitTypes: new Set(),
    hpValues: new Set(),
    farms: false,
    barracks: false,
    towers: false,
    bastions: false,
    capturedSuburbs: false
  };

  let smokeSeed = null;
  for (let seed = 15000; seed < 15280; seed += 1) {
    const map = api.generateAdvancedEconomyStage13TrainingMap({ seed });
    validateMap(map, seed, observed);
    const repeated = api.generateAdvancedEconomyStage13TrainingMap({ seed });
    assert(normalizeMap(map) === normalizeMap(repeated),
      'advanced stage 13 map generation is not deterministic for seed ' + seed);

    if (map.economyObjects.capturedSuburbs > 0) {
      observed.capturedSuburbs = true;
    }

    const runtime = map.start();
    for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
      assert(runtime.players[playerIndex].towns.length === map.players[playerIndex].towns.length,
        'advanced stage 13 runtime lost configured towns', { seed, playerIndex });
      assert(runtime.players[playerIndex].units.length >= map.players[playerIndex].units.length,
        'advanced stage 13 runtime lost configured units', { seed, playerIndex });
      assert(runtime.players[playerIndex].farms.length === (map.players[playerIndex].farms || []).length,
        'advanced stage 13 runtime lost configured farms', { seed, playerIndex });
      assert(runtime.players[playerIndex].barracks.length === (map.players[playerIndex].barracks || []).length,
        'advanced stage 13 runtime lost configured barracks', { seed, playerIndex });
      assert(runtime.players[playerIndex].towers.length === (map.players[playerIndex].towers || []).length,
        'advanced stage 13 runtime lost configured towers', { seed, playerIndex });
      assert(runtime.players[playerIndex].bastions.length === (map.players[playerIndex].bastions || []).length,
        'advanced stage 13 runtime lost configured bastions', { seed, playerIndex });
    }

    if (smokeSeed === null &&
        map.players[1].towns.length === 1 &&
        map.players[2].towns.length === 1) {
      smokeSeed = seed;
    }
  }

  for (const count of [0, 1, 2, 3]) {
    assert(observed.townCounts.has(count),
      'advanced stage 13 fixed-seed sample did not generate town count ' + count,
      { observedTownCounts: Array.from(observed.townCounts) });
  }
  for (const typeName of Object.keys(unitMaxHp)) {
    assert(observed.unitTypes.has(typeName),
      'advanced stage 13 fixed-seed sample did not generate unit type ' + typeName,
      { observedUnitTypes: Array.from(observed.unitTypes) });
  }
  for (const field of ['farms', 'barracks', 'towers', 'bastions']) {
    assert(observed[field],
      'advanced stage 13 fixed-seed sample did not generate ' + field);
  }
  assert(observed.capturedSuburbs,
    'advanced stage 13 fixed-seed sample did not generate captured suburbs');
  assert(observed.hpValues.size > 8,
    'advanced stage 13 fixed-seed sample did not vary configured hp values',
    { hpValues: Array.from(observed.hpValues) });
  assert(smokeSeed !== null,
    'advanced stage 13 fixed-seed sample did not find a one-town-per-player benchmark smoke seed');

  const smokeMap = api.generateAdvancedEconomyStage13TrainingMap({
    seed: smokeSeed,
    suddenDeathRound: 20
  });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: smokeSeed,
    roundLimit: 5,
    actionLimit: 4,
    commandLimit: 32
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
    'short economy smoke did not run AIPlayerWithEconomy', smokeResult);
  assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'short economy smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
  assert(!smokeResult.crash,
    'short advanced stage 13 economy smoke crashed', smokeResult);
  assert(smokeResult.turnCount > 0,
    'short advanced stage 13 economy smoke game did not advance', smokeResult);

  console.log('Advanced economy stage 13 random 20x20 HP map generation smoke passed');

}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
