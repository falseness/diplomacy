const fs = require('fs');
const path = require('path');
const { run } = require('./economy-training');
const {
  runSymmetrical9x9AllUnitsGate
} = require('./benchmark-symmetrical-9x9-all-units-gate');

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
    `task153-test-${process.pid}`
  );
  const runId = 'advanced-9x9-training-test';
  removeDirectory(storageDir);

  try {
    const result = await run({
      storageDir,
      runId,
      games: 6,
      epochs: 1,
      seed: 153000,
      checkpointInterval: 1,
      playerCounts: [2],
      mapSource: 'advanced-9x9-economy'
    });

    check(result.metrics.length === 6,
      'advanced 9x9 training did not complete six stage samples');
    const observedStages = new Set();
    for (const metric of result.metrics) {
      check(metric.dataSource === 'real-runtime-self-play',
        'training data did not come from real runtime self-play');
      check(metric.generatedMapProvenance &&
          metric.generatedMapProvenance.size === 'advanced-economy-9x9',
        'metric did not record advanced 9x9 provenance');
      check(metric.mapSize && metric.mapSize.x === 9 && metric.mapSize.y === 9,
        'training map was not 9x9', metric.mapSize);
      check(metric.players.join(',') ===
          'AIPlayerWithEconomy,SimpleAiPlayerWithEconomy',
        'advanced 9x9 training used unexpected runtime players', metric.players);
      check(metric.examples > 0 && metric.actionsApplied === metric.examples,
        'training examples were not produced by applied actions');
      check(metric.generatedMapProvenance.advancedEconomyStage >= 7 &&
          metric.generatedMapProvenance.advancedEconomyStage <= 12,
        'advanced 9x9 stage was not recorded');
      observedStages.add(metric.generatedMapProvenance.advancedEconomyStage);
    }
    check([7, 8, 9, 10, 11, 12].every(stage => observedStages.has(stage)),
      'training did not cover all advanced 9x9 stages',
      { observedStages: Array.from(observedStages).sort() });

    check(result.candidate &&
        result.candidate.selectedBy === 'lowest-advanced-9x9-training-loss',
      'candidate was not selected from advanced 9x9 training');
    const checkpointDir = path.join(storageDir, result.candidate.checkpoint);
    check(fs.existsSync(path.join(checkpointDir, 'model.json')),
      'candidate checkpoint model is missing');
    const metadata = readJson(path.join(checkpointDir, 'metadata.json'));
    check(metadata.mapSource === 'advanced-9x9-economy',
      'checkpoint metadata did not record advanced map source');
    check(metadata.labelScale === 1,
      'advanced 9x9 checkpoint should use low-weight 9x9 correction scale');
    check(/^generateAdvancedEconomyStage(?:7|8|9|10|11|12)TrainingMap$/.test(
      metadata.mapGenerator),
    'checkpoint metadata did not record an advanced 9x9 generator',
    metadata);

    const snapshot = readJson(result.snapshotPath);
    check(snapshot.status === 'complete' &&
        snapshot.mapSource === 'advanced-9x9-economy',
      'training snapshot did not record advanced 9x9 completion');
    check(snapshot.generatedMapProvenance &&
        JSON.stringify(snapshot.generatedMapProvenance.advancedEconomyStages) ===
          JSON.stringify([7, 8, 9, 10, 11, 12]),
      'training snapshot did not list advanced 9x9 stages');

    const gate = await runSymmetrical9x9AllUnitsGate({
      games: 2,
      seed: 153900,
      roundLimit: 80,
      suddenDeathRound: 80,
      actionLimit: 20,
      commandLimit: 100,
      minNoLossRate: 0,
      minWinRate: 0,
      checkpoint: checkpointDir
    });
    check(gate.config.playerClasses.ai === 'AIPlayerWithEconomy' &&
        gate.config.playerClasses.opponent === 'SimpleAiPlayerWithEconomy',
      'gate did not use the required runtime player classes');
    check(gate.checkpoint.metadata.mapSource === 'advanced-9x9-economy',
      'gate did not load the advanced 9x9 checkpoint');
    check(gate.checkpoint.gameplayInference.calls > 0,
      'gate did not perform checkpoint-backed inference');
  } finally {
    removeDirectory(storageDir);
  }

  console.log('TASK-153 advanced 9x9 economy training smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
