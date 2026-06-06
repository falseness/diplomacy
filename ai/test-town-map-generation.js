const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function key(coord) {
  return coord.x + ':' + coord.y;
}

function typeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function normalizeMap(map) {
  return {
    mapSize: map.mapSize,
    players: map.players.map(function(player) {
      return {
        rgb: player.rgb,
        ai: !!player.ai,
        towns: player.towns,
        units: (player.units || []).map(function(unit) {
          return {
            type: typeName(unit),
            x: unit.x,
            y: unit.y,
            hp: unit.hp
          };
        })
      };
    }),
    goldmines: map.goldmines,
    lakes: map.lakes,
    mountains: map.mountains,
    bushes: map.bushes,
    hills: map.hills
  };
}

function neighbours(coord) {
  return [
    {x: coord.x - 1, y: coord.y},
    {x: coord.x + 1, y: coord.y},
    {x: coord.x, y: coord.y - 1},
    {x: coord.x, y: coord.y + 1},
    {x: coord.x - 1, y: coord.y + 1},
    {x: coord.x + 1, y: coord.y - 1}
  ];
}

function validateCoord(map, coord, label) {
  assert(coord.x >= 0 && coord.y >= 0, label + ' has negative coordinate');
  assert(coord.x < map.mapSize.x && coord.y < map.mapSize.y, label + ' is outside map');
}

function validateGeneratedMap(map) {
  assert(map.players.length === 3, 'generated town maps should have neutral plus two players');
  assert(map.players[0].towns.length >= 1, 'neutral town missing');
  assert(map.players[1].towns.length >= 1, 'friendly town missing');
  assert(map.players[2].towns.length >= 1, 'enemy town missing');

  const occupied = {};
  const invalidForTowns = {};
  const terrain = [].concat(map.lakes, map.mountains, map.bushes, map.hills, map.goldmines);

  for (const coord of terrain) {
    validateCoord(map, coord, 'terrain');
    assert(!invalidForTowns[key(coord)], 'terrain overlap at ' + key(coord));
    invalidForTowns[key(coord)] = true;
    occupied[key(coord)] = true;
  }

  for (let playerIndex = 0; playerIndex < map.players.length; ++playerIndex) {
    const player = map.players[playerIndex];
    for (const town of player.towns) {
      validateCoord(map, town, 'town');
      assert(town.x > 0 && town.y > 0, 'town placed on edge without suburb room');
      assert(town.x < map.mapSize.x - 1 && town.y < map.mapSize.y - 1, 'town placed on edge without suburb room');
      assert(!invalidForTowns[key(town)], 'town overlaps blocking terrain at ' + key(town));
      assert(!occupied[key(town)], 'town overlaps another object at ' + key(town));
      occupied[key(town)] = true;

      const suburbCoords = neighbours(town);
      assert(suburbCoords.length === 6, 'owned town suburb candidate count changed');
      for (const suburb of suburbCoords) {
        validateCoord(map, suburb, 'suburb');
      }
    }

    for (const unit of player.units || []) {
      validateCoord(map, unit, 'unit');
      assert(!occupied[key(unit)], 'explicit unit overlaps town, terrain, or building at ' + key(unit));
      occupied[key(unit)] = true;
      assert(typeName(unit) === 'Noob', 'town scenario extra units should match current GameMap Noob startup');
    }
  }
}

function startGeneratedMapAndAdvance(map, turns) {
  assert(map.constructor.name === 'SmokeGameMap', 'town generator must return a GameMap-compatible object');
  const runtime = map.start();
  assert(runtime.players.length === map.players.length, 'game start lost generated players');
  for (let playerIndex = 1; playerIndex < map.players.length; ++playerIndex) {
    const generatedPlayer = map.players[playerIndex];
    const runtimePlayer = runtime.players[playerIndex];
    assert(runtimePlayer.towns.length === generatedPlayer.towns.length, 'game start lost an owned town');
    for (const town of runtimePlayer.towns) {
      assert(town.suburbs.length === 7, 'owned town did not initialize its town and six adjacent suburbs');
      assert(
        runtimePlayer.units.some(unit =>
          unit.source === 'first-town-unit' &&
          unit.x === town.coord.x &&
          unit.y === town.coord.y),
        'owned town did not initialize its first unit'
      );
    }
  }
  for (const town of runtime.players[0].towns) {
    assert(town.suburbs.length === 1, 'neutral town should initialize only its town suburb');
  }
  map.advanceTurns(turns);
  assert(runtime.turn === turns, 'generated game did not advance the requested turns');
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateTownTrainingMap: context.generateTownTrainingMap,
  generateTinyTownTrainingMap: context.generateTinyTownTrainingMap,
  generateMediumTownTrainingMap: context.generateMediumTownTrainingMap,
  generateBigTownTrainingMap: context.generateBigTownTrainingMap
};`)(context);

assert(api.generateTownTrainingMap, 'generateTownTrainingMap is not exported to the AI script context');
assert(api.generateTinyTownTrainingMap, 'tiny town generator missing');
assert(api.generateMediumTownTrainingMap, 'medium town generator missing');
assert(api.generateBigTownTrainingMap, 'big town generator missing');

const sizes = ['tiny', 'medium', 'big'];
for (let i = 0; i < 100; ++i) {
  const seed = 1000 + i;
  const size = sizes[i % sizes.length];
  const map = api.generateTownTrainingMap({size, seed});
  validateGeneratedMap(map);
  startGeneratedMapAndAdvance(map, 5);

  const repeated = api.generateTownTrainingMap({size, seed});
  assert(
    JSON.stringify(normalizeMap(map)) === JSON.stringify(normalizeMap(repeated)),
    'seeded town map generation is not reproducible for ' + size + ' seed ' + seed
  );
}

for (const size of sizes) {
  const map = api.generateTownTrainingMap({size, seed: 42});
  validateGeneratedMap(map);
}

console.log('Town map generation smoke passed for 100 seeded maps across tiny, medium, and big sizes');
