const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function runTrain(storageDir, args) {
  const env = {
    ...process.env,
    PATH: `${node20BinDir()}:${process.env.PATH || ''}`
  };
  execFileSync(
    'bash',
    ['./train.sh', '--storage-dir', storageDir, ...args],
    { cwd: path.resolve(__dirname, '..'), env, stdio: 'pipe' }
  );
}

function runWithCleanStorage(name, callback) {
  const storageDir = path.join('/mnt/storage/diplomacy', `${name}-${process.pid}`);
  if (fs.existsSync(storageDir)) {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  try {
    callback(storageDir);
  } finally {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  }
}

function progressRecords(storageDir, runId) {
  return readJsonLines(path.join(storageDir, 'progress', `${runId}.jsonl`));
}

function assertNoCheatingSourceChanges() {
  const playersSource = fs.readFileSync(path.resolve(__dirname, 'players.js'), 'utf8');
  check(!/grid\.arr\.length\s*==|grid\.arr\.length\s*===/.test(playersSource),
    'AI player source has ad-hoc grid height conditionals');
  check(!/grid\.arr\[0\]\.length\s*==|grid\.arr\[0\]\.length\s*===/.test(playersSource),
    'AI player source has ad-hoc grid width conditionals');
  check(!playersSource.includes('curriculumSimpleWinrate'),
    'AI player source should not know about curriculum benchmark gates');
}

function assertPassingGate() {
  runWithCleanStorage('task068-curriculum-pass', (storageDir) => {
    const runId = 'task068-pass';
    runTrain(storageDir, [
      '--run-id', runId,
      '--games', '3',
      '--epochs', '1',
      '--seed', '68068',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate', '0.75',
      '--curriculum-lr-reduction-attempted'
    ]);

    const progress = progressRecords(storageDir, runId);
    check(progress.length === 3, 'passing run should write three progress records');
    const first = progress[0];
    const final = progress[2];
    check(first.nextStageEligibility.decision === 'hold',
      'stage advanced before plateau evidence existed');
    check(first.curriculum.currentStageIndex === 0,
      'early gate changed the stage unexpectedly');
    check(final.plateauState.status === 'plateau',
      'passing run did not produce plateau evidence');
    check(final.learningRateReduction.attempted === true,
      'passing run did not record the lower learning-rate attempt');
    check(final.learningRateReduction.improved === false,
      'passing run should require the lower learning-rate attempt not to improve');
    check(final.simpleAiPlayerWinrate.evaluated === true &&
      final.simpleAiPlayerWinrate.value === 0.75,
    'passing run did not record SimpleAiPlayer winrate evidence');
    check(final.nextStageEligibility.eligible === true &&
      final.nextStageEligibility.decision === 'advance',
    'passing run did not advance after all gates passed');
    check(final.curriculum.currentStageIndex === 1,
      'passing run did not persist the advanced stage in progress');

    const state = readJson(path.join(storageDir, 'runs', runId, 'state.json'));
    check(state.curriculum.currentStageIndex === 1,
      'passing run did not persist advanced stage in state');
    check(state.curriculum.gateHistory.length === 3,
      'passing run did not persist gate history');
    check(state.curriculum.gateHistory[2].advancedToStage === 'combat-stage-1',
      'passing run did not record the stage transition');

    const manifest = readJson(path.join(storageDir, 'runs', runId, 'manifest.json'));
    check(manifest.curriculum.currentStageIndex === 1,
      'manifest did not include advanced curriculum state');
    check(manifest.configuration.curriculumSimpleWinrateThreshold === 0.6,
      'manifest did not record the SimpleAiPlayer threshold');
  });
}

function assertFailingGate() {
  runWithCleanStorage('task068-curriculum-fail', (storageDir) => {
    const runId = 'task068-fail';
    runTrain(storageDir, [
      '--run-id', runId,
      '--games', '3',
      '--epochs', '1',
      '--seed', '68069',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate', '0.6',
      '--curriculum-lr-reduction-attempted'
    ]);

    const final = progressRecords(storageDir, runId)[2];
    check(final.plateauState.status === 'plateau',
      'failing run should still have plateau evidence');
    check(final.nextStageEligibility.eligible === false &&
      final.nextStageEligibility.decision === 'hold',
    'failing SimpleAiPlayer gate advanced the stage');
    check(final.nextStageEligibility.reason.includes('greater than 0.6'),
      'failing SimpleAiPlayer gate did not record the threshold reason');
    check(final.curriculum.currentStageIndex === 0,
      'failing SimpleAiPlayer gate changed the current stage');

    const state = readJson(path.join(storageDir, 'runs', runId, 'state.json'));
    check(state.curriculum.currentStageIndex === 0,
      'failed gate should persist the original stage');
    check(state.curriculum.gateHistory[2].decision === 'hold',
      'failed gate history did not record hold decision');
  });
}

function assertResumeGateHistory() {
  runWithCleanStorage('task068-curriculum-resume', (storageDir) => {
    const runId = 'task068-resume';
    const common = [
      '--games', '3',
      '--epochs', '1',
      '--seed', '68070',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate', '0.75',
      '--curriculum-lr-reduction-attempted'
    ];
    runTrain(storageDir, [
      '--run-id', runId,
      ...common,
      '--max-games-this-run', '2'
    ]);

    const pausedState = readJson(path.join(storageDir, 'runs', runId, 'state.json'));
    check(pausedState.status === 'paused',
      'controlled run should pause before resume');
    check(pausedState.curriculum.currentStageIndex === 0,
      'paused run should not advance before the plateau window fills');
    check(pausedState.curriculum.gateHistory.length === 2,
      'paused run should persist early gate history');

    runTrain(storageDir, [
      '--resume',
      '--curriculum-simple-winrate', '0.75',
      '--curriculum-lr-reduction-attempted'
    ]);

    const resumedState = readJson(path.join(storageDir, 'runs', runId, 'state.json'));
    check(resumedState.status === 'complete',
      'resume run did not complete');
    check(resumedState.curriculum.currentStageIndex === 1,
      'resume run did not preserve and advance stage state');
    check(resumedState.curriculum.gateHistory.length === 3,
      'resume run did not preserve gate history');
    check(resumedState.resumeEvents.length === 1,
      'resume event was not persisted');
    const finalProgress = progressRecords(storageDir, runId)[2];
    check(finalProgress.curriculum.gateHistory.length === 3,
      'resume progress did not include restored gate history');
  });
}

assertNoCheatingSourceChanges();
assertPassingGate();
assertFailingGate();
assertResumeGateHistory();

console.log('Combat curriculum controller smoke passed');
