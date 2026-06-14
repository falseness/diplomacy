const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const {
  DEFAULT_ACTION_SPACE_SIZE,
  createAlphaZeroLiteCombatModel
} = require('./alphazero-lite-combat');
const {
  evaluateCurriculumSimpleAiWinrate,
  evaluateCurriculumBaselineAiWinrate,
  curriculumGateDecision,
  initialCurriculumState,
  updateCurriculumState
} = require('./cloud-train-runner');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function extractBlock(source, marker) {
  const start = source.indexOf(marker);
  check(start !== -1, 'missing source marker ' + marker);
  const brace = source.indexOf('{', start);
  check(brace !== -1, 'missing opening brace for ' + marker);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(brace + 1, index);
      }
    }
  }
  throw new Error('unterminated source block for ' + marker);
}

function conditionalHeaders(source) {
  const headers = [];
  const pattern = /\b(?:if|else\s+if)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    headers.push(match[1]);
  }
  return headers;
}

function createWeakMeasuredModel() {
  const created = createAlphaZeroLiteCombatModel({
    boardHeight: 3,
    boardWidth: 3,
    channels: 21,
    globalFeatures: 1,
    actionSpaceSize: DEFAULT_ACTION_SPACE_SIZE,
    filters: 8,
    residualBlocks: 1,
    learningRate: 0.01
  });
  const model = created.model;
  model.setWeights(model.getWeights().map((weight) => tf.zerosLike(weight)));
  return model;
}

function createBelowThresholdMeasuredPredictor() {
  return function belowThresholdMeasuredPredictor(_modelIdentifier, vectorizedGrids) {
    return vectorizedGrids.map(() => [0]);
  };
}

function assertMeasuredEvidence(evidence, label) {
  check(evidence && evidence.evaluated === true,
    `${label} missing evaluated evidence`, evidence);
  check(evidence.source === 'measured-model-vs-SimpleAiPlayer-benchmark',
    `${label} used injected or mocked SimpleAiPlayer gate evidence`, evidence);
  check(evidence.artificialAdvantage === false,
    `${label} recorded artificial advantage`, evidence);
  check(evidence.benchmarkPolicy &&
      evidence.benchmarkPolicy.includes('unchanged AIPlayer') &&
      evidence.benchmarkPolicy.includes('unchanged SimpleAiPlayer'),
    `${label} did not document unchanged player-class comparison`, evidence);
  check(Array.isArray(evidence.results) && evidence.results.length === evidence.games,
    `${label} did not include per-game measured results`, evidence);
  for (const result of evidence.results) {
    check(result.runtimePlayerA === 'AIPlayer',
      `${label} did not use runtime AIPlayer`, result);
    check(result.runtimePlayerB === 'SimpleAiPlayer',
      `${label} did not use runtime SimpleAiPlayer`, result);
    check(result.inference &&
        (result.inference.source ===
          'current TensorFlow checkpoint output through unchanged runtime AIPlayer predict()' ||
          result.inference.source ===
          'test-configured current-model output through unchanged runtime AIPlayer predict()'),
      `${label} did not route decisions through model-backed AIPlayer inference`,
      result);
  }
}

function assertBaselineEvidence(evidence, label) {
  check(evidence && evidence.evaluated === true,
    `${label} missing evaluated baseline AIPlayer evidence`, evidence);
  check(evidence.source === 'measured-model-vs-baseline-AIPlayer-benchmark',
    `${label} used injected or mocked baseline AIPlayer gate evidence`, evidence);
  check(evidence.baselineModelPath ===
      '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training',
    `${label} did not use the required TASK-111 baseline checkpoint`, evidence);
  check(evidence.artificialAdvantage === false,
    `${label} recorded artificial advantage`, evidence);
  check(evidence.benchmarkPolicy &&
      evidence.benchmarkPolicy.includes('unchanged AIPlayer') &&
      evidence.benchmarkPolicy.includes('saved baseline model'),
    `${label} did not document unchanged AIPlayer baseline comparison`, evidence);
  check(Array.isArray(evidence.results) && evidence.results.length === evidence.games,
    `${label} did not include per-game measured baseline results`, evidence);
  for (const result of evidence.results) {
    check(result.runtimePlayerA === 'AIPlayer' && result.runtimePlayerB === 'AIPlayer',
      `${label} did not use runtime AIPlayer on both sides`, result);
    check(result.inference &&
        (result.inference.source.includes('side A current AIPlayer model') ||
          result.inference.source.includes('side A test-configured current AIPlayer model')) &&
        result.inference.source.includes('side B baseline AIPlayer model'),
      `${label} did not route side-specific model-backed AIPlayer inference`,
      result);
  }
}

