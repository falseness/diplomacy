const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadAiScripts } = require('./smokeHarness');
const {
  curriculumGateDecision,
  initialCurriculumState,
  updateCurriculumState
} = require('./cloud-train-runner');

const CURRICULUM_STAGE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

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
  const playerClassSource = playersSource.slice(playersSource.indexOf('class SimpleAiPlayer'));
  const benchmarkSource = fs.readFileSync(
    path.resolve(__dirname, 'benchmark-combat-model.js'), 'utf8');
  check(!/grid\.arr\.length\s*==|grid\.arr\.length\s*===/.test(playersSource),
    'AI player source has ad-hoc grid height conditionals');
  check(!/grid\.arr\[0\]\.length\s*==|grid\.arr\[0\]\.length\s*===/.test(playersSource),
    'AI player source has ad-hoc grid width conditionals');
  check(!/\bif\s*\([^)]*grid\.arr(?:\[0\])?\.length/.test(playerClassSource),
    'AI player source has ad-hoc grid-size if branches');
  check(!/\bAIPlayer\b[\s\S]{0,250}\bconcede\s*\(/.test(benchmarkSource),
    'combat benchmark should not force SimpleAiPlayer concessions');
  check(!/artificialAdvantage|candidateGoldBonus|simpleHandicap/.test(benchmarkSource + playersSource),
    'SimpleAiPlayer comparison contains an artificial advantage hook');
  check(!playersSource.includes('curriculumSimpleWinrate'),
    'AI player source should not know about curriculum benchmark gates');
}

function stageLabel(stageIndex) {
  return CURRICULUM_STAGE_LABELS[stageIndex] || `post-${stageIndex}`;
}

function assertGateEvidence(record, label) {
  check(record.plateauState.status === 'plateau',
    label + ' did not include plateau evidence');
  check(record.learningRateReduction.attempted === true,
    label + ' did not include the required learning-rate reduction attempt');
  check(record.learningRateReduction.improved === false,
    label + ' learning-rate attempt should not improve before advancing');
  check(record.simpleAiPlayerWinrate.evaluated === true,
    label + ' did not evaluate SimpleAiPlayer winrate');
  check(record.simpleAiPlayerWinrate.value >
      record.nextStageEligibility.requiredSimpleAiPlayerWinrateExclusiveFloor,
    label + ' did not require SimpleAiPlayer winrate greater than 60 percent');
  check(record.simpleAiPlayerWinrate.value >= record.nextStageEligibility.requiredSimpleAiPlayerWinrate,
    label + ' did not require SimpleAiPlayer winrate at least the threshold');
}

function assertStrictSixtyPercentBoundary() {
  const state = { curriculum: { currentStageIndex: 0, currentStage: 'combat-foundation' } };
  const plateau = { status: 'plateau' };
  const learningRateAttempt = { attempted: true, improved: false };
  const evaluated = (value) => ({ value, evaluated: true, games: 10, source: 'tiny-evaluation' });
  const options = { curriculumSimpleWinrateThreshold: 0.6 };
  const exactBoundary = curriculumGateDecision(
    state,
    plateau,
    evaluated(0.6),
    learningRateAttempt,
    options,
    evaluated(0.6)
  );
  check(exactBoundary.decision === 'hold' && exactBoundary.eligible === false,
    'exactly 60 percent SimpleAiPlayer winrate must not advance');
  check(exactBoundary.reason.includes('greater than 0.6'),
    'exactly 60 percent rejection did not record the strict boundary reason');
  check(exactBoundary.requiredSimpleAiPlayerWinrateExclusiveFloor === 0.6,
    'gate did not expose the strict 60 percent floor');

  const aboveBoundary = curriculumGateDecision(
    state,
    plateau,
    evaluated(0.61),
    learningRateAttempt,
    options,
    evaluated(0.6)
  );
  check(aboveBoundary.decision === 'advance' && aboveBoundary.eligible === true,
    'above-60 percent SimpleAiPlayer winrate did not advance after all gates passed');
}

