const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function check(condition, message) {
  if (!condition) throw new Error(message);
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

function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task064-progress-${process.pid}`);
  const runId = 'task064-combat-progress';
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
        '--games', '1',
        '--epochs', '1',
        '--seed', '64064',
        '--checkpoint-interval', '1'
      ],
      { cwd: path.resolve(__dirname, '..'), env, stdio: 'pipe' }
    );

    const progressPath = path.join(storageDir, 'progress', `${runId}.jsonl`);
    check(fs.existsSync(progressPath), 'combat progress artifact missing');
    const records = readJsonLines(progressPath);
    check(records.length === 1, 'combat progress artifact should contain one record');
    const record = records[0];
    for (const field of [
      'stage',
      'epoch',
      'checkpoint',
      'loss',
      'learningRate',
      'oldVsNewWinrate',
      'simpleAiPlayerWinrate',
      'plateauState',
      'nextStageEligibility'
    ]) {
      check(Object.prototype.hasOwnProperty.call(record, field),
        `combat progress record missing ${field}`);
    }
    check(record.stage === 'combat-foundation',
      'combat progress should not introduce an economy stage');
    check(typeof record.loss === 'number' && Number.isFinite(record.loss),
      'combat progress loss is not machine-readable');
    check(record.checkpoint === path.join('checkpoints', runId, 'step-00000001'),
      'combat progress checkpoint path is not the saved checkpoint');
    check(record.simpleAiPlayerWinrate &&
      record.simpleAiPlayerWinrate.evaluated === false,
    'SimpleAiPlayer winrate field should be explicit when not evaluated');
    check(record.nextStageEligibility &&
      record.nextStageEligibility.eligible === false,
    'next-stage eligibility should stay false for progress-only recording');

    const manifestPath = path.join(storageDir, 'runs', runId, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    check(manifest.artifacts.progress === path.join('progress', `${runId}.jsonl`),
      'manifest does not reference combat progress artifact');
    check(manifest.artifacts.outputFiles.includes(path.join('progress', `${runId}.jsonl`)),
      'manifest outputFiles does not include combat progress artifact');
  } finally {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  }

  console.log('Combat training progress smoke passed');
}

main();
