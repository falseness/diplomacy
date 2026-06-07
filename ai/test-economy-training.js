const fs = require('fs');
const path = require('path');
const { run } = require('./economy-training');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task036-test-${process.pid}`);
  const runId = 'economy-training-test';
  let incrementalSnapshotChecked = false;
  if (fs.existsSync(storageDir)) {
    fs.rmdirSync(storageDir, { recursive: true });
  }
  const result = await run({
    storageDir,
    runId,
    games: 2,
    epochs: 1,
    seed: 36036,
    checkpointInterval: 1,
    onGameComplete({ game, snapshotPath, finalDir }) {
      if (game !== 1) return;
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath));
      check(snapshot.status === 'running',
        'intermediate benchmark snapshot was not marked running');
      check(snapshot.completedGames === 1 && snapshot.games.length === 1,
        'intermediate benchmark snapshot did not contain first-game results');
      check(snapshot.candidate && snapshot.candidate.game === 1,
        'intermediate benchmark snapshot did not identify a saved candidate');
      check(!fs.existsSync(path.join(finalDir, 'model.json')),
        'benchmark snapshot was not written until after final model saving');
      incrementalSnapshotChecked = true;
    }
  });
  try {
    check(incrementalSnapshotChecked,
      'benchmark snapshot was not inspected during training');
    check(result.metrics.length === 2, 'longer economy training did not complete');
    for (const metric of result.metrics) {
      check(metric.cellVectorSize === 78, 'economy training did not use 78-channel vectors');
      check(metric.dataSource === 'real-runtime-self-play',
        'training data did not come from real runtime self-play');
      check(metric.players.every(name => name === 'AIPlayerWithEconomy'),
        'self-play did not use two AIPlayerWithEconomy players');
      check(metric.turnsPlayed > 0, 'self-play did not advance turns');
      check(metric.actionsApplied === metric.examples && metric.actionsApplied > 0,
        'training examples were not produced by applied actions');
      check(metric.economyActions > 0, 'self-play data did not contain economy actions');
      check(metric.mapFeatures.units > 0 && metric.mapFeatures.goldmines > 0,
        'training map did not contain combat and economy features');
      for (const category of [
        'unit-command',
        'unit-training',
        'suburb-expansion',
        'building-placement'
      ]) {
        check(metric.actionCounts[category] > 0, `${category} missing from self-play data`);
      }
      check(metric.appliedActions.every(action =>
        action.playerIndex === 1 || action.playerIndex === 2),
      'applied action records do not identify a self-play participant');
    }
    const checkpointRoot = path.join(storageDir, 'checkpoints', runId);
    check(fs.existsSync(path.join(checkpointRoot, 'step-00000001', 'model.json')),
      'first training checkpoint missing');
    check(fs.existsSync(path.join(checkpointRoot, 'step-00000002', 'model.json')),
      'second training checkpoint missing');
    check(fs.existsSync(path.join(checkpointRoot, 'candidate.json')),
      'candidate checkpoint selection missing');
    check(fs.existsSync(path.join(storageDir, 'metrics', `${runId}.jsonl`)),
      'intermediate metrics missing');
    const snapshotPath = path.join(storageDir, 'benchmarks', `${runId}.json`);
    check(fs.existsSync(snapshotPath), 'benchmark snapshot missing');
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath));
    check(snapshot.status === 'complete' && snapshot.completedGames === 2,
      'final benchmark snapshot did not record completed training');
    check(fs.existsSync(path.join(storageDir, 'final', runId, 'model.json')),
      'final economy model missing');
  } finally {
    if (fs.existsSync(storageDir)) {
      fs.rmdirSync(storageDir, { recursive: true });
    }
  }
  console.log('AIPlayerWithEconomy training smoke passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
