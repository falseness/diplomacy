const {
  enumerateGamestartMapCoverage,
  manualGamestartMapCount
} = require('./gamestart-map-coverage');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const coverage = enumerateGamestartMapCoverage();

assert(coverage.source === 'options/gamestart.js', 'unexpected source file');
assert(coverage.totalMaps === manualGamestartMapCount(), 'manual map count mismatch');
assert(coverage.mapsObjectGameMapCount === 18, 'expected 18 maps from maps object');
assert(coverage.totalMaps === 19, 'expected every GameMap constructor in options/gamestart.js');
assert(coverage.maps.length === coverage.totalMaps, 'map entry count mismatch');
assert(coverage.defaultSuddenDeathRound === 40, 'runtime sudden death default changed');
assert(
  coverage.standaloneFactories.includes('createTinyEconomyAiTestMap'),
  'tiny economy map factory was not discovered'
);

const names = new Set();
for (const entry of coverage.maps) {
  assert(!names.has(entry.name), 'duplicate coverage name: ' + entry.name);
  names.add(entry.name);
  assert(entry.groupName, 'missing group name');
  assert(Number.isInteger(entry.variantIndex), 'missing variant index');
  assert(Number.isInteger(entry.mapSize.x) && entry.mapSize.x > 0, 'invalid map width');
  assert(Number.isInteger(entry.mapSize.y) && entry.mapSize.y > 0, 'invalid map height');
  assert(
    [2, 3, 4].includes(entry.nonNeutralPlayerCount),
    'unexpected non-neutral player count for ' + entry.name
  );
  assert(
    ['1v1', '3-player', '4-player'].includes(entry.playerGroup),
    'unexpected player group for ' + entry.name
  );
  assert(
    entry.sourceType === 'maps-object' || entry.sourceType === 'standalone-factory',
    'unexpected source type for ' + entry.name
  );
  if (entry.sourceType === 'maps-object') {
    assert(entry.suddenDeathRound === 40, 'unexpected sudden death round for ' + entry.name);
    assert(entry.suddenDeathSource === 'runtime-default', 'unexpected sudden death source');
  }
}

const playerGroups = new Set(coverage.maps.map(entry => entry.playerGroup));
assert(playerGroups.has('1v1'), 'missing 1v1 coverage');
assert(playerGroups.has('3-player'), 'missing 3-player coverage');
assert(playerGroups.has('4-player'), 'missing 4-player coverage');
assert(
  coverage.maps.some(entry => entry.groupName === 'open field' && entry.variantIndex === 2),
  'open field variant #3 was not discovered'
);
assert(
  coverage.maps.some(entry => entry.groupName === 'fight forever' && entry.variantIndex === 1),
  'fight forever variant #2 was not discovered'
);
const tinyEconomy = coverage.maps.find(entry => entry.sourceName === 'createTinyEconomyAiTestMap');
assert(tinyEconomy, 'tiny economy AI test map was not discovered');
assert(tinyEconomy.name === 'tiny economy ai duel', 'unexpected tiny economy map name');
assert(tinyEconomy.groupName === 'tiny economy ai duel', 'unexpected tiny economy group');
assert(tinyEconomy.sourceType === 'standalone-factory', 'unexpected tiny economy source type');
assert(tinyEconomy.variantIndex === 0, 'unexpected tiny economy variant index');
assert(tinyEconomy.mapSize.x === 9 && tinyEconomy.mapSize.y === 7, 'unexpected tiny economy size');
assert(tinyEconomy.nonNeutralPlayerCount === 2, 'unexpected tiny economy player count');
assert(tinyEconomy.playerGroup === '1v1', 'unexpected tiny economy player group');
assert(tinyEconomy.configuredSuddenDeathRound === 2000, 'missing tiny economy sudden death config');
assert(tinyEconomy.suddenDeathRound === 2000, 'unexpected tiny economy sudden death round');
assert(tinyEconomy.suddenDeathSource === 'configured', 'unexpected tiny economy sudden death source');

console.log('Gamestart map coverage metadata passed');
