const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STALE_WEIGHTS = '/mnt/storage/diplomacy/verify-task068-manual/final/verify-resume/weights.bin';
const STORAGE_ROOT = '/mnt/storage/diplomacy';
const RUN_STAMP = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const STORAGE_DIR = path.join(STORAGE_ROOT, `task078-full-training-${RUN_STAMP}`);
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
  return execFileSync(
    'bash',
    ['./train.sh', '--storage-dir', STORAGE_DIR, ...args],
    { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' }
  );
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

function assertPassingRun() {
  runTrain([
    '--run-id', PASS_RUN_ID,
    '--games', '8',
    '--epochs', '1',
    '--seed', '78078',
    '--checkpoint-interval', '1',
    '--old-vs-new-games', '2',
    '--plateau-window', '2',
    '--plateau-min-delta', '2',
    '--plateau-patience', '1',
    '--curriculum-lr-reduction-attempted'
  ]);

  const progressPath = path.join(STORAGE_DIR, 'progress', `${PASS_RUN_ID}.jsonl`);
  const progress = readJsonLines(progressPath);
  check(progress.length === 8, 'full training should write eight progress records');
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
        !record.simpleAiPlayerWinrate.benchmarkPolicy.includes('no-model combat baseline'),
      `stage gate ${index} used loss-comparison heuristic evidence`);
    check(record.simpleAiPlayerWinrate.artificialAdvantage === false,
      `stage gate ${index} reported an artificial benchmark advantage`);
    check(record.simpleAiPlayerWinrate.modelWins > record.simpleAiPlayerWinrate.simpleAiPlayerWins,
      `stage gate ${index} did not beat SimpleAiPlayer in measured games`);
    record.simpleAiPlayerWinrate.results.forEach((gameResult) => {
      check(gameResult.runtimePlayerA === 'AIPlayer',
        `stage gate ${index} model side did not use unchanged AIPlayer`);
      check(gameResult.runtimePlayerB === 'SimpleAiPlayer',
        `stage gate ${index} baseline side did not use unchanged SimpleAiPlayer`);
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

  const manifest = readJson(path.join(STORAGE_DIR, 'runs', PASS_RUN_ID, 'manifest.json'));
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

function assertFailingRun() {
  runTrain([
    '--run-id', FAIL_RUN_ID,
    '--games', '3',
    '--epochs', '1',
    '--seed', '78079',
    '--checkpoint-interval', '1',
    '--old-vs-new-games', '2',
    '--plateau-window', '2',
    '--plateau-min-delta', '2',
    '--plateau-patience', '1',
    '--curriculum-simple-winrate-threshold', '1',
    '--curriculum-lr-reduction-attempted'
  ]);

  const progressPath = path.join(STORAGE_DIR, 'progress', `${FAIL_RUN_ID}.jsonl`);
  const progress = readJsonLines(progressPath);
  const finalRecord = progress[progress.length - 1];
  check(finalRecord.plateauState.status === 'plateau',
    'failed-gate run should still reach plateau evidence');
  check(finalRecord.simpleAiPlayerWinrate.evaluated === true &&
      finalRecord.simpleAiPlayerWinrate.source === 'measured-model-vs-SimpleAiPlayer-benchmark',
  'failed-gate run did not record measured SimpleAiPlayer winrate evidence');
  check(finalRecord.simpleAiPlayerWinrate.benchmarkPolicy.includes('real GameMap runtime') &&
      !finalRecord.simpleAiPlayerWinrate.benchmarkPolicy.includes('no-model combat baseline'),
  'failed-gate run used heuristic SimpleAiPlayer evidence');
  check(finalRecord.simpleAiPlayerWinrate.value <= 1,
    'failed-gate run should have a bounded measured winrate');
  check(finalRecord.nextStageEligibility.decision === 'hold' &&
      finalRecord.nextStageEligibility.eligible === false,
  'strict measured winrate threshold should block advancement');
  check(finalRecord.nextStageEligibility.reason.includes('greater than 1'),
    'failed-gate run did not record the threshold blocker reason');
  const state = readJson(path.join(STORAGE_DIR, 'runs', FAIL_RUN_ID, 'state.json'));
  check(state.curriculum.currentStageIndex === 0,
    'failed-gate run advanced the curriculum');
  return {
    runId: FAIL_RUN_ID,
    progressPath,
    blockedAtTrainingStep: finalRecord.trainingStep,
    simpleAiPlayerWinrate: finalRecord.simpleAiPlayerWinrate.value,
    decision: finalRecord.nextStageEligibility.decision,
    reason: finalRecord.nextStageEligibility.reason
  };
}

function main() {
  if (fs.existsSync(STORAGE_DIR)) {
    fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  const passingRun = assertPassingRun();
  const failingRun = assertFailingRun();
  const summary = {
    task: 'TASK-078',
    storageDir: STORAGE_DIR,
    staleArtifactRejected: STALE_WEIGHTS,
    passingRun,
    failingRun
  };
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Combat full-training verification passed: ${SUMMARY_PATH}`);
}

main();
