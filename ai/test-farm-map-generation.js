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
  ].some(candidate => candidate.x === coord.x && candidate.y === coord.y);
}

const { context } = loadAiScripts();
new vm.Script(`
  whooseTurn = 1;
  players = [
    {gold: 0, income: 0, towns: []},
    {gold: 50, income: 10, towns: []},
    {gold: 50, income: 10, towns: []}
  ];
  suddenDeathRound = 20;
  gameRound = 0;
`).runInContext(context);
const api = new vm.Script(`({
  generateTownTrainingMap,
  vectorizeCell,
  CELL_VECTOR_INDEX
})`).runInContext(context);

let completedCount = 0;
let pendingCount = 0;
let completedByPlayer = [0, 0, 0];
let pendingByPlayer = [0, 0, 0];
let vectorizedCompletedCount = 0;
let vectorizedPendingCount = 0;

for (let seed = 1; seed <= 30; ++seed) {
  const map = api.generateTownTrainingMap({
    size: seed % 2 ? 'medium' : 'big',
    seed,
    barrackDensity: 0,
    farmDensity: 1,
    pendingFarmProbability: 0.5
  });
  const occupied = {};
  for (const coord of [].concat(map.lakes, map.mountains, map.goldmines)) {
    occupied[key(coord)] = 'terrain';
  }
  for (const player of map.players) {
    for (const town of player.towns) {
      occupied[key(town)] = 'town';
    }
    for (const unit of player.units || []) {
      occupied[key(unit)] = 'unit';
    }
  }

  for (let playerIndex = 1; playerIndex < map.players.length; ++playerIndex) {
    const player = map.players[playerIndex];
    const configured = [].concat(player.farms || [], player.pendingFarms || []);
    for (const farm of configured) {
      assert(isNeighbour(farm.town, farm), 'farm is not on its town suburb');
      assert(
        player.towns.some(town => key(town) === key(farm.town)),
        'farm references a town owned by another player'
      );
      assert(!occupied[key(farm)], 'farm overlaps ' + occupied[key(farm)]);
      occupied[key(farm)] = 'farm';
    }
    completedCount += (player.farms || []).length;
    pendingCount += (player.pendingFarms || []).length;
    completedByPlayer[playerIndex] += (player.farms || []).length;
    pendingByPlayer[playerIndex] += (player.pendingFarms || []).length;
  }

  const runtime = map.start();
  const incomeBefore = runtime.players.map(player => player.income);
  let vectorizedCompleted = 0;
  let vectorizedPending = 0;
  for (const cellKey of Object.keys(runtime.cells)) {
    const vector = api.vectorizeCell(runtime.cells[cellKey]);
    vectorizedCompleted += vector[api.CELL_VECTOR_INDEX.isFarm];
    vectorizedPending += vector[api.CELL_VECTOR_INDEX.isPendingFarm];
  }
  vectorizedCompletedCount += vectorizedCompleted;
  vectorizedPendingCount += vectorizedPending;

  map.advanceTurns(2);
  assert(runtime.turn === 2, 'generated farm game did not advance two turns');
  for (let playerIndex = 1; playerIndex < runtime.players.length; ++playerIndex) {
    const player = runtime.players[playerIndex];
    assert(player.pendingFarms.length === 0, 'pending farm did not finish production');
    assert(
      player.income === incomeBefore[playerIndex] +
        (map.players[playerIndex].pendingFarms || []).length * 4,
      'completed pending farms did not increase player income'
    );
  }
}

assert(completedCount > 0, 'high-density generation produced no completed farms');
assert(pendingCount > 0, 'high-density generation produced no pending farms');
assert(completedByPlayer[1] > 0 && completedByPlayer[2] > 0, 'completed farms missing for a player');
assert(pendingByPlayer[1] > 0 && pendingByPlayer[2] > 0, 'pending farms missing for a player');
assert(vectorizedCompletedCount === completedCount, 'generated completed farms were not vectorized');
assert(vectorizedPendingCount === pendingCount, 'generated pending farms were not vectorized');

const noFarms = api.generateTownTrainingMap({
  size: 'big',
  seed: 99,
  barrackDensity: 0,
  farmDensity: 0
});
assert(
  noFarms.players.every(player =>
    (player.farms || []).length === 0 &&
    (player.pendingFarms || []).length === 0),
  'zero farm density still generated farms'
);

console.log(
  'Farm map generation smoke passed with ' +
  completedCount + ' completed and ' + pendingCount + ' pending farms'
);
