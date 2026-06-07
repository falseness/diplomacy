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

function unitName(unit) {
  return unit.type.name;
}

function unitLayout(map) {
  return map.players.slice(1).map(player =>
    player.units.map(unit => [unitName(unit), unit.x, unit.y])
  );
}

const { context } = loadAiScripts();
const api = new vm.Script(`({ generateTownTrainingMap })`).runInContext(context);
const expectedTypes = ['Archer', 'Catapult', 'KOHb', 'Noob', 'Normchel'];

for (let seed = 1; seed <= 50; ++seed) {
  const options = {
    size: 'big',
    seed,
    unitsPerPlayer: 10,
    unitComposition: 'all',
    barrackDensity: 0,
    farmDensity: 0,
    goldmineCount: 0
  };
  const map = api.generateTownTrainingMap(options);
  const repeated = api.generateTownTrainingMap(options);
  assert(
    JSON.stringify(unitLayout(map)) === JSON.stringify(unitLayout(repeated)),
    'unit layout is not reproducible for seed ' + seed
  );

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
    const units = map.players[playerIndex].units;
    const names = Array.from(new Set(units.map(unitName))).sort();
    assert(
      JSON.stringify(names) === JSON.stringify(expectedTypes),
      'all unit types were not generated for player ' + playerIndex + ', seed ' + seed
    );
    for (const unit of units) {
      assert(!occupied[key(unit)], 'unit overlaps ' + occupied[key(unit)] + ' at ' + key(unit));
      occupied[key(unit)] = 'unit';
    }
  }

  const runtime = map.start();
  for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
    const configuredUnits = runtime.players[playerIndex].units.filter(
      unit => unit.source === 'configured'
    );
    for (const unit of configuredUnits) {
      assert(unit.getAvailableCommands().length > 0, unit.name + ' has no command at turn start');
    }
  }
}

const combatMap = api.generateTownTrainingMap({
  size: 'big',
  seed: 9001,
  unitsPerPlayer: 30,
  unitComposition: 'combat',
  barrackDensity: 0,
  farmDensity: 0,
  goldmineCount: 0
});
const economyMap = api.generateTownTrainingMap({
  size: 'big',
  seed: 9001,
  unitsPerPlayer: 30,
  unitComposition: 'economy',
  barrackDensity: 0,
  farmDensity: 0,
  goldmineCount: 0
});

function countTypes(map) {
  const counts = {};
  for (const unit of map.players[1].units) {
    counts[unitName(unit)] = (counts[unitName(unit)] || 0) + 1;
  }
  return counts;
}

const combatCounts = countTypes(combatMap);
const economyCounts = countTypes(economyMap);
assert(combatCounts.Archer > economyCounts.Archer, 'combat profile did not bias archers');
assert(economyCounts.Noob > combatCounts.Noob, 'economy profile did not bias noobs');
assert(!economyCounts.Catapult, 'economy profile unexpectedly generated catapults');

console.log('Unit map generation smoke passed for 50 reproducible all-unit seeds and composition profiles');
