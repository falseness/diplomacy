// Opt-in lifecycle experiment. Each child owns its models; runGame creates a
// fresh runtime for every job. The caller must close the pool in finally.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { snapshotModel, snapshotHash } = require('./baseline-evaluation-process');

class EvaluatorProcess {
  constructor(childPath = __filename, timeoutMs = 600000) {
    this.nextId = 0;
    this.pending = null;
    this.failure = null;
    this.closing = false;
    this.timeoutMs = timeoutMs;
    const start = performance.now();
    this.child = fork(childPath, [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.exited = new Promise(resolve => this.child.once('exit', (code, signal) => {
      if (!this.closing || code !== 0) this.fail(new Error(`unexpected evaluator exit ${code}/${signal}`));
      if (this.pending) this.fail(new Error('missing evaluator response'));
      this.exit = { code, signal, lifetimeMs: performance.now() - start };
      resolve(this.exit);
    }));
    this.child.on('error', error => this.fail(error));
    this.child.on('message', message => {
      try {
        assert(this.pending, 'duplicate/unsolicited evaluator response');
        assert.equal(message.id, this.pending.id, 'stale evaluator response');
        if (message.error) throw new Error(message.error);
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(message);
      } catch (error) { this.fail(error); }
    });
  }
  fail(error) {
    this.failure ||= error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failure);
      this.pending = null;
    }
    this.child.kill('SIGKILL');
  }
  request(type, payload = {}) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending || this.closing) return Promise.reject(new Error('busy/closed evaluator'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.fail(new Error('missing evaluator response timeout')), this.timeoutMs);
      this.pending = { id, resolve, reject, timer };
      this.child.send({ id, type, ...payload }, error => { if (error) this.fail(error); });
    });
  }
  async close() {
    let message;
    try {
      if (!this.failure) {
        // Mark expected exit before the shutdown response can disconnect IPC.
        const response = this.request('shutdown');
        this.closing = true;
        message = await response;
        assert.equal(message.tensors, 0, 'owned tensors remain after shutdown');
      }
    } catch (error) { this.fail(error); }
    // An acknowledged shutdown must also actually exit.
    const timer = setTimeout(() => this.fail(new Error('evaluator exit timeout')), this.timeoutMs);
    const exit = await this.exited;
    clearTimeout(timer);
    if (this.failure) throw this.failure;
    return { ...message, exit };
  }
}

class ReusableBaselineEvaluator {
  constructor() { this.workers = [new EvaluatorProcess(), new EvaluatorProcess()]; this.boundary = 0; }
  async evaluate(options, state, model, concurrency = 2) {
    assert([1, 2].includes(concurrency));
    assert.equal(options.curriculumGateGames || options.oldVsNewGames, 2);
    assert.equal(typeof options.curriculumPredictFunction === 'function', false, 'custom callbacks require serial evaluator');
    const start = performance.now();
    const snapshot = await snapshotModel(model);
    const snapshotMs = performance.now() - start;
    const hash = snapshotHash(snapshot);
    const boundary = ++this.boundary;
    const refreshStart = performance.now();
    const refreshed = await Promise.allSettled(this.workers.map(worker => worker.request('refresh', {
      boundary, snapshot, baselinePath: options.curriculumBaselineAiModelPath
    })));
    const refreshes = this.values(refreshed);
    refreshes.forEach(message => { assert.equal(message.hash, hash); assert.equal(message.boundary, boundary); });
    const refreshMs = performance.now() - refreshStart;
    const messages = [];
    for (let first = 0; first < 2; first += concurrency) {
      const settled = await Promise.allSettled(this.workers.slice(first, first + concurrency).map((worker, offset) =>
        worker.request('game', { boundary, hash, game: first + offset + 1, state,
          options: { curriculumBaselineAiModelPath: options.curriculumBaselineAiModelPath } })));
      messages.push(...this.values(settled));
    }
    messages.forEach((message, i) => {
      assert.equal(message.game, i + 1); assert.equal(message.boundary, boundary); assert.equal(message.hash, hash);
      assert.equal(message.tensors, refreshes[i].tensors, 'game tensor leak');
    });
    return { results: messages.map(message => message.result), messages, refreshes, hash, snapshotMs, refreshMs };
  }
  values(settled) {
    const failed = settled.find(item => item.status === 'rejected');
    if (failed) throw failed.reason;
    return settled.map(item => item.value);
  }
  async close() { return this.values(await Promise.allSettled(this.workers.map(worker => worker.close()))); }
}

function serve() {
  let tf, runner, current, baseline, baselinePath, hash, boundary = 0, lastId = 0;
  const seen = new Set();
  let busy = false;
  process.on('message', async job => {
    if (busy) { console.error('overlapping evaluator request'); process.exit(1); }
    busy = true;
    const phases = {};
    try {
      assert.equal(job.id, lastId + 1, 'stale/duplicate request id'); lastId = job.id;
      let response;
      if (job.type === 'refresh') {
        assert.equal(job.boundary, boundary + 1, 'stale boundary');
        let start = performance.now();
        if (!tf) { tf = require('@tensorflow/tfjs-node'); runner = require('./cloud-train-runner'); }
        phases.importMs = performance.now() - start;
        start = performance.now();
        if (!baseline) {
          baselinePath = job.baselinePath;
          baseline = await tf.loadLayersModel(`file://${require('node:path').resolve(baselinePath, 'model.json')}`);
        }
        assert.equal(job.baselinePath, baselinePath, 'baseline changed');
        phases.baselineLoadMs = performance.now() - start;
        start = performance.now();
        if (current) current.dispose();
        current = null;
        const bytes = job.snapshot.weightData;
        current = await tf.loadLayersModel({ load: async () => ({ ...job.snapshot,
          weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) });
        phases.currentLoadMs = performance.now() - start;
        hash = snapshotHash(await snapshotModel(current));
        assert.equal(hash, snapshotHash(job.snapshot), 'installed weight hash mismatch');
        boundary = job.boundary; seen.clear();
        response = { hash, boundary };
      } else if (job.type === 'game') {
        assert(current && baseline, 'missing refresh');
        assert.equal(job.boundary, boundary, 'stale game boundary'); assert.equal(job.hash, hash, 'stale game hash');
        assert([1, 2].includes(job.game) && !seen.has(job.game), 'missing/duplicate game index'); seen.add(job.game);
        const start = performance.now();
        const result = runner.runCurriculumBaselineGame(job.options, job.state, job.game,
          runner.createRuntimeModelPredict(current), runner.createRuntimeModelPredict(baseline));
        phases.gameMs = performance.now() - start;
        response = { result, game: job.game, hash, boundary };
      } else {
        assert.equal(job.type, 'shutdown');
        const start = performance.now();
        if (current) current.dispose(); if (baseline) baseline.dispose();
        current = baseline = null; phases.cleanupMs = performance.now() - start;
        response = {};
      }
      process.send({ id: job.id, ...response, phases, tensors: tf ? tf.memory().numTensors : 0,
        memory: process.memoryUsage(), pid: process.pid }, () => {
        busy = false;
        if (job.type === 'shutdown') process.disconnect();
      });
    } catch (error) {
      if (current) current.dispose(); if (baseline) baseline.dispose();
      process.send({ id: job.id, error: error.stack }, () => { process.exitCode = 1; process.disconnect(); });
    }
  });
}
if (require.main === module) serve();
module.exports = { EvaluatorProcess, ReusableBaselineEvaluator };
