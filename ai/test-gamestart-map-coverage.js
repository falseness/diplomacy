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
assert(coverage.totalMaps === 18, 'expected 18 maps from options/gamestart.js maps object');
assert(coverage.maps.length === coverage.totalMaps, 'map entry count mismatch');
assert(coverage.defaultSuddenDeathRound === 40, 'runtime sudden death default changed');

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
  assert(entry.suddenDeathRound === 40, 'unexpected sudden death round for ' + entry.name);
  assert(entry.suddenDeathSource === 'runtime-default', 'unexpected sudden death source');
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

console.log('Gamestart map coverage metadata passed');
