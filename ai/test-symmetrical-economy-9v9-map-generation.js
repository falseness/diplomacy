const { loadAiScripts } = require('./smokeHarness');
const { runCheckpointSmoke } = require('./tests/checkpoint-smoke.cjs');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function mirrorX(coord, mapSize) {
  return { x: mapSize.x - 1 - coord.x, y: coord.y };
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function normalizeEntry(entry) {
  return JSON.stringify(entry);
}

function normalizeCoordList(list) {
  return (list || []).map((coord) => normalizeEntry({
    x: coord.x,
    y: coord.y,
    hp: Object.prototype.hasOwnProperty.call(coord, 'hp') ? coord.hp : null,
    income: Object.prototype.hasOwnProperty.call(coord, 'income') ? coord.income : null,
    owner: Object.prototype.hasOwnProperty.call(coord, 'owner') ? coord.owner : null
  })).sort();
}

function normalizeUnits(units) {
  return (units || []).map((unit) => normalizeEntry({
    type: unitTypeName(unit),
    x: unit.x,
    y: unit.y,
    hp: Object.prototype.hasOwnProperty.call(unit, 'hp') ? unit.hp : null
  })).sort();
}

function normalizeOwnedBuildings(buildings) {
  return (buildings || []).map((building) => normalizeEntry({
    x: building.x,
    y: building.y,
    hp: Object.prototype.hasOwnProperty.call(building, 'hp') ? building.hp : null,
    town: building.town ? {
      x: building.town.x,
      y: building.town.y
    } : null
  })).sort();
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

function mirrorFarmOrBarrack(building, mapSize) {
  const mirrored = mirrorX(building, mapSize);
  return {
    x: mirrored.x,
    y: mirrored.y,
    hp: null,
    town: building.town ? mirrorX(building.town, mapSize) : null
  };
}

function normalizeMap(map) {
  return JSON.stringify({
    testName: map.testName,
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
      suburbs: player.suburbs || [],
      farms: normalizeOwnedBuildings(player.farms),
      barracks: normalizeOwnedBuildings(player.barracks),
      towers: normalizeOwnedBuildings(player.towers),
      bastions: normalizeOwnedBuildings(player.bastions)
    }))
  });
}

function assertInBounds(coord, mapSize, label, details) {
  assert(coord.x >= 0 && coord.y >= 0 && coord.x < mapSize.x && coord.y < mapSize.y,
    label + ' is outside the 9v9 map', Object.assign({ coord, mapSize }, details || {}));
}

function assertNoOverlap(map, seed) {
  const occupied = new Map();
  function claim(coord, label) {
    assertInBounds(coord, map.mapSize, label, { seed });
    const key = coordKey(coord);
    assert(!occupied.has(key),
      label + ' overlaps ' + occupied.get(key), { seed, coord, previous: occupied.get(key) });
    occupied.set(key, label);
  }

  for (const property of ['lakes', 'mountains', 'bushes', 'hills', 'goldmines']) {
    for (const coord of map[property] || []) {
      claim(coord, property);
    }
  }

  for (const playerIndex of [1, 2]) {
    const player = map.players[playerIndex];
    for (const property of ['towns', 'farms', 'barracks', 'towers', 'bastions']) {
      for (const coord of player[property] || []) {
        claim(coord, 'player ' + playerIndex + ' ' + property);
      }
    }
    for (const unit of player.units || []) {
      claim(unit, 'player ' + playerIndex + ' unit ' + unitTypeName(unit));
    }
  }
}

function assertMirroredTerrain(map, property, seed) {
  const mirrored = (map[property] || []).map((coord) => {
    const mirror = mirrorX(coord, map.mapSize);
    return Object.assign({}, coord, mirror);
  });
  assert(JSON.stringify(normalizeCoordList(map[property])) === JSON.stringify(normalizeCoordList(mirrored)),
    property + ' are not symmetrical for seed ' + seed,
    { actual: normalizeCoordList(map[property]), mirrored: normalizeCoordList(mirrored) });
}

