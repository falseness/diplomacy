const { parentPort, threadId } = require('worker_threads');

let busy = false;
let release;
parentPort.on('message', ({ id, job, type }) => {
  if (type === 'release') {
    if (release) release();
    return;
  }
  if (busy) throw new Error('more than one job dispatched to a busy worker');
  if (job.exit !== undefined) process.exit(job.exit);
  if (job.crash) throw new Error('fixture worker crashed');
  busy = true;
  const complete = () => {
    busy = false;
    release = null;
    parentPort.postMessage(job.error
      ? { id, error: 'fixture job failed' }
      : { id, result: { seed: job.seed, threadId } });
  };
  if (job.hold) release = complete;
  else setTimeout(complete, job.delay || 0);
});
