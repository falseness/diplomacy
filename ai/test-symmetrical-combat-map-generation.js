const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    if (details) {
      error.details = details;
    }
    throw error;
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function mirrorX(coord, mapSize) {
  return { x: mapSize.x - 1 - coord.x, y: coord.y };
}

function normalizeEntry(entry) {
  return JSON.stringify(entry);
}

function normalizeTerrainList(list) {
  return (list || []).map((coord) => normalizeEntry({
    x: coord.x,
    y: coord.y,
    hp: coord.hp || null,
    income: coord.income || null,
    owner: Object.prototype.hasOwnProperty.call(coord, 'owner') ? coord.owner : null
  })).sort();
}

function normalizeCoordList(list) {
  return (list || []).map((coord) => normalizeEntry({
    x: coord.x,
    y: coord.y
  })).sort();
}

function normalizeUnitList(units) {
  return (units || []).map((unit) => normalizeEntry({
    type: unitTypeName(unit),
    x: unit.x,
    y: unit.y,
    hp: unit.hp || null
  })).sort();
}

function normalizeBuildingList(buildings) {
  return (buildings || []).map((building) => normalizeEntry({
    x: building.x,
    y: building.y,
    hp: building.hp || null,
    town: building.town ? {
      x: building.town.x,
      y: building.town.y,
      hp: building.town.hp || null
    } : null
  })).sort();
}

function normalizeMap(map) {
  return JSON.stringify({
    testName: map.testName,
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    combatStage: map.combatStage,
    combatOnly: map.combatOnly,
    symmetry: map.symmetry,
    combatMetrics: map.combatMetrics,
    playerNoobCounts: map.playerNoobCounts,
    playerNormchelCounts: map.playerNormchelCounts,
    playerKOHbCounts: map.playerKOHbCounts,
    playerArcherCounts: map.playerArcherCounts,
    playerCatapultCounts: map.playerCatapultCounts,
    terrain: {
      lakes: normalizeTerrainList(map.lakes),
      mountains: normalizeTerrainList(map.mountains),
      bushes: normalizeTerrainList(map.bushes),
      hills: normalizeTerrainList(map.hills)
    },
    players: map.players.map((player) => ({
      playerType: player.playerType || null,
      towns: normalizeTerrainList(player.towns),
      units: normalizeUnitList(player.units),
      suburbs: (player.suburbs || []).map((suburb) => ({
        town: suburb.town,
        cells: normalizeTerrainList(suburb.cells),
        expansionCells: normalizeTerrainList(suburb.expansionCells)
      })),
      walls: normalizeBuildingList(player.walls),
      bastions: normalizeBuildingList(player.bastions),
      towers: normalizeBuildingList(player.towers)
    }))
  });
}

function assertMirroredTerrain(map, property) {
  const actual = normalizeTerrainList(map[property]);
  const mirrored = normalizeTerrainList((map[property] || []).map((coord) =>
    Object.assign({}, coord, mirrorX(coord, map.mapSize))));
  assert(
    JSON.stringify(actual) === JSON.stringify(mirrored),
    property + ' are not mirrored',
    { actual, mirrored }
  );
}

function mirrorUnitForComparison(unit, mapSize) {
  const mirrored = Object.assign({}, unit, mirrorX(unit, mapSize));
  return {
    type: unitTypeName(mirrored),
    x: mirrored.x,
    y: mirrored.y,
    hp: mirrored.hp || null
  };
}

function mirrorBuildingForComparison(building, mapSize) {
  const mirrored = Object.assign({}, building, mirrorX(building, mapSize));
  return {
    x: mirrored.x,
    y: mirrored.y,
    hp: mirrored.hp || null,
    town: building.town ? Object.assign({}, building.town, mirrorX(building.town, mapSize)) : null
  };
}

function assertMirroredPlayerSetup(map, seed) {
  const left = map.players[1];
  const right = map.players[2];
  assert(left.playerType === 'AIPlayer', 'left side should be AIPlayer');
  assert(right.playerType === 'SimpleAiPlayer', 'right side should be SimpleAiPlayer');
  assert(left.towns.length === 1 && right.towns.length === 1,
    'symmetrical combat map should have one mirrored objective town per player');
  assert(normalizeTerrainList(left.towns.map((town) =>
    Object.assign({}, town, mirrorX(town, map.mapSize))))[0] === normalizeTerrainList(right.towns)[0],
    'town positions or HP are not mirrored for seed ' + seed);

  const leftMirroredUnits = left.units.map((unit) =>
    normalizeEntry(mirrorUnitForComparison(unit, map.mapSize))).sort();
  assert(
    JSON.stringify(leftMirroredUnits) === JSON.stringify(normalizeUnitList(right.units)),
    'units are not mirrored for seed ' + seed,
    { leftMirroredUnits, rightUnits: normalizeUnitList(right.units) }
  );

  for (const property of ['walls', 'bastions', 'towers']) {
    const leftMirroredBuildings = (left[property] || []).map((building) =>
      normalizeEntry(mirrorBuildingForComparison(building, map.mapSize))).sort();
    assert(
      JSON.stringify(leftMirroredBuildings) === JSON.stringify(normalizeBuildingList(right[property])),
      property + ' are not mirrored for seed ' + seed,
      { leftMirroredBuildings, rightBuildings: normalizeBuildingList(right[property]) }
    );
  }

  const leftMirroredSuburbs = (left.suburbs || []).map((suburb) => ({
    town: Object.assign({}, suburb.town, mirrorX(suburb.town, map.mapSize)),
    cells: normalizeCoordList((suburb.cells || []).map((cell) =>
      Object.assign({}, cell, mirrorX(cell, map.mapSize)))),
    expansionCells: normalizeCoordList((suburb.expansionCells || []).map((cell) =>
      Object.assign({}, cell, mirrorX(cell, map.mapSize))))
  }));
  const rightSuburbs = (right.suburbs || []).map((suburb) => ({
    town: suburb.town,
    cells: normalizeCoordList(suburb.cells),
    expansionCells: normalizeCoordList(suburb.expansionCells)
  }));
  assert(
    JSON.stringify(leftMirroredSuburbs) === JSON.stringify(rightSuburbs),
    'suburb ownership layouts are not mirrored for seed ' + seed,
    { leftMirroredSuburbs, rightSuburbs }
  );

  assert(
    left.gold === right.gold,
    'configured starting resources are not mirrored for seed ' + seed,
    { leftGold: left.gold, rightGold: right.gold }
  );

  const requiredTypes = ['Noob', 'Normchel', 'KOHb', 'Archer', 'Catapult'];
  const generatedTypes = new Set(left.units.concat(right.units).map(unitTypeName));
  for (const type of requiredTypes) {
    assert(generatedTypes.has(type), 'missing final-stage combat unit type ' + type);
  }
}

