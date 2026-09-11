// Bounded real-evaluator concurrency screen; never a training or win-rate gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const SEEDS = [87087, 87089];
const GAMES_PER_BATCH = 2;
const ARM_ORDER = ['serial', 'parallel', 'parallel', 'serial'];
const CHILD_TIMEOUT_MS = 600000;

function checkpointHashes(checkpoint) {
  const metadata = JSON.parse(fs.readFileSync(path.join(checkpoint, 'model.json')));
  return Object.fromEntries(['model.json', ...metadata.weightsManifest.flatMap(group => group.paths)]
    .map(file => [file, crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(checkpoint, file))).digest('hex')]));
}

async function child(checkpoint, seed, baseline) {
  const tf = require('@tensorflow/tfjs-node');
  const { evaluateCurriculumSimpleAiWinrate, evaluateCurriculumBaselineAiWinrate, initialCurriculumState } = require('../cloud-train-runner');
  const model = await tf.loadLayersModel(`file://${path.join(checkpoint, 'model.json')}`);
  const tensors = tf.memory().numTensors;
  try {
    const evaluate = baseline ? evaluateCurriculumBaselineAiWinrate : evaluateCurriculumSimpleAiWinrate;
    const result = await evaluate({ curriculumGateGames: GAMES_PER_BATCH,
      curriculumBaselineAiModelPath: baseline }, {
      seed, completedGames: 1, runId: 'task106-evaluation-concurrency',
      curriculum: initialCurriculumState()
    }, model);
    assert.equal(result.results.length, GAMES_PER_BATCH);
    assert.deepEqual(result.sideDistribution, { modelA: 1, modelB: 1 });
    assert.equal(tf.memory().numTensors, tensors, 'evaluation tensor leak');
    process.send({ seed, result, hashes: checkpointHashes(checkpoint),
      baselineHashes: baseline ? checkpointHashes(baseline) : null,
      memory: process.memoryUsage(), resources: process.resourceUsage() });
  } finally {
    model.dispose();
    process.disconnect();
  }
}

function launch(checkpoint, seed, baseline) {
  return new Promise((resolve, reject) => {
    const worker = fork(__filename, ['child', checkpoint, String(seed), ...(baseline ? [baseline] : [])], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    let message;
    let messages = 0;
    const timer = setTimeout(() => worker.kill('SIGKILL'), CHILD_TIMEOUT_MS);
    worker.on('message', value => { message = value; messages += 1; });
    worker.on('error', error => { clearTimeout(timer); reject(error); });
    worker.on('exit', (code, signal) => {
      clearTimeout(timer);
      console.log('CHILD EXIT: ' + JSON.stringify({ seed, code, signal, messages }));
      if (code !== 0 || messages !== 1) {
        reject(new Error(`seed ${seed}: code=${code} signal=${signal} messages=${messages}`));
      } else {
        resolve(message);
      }
    });
  });
}

async function main(checkpoint, output, baseline) {
  assert(checkpoint && output, 'usage: node task106-evaluation-concurrency.cjs CHECKPOINT OUTPUT [BASELINE_CHECKPOINT]');
  checkpoint = path.resolve(checkpoint);
  baseline = baseline ? path.resolve(baseline) : undefined;
  const hashes = checkpointHashes(checkpoint);
  const baselineHashes = baseline ? checkpointHashes(baseline) : null;
  const report = { kind: 'same-source evaluator process concurrency feasibility; not canonical timing',
    checkpoint, hashes, baseline, baselineHashes, node: process.version, seeds: SEEDS, gamesPerBatch: GAMES_PER_BATCH,
    order: ARM_ORDER, arms: [],
    evaluator: baseline ? 'baseline-AI' : 'SimpleAi',
    caveat: 'Cold child/model loading included equally. No fit, serialization, holdout quality or complete-training speed claim.' };
  try {
    for (const mode of ARM_ORDER) {
      const start = performance.now();
      // Each arm launches exactly the same two cold processes and four games.
      const settled = mode === 'parallel'
        ? await Promise.allSettled(SEEDS.map(seed => launch(checkpoint, seed, baseline)))
        : await (async () => {
          const values = [];
          for (const seed of SEEDS) values.push(...await Promise.allSettled([launch(checkpoint, seed, baseline)]));
          return values;
        })();
      const results = settled.map((value, index) => value.status === 'fulfilled'
        ? value.value : { seed: SEEDS[index], error: String(value.reason) });
      const arm = { mode, wallMs: performance.now() - start, results };
      report.arms.push(arm);
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      assert(settled.every(value => value.status === 'fulfilled'), 'unfinished evaluation arm');
      for (const result of results) {
        assert.deepEqual(result.hashes, hashes);
        assert.deepEqual(result.baselineHashes, baselineHashes);
      }
      console.log('ARM COMPLETE: ' + JSON.stringify(arm));
    }
    const reference = report.arms[0].results.map(({ seed, result }) => ({ seed, result }));
    for (const arm of report.arms) {
      assert.deepEqual(arm.results.map(({ seed, result }) => ({ seed, result })), reference);
    }
    const mean = mode => report.arms.filter(arm => arm.mode === mode)
      .reduce((sum, arm) => sum + arm.wallMs, 0) / 2;
    report.serialMeanMs = mean('serial');
    report.parallelMeanMs = mean('parallel');
    report.reductionPercent = 100 * (1 - report.parallelMeanMs / report.serialMeanMs);
    report.parity = true;
    assert.deepEqual(checkpointHashes(checkpoint), hashes);
    if (baseline) assert.deepEqual(checkpointHashes(baseline), baselineHashes);
    console.log('EVALUATION PARITY: PASS arms=4 batchesPerArm=2 gamesPerArm=4');
    console.log('EVALUATION SCREEN TIMING: ' + JSON.stringify({ serialMeanMs: report.serialMeanMs,
      parallelMeanMs: report.parallelMeanMs, reductionPercent: report.reductionPercent }));
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
}

const args = process.argv.slice(2);
(args[0] === 'child' ? child(args[1], Number(args[2]), args[3]) : main(...args))
  .catch(error => { console.error(error); process.exitCode = 1; });
