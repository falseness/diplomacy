const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');

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
    name: 'value_output'
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
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task014-'));
  const checkpointDir = path.join(temporary, 'checkpoint');
  const reportPath = path.join(temporary, 'report.json');
  fs.mkdirSync(checkpointDir);
  await createCheckpoint(checkpointDir);

  const command = [
    path.join(__dirname, 'benchmark-trained-model.js'),
    '--checkpoint', checkpointDir,
    '--games', '100',
    '--seed', '771',
    '--output', reportPath
  ];
  const run = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert(run.status === 0, 'trained benchmark failed: ' + run.stderr);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert(report.config.mapName === 'big-open-field', 'benchmark did not use the big map');
  assert(report.summary.completedGames === 100, 'benchmark did not complete 100 games');
  assert(report.summary.candidateStarts.A === 50, 'candidate did not start 50 games as side A');
  assert(report.summary.candidateStarts.B === 50, 'candidate did not start 50 games as side B');
  assert(report.summary.candidateWinRate > 0.8, 'candidate win rate did not exceed 80 percent');
  for (const field of ['timeouts', 'suddenDeathGames', 'nonResults', 'crashes']) {
    assert(Object.prototype.hasOwnProperty.call(report.summary, field), 'missing ' + field);
  }
  assert(Array.isArray(report.failedSeeds), 'failed seeds were not retained');
  assert(report.checkpoint.metadata.trainingStep === 100, 'checkpoint metadata was not reported');
  assert(report.checkpoint.predictionProbe.length === 1, 'checkpoint was not evaluated');
  assert(
    report.checkpoint.gameplayInference.decisions > 0,
    'checkpoint did not participate in gameplay decisions'
  );
  assert(
    report.checkpoint.gameplayInference.candidateEvaluations >
      report.checkpoint.gameplayInference.decisions,
    'checkpoint did not score competing gameplay actions'
  );

  const thresholdFailure = spawnSync(process.execPath, command.concat([
    '--min-win-rate', '1',
    '--output', path.join(temporary, 'strict-report.json')
  ]), { encoding: 'utf8' });
  assert(thresholdFailure.status === 1, 'strict threshold did not fail with status 1');

  console.log('Trained model big-map benchmark passed');
}

main().catch(function(error) {
  console.error(error.message);
  process.exitCode = 1;
});
