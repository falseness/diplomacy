const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  enumerateGamestartMapCoverage
} = require('./gamestart-map-coverage');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    if (details) {
      error.details = details;
    }
    throw error;
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task063-'));
const reportPath = path.join(temporary, 'report.json');
const failureDir = path.join(temporary, 'failures');
const command = [
  path.join(__dirname, 'benchmark-gamestart-all-slots.js'),
  '--map-limit', '1',
  '--seeds', '2',
  '--seed', '63900',
  '--round-limit', '1200',
  '--output', reportPath,
  '--failure-dir', failureDir,
  '--require-100'
];
const run = spawnSync(process.execPath, command, {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 40
});
if (run.status !== 0) {
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
}
assert(run.status === 0, 'TASK-063 benchmark smoke failed');
assert(fs.existsSync(reportPath), 'TASK-063 smoke report was not written');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const coverage = enumerateGamestartMapCoverage();
const selected = report.mapCoverage.selectedMaps;
assert(selected.length === 1, 'smoke should select exactly one map', selected);
assert(
  report.mapCoverage.totalMaps === coverage.totalMaps,
  'report did not record full TASK-054 coverage total'
);
assert(
  report.mapCoverage.expectedGames ===
    selected[0].playerCount * report.config.seedsPerMapCandidateSlot,
  'expected game count is not per candidate slot and seed'
);
assert(
  report.summary.attemptedGames === report.mapCoverage.expectedGames,
  'attempted game count does not match expected scenarios'
);
assert(report.summary.nonWins === 0, 'smoke produced non-wins', report.summary);
assert(report.summary.candidateWinRate === 1, 'candidate win rate was not 100 percent');
assert(report.summary.crashes === 0, 'smoke crashed');
assert(report.summary.timeouts === 0, 'smoke timed out');
assert(report.summary.suddenDeathGames === 0, 'smoke reached sudden death');
assert(report.summary.classAssignmentFailures === 0, 'runtime class assignment failed');
assert(
  report.checkpoint.gameplayInference.positions > 0,
  'checkpoint-backed AIPlayerWithEconomy inference was not exercised'
);

for (const game of report.games) {
  assert(Number.isInteger(game.candidateSlot), 'candidate slot missing', game);
  assert(Array.isArray(game.opponentSlots), 'opponent slots missing', game);
  assert(typeof game.mapName === 'string', 'map name missing', game);
  assert(Object.prototype.hasOwnProperty.call(game, 'variantIndex'), 'variant index missing');
  assert(Number.isInteger(game.seed), 'seed missing', game);
  assert(Object.prototype.hasOwnProperty.call(game, 'winner'), 'winner missing');
  assert(Number.isInteger(game.roundCount), 'round count missing', game);
  assert(game.crash === null, 'crash field missing', game);
  assert(typeof game.timeout === 'boolean', 'timeout field missing', game);
  assert(typeof game.suddenDeath === 'boolean', 'sudden-death field missing', game);
  assert(game.exactClassAssignment === true, 'class assignment was not exact', game);
  const candidate = game.players.filter(player =>
    player.type === 'AIPlayerWithEconomy');
  const opponents = game.players.filter(player =>
    player.type === 'SimpleAiPlayerWithEconomy');
  assert(candidate.length === 1, 'expected exactly one AIPlayerWithEconomy', game);
  assert(candidate[0].side === game.candidateSlot, 'candidate class is in wrong slot', game);
  assert(opponents.length === game.opponentSlots.length, 'opponent count mismatch', game);
  assert(game.candidateWon === true, 'candidate did not win smoke game', game);
}

console.log(
  'TASK-063 all-gamestart benchmark smoke passed: ' +
    report.summary.candidateWins + '/' + report.summary.attemptedGames +
    ' candidate wins'
);