function assertCombatOnly(map) {
  assert(map.combatOnly === true, 'map should be marked combat-only');
  assert(map.combatMetrics.benchmarkPassFailLogic === false,
    'generator should not contain benchmark pass/fail logic');
  for (const [name, count] of Object.entries(map.economyObjects || {})) {
    assert(count === 0, 'combat generator should not include economy object count for ' + name);
  }
}

function assertMirroredRuntimeResources(runtime, seed) {
  assert(runtime.players[1].gold === runtime.players[2].gold,
    'runtime starting gold is not mirrored for seed ' + seed,
    { playerOneGold: runtime.players[1].gold, playerTwoGold: runtime.players[2].gold });
  assert(runtime.players[1].income === runtime.players[2].income,
    'runtime starting income is not mirrored for seed ' + seed,
    { playerOneIncome: runtime.players[1].income, playerTwoIncome: runtime.players[2].income });
}

function expectMirrorFailure(label, mutateMap) {
  const map = api.generateSymmetricalCombatStageGMap({ seed: 109999 });
  mutateMap(map);
  let failed = false;
  try {
    assertMirroredPlayerSetup(map, label);
    for (const property of ['lakes', 'mountains', 'bushes', 'hills']) {
      assertMirroredTerrain(map, property);
    }
  } catch (error) {
    failed = true;
  }
  assert(failed, 'mirror fairness test did not reject intentional asymmetry: ' + label);
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateSymmetricalCombatStageGMap: context.generateSymmetricalCombatStageGMap
};`)(context);

assert(api.generateSymmetricalCombatStageGMap,
  'generateSymmetricalCombatStageGMap is not exported to the AI script context');

const seeds = [108001, 108002, 108003, 108004];
for (const seed of seeds) {
  const map = api.generateSymmetricalCombatStageGMap({ seed });
  assert(map.mapSize.x === 11 && map.mapSize.y === 9,
    'default symmetrical combat map should use stable 11x9 bounds');
  assert(map.players.length === 3, 'map should include neutral plus two combat players');
  assert(map.symmetry && map.symmetry.axis === 'vertical',
    'map should record vertical mirror metadata');
  assertCombatOnly(map);
  assertMirroredPlayerSetup(map, seed);
  for (const property of ['lakes', 'mountains', 'bushes', 'hills']) {
    assertMirroredTerrain(map, property);
  }
  const runtime = map.start();
  assert(runtime.players.length === 3,
    'headless start should preserve players for seed ' + seed);
  assertMirroredRuntimeResources(runtime, seed);

  const repeated = api.generateSymmetricalCombatStageGMap({ seed });
  assert(normalizeMap(map) === normalizeMap(repeated),
    'same seed did not reproduce the same symmetrical combat map for seed ' + seed);
}

expectMirrorFailure('unit HP advantage', (map) => {
  map.players[2].units[0].hp += 1;
});
expectMirrorFailure('terrain advantage', (map) => {
  map.mountains.push({ x: 4, y: 4 });
});
expectMirrorFailure('resource advantage', (map) => {
  map.players[1].gold = 90;
  map.players[2].gold = 95;
});
expectMirrorFailure('ownership advantage', (map) => {
  map.players[2].suburbs[0].cells.pop();
});

const smokeMap = api.generateSymmetricalCombatStageGMap({ seed: seeds[0] });
const smokeGame = runGame({
  gameMap: smokeMap,
  playerA: 'AIPlayer',
  playerB: 'SimpleAiPlayer',
  seed: seeds[0],
  roundLimit: 4,
  actionLimit: 30,
  commandLimit: 60
});
assert(smokeGame.runtimePlayerA === 'AIPlayer',
  'benchmark harness did not instantiate AIPlayer');
assert(smokeGame.runtimePlayerB === 'SimpleAiPlayer',
  'benchmark harness did not instantiate SimpleAiPlayer');
assert(!smokeGame.crash, 'benchmark harness smoke crashed');
assert(smokeGame.inference.calls > 0,
  'AIPlayer benchmark smoke did not exercise inference');

console.log('TASK-109 symmetrical combat fairness smoke passed across ' + seeds.length + ' seeds');
