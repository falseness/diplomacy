const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  runtimeTeacherDatasetSignature,
  verifyRuntimeTeacherWorkerInvariants,
  workerPoolDispatchProbe
} = require('./cloud-train-runner');
const { verifyWorkerLifecycle } = require('./tests/task106-worker-lifecycle.cjs');
const { verifyRuntimeTeacherTransfer } = require('./tests/runtime-teacher-transfer.cjs');
const { verifyPretrainingOverlap } = require('../tests/task106-pretraining-overlap.cjs');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function runTraining(args, env) {
  const command = ['./train.sh', ...args];
  console.log('Worker training command:', JSON.stringify(['bash', ...command]));
  const result = spawnSync('bash', command, {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, env || {}, {
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`
    }),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  console.log('Worker training exit:', result.status);
  if (result.status !== 0) {
    throw new Error([
      `command failed: bash ${command.join(' ')}`,
      `status: ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }
  return result;
}

async function main() {
  await verifyWorkerLifecycle();
  await verifyRuntimeTeacherTransfer();
  const invariantResults = await verifyRuntimeTeacherWorkerInvariants(10600, 0, 2);
  check(invariantResults.length === 10,
    'worker invariant did not compare ten seeds',
    invariantResults.map((result) => result.seed));
  console.log('Worker invariants passed:', JSON.stringify(invariantResults.map(
    ({ examples, ...result }) => ({ ...result, examples: examples.length }))));

  const serialSignature = await runtimeTeacherDatasetSignature(11600, 0, 1);
  const workerSignature = await runtimeTeacherDatasetSignature(11600, 0, 2);
  check(serialSignature.length > 0, 'serial dataset signature was empty');
  check(JSON.stringify(serialSignature) === JSON.stringify(workerSignature),
    'worker dataset content differs from serial dataset content',
    {
      serialExamples: serialSignature.length,
      workerExamples: workerSignature.length
    });
  console.log('Serial/worker ordered examples and trainer tensors equality passed:', serialSignature.length, 'ordered records including four tensor signatures');

  const probe = await workerPoolDispatchProbe(2, [
    { seed: 12600, stageIndex: 0, game: 1 },
    { seed: 12600, stageIndex: 0, game: 2 },
    { seed: 12610, stageIndex: 0, game: 1 },
    { seed: 12610, stageIndex: 0, game: 2 }
  ]);
  check(probe.actualWorkers === 2, 'worker pool did not start two workers', probe);
  check(probe.dispatched === 4 && probe.collected === 4,
    'worker pool dropped or duplicated jobs',
    probe);
  check(probe.pendingJobs === 0, 'pool retained completed jobs', probe);
  check(new Set(probe.seeds).size === 4,
    'worker pool returned duplicate game seeds',
    probe);

  console.log('Worker dispatch passed:', JSON.stringify(probe));
  const storageDir = process.env.TASK106_SMOKE_STORAGE || fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task106-workers-'));
  console.log('Worker training storage:', storageDir);
  // Use the public CLI so runner defaults and required arguments stay centralized.
  const trainingArgs = [
    '--storage-dir', storageDir,
    '--run-id', 'task106-worker-smoke',
    '--games', '1',
    '--epochs', '1',
    '--seed', '106',
    '--max-games-this-run', '0',
    '--checkpoint-interval', '1',
    '--checkpoint-retain', '0',
    '--old-vs-new-games', '1',
    '--evaluation-cadence', '2',
    '--plateau-window', '2',
    '--plateau-min-delta', '0.001',
    '--plateau-patience', '1',
    '--curriculum-simple-winrate', '1',
    '--curriculum-simple-winrate-threshold', '0.8',
    '--fail-after-game', '0'
  ];
  const hashes = [];
  for (const workers of [1, 2]) {
    const workerStorage = path.join(storageDir, String(workers));
    const args = trainingArgs.slice();
    args[args.indexOf('--storage-dir') + 1] = workerStorage;
    fs.mkdirSync(workerStorage, { recursive: true });
    const eventsPath = path.join(workerStorage, 'training-events.jsonl');
    const observerPath = path.resolve(__dirname, '../tests/task106-training-observer.cjs');
    runTraining([...args, '--workers', String(workers)], {
      DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT: '1',
      TASK106_TRAINING_EVENTS: eventsPath,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${observerPath}`
    });
    verifyPretrainingOverlap(eventsPath, workers, 106);
    const weights = fs.readFileSync(path.join(workerStorage, 'final',
      'task106-worker-smoke', 'weights.bin'));
    hashes.push(crypto.createHash('sha256').update(weights).digest('hex'));
  }
  check(hashes[0] === hashes[1], 'worker count changed deterministic trained weights', hashes);
  console.log('Deterministic trainer consumption and final weights equality passed:', hashes[0]);
  const manifestPath = path.join(storageDir, '2', 'runs', 'task106-worker-smoke', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(manifest.status === 'complete', 'worker training smoke did not complete', manifest);
  check(manifest.configuration.workers === 2,
    'worker training manifest did not record worker count',
    manifest.configuration);
  console.log('Worker training manifest passed:', JSON.stringify({
    path: manifestPath,
    status: manifest.status,
    workers: manifest.configuration.workers
  }));

  console.log('TASK-106 self-play worker smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
