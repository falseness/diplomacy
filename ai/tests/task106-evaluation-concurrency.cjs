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
const CHILD_TIMEOUT_MS = 180000;

function checkpointHashes(checkpoint) {
  const metadata = JSON.parse(fs.readFileSync(path.join(checkpoint, 'model.json')));
  return Object.fromEntries(['model.json', ...metadata.weightsManifest.flatMap(group => group.paths)]
    .map(file => [file, crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(checkpoint, file))).digest('hex')]));
}

async function child(checkpoint, seed) {
  const tf = require('@tensorflow/tfjs-node');
  const { evaluateCurriculumSimpleAiWinrate, initialCurriculumState } = require('../cloud-train-runner');
  const model = await tf.loadLayersModel(`file://${path.join(checkpoint, 'model.json')}`);
  const tensors = tf.memory().numTensors;
  try {
    const result = await evaluateCurriculumSimpleAiWinrate({ curriculumGateGames: GAMES_PER_BATCH }, {
      seed, completedGames: 1, runId: 'task106-evaluation-concurrency',
      curriculum: initialCurriculumState()
    }, model);
    assert.equal(result.results.length, GAMES_PER_BATCH);
    assert.deepEqual(result.sideDistribution, { modelA: 1, modelB: 1 });
    assert.equal(tf.memory().numTensors, tensors, 'evaluation tensor leak');
    process.send({ seed, result, hashes: checkpointHashes(checkpoint),
      memory: process.memoryUsage(), resources: process.resourceUsage() });
  } finally {
    model.dispose();
    process.disconnect();
  }
}

function launch(checkpoint, seed) {
  return new Promise((resolve, reject) => {
    const worker = fork(__filename, ['child', checkpoint, String(seed)], {
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

async function main(checkpoint, output) {
  assert(checkpoint && output, 'usage: node task106-evaluation-concurrency.cjs CHECKPOINT OUTPUT');
  checkpoint = path.resolve(checkpoint);
  const hashes = checkpointHashes(checkpoint);
  const report = { kind: 'same-source evaluator process concurrency feasibility; not canonical timing',
    checkpoint, hashes, node: process.version, seeds: SEEDS, gamesPerBatch: GAMES_PER_BATCH,
    order: ARM_ORDER, arms: [],
    caveat: 'Cold child/model loading included equally. SimpleAi only; no baseline-AI, fit, serialization, holdout quality or complete-training speed claim.' };
  try {
    for (const mode of ARM_ORDER) {
      const start = performance.now();
      // Each arm launches exactly the same two cold processes and four games.
      const settled = mode === 'parallel'
        ? await Promise.allSettled(SEEDS.map(seed => launch(checkpoint, seed)))
        : await (async () => {
          const values = [];
          for (const seed of SEEDS) values.push(...await Promise.allSettled([launch(checkpoint, seed)]));
          return values;
        })();
      const results = settled.map((value, index) => value.status === 'fulfilled'
        ? value.value : { seed: SEEDS[index], error: String(value.reason) });
      const arm = { mode, wallMs: performance.now() - start, results };
      report.arms.push(arm);
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      assert(settled.every(value => value.status === 'fulfilled'), 'unfinished evaluation arm');
      for (const result of results) assert.deepEqual(result.hashes, hashes);
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
    console.log('EVALUATION PARITY: PASS arms=4 batchesPerArm=2 gamesPerArm=4');
    console.log('EVALUATION SCREEN TIMING: ' + JSON.stringify({ serialMeanMs: report.serialMeanMs,
      parallelMeanMs: report.parallelMeanMs, reductionPercent: report.reductionPercent }));
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
}

const args = process.argv.slice(2);
(args[0] === 'child' ? child(args[1], Number(args[2])) : main(...args))
  .catch(error => { console.error(error); process.exitCode = 1; });
