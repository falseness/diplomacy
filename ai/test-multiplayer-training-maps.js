const vm = require('vm');
const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function key(coord) {
  return `${coord.x}:${coord.y}`;
}

function normalizeMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    players: map.players.map(player => ({
      rgb: player.rgb,
      gold: player.gold || 0,
      towns: player.towns,
      units: (player.units || []).map(unit => ({
        type: unit.type.name,
        x: unit.x,
        y: unit.y
      })),
      suburbs: player.suburbs || [],
      barracks: player.barracks || [],
      farms: player.farms || [],
      walls: player.walls || [],
      bastions: player.bastions || [],
      towers: player.towers || []
    })),
    goldmines: map.goldmines,
    lakes: map.lakes,
    mountains: map.mountains
  });
}

function countPlayerBuildings(player) {
  return [
    'barracks',
    'pendingBarracks',
    'farms',
    'pendingFarms',
    'walls',
    'bastions',
    'towers'
  ].reduce((total, property) => total + (player[property] || []).length, 0);
}

function validateGeneratedTrainingMap(map, playerCount, seed) {
  assert(map.players.length === playerCount + 1,
    `seed ${seed} expected neutral plus ${playerCount} players`);
  assert(map.players[0].towns.length > 0, `seed ${seed} missing neutral towns`);
  assert(map.goldmines.length > 0, `seed ${seed} missing generated goldmines`);

  const occupied = {};
  for (const coord of [].concat(map.lakes, map.mountains, map.goldmines)) {
    assert(coord.x >= 0 && coord.y >= 0, `seed ${seed} terrain outside map`);
    assert(coord.x < map.mapSize.x && coord.y < map.mapSize.y,
      `seed ${seed} terrain outside map`);
    occupied[key(coord)] = true;
  }
  for (const mine of map.goldmines) {
    assert(mine.owner >= 0 && mine.owner <= playerCount,
      `seed ${seed} goldmine owner outside player range`);
  }

  for (let playerIndex = 1; playerIndex < map.players.length; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.playerType === undefined,
      'map generation should not hard-code runtime player classes');
    assert(player.towns.length > 0, `seed ${seed} player ${playerIndex} missing town`);
    assert((player.units || []).length > 0,
      `seed ${seed} player ${playerIndex} missing combat units`);
    assert((player.suburbs || []).length > 0,
      `seed ${seed} player ${playerIndex} missing economy suburbs`);
    assert(countPlayerBuildings(player) > 0,
      `seed ${seed} player ${playerIndex} missing economy/combat buildings`);
    for (const unit of player.units || []) {
      assert(!occupied[key(unit)], `seed ${seed} unit overlap at ${key(unit)}`);
      occupied[key(unit)] = true;
    }
  }
}

const { context } = loadAiScripts();
const api = new vm.Script(`({ generateTownTrainingMap })`).runInContext(context);

for (const playerCount of [2, 3, 4]) {
  const seed = 60000 + playerCount;
  const options = {
    size: playerCount === 2 ? 'tiny' : 'medium',
    seed,
    playerCount,
    buildingDensity: 'dense',
    barrackDensity: 0.3,
    pendingBarrackProbability: 0,
    farmDensity: 0.3,
    pendingFarmProbability: 0,
    externalDensity: 1,
    suburbDensity: 1,
    suburbDistance: 1,
    unitComposition: 'all',
    unitsPerPlayer: 2,
    goldmineCount: 6,
    startingGoldMin: 500,
    startingGoldMax: 500
  };
  const map = api.generateTownTrainingMap(options);
  const repeated = api.generateTownTrainingMap(options);
  validateGeneratedTrainingMap(map, playerCount, seed);
  assert(normalizeMap(map) === normalizeMap(repeated),
    `seed ${seed} ${playerCount}-player generated map was not reproducible`);

  const runtime = map.start();
  assert(runtime.players.length === playerCount + 1,
    `seed ${seed} runtime lost generated players`);
  map.advanceTurns(5);
  assert(runtime.turn === 5, `seed ${seed} generated map did not advance turns`);
}

console.log('Multiplayer generated training maps passed for fixed 2/3/4-player seeds');
