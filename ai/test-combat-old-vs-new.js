const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function node20BinDir() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) {
    return path.dirname(process.execPath);
  }
  const output = execFileSync(
    'npx',
    ['-y', '-p', 'node@20', 'node', '-e', 'console.log(require("path").dirname(process.execPath))'],
    { encoding: 'utf8' }
  );
  return output.trim();
}

async function assertLoadableModel(checkpointDir, message) {
  const model = await tf.loadLayersModel(
    `file://${path.join(checkpointDir, 'model.json')}`
  );
  try {
    check(model.inputs[0].shape[3] === 21, message);
  } finally {
    model.dispose();
  }
}

async function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task065-old-vs-new-${process.pid}`);
  const runId = 'task065-combat-old-vs-new';
  if (fs.existsSync(storageDir)) {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  try {
    const env = {
      ...process.env,
      PATH: `${node20BinDir()}:${process.env.PATH || ''}`
    };
    execFileSync(
      'bash',
      [
        './train.sh',
        '--storage-dir', storageDir,
        '--run-id', runId,
        '--games', '3',
        '--epochs', '1',
        '--seed', '65065',
        '--checkpoint-interval', '1',
        '--checkpoint-retain', '1',
        '--old-vs-new-games', '2',
        '--plateau-window', '2',
        '--plateau-min-delta', '2',
        '--plateau-patience', '1'
      ],
      { cwd: path.resolve(__dirname, '..'), env, stdio: 'pipe' }
    );

    const checkpointRoot = path.join(storageDir, 'checkpoints', runId);
    const latestPointer = readJson(path.join(checkpointRoot, 'latest.json'));
    const oldPointer = readJson(path.join(checkpointRoot, 'old-epoch.json'));
    check(latestPointer.path === path.join('checkpoints', runId, 'step-00000003'),
      'latest checkpoint pointer did not advance to step 3');
    check(oldPointer.path === path.join('checkpoints', runId, 'step-00000002'),
      'old epoch pointer did not preserve the previous checkpoint');
    check(fs.existsSync(path.join(storageDir, oldPointer.path, 'metadata.json')),
      'old epoch metadata missing after retention pruning');
    await assertLoadableModel(path.join(storageDir, oldPointer.path),
      'old epoch checkpoint is not loadable');

    const metrics = readJsonLines(path.join(storageDir, 'metrics', `${runId}.jsonl`))
      .filter((record) => record.type === 'game');
    check(metrics.length === 3, 'expected three metric records');
    const evaluated = metrics.filter((record) =>
      record.oldVsNewEvaluation && record.oldVsNewEvaluation.evaluated);
    check(evaluated.length === 2, 'expected old-vs-new evaluations after checkpoints 2 and 3');
    for (const record of evaluated) {
      check(record.oldVsNewEvaluation.games === 2,
        'old-vs-new evaluation did not use the configured game count');
      check(typeof record.oldVsNewEvaluation.winrate === 'number',
        'old-vs-new winrate was not recorded');
      check(record.benchmarkSummary &&
        record.benchmarkSummary.oldVsNewWinrate &&
        record.benchmarkSummary.oldVsNewWinrate.evaluated === true,
      'benchmark summary did not include old-vs-new evaluation');
    }

    const progress = readJsonLines(path.join(storageDir, 'progress', `${runId}.jsonl`));
    check(progress.length === 3, 'expected three progress records');
    const finalProgress = progress[2];
    check(finalProgress.oldVsNewWinrate.evaluated === true,
      'progress did not record evaluated old-vs-new winrate');
    check(finalProgress.plateauState.minDelta === 2,
      'plateau decision did not use configured min delta');
    check(finalProgress.plateauState.configuredWindow === 2,
      'plateau decision did not use configured window');
    check(finalProgress.nextStageEligibility.decision === 'hold',
      'configured plateau smoke did not hold advancement');

    const manifest = readJson(path.join(storageDir, 'runs', runId, 'manifest.json'));
    check(manifest.artifacts.oldEpochWeights === path.join('checkpoints', runId, 'old-epoch.json'),
      'manifest does not reference old epoch weights pointer');
    check(manifest.configuration.oldVsNewGames === 2,
      'manifest did not record old-vs-new configuration');

    const evalOutput = execFileSync(
      'bash',
      ['./train.sh', '--storage-dir', storageDir, '--evaluate-latest'],
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' }
    );
    check(evalOutput.includes('"trainingStep":3'),
      'latest checkpoint evaluation did not load step 3');
  } finally {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  }

  console.log('Combat old-vs-new checkpoint smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
