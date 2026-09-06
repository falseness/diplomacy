const fs = require('fs');
const path = require('path');
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
  console.log('Anti-cheating PASS: no artificial advantage, forced concession, curriculum-aware AIPlayer, or ad-hoc grid-size AIPlayer branch found');
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
  console.log('Step 4 PASS: SimpleAiPlayer winrate at or below 60 percent blocks advancement');
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
  const state = { completedGames: 0, curriculum: initialCurriculumState() };
  const evaluated = (value) => ({
    value,
    evaluated: true,
    games: 10,
    source: 'fixed controller-regression evidence'
  });
  const options = { curriculumSimpleWinrateThreshold: 0.8 };
  for (let fromStageIndex = 0; fromStageIndex < CURRICULUM_STAGE_LABELS.length - 1;
    fromStageIndex += 1) {
    state.completedGames += 1;
    const label = `Stage ${stageLabel(fromStageIndex)} to Stage ${stageLabel(fromStageIndex + 1)}`;
    const decision = curriculumGateDecision(
      state,
      { status: 'plateau' },
      evaluated(0.85),
      { attempted: true, improved: false },
      options,
      evaluated(0.85)
    );
    check(decision.eligible === true && decision.decision === 'advance',
      label + ' did not advance after all gates passed');
    assertGateEvidence({
      plateauState: { status: 'plateau' },
      learningRateReduction: { attempted: true, improved: false },
      simpleAiPlayerWinrate: evaluated(0.85),
      nextStageEligibility: decision
    }, label);
    updateCurriculumState(state, decision);
    check(state.curriculum.currentStageIndex === fromStageIndex + 1,
      label + ' did not persist the next stage index');
    console.log(`${label} PASS`);
  }
  check(state.curriculum.gateHistory.length === 6,
    'boundary regression should record six stage-boundary advances');
  console.log('Step 1 PASS: every transition from Stage A through Stage G advanced only with complete gate evidence');
}

function assertMissingLearningRateGate() {
  const evaluated = { value: 0.85, evaluated: true, games: 10 };
  const decision = curriculumGateDecision(
    { curriculum: initialCurriculumState() },
    { status: 'plateau' },
    evaluated,
    { attempted: false, improved: false },
    { curriculumSimpleWinrateThreshold: 0.8 },
    evaluated
  );
  check(decision.eligible === false && decision.decision === 'hold',
    'missing learning-rate evidence advanced the stage');
  check(decision.reason.includes('lower learning-rate attempt'),
    'missing learning-rate blocker reason was not recorded');
  console.log('Step 3 PASS: missing learning-rate reduction evidence blocks advancement');
}

function assertMissingPlateauGate() {
  const evaluated = { value: 0.85, evaluated: true, games: 10 };
  const decision = curriculumGateDecision(
    { curriculum: initialCurriculumState() },
    { status: 'insufficient-data' },
    evaluated,
    { attempted: true, improved: false },
    { curriculumSimpleWinrateThreshold: 0.8 },
    evaluated
  );
  check(decision.eligible === false && decision.decision === 'hold',
    'missing plateau evidence advanced the stage');
  check(decision.reason.includes('plateau evidence is not present'),
    'missing plateau blocker reason was not recorded');
  console.log('Step 2 PASS: missing plateau evidence blocks advancement');
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
  console.log('Combat-only PASS: tested Stage A through Stage G maps have no economy objects or actions');
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
assertMissingPlateauGate();
assertMissingLearningRateGate();

console.log('Combat curriculum controller smoke passed');
