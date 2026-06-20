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

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task156-'));
const reportPath = path.join(temporary, 'report.json');
const failureDir = path.join(temporary, 'failures');
const command = [
  path.join(__dirname, 'benchmark-gamestart-all-slots.js'),
  '--candidate-slot-policy', 'task156',
  '--sudden-death', '80',
  '--map-limit', '3',
  '--seeds', '1',
  '--seed', '156900',
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
assert(run.status === 0, 'TASK-156 benchmark smoke failed');
assert(fs.existsSync(reportPath), 'TASK-156 smoke report was not written');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const coverage = enumerateGamestartMapCoverage();
assert(
  report.config.candidateSlotPolicy === 'task156',
  'TASK-156 candidate slot policy was not recorded'
);
assert(report.config.suddenDeathRound === 80, 'TASK-156 sudden-death bound changed');
assert(
  report.mapCoverage.totalMaps === coverage.totalMaps,
  'report did not record full gamestart map count'
);
assert(report.mapCoverage.selectedMaps.length === 3, 'smoke selected wrong map count');

let expectedGames = 0;
for (const map of report.mapCoverage.selectedMaps) {
  if (map.playerCount === 2) {
    assert(
      map.candidateSlots.length === 2 &&
        map.candidateSlots[0] === 1 &&
        map.candidateSlots[1] === 2,
      '1v1 maps should evaluate both candidate sides when practical',
      map
    );
  } else {
    assert(
      map.candidateSlots.length === 1 &&
        map.candidateSlots[0] === Math.ceil(map.playerCount / 2),
      'multiplayer maps should evaluate exactly one middle candidate slot',
      map
    );
  }
  expectedGames += map.candidateSlots.length;
}
assert(report.mapCoverage.expectedGames === expectedGames, 'expected game count mismatch');
assert(report.summary.attemptedGames === expectedGames, 'attempted game count mismatch');
assert(report.summary.nonWins === 0, 'TASK-156 smoke produced non-wins', report.summary);
assert(report.summary.candidateWinRate === 1, 'candidate win rate was not 100 percent');
assert(report.summary.classAssignmentFailures === 0, 'runtime class assignment failed');
assert(
  report.checkpoint.gameplayInference.positions > 0,
  'checkpoint-backed AIPlayerWithEconomy inference was not exercised'
);

for (const game of report.games) {
  const candidates = game.players.filter(player =>
    player.type === 'AIPlayerWithEconomy');
  const opponents = game.players.filter(player =>
    player.type === 'SimpleAiPlayerWithEconomy');
  assert(candidates.length === 1, 'expected exactly one AIPlayerWithEconomy', game);
  assert(candidates[0].side === game.candidateSlot, 'candidate side mismatch', game);
  assert(opponents.length === game.playerCount - 1, 'opponent count mismatch', game);
  if (game.playerCount >= 3) {
    assert(
      game.candidateSlot === Math.ceil(game.playerCount / 2),
      'multiplayer candidate slot did not follow TASK-156 policy',
      game
    );
  }
  assert(game.candidateWon === true, 'candidate did not win smoke game', game);
}

console.log(
  'TASK-156 all-gamestart benchmark smoke passed: ' +
    report.summary.candidateWins + '/' + report.summary.attemptedGames +
    ' candidate wins'
);
