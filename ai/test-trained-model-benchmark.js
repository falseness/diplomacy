const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const {
  BENCHMARK_MAPS,
} = require('./benchmarkHarness');
const {
  buildBenchmarkReport,
  flattenBoardBatch,
  loadCheckpoint,
  runBalancedBenchmark
} = require('./benchmark-trained-model');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createCheckpoint(checkpointDir) {
  const board = tf.input({ shape: [21, 21, 82], name: 'board' });
  const globals = tf.input({ shape: [1], name: 'global_variables' });
  const flattened = tf.layers.flatten().apply(board);
  const merged = tf.layers.concatenate().apply([flattened, globals]);
  const output = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    name: 'value_output',
    kernelInitializer: 'ones',
    biasInitializer: 'zeros'
  }).apply(merged);
  const model = tf.model({ inputs: [board, globals], outputs: output });
  await model.save('file://' + checkpointDir);
  model.dispose();
  fs.writeFileSync(path.join(checkpointDir, 'metadata.json'), JSON.stringify({
    modelVersion: 1,
    trainingStep: 100,
    seed: 771,
    timestamp: new Date(0).toISOString()
  }, null, 2) + '\n');
}

async function main() {
  const flattenProbe = [
    [
      [[1.25, 2.5], [3.75, 4]],
      [[5, 6], [7, 8]]
    ],
    [
      [[-1, -2], [-3, -4]],
      [[-5, -6], [-7, -8]]
    ]
  ];
  assert(
    Array.from(flattenBoardBatch(flattenProbe, 2, 2, 2)).join(',') ===
      flattenProbe.flat(3).join(','),
    'allocation-light board batching changed tensor element order or values'
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task047-'));
  const checkpointDir = path.join(temporary, 'checkpoint');
  fs.mkdirSync(checkpointDir);
  await createCheckpoint(checkpointDir);

  const checkpoint = await loadCheckpoint(checkpointDir);
  const report = runBalancedBenchmark({
    checkpoint: checkpointDir,
    candidate: 'AIPlayerWithEconomy',
    baseline: 'SimpleAiPlayer',
    mapName: 'big-open-field',
    games: 2,
    seed: 41046,
    roundLimit: 60,
    minWinRate: 0.8
  }, checkpoint);
  checkpoint.model.dispose();

  assert(report.config.mapName === 'big-open-field', 'benchmark did not use the big map');
  assert(report.config.candidate === 'AIPlayerWithEconomy', 'benchmark used the wrong candidate class');
  assert(report.summary.completedGames === 2, 'focused benchmark did not complete both games');
  assert(report.summary.runtimeGamesExecuted === 2, 'focused benchmark did not execute every requested game');
  assert(report.summary.uniqueScenarioCount === 1,
    'focused benchmark changed the configured map between seeds');
  const configuredMapHash = crypto.createHash('sha256')
    .update(JSON.stringify(BENCHMARK_MAPS['big-open-field'])).digest('hex');
  assert(report.games.every(game => game.scenarioHash === configuredMapHash),
    'focused benchmark did not use the exact configured big-open-field map');
  assert(report.summary.uniqueTrajectoryCount === 2,
    'focused benchmark did not execute distinct runtime trajectories');
  assert(report.games.every(game => /^[0-9a-f]{64}$/.test(game.trajectoryHash)),
    'runtime trajectory hashes were not reported');
  assert(report.games.every(game => game.trajectoryHash === crypto.createHash('sha256')
    .update(JSON.stringify(game.trajectory)).digest('hex')),
    'trajectory hashes depended on data outside the runtime trajectory');
  assert(report.scenarioPolicy.name === 'configured-benchmark-map-v1',
    'configured-map policy was not reported');
  assert(report.scenarioPolicy.mapSource === 'BENCHMARK_MAPS[config.mapName]',
    'configured-map source was not reported');
  assert(
    report.summary.deterministicReplays === undefined,
    'benchmark still reports deterministic replay shortcuts'
  );
  assert(
    report.games.every(game => !('deterministicReplay' in game) && !('replayedFromSeed' in game)),
    'benchmark game rows still contain replay metadata'
  );
  assert(report.summary.nonWins === report.failedSeeds.length,
    'non-win accounting did not retain every failed seed');
  const cleanDuplicate = Object.assign({}, report.games[0], {
    winnerSide: 'A',
    candidateSide: 'A',
    candidateWon: true,
    cleanPreSuddenDeathWin: true,
    timeout: false,
    suddenDeath: false,
    nonResult: false,
    exactClassAssignment: true,
    genuineOpponentElimination: true,
    gameplayInference: { calls: 1 }
  });
  const duplicateGames = [
    Object.assign({}, cleanDuplicate, { seed: 41046 }),
    Object.assign({}, cleanDuplicate, { seed: 41047 })
  ];
  const duplicateReport = buildBenchmarkReport({
    checkpoint: checkpointDir,
    candidate: 'AIPlayerWithEconomy',
    baseline: 'SimpleAiPlayer',
    mapName: 'big-open-field',
    games: 2,
    seed: 41046,
    roundLimit: 60,
    minWinRate: 0.8
  }, checkpoint, duplicateGames, []);
  assert(duplicateReport.summary.nonWins === 1,
    'duplicate runtime evidence did not fail the quality gate');
  assert(duplicateReport.failedSeeds.includes(duplicateGames[1].seed),
    'duplicate runtime evidence did not retain the failed seed');
  assert(duplicateReport.summary.repeatedTrajectoryGames === 1,
    'repeated fixed-map trajectories were not reported explicitly');
  assert(report.games.every(game => typeof game.thresholdEligibleWin === 'boolean'),
    'game rows did not expose threshold eligibility');
  assert(report.games.every(game => typeof game.outcomeType === 'string'),
    'game rows did not classify outcomes explicitly');
  assert(report.games.every(game => game.runtimePlayerA && game.runtimePlayerB),
    'runtime player classes were not reported');
  assert(report.games.some(game => game.seed === 41046), 'TASK-041 seed 41046 was not covered');
  assert(
    report.checkpoint.gameplayInference.calls > 0,
    'checkpoint did not participate in gameplay decisions'
  );
  assert(
    report.checkpoint.gameplayInference.positions >
      report.checkpoint.gameplayInference.calls,
    'checkpoint did not score competing gameplay actions'
  );

  const secondWeaknessCheckpoint = await loadCheckpoint(checkpointDir);
  const secondWeaknessReport = runBalancedBenchmark({
    checkpoint: checkpointDir,
    candidate: 'AIPlayerWithEconomy',
    baseline: 'SimpleAiPlayer',
    mapName: 'big-open-field',
    games: 2,
    seed: 41050,
    roundLimit: 60,
    minWinRate: 0.8
  }, secondWeaknessCheckpoint);
  secondWeaknessCheckpoint.model.dispose();
  assert(secondWeaknessReport.games.some(game => game.seed === 41050),
    'TASK-041 seed 41050 was not covered');
  assert(secondWeaknessReport.summary.nonWins === secondWeaknessReport.failedSeeds.length,
    'TASK-041 seed 41050 failures were not retained');

  const strictCheckpoint = await loadCheckpoint(checkpointDir);
  const strictFailure = runBalancedBenchmark({
    checkpoint: checkpointDir,
    candidate: 'SimpleAiPlayer',
    baseline: 'SimpleAiPlayer',
    mapName: 'big-open-field',
    games: 2,
    seed: 41046,
    roundLimit: 2,
    minWinRate: 0.8
  }, strictCheckpoint);
  strictCheckpoint.model.dispose();
  assert(strictFailure.summary.nonWins > 0, 'non-wins were not retained in strict report');
  assert(strictFailure.failedSeeds.length > 0, 'strict report did not retain failed seeds');

  console.log('Trained model big-map benchmark passed');
}

main().catch(function(error) {
  console.error(error.message);
  process.exitCode = 1;
});
