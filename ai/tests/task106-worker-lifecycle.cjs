const assert = require('assert/strict');
const path = require('path');
const { once } = require('events');
const { Worker } = require('worker_threads');
const { RuntimeTeacherWorkerPool } = require('../cloud-train-runner');

const fixture = path.join(__dirname, 'fixtures/task106-pool-worker.cjs');

async function verifyWorkerLifecycle() {
  const guard = new Worker(path.join(__dirname, 'fixtures/task106-no-tensorflow-worker.cjs'));
  try {
    const [result] = await once(guard, 'message');
    assert.deepEqual(result, { tensorflowImports: 0 });
  } finally {
    await guard.terminate();
  }
  console.log('Worker TensorFlow isolation passed: tensorflowImports=0');

  const pool = new RuntimeTeacherWorkerPool(2, fixture);
  try {
    const jobs = Array.from({ length: 8 }, (_, seed) => ({ seed, hold: seed === 0 }));
    const promises = jobs.map(job => pool.runRuntimeTeacherGame(job));
    await Promise.all(promises.slice(1));
    pool.workers.forEach(worker => worker.postMessage({ type: 'release' }));
    const results = await Promise.all(promises);
    assert.deepEqual(results.map(result => result.seed), jobs.map(job => job.seed));
    assert.equal(new Set(results.map(result => result.threadId)).size, 2);
    assert.equal(new Set(results.slice(1).map(result => result.threadId)).size, 1);
    assert.equal(pool.pending.size, 0);
    assert.equal(pool.queue.length, 0);
    assert.equal(pool.idleWorkers.length, 2);
    await assert.rejects(pool.runRuntimeTeacherGame({ error: true }), /fixture job failed/);
    await assert.rejects(pool.runRuntimeTeacherGame({ seed: Symbol('uncloneable') }), /could not be cloned/);
    assert.equal((await pool.runRuntimeTeacherGame({ seed: 9 })).seed, 9);
    console.log('Worker queue passed: jobs=8 uniqueSeeds=8 workers=2 pendingJobs=0; job and clone errors recovered');
  } finally {
    const closing = pool.close();
    assert.equal(pool.close(), closing);
    await closing;
  }
  assert.equal(pool.workers.length, 0);
  await assert.rejects(pool.runRuntimeTeacherGame({ seed: 10 }), /pool is closed/);

  for (const job of [{ exit: 0 }, { exit: 7 }, { crash: true }]) {
    const failed = new RuntimeTeacherWorkerPool(2, fixture);
    try {
      const settled = await Promise.allSettled([job, ...Array(5).fill({ delay: 1000 })]
        .map(input => failed.runRuntimeTeacherGame(input)));
      assert(settled.every(result => result.status === 'rejected'));
      assert.equal(failed.pending.size, 0);
      assert.equal(failed.queue.length, 0);
      await assert.rejects(failed.runRuntimeTeacherGame({ seed: 11 }), /worker exited|fixture worker crashed/);
    } finally {
      await failed.close();
    }
  }
  console.log('Worker failure handling passed: clean exit, nonzero exit, crash; all active and queued jobs rejected');

  const cancelled = new RuntimeTeacherWorkerPool(2, fixture);
  const settled = Promise.allSettled(Array.from({ length: 6 }, () =>
    cancelled.runRuntimeTeacherGame({ delay: 1000 })));
  await cancelled.close();
  assert((await settled).every(result => result.status === 'rejected' && /pool is closed/.test(result.reason.message)));
  assert.equal(cancelled.pending.size, 0);
  assert.equal(cancelled.queue.length, 0);
  assert.equal(cancelled.workers.length, 0);
  const serial = new RuntimeTeacherWorkerPool(1);
  await serial.close();
  await assert.rejects(serial.runRuntimeTeacherGame({ seed: 12 }), /pool is closed/);
  console.log('Worker shutdown passed: jobs=6 rejected=6 pendingJobs=0 workers=0; repeated close and use after close checked');
}

if (require.main === module) {
  // Bound broken lifecycle implementations that leave promises unresolved.
  const timeout = setTimeout(() => {
    console.error('Worker lifecycle check timed out');
    process.exit(1);
  }, 30000);
  verifyWorkerLifecycle().catch(error => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => clearTimeout(timeout));
}

module.exports = { verifyWorkerLifecycle };
