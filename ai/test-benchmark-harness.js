const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PLAYER_PROFILES,
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
    'seed'
  ]) {
    assert(Object.prototype.hasOwnProperty.call(game, field), 'missing result field ' + field);
  }
}

for (const playerClass of Object.keys(PLAYER_PROFILES)) {
  const comparison = runBenchmark({
    mapName: 'tiny-duel',
    playerA: playerClass,
    playerB: 'SimpleAiPlayer',
    seed: 19,
    repeat: 1,
    roundLimit: 30
  });
  assert(comparison.games[0].playerA === playerClass, playerClass + ' was not selectable');
}

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-benchmark-'));
const outputPath = writeResult(first, path.join(outputDirectory, 'result.json'));
const saved = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
assert(saved.games.length === first.games.length, 'structured result file is incomplete');

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
