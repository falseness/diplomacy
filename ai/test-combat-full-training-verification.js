const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');
const { createAlphaZeroLiteCombatModel } = require('./alphazero-lite-combat');
const {
  curriculumGateDecision,
  evaluateCurriculumSimpleAiWinrate,
  initialCurriculumState
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

function valuePredictions(model, boards, globals) {
  const boardTensor = tf.tensor4d(boards.flat(), [boards.length, 3, 3, 21]);
  const globalTensor = tf.tensor2d(globals, [globals.length, 1]);
  const prediction = model.predict([boardTensor, globalTensor]);
  const outputs = Array.isArray(prediction) ? prediction : [prediction];
  try {
    const valueOutput = outputs.find((tensor) =>
      (tensor.name || '').replace(/:\d+$/, '').split('/')[0] === 'combat_value') ||
      outputs[outputs.length - 1];
    check(valueOutput, 'model controls could not find combat_value output');
    return Array.from(valueOutput.dataSync());
  } finally {
    outputs.forEach((tensor) => tensor.dispose());
    boardTensor.dispose();
    globalTensor.dispose();
  }
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
  const boards = [new Array(3 * 3 * 21).fill(0), new Array(3 * 3 * 21).fill(0)];
  boards[0][0] = 1;
  boards[0][2] = 10;
  boards[1][1] = 1;
  boards[1][3] = 10;
  const globals = [[0], [0.1]];
  const realModel = await tf.loadLayersModel(`file://${modelPath}`);
  const zeroModel = createAlphaZeroLiteCombatModel({ seed: 780780 }).model;
  const randomModel = createAlphaZeroLiteCombatModel({ seed: 780781 }).model;
  try {
    const zeroWeights = zeroModel.getWeights().map((weight) => tf.zerosLike(weight));
    zeroModel.setWeights(zeroWeights);
    zeroWeights.forEach((weight) => weight.dispose());
    const real = valuePredictions(realModel, boards, globals);
    const zeroed = valuePredictions(zeroModel, boards, globals);
    const randomized = valuePredictions(randomModel, boards, globals);
    const heuristicOnly = [1.5, -1.5];
    check(real.some((value, index) => value !== zeroed[index]),
      'real checkpoint matched the zeroed-model control');
    check(real.some((value, index) => value !== randomized[index]),
      'real checkpoint matched the randomized-model control');
    check(real.some((value, index) => value !== heuristicOnly[index]),
      'real checkpoint output was identical to the heuristic-only control');
    return { missingRejected, real, zeroed, randomized, heuristicOnly };
  } finally {
    realModel.dispose();
    zeroModel.dispose();
    randomModel.dispose();
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
      '--old-vs-new-games', '2',
      '--plateau-window', '2',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate-threshold', '0.5',
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
    check(record.simpleAiPlayerWinrate.sideDistribution.modelA === 1 &&
        record.simpleAiPlayerWinrate.sideDistribution.modelB === 1,
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
  return {
    runId: PASS_RUN_ID,
    progressPath,
    finalWeightsPath,
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
      { oldVsNewGames: 2 },
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
  const modelControls = await assertModelControls(passingRun.finalWeightsPath);
  const summary = {
    task: 'TASK-078',
    storageDir: STORAGE_DIR,
    staleArtifactRejected: STALE_WEIGHTS,
    passingRun,
    failingRun,
    modelControls
  };
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Combat full-training verification passed: ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
