const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function mirrorX(coord, mapSize) {
  return { x: mapSize.x - 1 - coord.x, y: coord.y };
}

function normalizeEntries(entries) {
  return entries.map((entry) => JSON.stringify(entry)).sort();
}

function normalizeCoordList(coords) {
  return normalizeEntries((coords || []).map((coord) => ({
    x: coord.x,
    y: coord.y,
    hp: Object.prototype.hasOwnProperty.call(coord, 'hp') ? coord.hp : null,
    income: Object.prototype.hasOwnProperty.call(coord, 'income') ? coord.income : null,
    owner: Object.prototype.hasOwnProperty.call(coord, 'owner') ? coord.owner : null
  })));
}

function normalizeUnits(units) {
  return normalizeEntries((units || []).map((unit) => ({
    type: unitTypeName(unit),
    x: unit.x,
    y: unit.y,
    hp: Object.prototype.hasOwnProperty.call(unit, 'hp') ? unit.hp : null
  })));
}

function normalizeBuildings(buildings) {
  return normalizeEntries((buildings || []).map((building) => ({
    x: building.x,
    y: building.y,
    hp: Object.prototype.hasOwnProperty.call(building, 'hp') ? building.hp : null,
    town: building.town ? { x: building.town.x, y: building.town.y } : null
  })));
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

function mirrorBuilding(building, mapSize) {
  const mirrored = mirrorX(building, mapSize);
  return {
    x: mirrored.x,
    y: mirrored.y,
    hp: Object.prototype.hasOwnProperty.call(building, 'hp') ? building.hp : null,
    town: building.town ? mirrorX(building.town, mapSize) : null
  };
}

function mirrorCoordWithFields(coord, mapSize, fields) {
  const mirrored = mirrorX(coord, mapSize);
  const result = { x: mirrored.x, y: mirrored.y };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(coord, field)) {
      result[field] = coord[field];
    }
  }
  return result;
}

function terrainEntries(map) {
  return []
    .concat((map.lakes || []).map((coord) => ({ type: 'lake', coord })))
    .concat((map.mountains || []).map((coord) => ({ type: 'mountain', coord })))
    .concat((map.bushes || []).map((coord) => ({ type: 'bush', coord })))
    .concat((map.hills || []).map((coord) => ({ type: 'hill', coord })));
}

function normalizedMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    economyStage: map.economyStage,
    symmetry: map.symmetry,
    economyGenerator: map.economyGenerator,
    economyObjects: map.economyObjects,
    goldmines: normalizeCoordList(map.goldmines),
    lakes: normalizeCoordList(map.lakes),
    mountains: normalizeCoordList(map.mountains),
    bushes: normalizeCoordList(map.bushes),
    hills: normalizeCoordList(map.hills),
    players: map.players.map((player) => ({
      playerType: player.playerType || null,
      gold: player.gold || 0,
      towns: normalizeCoordList(player.towns),
      units: normalizeUnits(player.units),
      suburbs: (player.suburbs || []).map((suburb) => ({
        town: suburb.town,
        cells: normalizeCoordList(suburb.cells),
        expansionCells: normalizeCoordList(suburb.expansionCells)
      })),
      farms: normalizeBuildings(player.farms),
      barracks: normalizeBuildings(player.barracks),
      towers: normalizeBuildings(player.towers),
      bastions: normalizeBuildings(player.bastions)
    }))
  });
}

function assertSameNormalized(actual, expected, message, details) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    message, Object.assign({ actual, expected }, details || {}));
}

function assertInBounds(coord, mapSize, message, details) {
  assert(coord.x >= 0 && coord.y >= 0 && coord.x < mapSize.x && coord.y < mapSize.y,
    message, Object.assign({ coord, mapSize }, details || {}));
}

function assertLegalTerrainAndPlacement(map, seed) {
  const occupied = new Map();
  function claim(coord, label) {
    assertInBounds(coord, map.mapSize,
      'symmetrical economy validation found an out-of-bounds ' + label,
      { seed, coord });
    const key = coordKey(coord);
    assert(!occupied.has(key),
      'symmetrical economy validation found overlapping map objects',
      { seed, coord, label, previous: occupied.get(key) });
    occupied.set(key, label);
  }

  for (const entry of terrainEntries(map)) {
    claim(entry.coord, entry.type);
  }
  for (const goldmine of map.goldmines || []) {
    claim(goldmine, 'goldmine');
  }
  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const property of ['towns', 'farms', 'barracks', 'towers', 'bastions']) {
      for (const building of player[property] || []) {
        claim(building, 'player ' + playerIndex + ' ' + property);
      }
    }
    for (const unit of player.units || []) {
      claim(unit, 'player ' + playerIndex + ' unit ' + unitTypeName(unit));
    }
  }
}

