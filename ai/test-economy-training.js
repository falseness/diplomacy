const fs = require('fs');
const path = require('path');
const { run } = require('./economy-training');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task036-test-${process.pid}`);
  const runId = 'economy-training-test';
  if (fs.existsSync(storageDir)) {
    fs.rmdirSync(storageDir, { recursive: true });
  }
  const result = await run({
    storageDir,
    runId,
    games: 2,
    epochs: 1,
    seed: 36036,
    checkpointInterval: 1
  });
  try {
    check(result.metrics.length === 2, 'longer economy training did not complete');
    for (const metric of result.metrics) {
      check(metric.cellVectorSize === 78, 'economy training did not use 78-channel vectors');
      check(metric.economyActions > 0, 'self-play data did not contain economy actions');
      for (const category of [
        'unit-command',
        'unit-training',
        'suburb-expansion',
        'building-placement'
      ]) {
        check(metric.actionCounts[category] > 0, `${category} missing from self-play data`);
      }
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
    check(fs.existsSync(path.join(storageDir, 'benchmarks', `${runId}.json`)),
      'benchmark snapshot missing');
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
