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

for (const playerClass of Object.keys(PLAYER_CLASSES)) {
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
assert(
  timeoutReport.config.checkpointIdentifier === 'task038-smoke-checkpoint',
  'checkpoint identifier was not reported'
);

const crashReport = runBenchmark({
  mapName: 'tiny-duel',
  playerA: 'SimpleAiPlayer',
  playerB: 'SimpleAiPlayer',
  seed: 777,
  repeat: 2,
  roundLimit: 10,
  simulateCrashSeeds: [778]
});
assert(crashReport.summary.crashCount === 1, 'simulated crash was not counted');
assert(crashReport.crashes[0].seed === 778, 'simulated crash seed missing');
assert(crashReport.summary.failedSeeds.includes(778), 'crash seed was not marked failed');

const failureOutput = path.join(outputDirectory, 'threshold-failure.json');
const failedThreshold = spawnSync(process.execPath, [
  path.join(__dirname, 'benchmark.js'),
  '--player-a', 'SimpleAiPlayer',
  '--player-b', 'AIPlayerWithEconomy',
  '--map', 'tiny-duel',
  '--seed', '7',
  '--repeat', '3',
  '--round-limit', '30',
  '--min-win-rate', '1',
  '--output', failureOutput
], { encoding: 'utf8' });
assert(failedThreshold.status === 1, 'intentionally failing threshold did not exit with status 1');
assert(fs.existsSync(failureOutput), 'threshold failure did not retain its structured report');

console.log('Deterministic benchmark harness smoke passed');
