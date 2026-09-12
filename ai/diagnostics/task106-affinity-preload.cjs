// Diagnostic only: place evaluator processes before Node/native initialization.
// All game arguments, IPC payloads, results, and training calls pass unchanged.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const Module = require('node:module');
const record = event => fs.appendFileSync(process.env.TASK106_AFFINITY_EVENTS,
  JSON.stringify({ ...event, pid: process.pid, ns: process.hrtime.bigint().toString() }) + '\n');
let childIndex = 0;
const fork = cp.fork;
cp.fork = function(file, args, options) {
  if (path.basename(file) === 'reusable-baseline-evaluation.js') {
    const index = childIndex++;
    if (index > 1) throw new Error('unexpected third evaluator');
    const mapping = JSON.parse(process.env.TASK106_AFFINITY_MAPPING);
    options = { ...options, execPath: process.env.TASK106_AFFINITY_LAUNCHER,
      env: { ...(options.env || process.env), TASK106_CHILD_NODE: process.execPath,
        TASK106_CHILD_CPUS: mapping[index], TASK106_CHILD_INDEX: String(index) } };
  }
  return fork.call(this, file, args, options);
};
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === '@tensorflow/tfjs-node' && process.env.TASK106_CHILD_CPUS) {
    record({ event: 'before-tensorflow', index: process.env.TASK106_CHILD_INDEX,
      expected: process.env.TASK106_CHILD_CPUS,
      threads: fs.readdirSync('/proc/self/task').map(tid => ({ tid,
        status: fs.readFileSync(`/proc/self/task/${tid}/status`, 'utf8') })) });
  }
  return load.call(this, request, ...args);
};
require('../tests/task106-reusable-cli.cjs');
