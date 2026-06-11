const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const {
  FORCED_SUDDEN_DEATH_ROUND
} = require('./gamestart-simple-economy-completion');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task055-'));
const output = path.join(tempDir, 'report.json');
const failureDir = path.join(tempDir, 'failures');

const result = childProcess.spawnSync(process.execPath, [
  'ai/gamestart-simple-economy-completion.js',
  '--sample-player-groups',
  '1v1,3-player,4-player',
  '--seed',
  '55055',
  '--round-limit',
  '20',
  '--output',
  output,
  '--failure-dir',
  failureDir
], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8'
});

assert(
  result.status === 0,
  'completion harness failed:\nstdout:\n' + result.stdout + '\nstderr:\n' + result.stderr
);
assert(fs.existsSync(output), 'structured report was not written');

const report = JSON.parse(fs.readFileSync(output, 'utf8'));
assert(report.config.forcedSuddenDeathRound === 500, 'forced sudden death config missing');
assert(report.config.roundLimit === 20, 'unexpected round limit');
assert(report.mapCoverage.selectedMaps.length === 3, 'expected one sample per player group');
assert(report.games.length === 3, 'expected three sample scenarios');
assert(report.summary.attemptedScenarios === 3, 'unexpected attempted scenario count');
assert(report.summary.crashes === 0, 'sample scenarios crashed');
assert(report.summary.requiredClassMismatches === 0, 'wrong player class used');

const groups = new Set(report.games.map(game => game.playerGroup));
assert(groups.has('1v1'), 'missing 1v1 sample');
assert(groups.has('3-player'), 'missing 3-player sample');
assert(groups.has('4-player'), 'missing 4-player sample');

for (const game of report.games) {
  assert(game.runtimeLoop === 'GameMap.start + nextTurn', 'real runtime loop not recorded');
  assert(game.requiredPlayerClass === 'SimpleAiPlayerWithEconomy', 'required class missing');
  assert(game.allNonNeutralPlayersUseRequiredClass, 'non-neutral player class mismatch');
  assert(game.suddenDeathRound === FORCED_SUDDEN_DEATH_ROUND, 'sudden death was not forced');
  assert(game.forcedSuddenDeathRound === FORCED_SUDDEN_DEATH_ROUND, 'forced sudden death missing');
  assert(Number.isInteger(game.variantIndex), 'variant index missing');
  assert(Number.isInteger(game.playerCount), 'player count missing');
  assert(Number.isInteger(game.seed), 'seed missing');
  assert(Object.prototype.hasOwnProperty.call(game, 'winner'), 'winner field missing');
  assert(Number.isInteger(game.roundCount), 'round count missing');
  assert(Object.prototype.hasOwnProperty.call(game, 'crash'), 'crash field missing');
  assert(Object.prototype.hasOwnProperty.call(game, 'timeout'), 'timeout field missing');
  assert(Object.prototype.hasOwnProperty.call(game, 'suddenDeath'), 'sudden death field missing');
  for (const player of game.players) {
    assert(player.type === 'SimpleAiPlayerWithEconomy', 'unexpected runtime class');
  }
}

for (const failure of report.failedGames) {
  assert(failure.failurePath, 'failure path missing');
  assert(fs.existsSync(failure.failurePath), 'failure artifact was not written');
}

console.log('Gamestart SimpleAiPlayerWithEconomy completion harness passed');
