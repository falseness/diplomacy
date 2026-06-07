const { loadAiScripts } = require('./smokeHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function key(coord) {
  return coord.x + ':' + coord.y;
}

function distance(a, b) {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs((a.x - b.x) + (a.y - b.y)));
}

function normalize(map) {
  return map.players.map(player => ({
    towns: player.towns,
    suburbs: player.suburbs
  }));
}

const { context } = loadAiScripts();
const api = new Function('context', 'return {' +
  'generateTownTrainingMap: context.generateTownTrainingMap,' +
  'vectorizeCell: context.vectorizeCell,' +
  'CELL_VECTOR_INDEX: context.CELL_VECTOR_INDEX' +
'};')(context);

for (let seed = 1; seed <= 100; ++seed) {
  const maxDistance = seed % 3 + 1;
  const density = 0.35 + (seed % 4) * 0.15;
  const map = api.generateTownTrainingMap({
    size: 'big',
    seed,
    suburbDensity: density,
    suburbDistance: maxDistance,
    barrackDensity: 0,
    farmDensity: 0,
    externalDensity: 0
  });
  const repeated = api.generateTownTrainingMap({
    size: 'big',
    seed,
    suburbDensity: density,
    suburbDistance: maxDistance,
    barrackDensity: 0,
    farmDensity: 0,
    externalDensity: 0
  });
  assert(JSON.stringify(normalize(map)) === JSON.stringify(normalize(repeated)),
    'suburb generation is not reproducible for seed ' + seed);

  const claimed = {};
  for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
    const player = map.players[playerIndex];
    assert(player.suburbs.length === player.towns.length,
      'every owned town needs one suburb layout');
    for (let townIndex = 0; townIndex < player.suburbs.length; ++townIndex) {
      const layout = player.suburbs[townIndex];
      assert(layout.town.x === player.towns[townIndex].x &&
        layout.town.y === player.towns[townIndex].y,
      'suburb layout references the wrong town');
      assert(layout.cells.length >= 2, 'generated town lacks owned suburbs');
      assert(layout.expansionCells.length > 0,
        'generated suburb layout lacks expansion choices');
      const connected = {};
      connected[key(layout.town)] = true;
      for (const cell of layout.cells) {
        assert(cell.x >= 0 && cell.y >= 0 &&
          cell.x < map.mapSize.x && cell.y < map.mapSize.y,
        'suburb is outside the generated map');
        assert(distance(cell, layout.town) <= maxDistance,
          'suburb exceeds configured town distance');
        assert(!claimed[key(cell)] || key(cell) === key(layout.town),
          'suburb is claimed by multiple towns');
        claimed[key(cell)] = playerIndex;
        if (key(cell) !== key(layout.town)) {
          assert(layout.cells.some(other =>
            connected[key(other)] && distance(other, cell) === 1),
          'suburb layout is disconnected from its town');
        }
        connected[key(cell)] = true;
      }
      for (const expansion of layout.expansionCells) {
        assert(layout.cells.some(cell => distance(cell, expansion) === 1),
          'expansion choice is not adjacent to a suburb');
      }
    }
  }

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
    const generatedPlayer = map.players[playerIndex];
    const runtimePlayer = runtime.players[playerIndex];
    for (let townIndex = 0; townIndex < runtimePlayer.towns.length; ++townIndex) {
      const town = runtimePlayer.towns[townIndex];
      assert(town.suburbs.length === generatedPlayer.suburbs[townIndex].cells.length,
        'runtime lost configured suburb cells');
      assert(town.suburbs.every(suburb =>
        suburb.playerColor === playerIndex && suburb.isSuburb),
      'runtime suburb ownership does not match its town');

      context.players = runtime.players;
      context.whooseTurn = playerIndex;
      const suburb = town.suburbs[0];
      const suburbVector = api.vectorizeCell({
        coord: suburb.coord,
        playerColor: playerIndex,
        hexagon: suburb,
        building: {isEmpty() { return true; }, isTown() { return false; }},
        unit: {isEmpty() { return true; }}
      });
      assert(suburbVector[api.CELL_VECTOR_INDEX.isSuburb] === 1,
        'generated suburb missing vector marker');
      assert(suburbVector[api.CELL_VECTOR_INDEX.suburbOwner] === 1,
        'generated suburb ownership vector is incorrect');

      const expansion = generatedPlayer.suburbs[townIndex].expansionCells[0];
      const incomeBefore = town.income;
      const expanded = runtimePlayer.expandSuburb(townIndex, expansion);
      assert(expanded.playerColor === playerIndex && expanded.isSuburb,
        'suburb expansion command produced invalid ownership');
      assert(town.income === incomeBefore + 1,
        'suburb expansion did not update town income');
      const expandedVector = api.vectorizeCell({
        coord: expanded.coord,
        playerColor: playerIndex,
        hexagon: expanded,
        building: {isEmpty() { return true; }, isTown() { return false; }},
        unit: {isEmpty() { return true; }}
      });
      assert(expandedVector[api.CELL_VECTOR_INDEX.isSuburb] === 1,
        'expanded suburb is not represented in vectorization');
    }
  }
}

const sparse = api.generateTownTrainingMap({
  size: 'big', seed: 500, suburbDensity: 0, suburbDistance: 1
});
const dense = api.generateTownTrainingMap({
  size: 'big', seed: 500, suburbDensity: 1, suburbDistance: 3
});
const countSuburbs = map => map.players.slice(1).reduce(
  (total, player) => total + player.suburbs.reduce(
    (subtotal, layout) => subtotal + layout.cells.length, 0), 0);
assert(countSuburbs(dense) > countSuburbs(sparse),
  'suburb density/distance configuration does not change layouts');

console.log('Suburb map generation smoke passed for 100 seeded maps');
