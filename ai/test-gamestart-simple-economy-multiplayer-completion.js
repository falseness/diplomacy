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

function runGroup(tempDir, playerGroup, seed, expectedMaps) {
  const output = path.join(tempDir, playerGroup + '-report.json');
  const failureDir = path.join(tempDir, playerGroup + '-failures');
  const result = childProcess.spawnSync(process.execPath, [
    'ai/gamestart-simple-economy-completion.js',
    '--player-group',
    playerGroup,
    '--seed',
    String(seed),
    '--round-limit',
    '1000',
    '--require-complete',
    '--output',
    output,
    '--failure-dir',
    failureDir
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 15 * 60 * 1000
  });

  assert(
    result.status === 0,
    playerGroup + ' completion failed:\nstdout:\n' +
      result.stdout + '\nstderr:\n' + result.stderr
  );
  assert(fs.existsSync(output), playerGroup + ' report was not written');
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert(
    report.config.forcedSuddenDeathRound === FORCED_SUDDEN_DEATH_ROUND,
    playerGroup + ' did not force suddenDeathRound=500'
  );
  assert(report.config.requireComplete, playerGroup + ' was not strict');
  assert(
    report.mapCoverage.selectedMaps.length === expectedMaps,
    playerGroup + ' selected ' + report.mapCoverage.selectedMaps.length +
      ' maps instead of ' + expectedMaps
  );
  assert(
    report.summary.attemptedScenarios === expectedMaps,
    playerGroup + ' attempted wrong scenario count'
  );
  assert(report.summary.completedScenarios === expectedMaps, playerGroup + ' did not complete every map');
  assert(report.summary.nonResults === 0, playerGroup + ' had non-results');
  assert(report.summary.timeouts === 0, playerGroup + ' had timeouts');
  assert(report.summary.suddenDeathNonResults === 0, playerGroup + ' reached sudden death without a winner');
  assert(report.summary.crashes === 0, playerGroup + ' crashed');
  assert(report.summary.requiredClassMismatches === 0, playerGroup + ' used the wrong player class');
  assert(report.failedGames.length === 0, playerGroup + ' wrote failed game entries');

  for (const game of report.games) {
    assert(game.playerGroup === playerGroup, 'wrong player group in ' + game.mapName);
    assert(game.winner !== null, game.mapName + ' had no winner');
    assert(game.roundCount < FORCED_SUDDEN_DEATH_ROUND, game.mapName + ' reached sudden death');
    assert(game.suddenDeathRound === FORCED_SUDDEN_DEATH_ROUND, game.mapName + ' had wrong sudden death round');
    assert(game.allNonNeutralPlayersUseRequiredClass, game.mapName + ' had a class mismatch');
    for (const player of game.players) {
      assert(player.type === 'SimpleAiPlayerWithEconomy', game.mapName + ' used ' + player.type);
    }
  }

  return report;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task057-'));
const threePlayer = runGroup(tempDir, '3-player', 57000, 2);
const fourPlayer = runGroup(tempDir, '4-player', 57050, 1);

console.log(
  'Gamestart SimpleAiPlayerWithEconomy multiplayer completion passed: ' +
    threePlayer.summary.completedScenarios + ' 3-player maps, ' +
    fourPlayer.summary.completedScenarios + ' 4-player maps'
);