function assertNoComparisonCheating() {
  const playersSource = fs.readFileSync(path.resolve(__dirname, 'players.js'), 'utf8');
  const aiPlayerSource = extractBlock(playersSource, 'class AIPlayer ');
  const benchmarkSource = fs.readFileSync(
    path.resolve(__dirname, 'benchmark-combat-model.js'),
    'utf8'
  );
  const gridSizeBranches = conditionalHeaders(aiPlayerSource).filter((header) =>
    /grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length/.test(header));
  check(gridSizeBranches.length === 0,
    'AIPlayer source has ad-hoc grid-size if branches', gridSizeBranches);
  check(!/\bAIPlayer\b[\s\S]{0,250}\bconcede\s*\(/.test(benchmarkSource),
    'combat benchmark forces a comparison concession');
  check(!/candidateGoldBonus|simpleHandicap|artificialAdvantage\s*:\s*true/.test(
    aiPlayerSource + benchmarkSource),
    'comparison source contains artificial player advantage hooks');
}

async function main() {
  assertNoComparisonCheating();

  let rejectedMockEvidence = false;
  try {
    assertMeasuredEvidence({
      evaluated: true,
      value: 0.79,
      source: 'mock-or-tiny-evaluation'
    }, 'mock evidence guard');
  } catch (error) {
    rejectedMockEvidence = /injected or mocked/.test(error.message);
  }
  check(rejectedMockEvidence,
    'measured-evidence guard did not reject mocked gate evidence');

  let rejectedMockBaselineEvidence = false;
  try {
    assertBaselineEvidence({
      evaluated: true,
      value: 0.79,
      source: 'mock-or-tiny-evaluation'
    }, 'mock baseline evidence guard');
  } catch (error) {
    rejectedMockBaselineEvidence = /injected or mocked/.test(error.message);
  }
  check(rejectedMockBaselineEvidence,
    'baseline measured-evidence guard did not reject mocked gate evidence');

  const model = createWeakMeasuredModel();
  const state = {
    runId: 'task107-measured-gate-failure',
    seed: 107107,
    completedGames: 2,
    updatedAt: new Date().toISOString(),
    curriculum: initialCurriculumState()
  };
  const options = {
    oldVsNewGames: 2,
    curriculumSimpleWinrateThreshold: 0.8
  };

  try {
    const belowThresholdPredictor = createBelowThresholdMeasuredPredictor();
    const measuredOptions = Object.assign({}, options, {
      curriculumPredictFunction: belowThresholdPredictor
    });
    const evidence = await evaluateCurriculumSimpleAiWinrate(
      measuredOptions,
      state,
      model
    );
    const baselineEvidence = await evaluateCurriculumBaselineAiWinrate(
      Object.assign({}, measuredOptions, {
        curriculumBaselineAiModelPath:
          '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training'
      }),
      state,
      model
    );
    assertMeasuredEvidence(evidence, 'below-threshold gate');
    assertBaselineEvidence(baselineEvidence, 'baseline below-threshold gate');
    check(evidence.value < options.curriculumSimpleWinrateThreshold,
      'measured SimpleAiPlayer gate was not below the 80 percent threshold',
      evidence);
    check(baselineEvidence.value < options.curriculumSimpleWinrateThreshold,
      'measured baseline AIPlayer gate was not below the 80 percent threshold',
      baselineEvidence);

    const decision = curriculumGateDecision(
      state,
      { status: 'plateau' },
      evidence,
      { attempted: true, improved: false },
      options,
      baselineEvidence
    );
    check(decision.requiredSimpleAiPlayerWinrate === 0.8,
      'gate decision did not carry the 80 percent threshold', decision);
    check(decision.eligible === false && decision.decision === 'hold',
      'below-80 measured gate advanced the curriculum', decision);
    check(decision.reason.includes('at least 0.8'),
      'below-80 measured gate did not record a threshold reason', decision);
    check(decision.requiredBaselineAiPlayerWinrate === 0.8,
      'gate decision did not carry the baseline AIPlayer 80 percent threshold',
      decision);
    check(decision.reason.includes('baseline AIPlayer winrate must be at least 0.8'),
      'below-80 baseline AIPlayer gate did not record a threshold reason',
      decision);

    const curriculum = updateCurriculumState(state, decision);
    check(curriculum.currentStageIndex === 0 &&
        curriculum.currentStage === 'combat-foundation',
      'failed measured gate changed the curriculum stage', curriculum);
    check(curriculum.gateHistory.length === 1 &&
        curriculum.gateHistory[0].decision === 'hold',
      'failed measured gate was not recorded as a hold', curriculum);
    check(curriculum.gateHistory[0].simpleAiPlayerWinrate.value ===
        evidence.value,
      'gate history did not preserve below-threshold measured winrate',
      curriculum);
    check(curriculum.gateHistory[0].baselineAiPlayerWinrate.value ===
        baselineEvidence.value,
      'gate history did not preserve measured baseline AIPlayer winrate',
      curriculum);

    const report = {
      task: 'TASK-112',
      threshold: options.curriculumSimpleWinrateThreshold,
      measuredEvidence: evidence,
      baselineMeasuredEvidence: baselineEvidence,
      gateDecision: decision,
      curriculum
    };
    const task112ReportPath = path.join(
      '/mnt/storage/diplomacy/benchmarks',
      'task112-measured-gate-failure.json'
    );
    writeJson(task112ReportPath, report);
    const task107ReportPath = path.join(
      '/mnt/storage/diplomacy/benchmarks',
      'task107-measured-gate-failure.json'
    );
    writeJson(task107ReportPath, Object.assign({}, report, {
      task: 'TASK-107',
      task112ReportPath
    }));
    check(fs.existsSync(task112ReportPath),
      'structured measured gate report was not written');
    console.log(`TASK-112 measured gate failure regression passed: ${task112ReportPath}`);
  } finally {
    model.dispose();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
