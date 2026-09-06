const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');
const { createAlphaZeroLiteCombatModel } = require('./alphazero-lite-combat');
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

async function createLearnedCheckpoint(checkpointPath) {
  fs.mkdirSync(checkpointPath, { recursive: true });
  const created = createAlphaZeroLiteCombatModel({
    filters: 4,
    residualBlocks: 1,
    seed: 66066
  });
  const boards = tf.tensor4d(new Array(2 * 3 * 3 * 21).fill(0).map((_, index) =>
    index % 23 === 0 ? 1 : 0), [2, 3, 3, 21]);
  const globals = tf.tensor2d([[0], [0]], [2, 1]);
  const policies = tf.tensor2d([0, 1].map((selected) =>
    new Array(128).fill(0).map((_, index) => index === selected ? 1 : 0)), [2, 128]);
  const values = tf.tensor2d([[1], [-1]], [2, 1]);
  try {
    await created.model.fit([boards, globals], [policies, values], {
      epochs: 1,
      batchSize: 2,
      shuffle: false,
      verbose: 0
    });
    await created.model.save('file://' + checkpointPath);
  } finally {
    boards.dispose();
    globals.dispose();
    policies.dispose();
    values.dispose();
    created.model.dispose();
  }
  fs.writeFileSync(path.join(checkpointPath, 'metadata.json'), JSON.stringify({
    modelVersion: 2,
    architecture: created.metadata,
    trainingProvenance: {
      kind: 'tiny deterministic combat replay smoke',
      seed: 66066,
      examples: 2
    }
  }, null, 2) + '\n');
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'task066-'));
  const checkpointPath = path.join(temporary, 'learned-checkpoint');
  const reportPath = path.join(temporary, 'report.json');
  const failureReportPath = path.join(temporary, 'failure-report.json');
  await createLearnedCheckpoint(checkpointPath);
  try {
  runBenchmark([
    '--seed', '66066',
    '--maps', '2',
    '--stage', 'task066-smoke',
    '--round-limit', '90',
    '--weak-threshold', '0',
    '--checkpoint', checkpointPath,
    '--output', reportPath
  ]);
  const report = readJson(reportPath);
  check(report.config.combatOnly === true, 'report config is not combat-only');
  check(report.config.playerClasses.model === 'AIPlayer',
    'model player class is not AIPlayer');
  check(report.config.playerClasses.simple === 'SimpleAiPlayer',
    'simple player class is not unchanged SimpleAiPlayer');
  check(report.config.modelCheckpoint === checkpointPath,
    'model checkpoint identifier missing from report config');
  check(report.checkpoint.path === checkpointPath,
    'loaded checkpoint path missing from report');
  check(report.checkpoint.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)),
    'checkpoint file hashes missing from report');
  check(report.checkpoint.gameplayInference.calls > 0,
    'learned checkpoint did not participate in AIPlayer gameplay decisions');
  check(report.games.every((game) =>
    game.inference.source === 'loaded learned combat checkpoint value output'),
  'game report did not identify checkpoint-backed runtime inference');
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
    const runtimeModel = game.modelSide === 'A' ? game.runtimePlayerA : game.runtimePlayerB;
    const runtimeSimple = game.modelSide === 'A' ? game.runtimePlayerB : game.runtimePlayerA;
    check(runtimeModel === 'AIPlayer', 'runtime model player was not AIPlayer');
    check(runtimeSimple === 'SimpleAiPlayer',
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
    '--checkpoint', checkpointPath,
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
  check(failureReport.summary.modelWinrate ===
    failureReport.summary.modelWins / failureReport.summary.games,
  'gate winrate did not count every attempted non-win against the model');
  check(report.summary.sideDistribution.modelA === 1 &&
    report.summary.sideDistribution.modelB === 1,
  'model sides were not balanced');

  let missingRejected = false;
  try {
    runBenchmark([
      '--seed', '66066', '--maps', '2', '--weak-threshold', '0',
      '--checkpoint', path.join(temporary, 'missing'), '--output', reportPath
    ]);
  } catch (error) {
    missingRejected = error.status !== 0 &&
      /combat model checkpoint is missing/.test(String(error.stderr));
  }
  check(missingRejected, 'missing-checkpoint control was not rejected');

  for (let seed = 66066; seed < 66070; ++seed) {
    const gameMap = generatedCombatGameMap(seed, 'task066-inspection');
    assertCombatOnly(gameMap);
    check(gameMap.combatOnly === true, 'generated map lacks combat-only marker');
  }
  for (let seed = 66660; seed < 66664; ++seed) {
    assertCombatOnly(generatedCombatGameMap(seed, 'task066-narrow-map-regression'));
  }
  } finally {
    fs.rmdirSync(temporary, { recursive: true });
  }

  console.log('Combat model benchmark smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
