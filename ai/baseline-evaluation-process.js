// Isolate TensorFlow and the mutable game runtime in one process per game.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const CHILD_TIMEOUT_MS = 600000;

function snapshotHash(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot.modelTopology))
    .update(JSON.stringify(snapshot.weightSpecs)).update(Buffer.from(snapshot.weightData)).digest('hex');
}

async function snapshotModel(model) {
  let snapshot;
  await model.save({ save: async artifacts => {
    snapshot = { modelTopology: artifacts.modelTopology, weightSpecs: artifacts.weightSpecs,
      weightData: Buffer.from(artifacts.weightData) };
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
  } }, { includeOptimizer: false });
  return snapshot;
}

function launch(job, childPath = __filename) {
  return new Promise((resolve, reject) => {
    const child = fork(childPath, [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const messages = [];
    let failure;
    const timer = setTimeout(() => { failure = new Error('evaluation child timeout'); child.kill('SIGKILL'); }, CHILD_TIMEOUT_MS);
    child.on('error', error => { failure = error; child.kill('SIGKILL'); });
    child.on('message', message => messages.push(message));
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try {
        assert.ifError(failure);
        assert.equal(code, 0, `evaluation child exit signal=${signal}`);
        assert.equal(messages.length, 1, 'missing/duplicate evaluation result');
        const message = messages[0];
        assert.equal(message.game, job.game, 'wrong evaluation game');
        assert.equal(message.hash, snapshotHash(job.snapshot), 'stale evaluation model');
        assert.equal(message.tensorsAfter, 0, 'child tensor leak');
        resolve(message);
      } catch (error) { reject(error); }
    });
    child.send(job, error => { if (error) { failure = error; child.kill('SIGKILL'); } });
  });
}

async function evaluateInProcesses(options, state, model, concurrency, observe = () => {}) {
  assert(Number.isInteger(concurrency) && concurrency > 0);
  const snapshot = await snapshotModel(model);
  const games = options.curriculumGateGames || options.oldVsNewGames;
  const results = [];
  for (let first = 1; first <= games; first += concurrency) {
    const jobs = Array.from({ length: Math.min(concurrency, games - first + 1) }, (_, index) => ({
      options: { curriculumBaselineAiModelPath: options.curriculumBaselineAiModelPath },
      state, game: first + index, snapshot
    }));
    // Wait for every child, even if a sibling fails, before returning to training.
    const settled = await Promise.allSettled(jobs.map(job => launch(job)));
    for (const item of settled) {
      if (item.status === 'fulfilled') { observe(item.value); results.push(item.value.result); }
    }
    const failure = settled.find(item => item.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return results;
}

async function child(job) {
  const tf = require('@tensorflow/tfjs-node');
  const { runCurriculumBaselineGame, createRuntimeModelPredict } = require('./cloud-train-runner');
  const path = require('node:path');
  let model;
  let baseline;
  let result;
  try {
    const bytes = job.snapshot.weightData;
    model = await tf.loadLayersModel({ load: async () => ({ ...job.snapshot,
      weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) });
    baseline = await tf.loadLayersModel(`file://${path.resolve(job.options.curriculumBaselineAiModelPath, 'model.json')}`);
    result = runCurriculumBaselineGame(job.options, job.state, job.game,
      createRuntimeModelPredict(model), createRuntimeModelPredict(baseline));
  } finally {
    if (baseline) baseline.dispose();
    if (model) model.dispose();
  }
  process.send({ game: job.game, hash: snapshotHash(job.snapshot), result,
    tensorsAfter: tf.memory().numTensors, memory: process.memoryUsage(), resources: process.resourceUsage() }, () => process.disconnect());
}

if (require.main === module) process.once('message', job => child(job).catch(error => {
  console.error(error); process.exitCode = 1; process.disconnect();
}));
module.exports = { evaluateInProcesses, snapshotModel, snapshotHash, launch };