function assertMirroredEconomy(map, seed) {
  const left = map.players[1];
  const right = map.players[2];

  assert(map.mapSize.x === 9 && map.mapSize.y === 9,
    'symmetrical economy generator must use the 9v9 footprint', { seed, mapSize: map.mapSize });
  assert(left.playerType === 'AIPlayerWithEconomy' &&
      right.playerType === 'SimpleAiPlayerWithEconomy',
    'generator must use economy AI classes', { seed, left: left.playerType, right: right.playerType });
  assert(left.gold === right.gold,
    'starting resources are not equivalent', { seed, leftGold: left.gold, rightGold: right.gold });

  const requiredTypes = ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'];
  const leftTypes = new Set((left.units || []).map(unitTypeName));
  const rightTypes = new Set((right.units || []).map(unitTypeName));
  for (const type of requiredTypes) {
    assert(leftTypes.has(type) && rightTypes.has(type),
      'missing all-unit coverage for ' + type, { seed, leftTypes: Array.from(leftTypes), rightTypes: Array.from(rightTypes) });
  }

  assert(JSON.stringify(normalizeUnits(left.units.map((unit) => mirrorUnit(unit, map.mapSize)))) ===
      JSON.stringify(normalizeUnits(right.units)),
    'unit type, coordinate, or HP mirrors differ', { seed });

  for (const property of ['towers', 'bastions']) {
    assert(JSON.stringify(normalizeOwnedBuildings(left[property].map((building) =>
        mirrorBuilding(building, map.mapSize)))) === JSON.stringify(normalizeOwnedBuildings(right[property])),
      property + ' type, coordinate, town, or HP mirrors differ', { seed });
  }

  for (const property of ['farms', 'barracks']) {
    assert(JSON.stringify(normalizeOwnedBuildings(left[property].map((building) =>
        mirrorFarmOrBarrack(building, map.mapSize)))) === JSON.stringify(normalizeOwnedBuildings(right[property])),
      property + ' coordinates or town mirrors differ', { seed });
  }

  const leftOwnedGoldmine = (map.goldmines || []).find((goldmine) => goldmine.owner === 1);
  const rightOwnedGoldmine = (map.goldmines || []).find((goldmine) => goldmine.owner === 2);
  assert(leftOwnedGoldmine && rightOwnedGoldmine,
    'both players need an owned goldmine', { seed, goldmines: map.goldmines });
  const mirroredLeftGoldmine = Object.assign({}, leftOwnedGoldmine, mirrorX(leftOwnedGoldmine, map.mapSize), { owner: 2 });
  assert(JSON.stringify(normalizeCoordList([mirroredLeftGoldmine])) ===
      JSON.stringify(normalizeCoordList([rightOwnedGoldmine])),
    'owned goldmine mirrors differ', { seed, leftOwnedGoldmine, rightOwnedGoldmine });
  const neutralGoldmine = (map.goldmines || []).find((goldmine) => goldmine.owner === 0);
  assert(neutralGoldmine && neutralGoldmine.x === Math.floor(map.mapSize.x / 2),
    'neutral goldmine should sit on the symmetry axis', { seed, goldmines: map.goldmines });

  for (const property of ['lakes', 'mountains', 'bushes', 'hills']) {
    assertMirroredTerrain(map, property, seed);
  }

  assert(map.symmetry && map.symmetry.benchmarkSpecificAdvantage === false &&
      map.economyGenerator.benchmarkSpecificAdvantage === false,
    'generator must not encode benchmark-specific player advantages', { seed, metadata: map.economyGenerator });
  assert(map.economyObjects.farms === 2 &&
      map.economyObjects.barracks === 2 &&
      map.economyObjects.goldmines === 3 &&
      map.economyObjects.towers === 2 &&
      map.economyObjects.bastions === 2,
    'economy object summary is incomplete', { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateSymmetricalEconomy9v9AllUnitMap: context.generateSymmetricalEconomy9v9AllUnitMap
};`)(context);

async function main() {
  assert(typeof api.generateSymmetricalEconomy9v9AllUnitMap === 'function',
    'generateSymmetricalEconomy9v9AllUnitMap must be exported');

  const seeds = [13400, 13401, 13402, 13403, 13404, 13405, 13406, 13407];
  const observedLayouts = new Set();

  for (const seed of seeds) {
    const map = api.generateSymmetricalEconomy9v9AllUnitMap({ seed });
    assertMirroredEconomy(map, seed);
    assertNoOverlap(map, seed);
    observedLayouts.add(normalizeMap(map));

    const repeated = api.generateSymmetricalEconomy9v9AllUnitMap({ seed });
    assert(normalizeMap(map) === normalizeMap(repeated),
      'same seed did not reproduce the same symmetrical economy map', { seed });

    const runtime = map.start();
    assert(runtime.players[1].gold === runtime.players[2].gold,
      'runtime resources are not mirrored after start', { seed });
    const runtimePlayerOneUnits = runtime.players[1].units.filter((unit) => unit && unit.name);
    const runtimePlayerTwoUnits = runtime.players[2].units.filter((unit) => unit && unit.name);
    assert(runtimePlayerOneUnits.length === 5 && runtimePlayerTwoUnits.length === 5,
      'runtime did not create all configured units', { seed });
    assert(runtime.players[1].towers.length === 1 && runtime.players[2].towers.length === 1 &&
        runtime.players[1].bastions.length === 1 && runtime.players[2].bastions.length === 1,
      'runtime did not create configured defensive buildings', { seed });
  }

  assert(observedLayouts.size >= 2,
    'deterministic seeds should still produce varied HP or unit ordering', { observedLayouts: Array.from(observedLayouts) });

  const smokeMap = api.generateSymmetricalEconomy9v9AllUnitMap({ seed: 13442, suddenDeathRound: 20 });
  const smokeResult = await runCheckpointSmoke({
    gameMap: smokeMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: 13442,
    roundLimit: 5,
    actionLimit: 4,
    commandLimit: 32
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(!smokeResult.crash, 'short symmetrical economy smoke crashed', smokeResult);
  assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy' &&
      smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'short smoke did not run the required economy AI classes', smokeResult);
  assert(smokeResult.turnCount > 0,
    'short smoke game did not advance', smokeResult);

  console.log('TASK-134 symmetrical economy 9v9 map generation smoke passed');

}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
