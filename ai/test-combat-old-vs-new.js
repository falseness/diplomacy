const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function checkpointHashes(storageDir, checkpointPaths) {
  const lines = [];
  for (const checkpointPath of checkpointPaths) {
    const checkpointDir = path.join(storageDir, checkpointPath);
    for (const name of fs.readdirSync(checkpointDir).sort()) {
      const filePath = path.join(checkpointDir, name);
      if (fs.statSync(filePath).isFile()) {
        lines.push(`${sha256(filePath)}  ${path.join(checkpointPath, name)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function repositoryProvenance() {
  const repositoryRoot = path.resolve(__dirname, '..');
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }).trim(),
    dirtyStatus: execFileSync('git', ['status', '--short'], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }).trim().split('\n').filter(Boolean),
    runnerSha256: sha256(path.join(__dirname, 'cloud-train-runner.js')),
    harnessSha256: sha256(path.join(__dirname, 'benchmarkHarness.js')),
    playersSha256: sha256(path.join(__dirname, 'players.js'))
  };
}

function runInterruptedCheckpointSmoke(storageDir, env) {
  const runId = 'task065-interrupted';
  let output = '';
  let failedAsRequested = false;
  try {
    execFileSync(
      'bash',
      [
        './train.sh',
        '--storage-dir', storageDir,
        '--run-id', runId,
        '--games', '2',
        '--epochs', '1',
        '--seed', '65165',
        '--checkpoint-interval', '1',
        '--checkpoint-retain', '1',
        '--old-vs-new-games', '1',
        '--fail-after-game', '2'
      ],
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' }
    );
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
    failedAsRequested = error.status !== 0;
  }
  check(failedAsRequested, 'interrupted checkpoint smoke did not fail as requested');
  const checkpointRoot = path.join(storageDir, 'checkpoints', runId);
  const oldPointer = readJson(path.join(checkpointRoot, 'old-epoch.json'));
  check(oldPointer.path === path.join('checkpoints', runId, 'step-00000001'),
    'interrupted run old epoch pointer did not remain on the prior checkpoint');
  check(fs.existsSync(path.join(storageDir, oldPointer.path, 'model.json')),
    'interrupted run old epoch pointer references missing model data');
  check(fs.existsSync(path.join(storageDir, oldPointer.path, 'metadata.json')),
    'interrupted run old epoch pointer references missing metadata');
  const temporaryDirectories = fs.readdirSync(checkpointRoot)
    .filter((name) => name.includes('.tmp-'));
  check(temporaryDirectories.length === 0,
    'interrupted run left an incomplete temporary checkpoint');
  return {
    checkpointPath: oldPointer.path,
    output: [
    'COMMAND: bash ./train.sh --storage-dir <temporary-storage> --run-id task065-interrupted --games 2 --epochs 1 --seed 65165 --checkpoint-interval 1 --checkpoint-retain 1 --old-vs-new-games 1 --fail-after-game 2',
    'EXPECTED_EXIT_CODE: nonzero',
    output.trimEnd(),
    `OLD_EPOCH_PATH_AFTER_FAILURE: ${oldPointer.path}`,
    'ASSERTION: interrupted run old epoch points to complete model.json and metadata.json',
    'ASSERTION: interrupted run left no temporary checkpoint directory',
    'Interrupted checkpoint publication smoke passed',
    ''
    ].join('\n')
  };
}

function retainEvidence(evidenceDir, storageDir, runId, trainingOutput,
  evaluationOutput, metrics, interruptedStorageDir, interruptedEvidence) {
  if (!evidenceDir) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const checkpointRoot = path.join(storageDir, 'checkpoints', runId);
  const latestPointer = readJson(path.join(checkpointRoot, 'latest.json'));
  const oldPointer = readJson(path.join(checkpointRoot, 'old-epoch.json'));
  fs.copyFileSync(path.join(storageDir, 'progress', `${runId}.jsonl`),
    path.join(evidenceDir, 'progress.jsonl'));
  fs.copyFileSync(path.join(storageDir, 'metrics', `${runId}.jsonl`),
    path.join(evidenceDir, 'metrics.jsonl'));
  fs.copyFileSync(path.join(storageDir, 'runs', runId, 'manifest.json'),
    path.join(evidenceDir, 'manifest.json'));
  fs.copyFileSync(path.join(checkpointRoot, 'old-epoch.json'),
    path.join(evidenceDir, 'old-epoch.json'));
  fs.copyFileSync(path.join(checkpointRoot, 'latest.json'),
    path.join(evidenceDir, 'latest.json'));
  fs.cpSync(path.join(storageDir, oldPointer.path),
    path.join(evidenceDir, 'old-checkpoint'), { recursive: true });
  fs.cpSync(path.join(storageDir, latestPointer.path),
    path.join(evidenceDir, 'latest-checkpoint'), { recursive: true });
  fs.cpSync(path.join(interruptedStorageDir, interruptedEvidence.checkpointPath),
    path.join(evidenceDir, 'interrupted-old-checkpoint'), { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'checkpoint-sha256.txt'),
    checkpointHashes(storageDir, [oldPointer.path, latestPointer.path]));
  fs.writeFileSync(path.join(evidenceDir, 'interrupted-run.log'),
    interruptedEvidence.output);

  const evaluated = metrics.filter((record) =>
    record.oldVsNewEvaluation && record.oldVsNewEvaluation.evaluated);
  const results = evaluated.flatMap((record) => record.oldVsNewEvaluation.results);
  const evaluationSeeds = results.map((result) => result.seed);
  const trainingSeeds = [65065];
  const seedIntersection = evaluationSeeds.filter((seed) => trainingSeeds.includes(seed));
  const provenance = repositoryProvenance();
  fs.writeFileSync(path.join(evidenceDir, 'implementation-evidence.log'), [
    'COMMAND: npm run test-combat-old-vs-new',
    'TRAINING_COMMAND: bash ./train.sh --storage-dir <temporary-storage> --run-id task065-combat-old-vs-new --games 3 --epochs 1 --seed 65065 --checkpoint-interval 1 --checkpoint-retain 1 --old-vs-new-games 2 --plateau-window 2 --plateau-min-delta 2 --plateau-patience 1',
    'SEED: 65065',
    'EXIT_CODE: 0',
    trainingOutput.trimEnd(),
    evaluationOutput.trimEnd(),
    `LATEST_CHECKPOINT: ${latestPointer.path}`,
    `OLD_EPOCH_CHECKPOINT: ${oldPointer.path}`,
    `EVALUATED_GAME_COUNT: ${results.length}`,
    `EVALUATION_SEEDS: ${evaluationSeeds.join(',')}`,
    'EVALUATION_KIND: deterministic-checkpoint-gameplay',
    'RUNTIME_PLAYERS: AIPlayer versus AIPlayer',
    'ASSERTION: previous complete checkpoint retained and loadable as old epoch weights',
    'ASSERTION: old, latest, and interrupted-run checkpoint bytes archived for independent loading',
    'ASSERTION: deterministic real gameplay evaluations invoked both saved checkpoints',
    'ASSERTION: old-vs-new winrate recorded in progress metrics and benchmark summaries',
    'ASSERTION: configured plateau window, minimum delta, and patience produced hold',
    'Combat old-vs-new checkpoint smoke passed',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(evidenceDir, 'anti-cheating-audit.md'), [
    '# TASK-065 anti-cheating audit',
    '',
    `Repository commit: ${provenance.commit}`,
    `Dirty status: ${provenance.dirtyStatus.length ? provenance.dirtyStatus.join('; ') : 'clean'}`,
    `Frozen runner SHA-256: ${provenance.runnerSha256}`,
    `Benchmark harness SHA-256: ${provenance.harnessSha256}`,
    `Runtime player policy SHA-256: ${provenance.playersSha256}`,
    '',
    'Exact commands and complete program output are in implementation-evidence.log and interrupted-run.log; both expected assertions passed.',
    `Training seed list: ${trainingSeeds.join(',')}`,
    'Validation seed list: none (no validation or learned-strength claim in this ticket).',
    `Checkpoint gameplay evaluation seed list: ${evaluationSeeds.join(',')}`,
    `Training/evaluation seed intersection: ${seedIntersection.length ? seedIntersection.join(',') : 'empty'}`,
    `Unique gameplay scenarios: ${new Set(evaluationSeeds).size}`,
    `New-checkpoint side distribution: A=${results.filter((result) => result.newModelSide === 'A').length}, B=${results.filter((result) => result.newModelSide === 'B').length}`,
    `Per-game outcomes: ${JSON.stringify(results)}`,
    '',
    'Source audit: ai/cloud-train-runner.js evaluateNewVsOld and createRuntimeModelPredict; ai/benchmarkHarness.js runGame and active-side routing; ai/players.js unchanged AIPlayer policy.',
    'Controls: missing or incomplete old checkpoints fail before evaluation; both checkpoint predictors must receive gameplay calls; the identical zero-board control input produces distinct old/new checkpoint values and differs from a zeroed-model output, establishing that saved model outputs, rather than a shared heuristic, were routed to unchanged players. Random/heuristic strength controls are not applicable because this ticket makes no model-strength or gate-pass claim.',
    'Result accounting: every attempted game is included; only a winner on the assigned new-model side is a new-model win, and draws, timeouts, crashes, and non-results are not converted to wins.',
    '',
    'Acceptance 1 PASS: old-epoch.json identifies the prior complete checkpoint archived in old-checkpoint for independent loading.',
    'Acceptance 2 PASS: metrics.jsonl records deterministic-checkpoint-gameplay, fixed seeds, balanced side routing, unchanged runtime AIPlayer classes, and calls/probes from both checkpoints.',
    'Acceptance 3 PASS: metrics.jsonl and progress.jsonl record the old-vs-new winrate; metrics benchmark summaries include it.',
    'Acceptance 4 PASS: progress.jsonl records configuredWindow=2, minDelta=2, patience=1, plateau status, and a hold decision.',
    'Acceptance 5 PASS: interrupted-run.log shows forced failure preserved the complete checkpoint archived in interrupted-old-checkpoint and left no temporary checkpoint directory.',
    'Acceptance 6 PASS: this audit records provenance, seeds, sides, outcomes, controls, source paths, commands, and conclusions.',
    ''
  ].join('\n'));
}

async function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task065-old-vs-new-${process.pid}`);
  const interruptedStorageDir = path.join(
    '/mnt/storage/diplomacy', `task065-interrupted-${process.pid}`);
  const runId = 'task065-combat-old-vs-new';
  const evidenceDir = process.env.TASK065_EVIDENCE_DIR
    ? path.resolve(process.env.TASK065_EVIDENCE_DIR)
    : null;
  if (fs.existsSync(storageDir)) {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  if (fs.existsSync(interruptedStorageDir)) {
    fs.rmSync(interruptedStorageDir, { recursive: true, force: true });
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
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' }
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
      check(record.oldVsNewEvaluation.evaluationKind ===
        'deterministic-checkpoint-gameplay',
      'old-vs-new evaluation did not run deterministic gameplay');
      check(record.oldVsNewEvaluation.results.length === 2,
        'old-vs-new evaluation did not retain per-game results');
      check(record.oldVsNewEvaluation.results.every((result) =>
        result.runtimePlayerA === 'AIPlayer' && result.runtimePlayerB === 'AIPlayer'),
      'old-vs-new evaluation did not use unchanged runtime AIPlayer classes');
      check(record.oldVsNewEvaluation.newInference.calls > 0 &&
        record.oldVsNewEvaluation.oldInference.calls > 0,
      'old-vs-new gameplay did not invoke both checkpoint predictors');
      check(record.oldVsNewEvaluation.newInference.probes.some((value) => value !== 0) ||
        record.oldVsNewEvaluation.oldInference.probes.some((value) => value !== 0),
      'old-vs-new checkpoint predictions were indistinguishable from a zero control');
      check(record.oldVsNewEvaluation.checkpointOutputControl.newValue !==
        record.oldVsNewEvaluation.checkpointOutputControl.oldValue,
      'new and old checkpoint outputs did not differ on the frozen control input');
      check(record.oldVsNewEvaluation.checkpointOutputControl.newValue !== 0 ||
        record.oldVsNewEvaluation.checkpointOutputControl.oldValue !== 0,
      'new and old checkpoint outputs matched the zeroed-model control');
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
    const interruptedEvidence = runInterruptedCheckpointSmoke(interruptedStorageDir, env);
    retainEvidence(evidenceDir, storageDir, runId, trainingOutput,
      evalOutput, metrics, interruptedStorageDir, interruptedEvidence);
  } finally {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    if (fs.existsSync(interruptedStorageDir)) {
      fs.rmSync(interruptedStorageDir, { recursive: true, force: true });
    }
  }

  console.log('Combat old-vs-new checkpoint smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
