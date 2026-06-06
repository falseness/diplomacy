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
let vectorizedCompletedCount = 0;
let vectorizedPendingCount = 0;
for (let seed = 1; seed <= 30; ++seed) {
  const map = api.generateTownTrainingMap({
    size: seed % 2 ? 'medium' : 'big',
    seed,
    barrackDensity: 1,
    pendingBarrackProbability: 0.5
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
    const configured = [].concat(player.barracks || [], player.pendingBarracks || []);
    for (const barrack of configured) {
      assert(isNeighbour(barrack.town, barrack), 'barrack is not on its town suburb');
      assert(
        player.towns.some(town => key(town) === key(barrack.town)),
        'barrack references a town owned by another player'
      );
      assert(!occupied[key(barrack)], 'barrack overlaps ' + occupied[key(barrack)]);
      occupied[key(barrack)] = 'barrack';
    }
    completedCount += (player.barracks || []).length;
    pendingCount += (player.pendingBarracks || []).length;
  }

  const runtime = map.start();
  let vectorizedCompleted = 0;
  let vectorizedPending = 0;
  for (const cellKey of Object.keys(runtime.cells)) {
    const vector = api.vectorizeCell(runtime.cells[cellKey]);
    vectorizedCompleted += vector[api.CELL_VECTOR_INDEX.isBarrack];
    vectorizedPending += vector[api.CELL_VECTOR_INDEX.isPendingBarrack];
  }
  vectorizedCompletedCount += vectorizedCompleted;
  vectorizedPendingCount += vectorizedPending;

  map.advanceTurns(5);
  assert(runtime.turn === 5, 'generated barrack game did not advance five turns');
  for (const player of runtime.players) {
    assert(player.pendingBarracks.length === 0, 'pending barrack did not finish production');
  }
}

assert(completedCount > 0, 'high-density generation produced no completed barracks');
assert(pendingCount > 0, 'high-density generation produced no pending barracks');
assert(vectorizedCompletedCount === completedCount, 'generated completed barracks were not vectorized');
assert(vectorizedPendingCount === pendingCount, 'generated pending barracks were not vectorized');

const noBarracks = api.generateTownTrainingMap({
  size: 'big',
  seed: 99,
  barrackDensity: 0
});
assert(
  noBarracks.players.every(player =>
    (player.barracks || []).length === 0 &&
    (player.pendingBarracks || []).length === 0),
  'zero barrack density still generated barracks'
);

console.log(
  'Barrack map generation smoke passed with ' +
  completedCount + ' completed and ' + pendingCount + ' pending barracks'
);
