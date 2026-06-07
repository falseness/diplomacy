const vm = require('vm');
const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function key(coord) {
  return coord.x + ':' + coord.y;
}

function isNeighbour(town, coord) {
  return [
    {x: town.x - 1, y: town.y},
    {x: town.x + 1, y: town.y},
    {x: town.x, y: town.y - 1},
    {x: town.x, y: town.y + 1},
    {x: town.x - 1, y: town.y + 1},
    {x: town.x + 1, y: town.y - 1}
  ].some(candidate => key(candidate) === key(coord));
}

const { context } = loadAiScripts();
new vm.Script(`
  whooseTurn = 1;
  players = [
    {gold: 0, income: 0, towns: []},
    {gold: 100, income: 10, towns: []},
    {gold: 100, income: 10, towns: []}
  ];
  suddenDeathRound = 20;
  gameRound = 0;
`).runInContext(context);
const api = new vm.Script(`({
  generateTownTrainingMap,
  vectorizeCell,
  CELL_VECTOR_INDEX
})`).runInContext(context);

const typeProperties = ['walls', 'bastions', 'towers'];
const vectorChannels = {
  walls: api.CELL_VECTOR_INDEX.isWall,
  bastions: api.CELL_VECTOR_INDEX.isBastion,
  towers: api.CELL_VECTOR_INDEX.isTower
};
const densityTotals = {};

for (const density of ['sparse', 'normal', 'dense']) {
  densityTotals[density] = 0;
  for (let seed = 1; seed <= 40; ++seed) {
    const map = api.generateTownTrainingMap({
      size: 'big',
      seed,
      buildingDensity: density,
      barrackDensity: density === 'dense' ? 0 : undefined,
      farmDensity: density === 'dense' ? 0 : undefined,
      goldmineCount: 0,
      unitsPerPlayer: 0
    });
    const occupied = {};
    for (const coord of [].concat(map.lakes, map.mountains)) {
      occupied[key(coord)] = 'terrain';
    }
    for (const player of map.players) {
      for (const town of player.towns) {
        occupied[key(town)] = 'town';
      }
    }

    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
      const player = map.players[playerIndex];
      for (const property of typeProperties) {
        for (const building of player[property] || []) {
          assert(
            player.towns.some(town => isNeighbour(town, building)),
            property + ' is not on owned town land'
          );
          assert(!occupied[key(building)], property + ' overlaps ' + occupied[key(building)]);
          occupied[key(building)] = property;
          densityTotals[density] += 1;
        }
      }
    }

    const runtime = map.start();
    const vectorCounts = {walls: 0, bastions: 0, towers: 0};
    for (const cellKey of Object.keys(runtime.cells)) {
      const cell = runtime.cells[cellKey];
      const vector = api.vectorizeCell(cell);
      for (const property of typeProperties) {
        vectorCounts[property] += vector[vectorChannels[property]];
      }
    }
    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
      for (const property of typeProperties) {
        assert(
          vectorCounts[property] >= runtime.players[playerIndex][property].length,
          property + ' missing from generated map vectors'
        );
      }
    }

    for (const wall of runtime.players[1].walls) {
      assert(wall.building.isObstacle(1), 'friendly wall does not block movement');
      assert(wall.building.isBarrier(), 'wall does not block ranged combat');
    }
    for (const bastion of runtime.players[1].bastions) {
      assert(!bastion.building.isObstacle(1), 'bastion unexpectedly blocks movement');
      assert(bastion.building.isBarrier(), 'bastion does not block ranged combat');
    }
    for (const tower of runtime.players[1].towers) {
      assert(tower.building.isBarrier(), 'tower does not block ranged combat');
      assert(tower.building.rangeIncrease === 1, 'tower does not affect ranged combat');
    }
    map.advanceTurns(3);
    assert(runtime.turn === 3, 'building scenario did not advance');
  }
}

assert(densityTotals.sparse < densityTotals.normal, 'sparse maps are not sparser than normal');
assert(densityTotals.normal < densityTotals.dense, 'dense maps are not denser than normal');

const allBuildings = api.generateTownTrainingMap({
  size: 'big',
  seed: 27,
  buildingDensity: 'dense',
  barrackDensity: 0.25,
  farmDensity: 0.25,
  goldmineCount: 0,
  unitsPerPlayer: 0
});
for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
  const player = allBuildings.players[playerIndex];
  assert(player.towns.length > 0, 'town not generated');
  assert(
    player.barracks.length + player.pendingBarracks.length > 0,
    'barrack not generated'
  );
  assert(
    player.farms.length + player.pendingFarms.length > 0,
    'farm not generated'
  );
  for (const property of typeProperties) {
    assert(player[property].length > 0, property + ' not generated');
  }
}

console.log(
  'Building map generation smoke passed with sparse/normal/dense totals ' +
  densityTotals.sparse + '/' + densityTotals.normal + '/' + densityTotals.dense
);
