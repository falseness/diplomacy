const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  generatedCombatGameMap,
  assertCombatOnly
} = require('./benchmark-combat-model');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runBenchmark(args) {
  return execFileSync(
    process.execPath,
    ['ai/benchmark-combat-model.js'].concat(args),
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
}

const reportPath = path.join('/mnt/storage/diplomacy/benchmarks', `task066-combat-model-${process.pid}.json`);
const failureReportPath = path.join('/mnt/storage/diplomacy/benchmarks', `task066-combat-model-fail-${process.pid}.json`);

try {
  runBenchmark([
    '--seed', '66066',
    '--maps', '2',
    '--stage', 'task066-smoke',
    '--round-limit', '90',
    '--weak-threshold', '0',
    '--checkpoint', 'task066-smoke-checkpoint',
    '--output', reportPath
  ]);
  const report = readJson(reportPath);
  check(report.config.combatOnly === true, 'report config is not combat-only');
  check(report.config.playerClasses.model === 'AIPlayer',
    'model player class is not AIPlayer');
  check(report.config.playerClasses.simple === 'SimpleAiPlayer',
    'simple player class is not unchanged SimpleAiPlayer');
  check(report.config.modelCheckpoint === 'task066-smoke-checkpoint',
    'model checkpoint identifier missing from report config');
  check(typeof report.summary.modelWinrate === 'number',
    'aggregate model winrate missing');
  check(report.summary.gate === 'passed',
    'zero threshold smoke should pass the weak-model gate');
  check(report.games.length === 2, 'benchmark did not run requested generated maps');
  for (const game of report.games) {
    for (const field of [
      'seed',
      'mapStage',
      'winner',
      'roundCount',
      'timeout',
      'suddenDeath',
      'modelCheckpoint'
    ]) {
      check(Object.prototype.hasOwnProperty.call(game, field),
        `game record missing ${field}`);
    }
    check(game.runtimePlayerA === 'AIPlayer',
      'runtime model player was not AIPlayer');
    check(game.runtimePlayerB === 'SimpleAiPlayer',
      'runtime opponent was not SimpleAiPlayer');
    check(game.combatOnly === true, 'game record is not combat-only');
    check(game.economyObjects.farms === 0, 'combat map contains farms');
    check(game.economyObjects.barracks === 0, 'combat map contains barracks');
    check(game.economyObjects.goldmines === 0, 'combat map contains goldmines');
    check(game.economyObjects.productionActions === 0,
      'combat map contains production actions');
    check(game.economyObjects.resources === 0,
      'combat map contains resources');
  }

  let failed = false;
  try {
    runBenchmark([
      '--seed', '66066',
      '--maps', '2',
      '--stage', 'task066-smoke',
      '--round-limit', '90',
      '--weak-threshold', '1',
      '--checkpoint', 'task066-smoke-checkpoint',
      '--output', failureReportPath
    ]);
  } catch (error) {
    failed = error.status !== 0;
  }
  check(failed, 'high weak-model threshold did not fail the benchmark');
  const failureReport = readJson(failureReportPath);
  check(failureReport.summary.gate === 'failed',
    'failure report did not mark the weak-model gate failed');
  check(failureReport.summary.weakModelThreshold === 1,
    'failure report did not record configured threshold');

  for (let seed = 66066; seed < 66070; ++seed) {
    const gameMap = generatedCombatGameMap(seed, 'task066-inspection');
    assertCombatOnly(gameMap);
    check(gameMap.combatOnly === true, 'generated map lacks combat-only marker');
  }
} finally {
  for (const filePath of [reportPath, failureReportPath]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

console.log('Combat model benchmark smoke passed');
