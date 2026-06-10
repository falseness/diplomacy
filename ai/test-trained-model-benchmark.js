const fs = require('fs');
const os = require('os');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const {
  loadCheckpoint,
  runBalancedBenchmark
} = require('./benchmark-trained-model');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createCheckpoint(checkpointDir) {
  const board = tf.input({ shape: [3, 3, 21], name: 'board' });
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
  assert(
    report.summary.deterministicReplays === undefined,
    'benchmark still reports deterministic replay shortcuts'
  );
  assert(
    report.games.every(game => !('deterministicReplay' in game) && !('replayedFromSeed' in game)),
    'benchmark game rows still contain replay metadata'
  );
  assert(report.summary.cleanCandidateWins === 2, 'focused candidate did not win cleanly');
  assert(report.summary.thresholdEligibleCandidateWins === 2, 'threshold-eligible wins were not reported');
  assert(report.summary.cleanPreSuddenDeathCandidateWins === 2, 'clean pre-sudden-death wins were not reported');
  assert(report.summary.suddenDeathCandidateWins === 0, 'sudden-death candidate wins were not separated');
  assert(report.summary.candidateWinsIncludingSuddenDeath === 2, 'all candidate wins were not reported separately');
  assert(report.summary.candidateWinRate === 1, 'clean win rate was not reported correctly');
  assert(report.summary.cleanCandidateWinRate === 1, 'explicit clean win rate was not reported correctly');
  assert(report.summary.candidateWinRateIncludingSuddenDeath === 1,
    'candidate win rate including sudden death was not reported correctly');
  assert(report.summary.suddenDeathGames === 0, 'focused seeds should not reach sudden death');
  assert(report.summary.timeouts === 0, 'focused seeds should not time out');
  assert(report.summary.nonWins === 0, 'focused seeds should not report non-wins');
  assert(report.failedSeeds.length === 0, 'failed seeds were not filtered correctly');
  assert(
    report.games.every(game => game.cleanPreSuddenDeathWin && game.thresholdEligibleWin),
    'focused game rows did not expose clean threshold eligibility'
  );
  assert(
    report.games.every(game => game.outcomeType === 'clean-pre-sudden-death-candidate-win'),
    'focused game rows did not classify clean wins explicitly'
  );
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
  assert(secondWeaknessReport.summary.suddenDeathGames === 0,
    'TASK-041 seed 41050 still reached sudden death');
  assert(secondWeaknessReport.summary.cleanPreSuddenDeathCandidateWins === 2,
    'TASK-041 seed 41050 focused rerun was not clean');

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
