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

const { context } = loadAiScripts();
new vm.Script(`
  whooseTurn = 1;
  players = [
    {gold: 0, income: 0, towns: []},
    {gold: 0, income: 0, towns: []},
    {gold: 0, income: 0, towns: []}
  ];
  suddenDeathRound = 40;
  gameRound = 0;
`).runInContext(context);
const api = new vm.Script(`({
  generateTownTrainingMap,
  vectorizeCell,
  CELL_VECTOR_INDEX,
  GOLDMINE_TRAINING_INCOME_MIN,
  GOLDMINE_TRAINING_INCOME_MAX,
  GOLDMINE_TRAINING_STARTING_GOLD_MIN,
  GOLDMINE_TRAINING_STARTING_GOLD_MAX
})`).runInContext(context);

let variedIncome = new Set();
let variedStartingGold = new Set();
let vectorizedMines = 0;

for (let seed = 1; seed <= 40; ++seed) {
  const map = api.generateTownTrainingMap({
    size: seed % 2 ? 'medium' : 'big',
    seed,
    goldmineCount: 6,
    barrackDensity: 0,
    farmDensity: 0
  });
  assert(map.goldmines.length === 6, 'configured goldmine count was not respected');
  assert(
    map.goldmines.slice(0, 3).map(mine => mine.owner).join(',') === '0,1,2',
    'generated scenario is missing neutral, friendly, or enemy ownership'
  );

  const occupied = {};
  for (const coord of [].concat(map.lakes, map.mountains)) {
    occupied[key(coord)] = 'blocking terrain';
  }
  for (const player of map.players) {
    for (const town of player.towns) {
      occupied[key(town)] = 'town';
    }
    for (const unit of player.units || []) {
      occupied[key(unit)] = 'unit';
    }
    for (const building of [].concat(
      player.barracks || [],
      player.pendingBarracks || [],
      player.farms || [],
      player.pendingFarms || []
    )) {
      occupied[key(building)] = 'building';
    }
  }

  for (const mine of map.goldmines) {
    assert(!occupied[key(mine)], 'goldmine overlaps ' + occupied[key(mine)]);
    occupied[key(mine)] = 'goldmine';
    assert(
      mine.income >= api.GOLDMINE_TRAINING_INCOME_MIN &&
        mine.income <= api.GOLDMINE_TRAINING_INCOME_MAX,
      'goldmine income is outside documented bounds'
    );
    assert(mine.owner >= 0 && mine.owner <= 2, 'goldmine owner is invalid');
    variedIncome.add(mine.income);
  }

  for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
    const gold = map.players[playerIndex].gold;
    assert(
      gold >= api.GOLDMINE_TRAINING_STARTING_GOLD_MIN &&
        gold <= api.GOLDMINE_TRAINING_STARTING_GOLD_MAX,
      'starting gold is outside documented bounds'
    );
    variedStartingGold.add(gold);
  }

  const runtime = map.start();
  players = runtime.players;
  const goldBefore = runtime.players.map(player => player.gold);
  map.advanceTurns(20);
  for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
    assert(
      runtime.players[playerIndex].gold === goldBefore[playerIndex] + 20 * 10,
      'goldmine paid before its opening round completed'
    );
  }
  map.advanceTurns(1);
  gameRound = runtime.turn;
  for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
    const ownedMineIncome = runtime.players[playerIndex].goldmines.reduce(
      (total, mine) => total + mine.building.potentialIncome, 0);
    assert(
      runtime.players[playerIndex].gold ===
        goldBefore[playerIndex] + 21 * 10 + ownedMineIncome,
      'gold total did not include generated goldmine income correctly'
    );
  }

  for (const mine of map.goldmines) {
    const cell = runtime.cells[key(mine)];
    const vector = api.vectorizeCell(cell);
    assert(vector[api.CELL_VECTOR_INDEX.isGoldmine] === 1, 'goldmine vector flag missing');
    const expectedOwner = mine.owner === 0 ? 0 : (mine.owner === 1 ? 1 : -1);
    assert(
      vector[api.CELL_VECTOR_INDEX.goldmineOwner] === expectedOwner,
      'goldmine ownership vector is incorrect'
    );
    assert(
      vector[api.CELL_VECTOR_INDEX.goldminePotentialIncome] === mine.income / 100,
      'goldmine potential income vector is incorrect'
    );
    assert(
      vector[api.CELL_VECTOR_INDEX.goldmineActiveIncome] === mine.income / 100,
      'opened goldmine active income vector is incorrect'
    );
    vectorizedMines += 1;
  }
}

assert(variedIncome.size > 20, 'goldmine income generation lacks variation');
assert(variedStartingGold.size > 20, 'starting gold generation lacks variation');
assert(vectorizedMines === 240, 'not all generated goldmines were vectorized');

const noGoldmines = api.generateTownTrainingMap({
  size: 'big',
  seed: 99,
  goldmineCount: 0
});
assert(noGoldmines.goldmines.length === 0, 'zero goldmine count still generated mines');

console.log(
  'Gold map generation smoke passed with ' +
  vectorizedMines + ' vectorized mines and varied starting gold'
);
