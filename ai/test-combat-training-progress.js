const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function checkpointHashes(storageDir, checkpointPath) {
  const checkpointDir = path.join(storageDir, checkpointPath);
  return fs.readdirSync(checkpointDir)
    .filter((name) => fs.statSync(path.join(checkpointDir, name)).isFile())
    .sort()
    .map((name) => {
      const contents = fs.readFileSync(path.join(checkpointDir, name));
      return `${crypto.createHash('sha256').update(contents).digest('hex')}  ${path.join(checkpointPath, name)}`;
    })
    .join('\n') + '\n';
}

function retainEvidence(evidenceDir, storageDir, runId, record, trainingOutput) {
  if (!evidenceDir) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const progressPath = path.join(storageDir, 'progress', `${runId}.jsonl`);
  const manifestPath = path.join(storageDir, 'runs', runId, 'manifest.json');
  fs.copyFileSync(progressPath, path.join(evidenceDir, 'progress.jsonl'));
  fs.copyFileSync(manifestPath, path.join(evidenceDir, 'manifest.json'));
  fs.writeFileSync(
    path.join(evidenceDir, 'checkpoint.sha256'),
    checkpointHashes(storageDir, record.checkpoint)
  );
  fs.writeFileSync(
    path.join(evidenceDir, 'implementation-evidence.log'),
    [
      'COMMAND: npm run test-combat-training-progress',
      'TRAINING_COMMAND: bash ./train.sh --storage-dir <temporary-storage> --run-id task064-combat-progress --games 1 --epochs 1 --seed 64064 --checkpoint-interval 1',
      'SEED: 64064',
      'EXIT_CODE: 0',
      trainingOutput.trimEnd(),
      'ASSERTION: progress artifact exists under configured storage directory',
      'ASSERTION: required progress fields are present and machine-readable',
      'ASSERTION: manifest references progress/task064-combat-progress.jsonl',
      'ASSERTION: stage is combat-foundation and next-stage eligibility is false',
      'Combat training progress smoke passed',
      ''
    ].join('\n')
  );
}

function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task064-progress-${process.pid}`);
  const runId = 'task064-combat-progress';
  const evidenceDir = process.env.TASK064_EVIDENCE_DIR
    ? path.resolve(process.env.TASK064_EVIDENCE_DIR)
    : null;
  if (fs.existsSync(storageDir)) {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  try {
    const env = {
      ...process.env,
      PATH: `${node20BinDir()}:${process.env.PATH || ''}`
    };
    const trainingOutput = execFileSync(
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
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' }
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
      'baselineAiPlayerWinrate',
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
      record.simpleAiPlayerWinrate.evaluated === true &&
      record.simpleAiPlayerWinrate.source === 'measured-model-vs-SimpleAiPlayer-benchmark',
    'SimpleAiPlayer winrate field should contain measured benchmark evidence');
    check(record.nextStageEligibility &&
      record.nextStageEligibility.eligible === false,
    'next-stage eligibility should stay false for progress-only recording');
    check(record.nextStageEligibility.requiredSimpleAiPlayerWinrate === 0.8,
      'progress record did not use the 80 percent SimpleAiPlayer gate');
    check(record.baselineAiPlayerWinrate &&
      record.baselineAiPlayerWinrate.evaluated === true &&
      record.baselineAiPlayerWinrate.source === 'measured-model-vs-baseline-AIPlayer-benchmark',
    'baseline AIPlayer winrate field should contain measured benchmark evidence');
    check(record.baselineAiPlayerWinrate.baselineModelPath ===
      '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training',
    'baseline AIPlayer gate did not use the TASK-111 checkpoint path');
    check(record.nextStageEligibility.requiredBaselineAiPlayerWinrate === 0.8,
      'progress record did not use the 80 percent baseline AIPlayer gate');

    const manifestPath = path.join(storageDir, 'runs', runId, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    check(manifest.configuration.curriculumSimpleWinrateThreshold === 0.8,
      'manifest did not record the 80 percent SimpleAiPlayer gate');
    check(manifest.configuration.curriculumBaselineAiModelPath ===
      '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training',
    'manifest did not record the TASK-111 baseline AIPlayer model path');
    check(manifest.artifacts.progress === path.join('progress', `${runId}.jsonl`),
      'manifest does not reference combat progress artifact');
    check(manifest.artifacts.outputFiles.includes(path.join('progress', `${runId}.jsonl`)),
      'manifest outputFiles does not include combat progress artifact');
    retainEvidence(evidenceDir, storageDir, runId, record, trainingOutput);
  } finally {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  }

  console.log('Combat training progress smoke passed');
}

main();