function assertFocusedTask068Controller() {
  const evaluated = (value) => ({
    value,
    evaluated: true,
    games: 10,
    source: 'fixed tiny curriculum evaluation',
    artificialAdvantage: false
  });
  const options = { curriculumSimpleWinrateThreshold: 0.6 };
  const passingEvidence = [
    ['missing plateau', { status: 'insufficient-history' }, { attempted: true, improved: false }],
    ['missing learning-rate attempt', { status: 'plateau' }, { attempted: false, improved: false }],
    ['improving learning-rate attempt', { status: 'plateau' }, { attempted: true, improved: true }]
  ];
  for (const [label, plateau, learningRateAttempt] of passingEvidence) {
    const decision = curriculumGateDecision(
      { curriculum: initialCurriculumState() },
      plateau,
      evaluated(0.61),
      learningRateAttempt,
      options,
      evaluated(0.6)
    );
    check(decision.decision === 'hold' && decision.eligible === false,
      `${label} advanced the curriculum stage`);
  }

  const storageDir = path.join('/mnt/storage/diplomacy', `task068-focused-${process.pid}`);
  const statePath = path.join(storageDir, 'state.json');
  fs.mkdirSync(storageDir, { recursive: true });
  try {
    const pausedState = {
      runId: 'task068-focused',
      completedGames: 1,
      status: 'paused',
      curriculum: initialCurriculumState()
    };
    const held = curriculumGateDecision(
      pausedState,
      { status: 'insufficient-history' },
      evaluated(0.61),
      { attempted: true, improved: false },
      options,
      evaluated(0.6)
    );
    updateCurriculumState(pausedState, held);
    fs.writeFileSync(statePath, `${JSON.stringify(pausedState, null, 2)}\n`);

    const resumedState = readJson(statePath);
    check(resumedState.curriculum.currentStageIndex === 0 &&
        resumedState.curriculum.gateHistory.length === 1,
      'saved curriculum stage or gate history was not restored');
    resumedState.status = 'running';
    resumedState.completedGames = 2;
    const passing = curriculumGateDecision(
      resumedState,
      { status: 'plateau' },
      evaluated(0.61),
      { attempted: true, improved: false },
      options,
      evaluated(0.6)
    );
    check(passing.decision === 'advance' && passing.eligible === true,
      'complete plateau, learning-rate, and SimpleAiPlayer evidence did not pass');
    updateCurriculumState(resumedState, passing);
    fs.writeFileSync(statePath, `${JSON.stringify(resumedState, null, 2)}\n`);

    const completedState = readJson(statePath);
    check(completedState.curriculum.currentStageIndex === 1 &&
        completedState.curriculum.gateHistory.length === 2,
      'resumed curriculum did not preserve history and persist advancement');
    check(completedState.curriculum.gateHistory[1].simpleAiPlayerWinrate.value === 0.61,
      'resumed gate history did not preserve SimpleAiPlayer evidence');

    const failingState = {
      completedGames: 1,
      curriculum: initialCurriculumState()
    };
    const exactSixty = curriculumGateDecision(
      failingState,
      { status: 'plateau' },
      evaluated(0.6),
      { attempted: true, improved: false },
      options,
      evaluated(0.6)
    );
    updateCurriculumState(failingState, exactSixty);
    check(failingState.curriculum.currentStageIndex === 0 &&
        failingState.curriculum.gateHistory[0].decision === 'hold',
      'failed 60-percent gate changed the stage or omitted the hold history');
    check(failingState.curriculum.gateHistory[0].reason.includes('greater than 0.6'),
      'failed 60-percent gate did not persist its blocker reason');
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
  console.log('Step 1 PASS: fixed tiny curriculum evaluations exercised the controller');
  console.log('Step 2 PASS: advancement required plateau, one failed learning-rate reduction, and SimpleAiPlayer winrate above 60 percent');
  console.log('Step 3 PASS: exactly 60 percent held the current stage and persisted the blocker reason');
  console.log('Step 4 PASS: saved curriculum stage and gate history survived resume and advancement');
}

function assertEveryStageBoundary() {
  runWithCleanStorage('task076-curriculum-boundaries', (storageDir) => {
    const runId = 'task076-boundaries';
    runTrain(storageDir, [
      '--run-id', runId,
      '--games', '8',
      '--epochs', '1',
      '--seed', '76076',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate', '0.85',
      '--curriculum-lr-reduction-attempted'
    ]);

    const progress = progressRecords(storageDir, runId);
    check(progress.length === 8, 'boundary run should write eight progress records');

    for (let fromStageIndex = 0; fromStageIndex < CURRICULUM_STAGE_LABELS.length - 1;
      fromStageIndex += 1) {
      const record = progress[fromStageIndex + 2];
      const fromLabel = stageLabel(fromStageIndex);
      const toLabel = stageLabel(fromStageIndex + 1);
      const label = `Stage ${fromLabel} to Stage ${toLabel}`;
      check(record.nextStageEligibility.currentStageIndex === fromStageIndex,
        label + ' started from the wrong stage index');
      check(record.nextStageEligibility.eligible === true &&
          record.nextStageEligibility.decision === 'advance',
        label + ' did not advance after all gates passed');
      assertGateEvidence(record, label);
      check(record.curriculum.currentStageIndex === fromStageIndex + 1,
        label + ' did not persist the next stage index');
      const gate = record.curriculum.gateHistory[record.curriculum.gateHistory.length - 1];
      check(gate.stageIndex === fromStageIndex &&
          gate.advancedToStageIndex === fromStageIndex + 1,
        label + ' was not recorded in gate history');
    }

    const state = readJson(path.join(storageDir, 'runs', runId, 'state.json'));
    check(state.curriculum.currentStageIndex === 6,
      'boundary run should stop on Stage G');
    check(state.curriculum.gateHistory.filter((entry) =>
      entry.decision === 'advance').length === 6,
      'boundary run should record six stage-boundary advances');
  });
}

function assertMissingLearningRateGate() {
  runWithCleanStorage('task076-curriculum-missing-lr', (storageDir) => {
    const runId = 'task076-missing-lr';
    runTrain(storageDir, [
      '--run-id', runId,
      '--games', '3',
      '--epochs', '1',
      '--seed', '76077',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate', '0.85'
    ]);

    const final = progressRecords(storageDir, runId)[2];
    check(final.plateauState.status === 'plateau',
      'missing learning-rate test should have plateau evidence');
    check(final.learningRateReduction.attempted === false,
      'missing learning-rate test unexpectedly recorded an attempt');
    check(final.nextStageEligibility.eligible === false &&
        final.nextStageEligibility.decision === 'hold',
      'missing learning-rate evidence advanced the stage');
    check(final.nextStageEligibility.reason.includes('lower learning-rate attempt'),
      'missing learning-rate blocker reason was not recorded');
    check(final.curriculum.currentStageIndex === 0,
      'missing learning-rate evidence changed the stage');
  });
}

function assertStageMapsRemainCombatOnly() {
  const { context } = loadAiScripts();
  const api = new Function('context', `return {
    generateCombatStageATrainingMap: context.generateCombatStageATrainingMap,
    generateCombatStageBTrainingMap: context.generateCombatStageBTrainingMap,
    generateCombatStageCTrainingMap: context.generateCombatStageCTrainingMap,
    generateCombatStageDTrainingMap: context.generateCombatStageDTrainingMap,
    generateCombatStageETrainingMap: context.generateCombatStageETrainingMap,
    generateCombatStageFTrainingMap: context.generateCombatStageFTrainingMap,
    generateCombatStageGTrainingMap: context.generateCombatStageGTrainingMap
  };`)(context);
  const passedCurriculum = (stageIndex) => ({
    currentStageIndex: stageIndex + 1,
    currentStage: `combat-stage-${stageIndex + 1}`,
    gateHistory: [{
      stageIndex,
      stage: `combat-stage-${stageIndex}`,
      decision: 'advance',
      advancedToStageIndex: stageIndex + 1,
      advancedToStage: `combat-stage-${stageIndex + 1}`
    }]
  });
  const stages = [
    ['A', () => api.generateCombatStageATrainingMap({ seed: 76100 })],
    ['B', () => api.generateCombatStageBTrainingMap({ seed: 76101, progress: 1 })],
    ['C', () => api.generateCombatStageCTrainingMap({ seed: 76102, progress: 1 })],
    ['D', () => api.generateCombatStageDTrainingMap({ seed: 76103, progress: 1 })],
    ['E', () => api.generateCombatStageETrainingMap({
      seed: 76104,
      progress: 1,
      curriculum: passedCurriculum(3)
    })],
    ['F', () => api.generateCombatStageFTrainingMap({
      seed: 76105,
      progress: 1,
      curriculum: passedCurriculum(4)
    })],
    ['G', () => api.generateCombatStageGTrainingMap({
      seed: 76106,
      progress: 1,
      curriculum: passedCurriculum(5)
    })]
  ];

  for (const [stage, createMap] of stages) {
    const map = createMap();
    check(map.combatOnly === true, `Stage ${stage} map is not marked combat-only`);
    for (const [name, count] of Object.entries(map.economyObjects || {})) {
      check(count === 0, `Stage ${stage} map has economy object count for ${name}`);
    }
    for (const player of map.players) {
      for (const property of [
        'towns',
        'barracks',
        'pendingBarracks',
        'farms',
        'pendingFarms',
        'walls',
        'bastions',
        'towers'
      ]) {
        check((player[property] || []).length === 0,
          `Stage ${stage} player has economy/building entries in ${property}`);
      }
    }
    check(!JSON.stringify(map.combatMetrics || {}).includes('economy'),
      `Stage ${stage} metrics mention economy actions`);
  }
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
      '--curriculum-simple-winrate', '0.85',
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
      final.simpleAiPlayerWinrate.value === 0.85,
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
    check(manifest.configuration.curriculumSimpleWinrateThreshold === 0.8,
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
      '--curriculum-simple-winrate', '0.79',
      '--curriculum-lr-reduction-attempted'
    ]);

    const final = progressRecords(storageDir, runId)[2];
    check(final.plateauState.status === 'plateau',
      'failing run should still have plateau evidence');
    check(final.nextStageEligibility.eligible === false &&
      final.nextStageEligibility.decision === 'hold',
    'failing SimpleAiPlayer gate advanced the stage');
    check(final.nextStageEligibility.reason.includes('at least 0.8'),
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
      '--curriculum-simple-winrate', '0.85',
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
      '--curriculum-simple-winrate', '0.85',
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
assertStrictSixtyPercentBoundary();
if (process.argv.includes('--task068-only')) {
  assertFocusedTask068Controller();
  console.log('TASK-068 focused combat curriculum controller smoke passed');
  process.exit(0);
}
assertStageMapsRemainCombatOnly();
assertEveryStageBoundary();
assertPassingGate();
assertFailingGate();
assertMissingLearningRateGate();
assertResumeGateHistory();

console.log('Combat curriculum controller smoke passed');
