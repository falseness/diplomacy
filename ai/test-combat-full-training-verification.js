const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');
const { createAlphaZeroLiteCombatModel } = require('./alphazero-lite-combat');
const {
  createRuntimeModelPredict,
  curriculumGateDecision,
  evaluateCurriculumSimpleAiWinrate,
  initialCurriculumState,
  makeRuntimeCombatTeacherBatch,
  projectRuntimeVectorForModel
} = require('./cloud-train-runner');

const STALE_WEIGHTS = '/mnt/storage/diplomacy/verify-task068-manual/final/verify-resume/weights.bin';
const STORAGE_ROOT = '/mnt/storage/diplomacy';
const RUN_STAMP = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const STORAGE_DIR = process.env.TASK078_REUSE_STORAGE_DIR ||
  path.join(STORAGE_ROOT, `task078-full-training-${RUN_STAMP}`);
const PASS_RUN_ID = 'task078-full-curriculum-pass';
const FAIL_RUN_ID = 'task078-full-curriculum-fail';
const SUMMARY_PATH = path.join(
  STORAGE_ROOT,
  'benchmarks',
  `task078-full-training-verification-${RUN_STAMP}.json`
);

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

function runTrain(args) {
  const env = {
    ...process.env,
    PATH: `${node20BinDir()}:${process.env.PATH || ''}`
  };
  const output = execFileSync(
    'bash',
    ['./train.sh', '--storage-dir', STORAGE_DIR, ...args],
    { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' }
  );
  process.stdout.write(output);
  return output;
}

function heuristicPredict(_modelIdentifier, vectorizedGrids) {
  return vectorizedGrids.map((vectorizedGrid) => {
    const projected = projectRuntimeVectorForModel(vectorizedGrid);
    let material = 0;
    for (let offset = 0; offset < projected.board.length; offset += 21) {
      material += projected.board[offset] - projected.board[offset + 1];
      material += projected.board[offset + 2] - projected.board[offset + 3];
      material += projected.board[offset + 4] - projected.board[offset + 5];
      material += projected.board[offset + 6] - projected.board[offset + 7];
    }
    return [material];
  });
}

async function runGameplayControl(label, model, predictFunction) {
  const state = {
    runId: `task078-${label}-control`,
    seed: 789000,
    completedGames: 1,
    curriculum: initialCurriculumState()
  };
  const options = {
    oldVsNewGames: 4,
    curriculumGateGames: 4,
    curriculumPredictFunction: predictFunction
  };
  const result = await evaluateCurriculumSimpleAiWinrate(options, state, model);
  check(result.games === 4 && result.results.length === 4,
    `${label} gameplay control did not account for four games`);
  return result;
}

async function assertModelControls(finalWeightsPath) {
  const modelPath = path.join(path.dirname(finalWeightsPath), 'model.json');
  const missingModelPath = path.join(STORAGE_DIR, 'missing-control', 'model.json');
  let missingRejected = false;
  try {
    await tf.loadLayersModel(`file://${missingModelPath}`);
  } catch (error) {
    missingRejected = error.message.includes('does not exist');
  }
  check(missingRejected, 'missing-checkpoint control was not rejected');
  const realModel = await tf.loadLayersModel(`file://${modelPath}`);
  const zeroModel = createAlphaZeroLiteCombatModel({ seed: 780780 }).model;
  const randomModel = createAlphaZeroLiteCombatModel({ seed: 780781 }).model;
  try {
    check(realModel.getLayer('value_score').trainable === true &&
        realModel.getLayer('value_nonlinear').getConfig().alpha === 0.5 &&
        realModel.getLayer('combat_value').getConfig().activation === 'linear',
      'trained checkpoint does not use the nonlinear learned value head');
    check(!realModel.layers.some((layer) => layer.name === 'value_linear' ||
        layer.name === 'value_combined'),
      'trained checkpoint still contains a direct linear value bypass');
    const zeroWeights = zeroModel.getWeights().map((weight) => tf.zerosLike(weight));
    zeroModel.setWeights(zeroWeights);
    zeroWeights.forEach((weight) => weight.dispose());
    const real = await runGameplayControl(
      'real',
      realModel,
      createRuntimeModelPredict(realModel)
    );
    const zeroed = await runGameplayControl(
      'zeroed',
      zeroModel,
      createRuntimeModelPredict(zeroModel)
    );
    const randomized = await runGameplayControl(
      'randomized',
      randomModel,
      createRuntimeModelPredict(randomModel)
    );
    const heuristicOnly = await runGameplayControl(
      'heuristic-only',
      realModel,
      heuristicPredict
    );
    check(real.results.some((result, index) =>
      result.winnerSide !== zeroed.results[index].winnerSide ||
      result.roundCount !== zeroed.results[index].roundCount),
    'real checkpoint gameplay matched every zeroed-model trajectory');
    check(real.results.some((result, index) =>
      result.winnerSide !== randomized.results[index].winnerSide ||
      result.roundCount !== randomized.results[index].roundCount),
    'real checkpoint gameplay matched every randomized-model trajectory');
    check(real.results.some((result, index) =>
      result.winnerSide !== heuristicOnly.results[index].winnerSide ||
      result.roundCount !== heuristicOnly.results[index].roundCount),
    'real checkpoint gameplay matched every heuristic-only trajectory');
    return { missingRejected, real, zeroed, randomized, heuristicOnly };
  } finally {
    realModel.dispose();
    zeroModel.dispose();
    randomModel.dispose();
  }
}

async function assertValidationSplit(finalWeightsPath) {
  const validationBaseSeed = 880000;
  const validationStageIndex = 6;
  const batch = await makeRuntimeCombatTeacherBatch(
    validationBaseSeed,
    validationStageIndex
  );
  const model = await tf.loadLayersModel(
    `file://${path.join(path.dirname(finalWeightsPath), 'model.json')}`
  );
  let prediction;
  try {
    prediction = model.predict([batch.board, batch.global]);
    const outputs = Array.isArray(prediction) ? prediction : [prediction];
    const valueOutput = outputs.find((tensor) =>
      (tensor.name || '').replace(/:\d+$/, '').split('/')[0] === 'combat_value') ||
      outputs[outputs.length - 1];
    const predictions = valueOutput.dataSync();
    const labels = batch.labels.dataSync();
    let squaredError = 0;
    for (let index = 0; index < labels.length; index += 1) {
      squaredError += Math.pow(predictions[index] - labels[index], 2);
    }
    return {
      baseSeed: validationBaseSeed,
      seeds: batch.gameResults.map((result) => result.seed),
      examples: labels.length,
      meanSquaredError: squaredError / labels.length
    };
  } finally {
    if (prediction) {
      const outputs = Array.isArray(prediction) ? prediction : [prediction];
      outputs.forEach((tensor) => tensor.dispose());
    }
    batch.board.dispose();
    batch.global.dispose();
    batch.policy.dispose();
    batch.labels.dispose();
    model.dispose();
  }
}

function assertFinalWeights(manifest, runId) {
  check(manifest.status === 'complete', `${runId} manifest did not complete`);
  check(manifest.progress.completedGames === manifest.progress.totalGames,
    `${runId} did not finish every configured game`);
  const finalModelPath = path.join(STORAGE_DIR, manifest.artifacts.finalModel);
  const finalWeightsPath = path.join(finalModelPath, 'weights.bin');
  check(fs.existsSync(path.join(finalModelPath, 'model.json')),
    `${runId} final model.json is missing`);
  check(fs.existsSync(finalWeightsPath), `${runId} final weights.bin is missing`);
  check(finalWeightsPath !== STALE_WEIGHTS,
    `${runId} used stale TASK-068 weights as acceptance evidence`);
  check(finalWeightsPath.startsWith(STORAGE_ROOT + path.sep),
    `${runId} final weights are not under ${STORAGE_ROOT}`);
  return finalWeightsPath;
}

function assertNoComparisonShortcut() {
  const runnerSource = fs.readFileSync(
    path.resolve(__dirname, 'cloud-train-runner.js'),
    'utf8'
  );
  check(!runnerSource.includes('runtimeCombatStateFeature'),
    'cloud runner still contains a hand-coded runtime combat state feature');
  check(!runnerSource.includes('initializeRuntimeFeatureWeights'),
    'cloud runner still initializes value_output from a hand-coded feature');
  check(!runnerSource.includes('tf.train.adam(0)'),
    'cloud runner still disables model learning with a zero learning rate');
  check(!runnerSource.includes('fitRuntimeCombatValueBatch') &&
      !runnerSource.includes('solveLinearSystem'),
    'cloud runner still installs a closed-form combat value head');
  check(!runnerSource.includes("getLayer('value_linear')"),
    'cloud runner still installs a direct linear combat score');
}

function assertPassingRun() {
  assertNoComparisonShortcut();
  const manifestPath = path.join(STORAGE_DIR, 'runs', PASS_RUN_ID, 'manifest.json');
  if (process.env.TASK078_REUSE_STORAGE_DIR) {
    check(fs.existsSync(manifestPath), 'requested completed full-training run is missing');
    console.log(`Revalidating completed full-training run: ${STORAGE_DIR}`);
  } else {
    runTrain([
      '--run-id', PASS_RUN_ID,
      '--games', '15',
      '--epochs', '1',
      '--seed', '78078',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '1',
      '--curriculum-gate-games', '10',
      '--evaluation-cadence', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate-threshold', '0.6',
      '--curriculum-baseline-winrate-threshold', '0',
      '--curriculum-lr-reduction-attempted'
    ]);
  }

  const progressPath = path.join(STORAGE_DIR, 'progress', `${PASS_RUN_ID}.jsonl`);
  const progress = readJsonLines(progressPath);
  check(progress.length === 15, 'full training should write fifteen progress records');
  const advances = progress.filter((record) =>
    record.nextStageEligibility && record.nextStageEligibility.decision === 'advance');
  check(advances.length === 6, 'full training should advance exactly six stage gates');
  advances.forEach((record, index) => {
    check(record.simpleAiPlayerWinrate && record.simpleAiPlayerWinrate.evaluated === true,
      `stage gate ${index} did not evaluate SimpleAiPlayer winrate`);
    check(record.simpleAiPlayerWinrate.source === 'measured-model-vs-SimpleAiPlayer-benchmark',
      `stage gate ${index} used non-measured SimpleAiPlayer evidence`);
    check(record.simpleAiPlayerWinrate.benchmarkPolicy.includes('real GameMap runtime'),
      `stage gate ${index} did not use a real runtime benchmark`);
    check(!record.simpleAiPlayerWinrate.benchmarkPolicy.includes('loss compared') &&
        !record.simpleAiPlayerWinrate.benchmarkPolicy.includes('no-model combat baseline') &&
        !record.simpleAiPlayerWinrate.benchmarkPolicy.includes('combat value head'),
      `stage gate ${index} used loss-comparison heuristic evidence`);
    check(record.simpleAiPlayerWinrate.modelAdapter.includes('shared full-vector final combat value adapter') &&
        !record.simpleAiPlayerWinrate.modelAdapter.includes('heuristic combat value'),
      `stage gate ${index} did not use the shared full-vector combat adapter`);
    check(record.simpleAiPlayerWinrate.artificialAdvantage === false,
      `stage gate ${index} reported an artificial benchmark advantage`);
    check(record.simpleAiPlayerWinrate.modelWins > record.simpleAiPlayerWinrate.simpleAiPlayerWins,
      `stage gate ${index} did not beat SimpleAiPlayer in measured games`);
    check(record.simpleAiPlayerWinrate.games === 10 &&
        record.simpleAiPlayerWinrate.sideDistribution.modelA === 5 &&
        record.simpleAiPlayerWinrate.sideDistribution.modelB === 5,
      `stage gate ${index} did not balance the model across both sides`);
    record.simpleAiPlayerWinrate.results.forEach((gameResult) => {
      check(gameResult.modelSide !== gameResult.simpleAiPlayerSide &&
          gameResult[`runtimePlayer${gameResult.modelSide}`] === 'AIPlayer' &&
          gameResult[`runtimePlayer${gameResult.simpleAiPlayerSide}`] === 'SimpleAiPlayer',
        `stage gate ${index} did not use unchanged players on the recorded sides`);
      check(gameResult.inference &&
          gameResult.inference.source.includes('current TensorFlow checkpoint') &&
          gameResult.inference.calls > 0,
        `stage gate ${index} did not use TensorFlow checkpoint inference`);
    });
    check(record.simpleAiPlayerWinrate.value > 0.6,
      `stage gate ${index} advanced without greater-than-60-percent winrate`);
    check(record.simpleAiPlayerWinrate.value >
        record.nextStageEligibility.requiredSimpleAiPlayerWinrate,
      `stage gate ${index} did not beat the configured winrate threshold`);
    check(record.plateauState.status === 'plateau',
      `stage gate ${index} advanced without plateau evidence`);
    check(record.learningRateReduction.attempted === true,
      `stage gate ${index} advanced without a learning-rate reduction attempt`);
  });

  const state = readJson(path.join(STORAGE_DIR, 'runs', PASS_RUN_ID, 'state.json'));
  check(state.status === 'complete', 'full training state did not complete');
  check(state.curriculum.currentStageIndex === 6,
    'full training did not reach final Stage G index');
  check(state.curriculum.gateHistory.filter((gate) =>
    gate.decision === 'advance').length === 6,
  'full training gate history did not record all stage advances');

  const manifest = readJson(manifestPath);
  const finalWeightsPath = assertFinalWeights(manifest, PASS_RUN_ID);
  check(manifest.artifacts.progress === path.join('progress', `${PASS_RUN_ID}.jsonl`),
    'manifest does not identify the progress artifact');
  check(manifest.artifacts.finalModel === path.join('final', PASS_RUN_ID),
    'manifest does not identify the final model artifact');
  const trainingSeeds = [];
  for (let trainingStep = 1; trainingStep <= 15; trainingStep += 1) {
    trainingSeeds.push(78078 + trainingStep * 1009);
  }
  progress.filter((record) =>
    record.trainingStep % 2 === 0 || record.trainingStep === 15
  ).forEach((record) => {
    const stageIndex = record.nextStageEligibility.currentStageIndex;
    const baseSeed = 78078 + record.trainingStep * 1543;
    trainingSeeds.push(
      baseSeed + stageIndex * 997 + 1,
      baseSeed + stageIndex * 997 + 2
    );
  });
  const finalTestSeeds = advances.flatMap((record) =>
    record.simpleAiPlayerWinrate.results.map((result) => result.seed));
  check(new Set(finalTestSeeds).size === 60,
    'final stage gates did not use sixty unique predeclared scenarios');
  return {
    runId: PASS_RUN_ID,
    progressPath,
    finalWeightsPath,
    trainingSeeds,
    finalTestSeeds,
    advances: advances.map((record) => ({
      trainingStep: record.trainingStep,
      fromStageIndex: record.nextStageEligibility.currentStageIndex,
      advancedToStageIndex: record.curriculum.currentStageIndex,
      simpleAiPlayerWinrate: record.simpleAiPlayerWinrate.value,
      simpleAiPlayerEvidence: record.simpleAiPlayerWinrate.source,
      decision: record.nextStageEligibility.decision
    }))
  };
}

async function assertFailingRun() {
  const zeroModel = createAlphaZeroLiteCombatModel({ seed: 780790 }).model;
  const zeroWeights = zeroModel.getWeights().map((weight) => tf.zerosLike(weight));
  zeroModel.setWeights(zeroWeights);
  zeroWeights.forEach((weight) => weight.dispose());
  const state = {
    runId: FAIL_RUN_ID,
    seed: 78079,
    completedGames: 3,
    curriculum: initialCurriculumState()
  };
  let measuredEvidence;
  try {
    measuredEvidence = await evaluateCurriculumSimpleAiWinrate(
      { oldVsNewGames: 2, curriculumGateGames: 10 },
      state,
      zeroModel
    );
  } finally {
    zeroModel.dispose();
  }
  check(measuredEvidence.value <= 0.6,
    'zero-model measured control unexpectedly exceeded 60 percent');
  const decision = curriculumGateDecision(
    state,
    { status: 'plateau' },
    measuredEvidence,
    { attempted: true, improved: false },
    { curriculumSimpleWinrateThreshold: 0.5 },
    { value: 1, evaluated: true }
  );
  check(decision.decision === 'hold' && decision.eligible === false,
    'measured winrate at or below 60 percent should block advancement');
  check(decision.reason.includes('greater than 0.6'),
    'failed gate did not record the exclusive 60-percent blocker reason');
  return {
    runId: FAIL_RUN_ID,
    measuredEvidence,
    decision: decision.decision,
    reason: decision.reason
  };
}

async function main() {
  if (fs.existsSync(STORAGE_DIR)) {
    check(process.env.TASK078_REUSE_STORAGE_DIR,
      `fresh full-training storage already exists: ${STORAGE_DIR}`);
  }
  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  const passingRun = assertPassingRun();
  const failingRun = await assertFailingRun();
  const validation = await assertValidationSplit(passingRun.finalWeightsPath);
  check(validation.seeds.length === 2 && validation.examples > 0 &&
      Number.isFinite(validation.meanSquaredError),
    'held-out validation split did not produce finite checkpoint metrics');
  const trainingValidationIntersection = passingRun.trainingSeeds.filter((seed) =>
    validation.seeds.includes(seed));
  const trainingFinalTestIntersection = passingRun.trainingSeeds.filter((seed) =>
    passingRun.finalTestSeeds.includes(seed));
  const validationFinalTestIntersection = validation.seeds.filter((seed) =>
    passingRun.finalTestSeeds.includes(seed));
  check(trainingValidationIntersection.length === 0 &&
      trainingFinalTestIntersection.length === 0 &&
      validationFinalTestIntersection.length === 0,
    'training, validation, and final gate seeds overlap');
  const modelControls = await assertModelControls(passingRun.finalWeightsPath);
  const summary = {
    task: 'TASK-078',
    storageDir: STORAGE_DIR,
    staleArtifactRejected: STALE_WEIGHTS,
    passingRun,
    failingRun,
    validation,
    seedIntersections: {
      trainingValidationIntersection,
      trainingFinalTestIntersection,
      validationFinalTestIntersection
    },
    modelControls
  };
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Combat full-training verification passed: ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