function assertMirroredTerrain(map, seed) {
  for (const property of ['lakes', 'mountains', 'bushes', 'hills']) {
    const mirrored = (map[property] || []).map((coord) =>
      mirrorCoordWithFields(coord, map.mapSize, ['hp', 'income', 'owner']));
    assertSameNormalized(normalizeCoordList(map[property]), normalizeCoordList(mirrored),
      'symmetrical economy validation found unfair terrain symmetry',
      { seed, property });
  }
}

function assertMirroredSuburbs(left, right, mapSize, seed) {
  assert((left.suburbs || []).length === (right.suburbs || []).length,
    'symmetrical economy validation found different suburb layout counts', { seed });
  for (let index = 0; index < (left.suburbs || []).length; index += 1) {
    const leftLayout = left.suburbs[index];
    const rightLayout = right.suburbs[index];
    assertSameNormalized(
      normalizeCoordList([mirrorX(leftLayout.town, mapSize)]),
      normalizeCoordList([rightLayout.town]),
      'symmetrical economy validation found mismatched suburb town anchors',
      { seed, index });
    assertSameNormalized(
      normalizeCoordList(leftLayout.cells.map((cell) => mirrorX(cell, mapSize))),
      normalizeCoordList(rightLayout.cells),
      'symmetrical economy validation found mismatched owned suburb cells',
      { seed, index });
    assertSameNormalized(
      normalizeCoordList(leftLayout.expansionCells.map((cell) => mirrorX(cell, mapSize))),
      normalizeCoordList(rightLayout.expansionCells),
      'symmetrical economy validation found mismatched expansion options',
      { seed, index });
  }
}

function assertMirroredEconomyMap(map, seed) {
  const left = map.players[1];
  const right = map.players[2];

  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'symmetrical economy validation expected a 9v9 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'symmetrical economy validation expected neutral plus two players', { seed });
  assert(left.playerType === 'AIPlayerWithEconomy' &&
      right.playerType === 'SimpleAiPlayerWithEconomy',
    'symmetrical economy validation expected the economy AI comparison players',
    { seed, left: left.playerType, right: right.playerType });
  assert(left.gold === right.gold,
    'symmetrical economy validation found unfair starting gold',
    { seed, leftGold: left.gold, rightGold: right.gold });

  assertSameNormalized(
    normalizeCoordList((left.towns || []).map((town) => mirrorX(town, map.mapSize))),
    normalizeCoordList(right.towns || []),
    'symmetrical economy validation found mismatched mirrored towns',
    { seed });
  assertSameNormalized(
    normalizeUnits((left.units || []).map((unit) => mirrorUnit(unit, map.mapSize))),
    normalizeUnits(right.units || []),
    'symmetrical economy validation found mismatched mirrored unit roster, positions, or HP',
    { seed });

  for (const property of ['farms', 'barracks', 'towers', 'bastions']) {
    assertSameNormalized(
      normalizeBuildings((left[property] || []).map((building) =>
        mirrorBuilding(building, map.mapSize))),
      normalizeBuildings(right[property] || []),
      'symmetrical economy validation found mismatched mirrored ' + property,
      { seed });
  }

  assertMirroredSuburbs(left, right, map.mapSize, seed);

  const mirroredGoldmines = (map.goldmines || []).map((mine) => {
    const mirrored = mirrorCoordWithFields(mine, map.mapSize, ['income', 'owner']);
    if (mine.owner === 1) {
      mirrored.owner = 2;
    } else if (mine.owner === 2) {
      mirrored.owner = 1;
    }
    return mirrored;
  });
  assertSameNormalized(normalizeCoordList(map.goldmines), normalizeCoordList(mirroredGoldmines),
    'symmetrical economy validation found unfair goldmine ownership or income',
    { seed, goldmines: map.goldmines });

  assert(map.economyObjects &&
      map.economyObjects.resources === left.gold + right.gold &&
      map.economyObjects.farms === 2 &&
      map.economyObjects.barracks === 2 &&
      map.economyObjects.towers === 2 &&
      map.economyObjects.bastions === 2 &&
      map.economyObjects.goldmines === 3,
    'symmetrical economy validation found incomplete economy summary',
    { seed, economyObjects: map.economyObjects, leftGold: left.gold, rightGold: right.gold });

  assert(map.symmetry && map.symmetry.benchmarkSpecificAdvantage === false &&
      map.economyGenerator && map.economyGenerator.benchmarkSpecificAdvantage === false,
    'symmetrical economy validation found benchmark-specific advantage metadata',
    { seed, symmetry: map.symmetry, economyGenerator: map.economyGenerator });

  assertMirroredTerrain(map, seed);
  assertLegalTerrainAndPlacement(map, seed);
}

