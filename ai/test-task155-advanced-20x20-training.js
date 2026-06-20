const fs = require('fs');
const path = require('path');
const { run } = require('./economy-training');
const {
  runSymmetrical20x20EconomyGate
} = require('./benchmark-symmetrical-20x20-economy-gate');

function check(condition, message, details) {
  if (condition) return;
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function removeDirectory(directory) {
  if (fs.existsSync(directory)) {
    fs.rmdirSync(directory, { recursive: true });
  }
}

async function main() {
  const storageDir = path.join(
    '/mnt',
    'storage',
    'diplomacy',
    `task155-test-${process.pid}`
  );
  const runId = 'advanced-20x20-training-test';
  removeDirectory(storageDir);

  try {
    const result = await run({
      storageDir,
      runId,
      games: 3,
      epochs: 1,
      seed: 155000,
      checkpointInterval: 1,
      playerCounts: [2],
      mapSource: 'advanced-20x20-economy'
    });

    check(result.metrics.length === 3,
      'advanced 20x20 training did not complete three stage samples');
    for (const metric of result.metrics) {
      check(metric.dataSource === 'real-runtime-self-play',
        'training data did not come from real runtime self-play');
      check(metric.generatedMapProvenance &&
          metric.generatedMapProvenance.generator ===
            'generateAdvancedEconomyStage14TrainingMap',
        'metric did not record advanced stage-14 provenance',
        metric.generatedMapProvenance);
      check(metric.generatedMapProvenance.advancedEconomyStage === 14,
        'metric did not record advanced economy stage 14',
        metric.generatedMapProvenance);
      check(metric.mapSize && metric.mapSize.x === 20 && metric.mapSize.y === 20,
        'training map was not 20x20', metric.mapSize);
      check(metric.players.join(',') ===
          'AIPlayerWithEconomy,SimpleAiPlayerWithEconomy',
        'advanced 20x20 training used unexpected runtime players',
        metric.players);
      check(metric.examples > 0 && metric.actionsApplied === metric.examples,
        'training examples were not produced by applied actions',
        { examples: metric.examples, actionsApplied: metric.actionsApplied });
    }

    check(result.candidate &&
        result.candidate.selectedBy === 'lowest-advanced-20x20-training-loss',
      'candidate was not selected from advanced 20x20 training',
      result.candidate);
    const checkpointDir = path.join(storageDir, result.candidate.checkpoint);
    check(fs.existsSync(path.join(checkpointDir, 'model.json')),
      'candidate checkpoint model is missing');
    const metadata = readJson(path.join(checkpointDir, 'metadata.json'));
    check(metadata.mapSource === 'advanced-20x20-economy',
      'checkpoint metadata did not record advanced 20x20 map source');
    check(metadata.mapGenerator === 'generateAdvancedEconomyStage14TrainingMap',
      'checkpoint metadata did not record the stage-14 generator',
      metadata);
    check(metadata.labelScale === 1,
      'advanced 20x20 checkpoint should use low-weight symmetrical correction scale',
      metadata);

    const snapshot = readJson(result.snapshotPath);
    check(snapshot.status === 'complete' &&
        snapshot.mapSource === 'advanced-20x20-economy',
      'training snapshot did not record advanced 20x20 completion');
    check(snapshot.generatedMapProvenance &&
        JSON.stringify(snapshot.generatedMapProvenance.advancedEconomyStages) ===
          JSON.stringify([14]),
      'training snapshot did not list advanced stage 14');

    const gate = await runSymmetrical20x20EconomyGate({
      games: 2,
      seed: 154000,
      roundLimit: 40,
      suddenDeathRound: 120,
      actionLimit: 8,
      commandLimit: 48,
      minNoLossRate: 0,
      minWinRate: 0,
      checkpoint: checkpointDir
    });
    check(gate.config.playerClasses.ai === 'AIPlayerWithEconomy' &&
        gate.config.playerClasses.opponent === 'SimpleAiPlayerWithEconomy',
      'gate did not use the required runtime player classes');
    check(gate.checkpoint.metadata.mapSource === 'advanced-20x20-economy',
      'gate did not load the advanced 20x20 checkpoint');
    check(gate.checkpoint.gameplayInference.calls > 0,
      'gate did not perform checkpoint-backed inference');
  } finally {
    removeDirectory(storageDir);
  }

  console.log('TASK-155 advanced 20x20 economy training smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
