const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PLAYER_CLASSES,
  runBenchmark,
  writeResult
} = require('./benchmarkHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const harnessSource = fs.readFileSync(path.join(__dirname, 'benchmarkHarness.js'), 'utf8');
const cliSource = fs.readFileSync(path.join(__dirname, 'benchmark.js'), 'utf8');
assert(!/AIPlayer\.prototype\.nextTurn\s*=/.test(harnessSource),
  'benchmark harness replaces AIPlayer.prototype.nextTurn');
assert(!/simulate-crash-seed/.test(cliSource),
  'production benchmark CLI exposes report-format crash simulation');

const options = {
  mapName: 'tiny-duel',
  playerA: 'SimpleAiPlayer',
  playerB: 'SimpleAiPlayer',
  seed: 431,
  repeat: 4,
  roundLimit: 30
};
const first = runBenchmark(options);
const second = runBenchmark(options);

assert(
  JSON.stringify(first) === JSON.stringify(second),
  'fixed-seed benchmark results changed between runs'
);
assert(first.games.length === 4, 'benchmark repeat count was not honored');
for (const game of first.games) {
  for (const field of [
    'winner',
    'roundCount',
    'timeout',
    'suddenDeath',
    'mapName',
    'playerA',
    'playerB',
    'runtimePlayerA',
    'runtimePlayerB',
    'seed'
  ]) {
    assert(Object.prototype.hasOwnProperty.call(game, field), 'missing result field ' + field);
  }
}
for (const field of [
  'attemptedGames',
  'completedGames',
  'playerAWinRate',
  'averageGameLength',
  'medianGameLength',
  'timeoutCount',
  'suddenDeathCount',
  'crashCount',
  'failedSeeds'
]) {
  assert(Object.prototype.hasOwnProperty.call(first.summary, field), 'missing summary field ' + field);
}
assert(first.config.playerClasses.A === 'SimpleAiPlayer', 'player class A missing from config');
assert(first.config.playerClasses.B === 'SimpleAiPlayer', 'player class B missing from config');
assert(first.config.checkpointIdentifier === null, 'default checkpoint identifier should be null');
assert(first.config.codeRevision, 'code revision missing from config');

for (const playerClass of ['SimpleAiPlayer', 'SimpleAiPlayerWithEconomy']) {
  const comparison = runBenchmark({
    mapName: 'tiny-duel',
    playerA: playerClass,
    playerB: 'SimpleAiPlayer',
    seed: 19,
    repeat: 1,
    roundLimit: 30
  });
  assert(comparison.games[0].playerA === playerClass, playerClass + ' was not selectable');
  assert(
    comparison.games[0].runtimePlayerA === playerClass,
    playerClass + ' runtime constructor was not instantiated'
  );
}
for (const playerClass of [
  'SimpleAiPlayer',
  'SimpleAiPlayerWithEconomy',
  'AIPlayer',
  'AIPlayerWithEconomy'
]) {
  assert(typeof PLAYER_CLASSES[playerClass] === 'function',
    playerClass + ' was not loaded from the runtime player source');
}

const missingCheckpointReport = runBenchmark({
  mapName: 'tiny-duel',
  playerA: 'AIPlayer',
  playerB: 'SimpleAiPlayer',
  seed: 29,
  repeat: 1,
  roundLimit: 2
});
assert(missingCheckpointReport.summary.crashCount === 1,
  'generic AI gameplay silently substituted a synthetic model');
assert(/real checkpoint-backed predictFunction/.test(
  missingCheckpointReport.crashes[0].message),
  'generic AI failure did not direct callers to checkpoint-backed inference');

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-benchmark-'));
const outputPath = writeResult(first, path.join(outputDirectory, 'result.json'));
const saved = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
assert(saved.games.length === first.games.length, 'structured result file is incomplete');
assert(saved.artifacts.reportPath === outputPath, 'report artifact location was not saved');

const timeoutReport = runBenchmark({
  mapName: 'tiny-duel',
  playerA: 'SimpleAiPlayer',
  playerB: 'SimpleAiPlayer',
  seed: 901,
  repeat: 1,
  roundLimit: 1,
  checkpointIdentifier: 'task038-smoke-checkpoint'
});
assert(timeoutReport.summary.timeoutCount === 1, 'forced timeout was not reported');
assert(timeoutReport.summary.failedSeeds.includes(901), 'timeout seed was not marked failed');
assert(timeoutReport.summary.playerAWinRate === 0,
  'timeout was omitted from the attempted-game win-rate denominator');
assert(
  timeoutReport.config.checkpointIdentifier === 'task038-smoke-checkpoint',
  'checkpoint identifier was not reported'
);

let rejectedGameplaySimulation = false;
try {
  runBenchmark(Object.assign({}, options, { simulateCrashSeeds: [431] }));
} catch (error) {
  rejectedGameplaySimulation = /forbidden in gameplay benchmarks/.test(error.message);
}
assert(rejectedGameplaySimulation,
  'gameplay benchmark accepted a synthetic crash option');

const incompleteOutput = path.join(outputDirectory, 'incomplete-failure.json');
const failedIncomplete = spawnSync(process.execPath, [
  path.join(__dirname, 'benchmark.js'),
  '--player-a', 'SimpleAiPlayer',
  '--player-b', 'SimpleAiPlayer',
  '--map', 'tiny-duel',
  '--seed', '901',
  '--repeat', '1',
  '--round-limit', '1',
  '--min-win-rate', '0',
  '--output', incompleteOutput
], { encoding: 'utf8' });
assert(failedIncomplete.status === 1,
  'timeout/non-result was hidden by a permissive win-rate threshold');
assert(/failed attempt/.test(failedIncomplete.stderr),
  'timeout/non-result failure was not reported loudly');

const failureOutput = path.join(outputDirectory, 'threshold-failure.json');
const failedThreshold = spawnSync(process.execPath, [
  path.join(__dirname, 'benchmark.js'),
  '--player-a', 'SimpleAiPlayer',
  '--player-b', 'SimpleAiPlayer',
  '--map', 'tiny-duel',
  '--seed', '7',
  '--repeat', '3',
  '--round-limit', '1',
  '--min-win-rate', '1',
  '--output', failureOutput
], { encoding: 'utf8' });
assert(failedThreshold.status === 1, 'intentionally failing threshold did not exit with status 1');
assert(fs.existsSync(failureOutput), 'threshold failure did not retain its structured report');
assert(/fix the player, model, architecture, or training/.test(failedThreshold.stderr),
  'real gameplay failure was not routed to an AI/model/training fix');

console.log('Deterministic benchmark harness smoke passed');