function assertRuntimeEconomyState(map, seed) {
  const runtime = map.start();
  const left = runtime.players[1];
  const right = runtime.players[2];
  assert(left.gold === right.gold,
    'symmetrical economy validation found unfair runtime gold after start',
    { seed, leftGold: left.gold, rightGold: right.gold });
  assert(left.income === right.income,
    'symmetrical economy validation found unfair runtime income after start',
    { seed, leftIncome: left.income, rightIncome: right.income });
  assert(left.units.length === right.units.length &&
      left.farms.length === right.farms.length &&
      left.barracks.length === right.barracks.length &&
      left.towers.length === right.towers.length &&
      left.bastions.length === right.bastions.length,
    'symmetrical economy validation found unfair runtime object counts',
    {
      seed,
      left: {
        units: left.units.length,
        farms: left.farms.length,
        barracks: left.barracks.length,
        towers: left.towers.length,
        bastions: left.bastions.length
      },
      right: {
        units: right.units.length,
        farms: right.farms.length,
        barracks: right.barracks.length,
        towers: right.towers.length,
        bastions: right.bastions.length
      }
    });
}

function assertThrowsValidation(label, buildMap) {
  let threw = false;
  try {
    assertMirroredEconomyMap(buildMap(), 'mutation-' + label);
  } catch (error) {
    threw = true;
  }
  assert(threw,
    'symmetrical economy validation did not reject intentionally unfair ' + label);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateSymmetricalEconomy9v9AllUnitMap: context.generateSymmetricalEconomy9v9AllUnitMap
};`)(context);

assert(typeof api.generateSymmetricalEconomy9v9AllUnitMap === 'function',
  'generateSymmetricalEconomy9v9AllUnitMap must be exported');

const seeds = [
  1, 2, 3, 4, 5, 36, 37, 38,
  39, 40, 682, 683, 684, 685, 686, 1327,
  1328, 1329, 1330, 1331, 13500, 13501, 13502, 13503
];
const observedLayouts = new Set();
const observedTowerHp = new Set();
const observedBastionHp = new Set();
const observedUnitHp = new Set();
const observedGoldmineIncome = new Set();

for (const seed of seeds) {
  const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed });
  assertMirroredEconomyMap(map, seed);
  assertRuntimeEconomyState(map, seed);
  observedLayouts.add(normalizedMap(map));
  observedTowerHp.add(map.economyGenerator.hpByType.tower);
  observedBastionHp.add(map.economyGenerator.hpByType.bastion);
  observedGoldmineIncome.add(map.economyGenerator.goldmineIncome);
  for (const unit of map.players[1].units) {
    observedUnitHp.add(unitTypeName(unit) + ':' + unit.hp);
  }

  const repeated = api.generateSymmetricalEconomy9v9AllUnitMap({ seed });
  assert(normalizedMap(map) === normalizedMap(repeated),
    'symmetrical economy validation expected deterministic replay',
    { seed });
}

assert(observedLayouts.size >= 2,
  'symmetrical economy validation expected multiple deterministic layouts across seeds',
  { seeds });
assert(observedTowerHp.size >= 2 && observedBastionHp.size >= 2,
  'symmetrical economy validation expected defensive HP variation across seeds',
  {
    towerHp: Array.from(observedTowerHp),
    bastionHp: Array.from(observedBastionHp)
  });
assert(observedUnitHp.size >= 5,
  'symmetrical economy validation expected unit HP distribution coverage',
  { observedUnitHp: Array.from(observedUnitHp) });
assert(observedGoldmineIncome.size >= 2,
  'symmetrical economy validation expected resource-income variation across seeds',
  { observedGoldmineIncome: Array.from(observedGoldmineIncome) });

assertThrowsValidation('starting resources', () => {
  const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed: 13590 });
  map.players[2].gold += 1;
  return map;
});
assertThrowsValidation('unit hp', () => {
  const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed: 13591 });
  map.players[2].units[0].hp += 1;
  return map;
});
assertThrowsValidation('building hp', () => {
  const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed: 13592 });
  map.players[2].towers[0].hp += 1;
  return map;
});
assertThrowsValidation('goldmine income', () => {
  const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed: 13593 });
  map.goldmines.find((mine) => mine.owner === 2).income += 1;
  return map;
});
assertThrowsValidation('terrain placement', () => {
  const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed: 13594 });
  map.mountains[1].y += 1;
  return map;
});

console.log('TASK-135 symmetrical economy 9v9 validation passed for ' + seeds.length + ' deterministic seeds');
