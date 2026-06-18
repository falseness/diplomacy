const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function mirrorX(coord, mapSize) {
  return { x: mapSize.x - 1 - coord.x, y: coord.y };
}

function normalizeCoord(coord) {
  return {
    x: coord.x,
    y: coord.y,
    hp: Object.prototype.hasOwnProperty.call(coord, 'hp') ? coord.hp : null,
    town: coord.town ? { x: coord.town.x, y: coord.town.y } : null
  };
}

function normalizeList(list) {
  return (list || []).map((entry) => JSON.stringify(normalizeCoord(entry))).sort();
}

function normalizeUnits(units) {
  return (units || []).map((unit) => JSON.stringify({
    type: unitTypeName(unit),
    x: unit.x,
    y: unit.y,
    hp: Object.prototype.hasOwnProperty.call(unit, 'hp') ? unit.hp : null
  })).sort();
}

function mirrorBuilding(building, mapSize) {
  const mirrored = mirrorX(building, mapSize);
  const result = {
    x: mirrored.x,
    y: mirrored.y,
    hp: Object.prototype.hasOwnProperty.call(building, 'hp') ? building.hp : null,
    town: building.town ? mirrorX(building.town, mapSize) : null
  };
  return result;
}

function mirrorUnit(unit, mapSize) {
  const mirrored = mirrorX(unit, mapSize);
  return {
    type: unitTypeName(unit),
    x: mirrored.x,
    y: mirrored.y,
    hp: Object.prototype.hasOwnProperty.call(unit, 'hp') ? unit.hp : null
  };
}

function normalizeMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    economyStage: map.economyStage,
    advancedEconomyStage: map.advancedEconomyStage,
    symmetry: map.symmetry,
    economyGenerator: map.economyGenerator,
    economyObjects: map.economyObjects,
    players: map.players.map((player) => ({
      playerType: player.playerType || null,
      gold: player.gold || 0,
      towns: normalizeList(player.towns),
      units: normalizeUnits(player.units),
      suburbs: player.suburbs || [],
      farms: normalizeList(player.farms),
      barracks: normalizeList(player.barracks),
      towers: normalizeList(player.towers),
      bastions: normalizeList(player.bastions)
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

function assertExclusiveNoOverlap(map, seed) {
  const occupied = new Map();
  function claim(coord, label) {
    assert(coord.x >= 0 && coord.y >= 0 && coord.x < 20 && coord.y < 20,
      label + ' is outside the map', { seed, coord });
    const key = coordKey(coord);
    assert(!occupied.has(key),
      label + ' overlaps ' + occupied.get(key), { seed, coord, previous: occupied.get(key) });
    occupied.set(key, label);
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const field of ['towns', 'farms', 'barracks', 'towers', 'bastions']) {
      for (const object of player[field] || []) {
        claim(object, 'player ' + playerIndex + ' ' + field);
      }
    }
    for (const unit of player.units || []) {
      claim(unit, 'player ' + playerIndex + ' unit ' + unitTypeName(unit));
    }
  }
}

function assertMirroredSetup(map, seed, observed) {
  const left = map.players[1];
  const right = map.players[2];

  assert(map.mapSize.x === 20 && map.mapSize.y === 20,
    'advanced stage 14 must generate 20x20 maps', { seed, mapSize: map.mapSize });
  assert(map.advancedEconomyStage === 14 &&
      map.economyGenerator && map.economyGenerator.stage === 'advanced-14',
    'advanced stage 14 metadata is missing', { seed, economyGenerator: map.economyGenerator });
  assert(map.symmetry && map.symmetry.axis === 'vertical' &&
      map.economyGenerator.benchmarkSpecificAdvantage === false,
    'advanced stage 14 must document fair vertical symmetry', { seed, symmetry: map.symmetry });
  assert(left.playerType === 'AIPlayerWithEconomy' &&
      right.playerType === 'SimpleAiPlayerWithEconomy',
    'advanced stage 14 should preserve economy runtime player classes',
    { seed, players: map.players.map((player) => player.playerType) });
  assert(left.gold === right.gold,
    'advanced stage 14 starting resources are not equivalent',
    { seed, leftGold: left.gold, rightGold: right.gold });
  observed.goldValues.add(left.gold);

  assert(left.towns.length >= 0 && left.towns.length <= 3 &&
      left.towns.length === right.towns.length,
    'advanced stage 14 town counts are not mirrored', { seed, left: left.towns, right: right.towns });
  observed.townCounts.add(left.towns.length);

  assert(JSON.stringify(normalizeList(left.towns.map((town) => {
    const mirrored = mirrorX(town, map.mapSize);
    return { x: mirrored.x, y: mirrored.y, hp: town.hp };
  }))) === JSON.stringify(normalizeList(right.towns)),
    'advanced stage 14 town coordinates or HP are not mirrored', { seed });

  for (const town of left.towns.concat(right.towns)) {
    assert(town.x > 0 && town.y > 0 && town.x < 19 && town.y < 19,
      'advanced stage 14 town should stay away from map edges', { seed, town });
    assertHp(town, buildingMaxHp.towns,
      'advanced stage 14 town HP is outside 1..maxHp', { seed });
    observed.hpValues.add('town:' + town.hp);
  }

  assert(left.suburbs.length === right.suburbs.length,
    'advanced stage 14 suburb layout counts are not mirrored', { seed });
  const claimed = new Map();
  let capturedSuburbs = 0;
  for (let i = 0; i < left.suburbs.length; i += 1) {
    const leftLayout = left.suburbs[i];
    const rightLayout = right.suburbs[i];
    assert(coordKey(mirrorX(leftLayout.town, map.mapSize)) === coordKey(rightLayout.town),
      'advanced stage 14 suburb town references are not mirrored', { seed, leftLayout, rightLayout });
    assert(JSON.stringify(normalizeList(leftLayout.cells.map((cell) => mirrorX(cell, map.mapSize)))) ===
        JSON.stringify(normalizeList(rightLayout.cells)),
      'advanced stage 14 captured suburb cells are not mirrored', { seed, leftLayout, rightLayout });
    assert(leftLayout.cells.length >= 2 && rightLayout.cells.length >= 2,
      'advanced stage 14 should create captured cells around generated towns',
      { seed, leftLayout, rightLayout });
    for (const cell of leftLayout.cells.concat(rightLayout.cells)) {
      assert(cell.x >= 0 && cell.y >= 0 && cell.x < 20 && cell.y < 20,
        'advanced stage 14 captured cell is outside the map', { seed, cell });
      assert(!claimed.has(coordKey(cell)),
        'advanced stage 14 captured cell is claimed more than once',
        { seed, cell, previous: claimed.get(coordKey(cell)) });
      claimed.set(coordKey(cell), true);
      capturedSuburbs += 1;
    }
  }

  for (const field of ['farms', 'barracks', 'towers', 'bastions']) {
    assert(left[field].length === right[field].length,
      'advanced stage 14 ' + field + ' counts are not mirrored', { seed, left: left[field], right: right[field] });
    assert(JSON.stringify(normalizeList(left[field].map((building) =>
        mirrorBuilding(building, map.mapSize)))) === JSON.stringify(normalizeList(right[field])),
      'advanced stage 14 ' + field + ' coordinates, town references, or HP are not mirrored', { seed });
    for (const building of left[field].concat(right[field])) {
      assertHp(building, buildingMaxHp[field],
        'advanced stage 14 ' + field + ' HP is outside 1..maxHp', { seed });
      observed.hpValues.add(field + ':' + building.hp);
    }
    if (left[field].length > 0) {
      observed[field] = true;
    }
  }

  assert(left.units.length >= 1 && left.units.length === right.units.length,
    'advanced stage 14 unit counts are not mirrored', { seed, leftUnits: left.units, rightUnits: right.units });
  assert(JSON.stringify(normalizeUnits(left.units.map((unit) => mirrorUnit(unit, map.mapSize)))) ===
      JSON.stringify(normalizeUnits(right.units)),
    'advanced stage 14 unit type, coordinate, or HP mirrors differ', { seed });
  for (const unit of left.units.concat(right.units)) {
    const typeName = unitTypeName(unit);
    assert(unitMaxHp[typeName],
      'advanced stage 14 generated an unsupported unit type', { seed, unit, typeName });
    assertHp(unit, unitMaxHp[typeName],
      'advanced stage 14 unit HP is outside 1..maxHp', { seed, typeName });
    observed.unitTypes.add(typeName);
    observed.hpValues.add(typeName + ':' + unit.hp);
  }

  assertExclusiveNoOverlap(map, seed);
  assert(map.economyObjects.towns === left.towns.length + right.towns.length &&
      map.economyObjects.units === left.units.length + right.units.length &&
      map.economyObjects.farms === left.farms.length + right.farms.length &&
      map.economyObjects.barracks === left.barracks.length + right.barracks.length &&
      map.economyObjects.towers === left.towers.length + right.towers.length &&
      map.economyObjects.bastions === left.bastions.length + right.bastions.length &&
      map.economyObjects.capturedSuburbs === capturedSuburbs &&
      map.economyObjects.resources === left.gold + right.gold,
    'advanced stage 14 economy object summary is incorrect', { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateAdvancedEconomyStage14TrainingMap: context.generateAdvancedEconomyStage14TrainingMap
};`)(context);

assert(typeof api.generateAdvancedEconomyStage14TrainingMap === 'function',
  'generateAdvancedEconomyStage14TrainingMap must be exported to the AI script context');

const observed = {
  townCounts: new Set(),
  unitTypes: new Set(),
  hpValues: new Set(),
  goldValues: new Set(),
  farms: false,
  barracks: false,
  towers: false,
  bastions: false,
  capturedSuburbs: false
};
const layouts = new Set();
let smokeSeed = null;

for (let seed = 15100; seed < 15380; seed += 1) {
  const map = api.generateAdvancedEconomyStage14TrainingMap({ seed });
  assertMirroredSetup(map, seed, observed);
  const repeated = api.generateAdvancedEconomyStage14TrainingMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'advanced stage 14 map generation is not deterministic for seed ' + seed);
  layouts.add(normalizeMap(map));
  if (map.economyObjects.capturedSuburbs > 0) {
    observed.capturedSuburbs = true;
  }

  const runtime = map.start();
  assert(runtime.players[1].gold === runtime.players[2].gold,
    'advanced stage 14 runtime resources are not mirrored after start', { seed });
  assert(runtime.players[1].towns.length === map.players[1].towns.length &&
      runtime.players[2].towns.length === map.players[2].towns.length,
    'advanced stage 14 runtime lost configured towns', { seed });
  assert(runtime.players[1].units.length >= map.players[1].units.length &&
      runtime.players[2].units.length >= map.players[2].units.length,
    'advanced stage 14 runtime lost configured units', { seed });

  if (smokeSeed === null && map.players[1].towns.length === 1) {
    smokeSeed = seed;
  }
}

for (const count of [0, 1, 2, 3]) {
  assert(observed.townCounts.has(count),
    'advanced stage 14 fixed-seed sample did not generate town count ' + count,
    { observedTownCounts: Array.from(observed.townCounts) });
}
for (const typeName of Object.keys(unitMaxHp)) {
  assert(observed.unitTypes.has(typeName),
    'advanced stage 14 fixed-seed sample did not generate unit type ' + typeName,
    { observedUnitTypes: Array.from(observed.unitTypes) });
}
for (const field of ['farms', 'barracks', 'towers', 'bastions']) {
  assert(observed[field],
    'advanced stage 14 fixed-seed sample did not generate ' + field);
}
assert(observed.capturedSuburbs,
  'advanced stage 14 fixed-seed sample did not generate captured suburbs');
assert(observed.unitTypes.size >= 3,
  'advanced stage 14 fixed-seed sample did not vary generated unit types',
  { observedUnitTypes: Array.from(observed.unitTypes) });
assert(observed.hpValues.size > 8,
  'advanced stage 14 fixed-seed sample did not vary configured HP values',
  { hpValues: Array.from(observed.hpValues) });
assert(observed.goldValues.size > 1 && layouts.size > 4,
  'advanced stage 14 fixed seeds did not vary fair resources or layouts',
  { goldValues: Array.from(observed.goldValues), layoutCount: layouts.size });
assert(smokeSeed !== null,
  'advanced stage 14 fixed-seed sample did not find a one-town-per-player benchmark smoke seed');

const smokeMap = api.generateAdvancedEconomyStage14TrainingMap({
  seed: smokeSeed,
  suddenDeathRound: 20
});
const smokeResult = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed: smokeSeed,
  roundLimit: 5,
  actionLimit: 4,
  commandLimit: 32
});

assert(!smokeResult.crash,
  'short advanced stage 14 economy smoke crashed', smokeResult);
assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy' &&
    smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
  'short advanced stage 14 smoke did not run the required economy AI classes', smokeResult);
assert(smokeResult.turnCount > 0,
  'short advanced stage 14 smoke game did not advance', smokeResult);

console.log('Advanced economy stage 14 symmetric 20x20 random map generation smoke passed');
