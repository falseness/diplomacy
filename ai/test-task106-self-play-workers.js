const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  runtimeTeacherDatasetSignature,
  verifyRuntimeTeacherWorkerInvariants,
  workerPoolDispatchProbe
} = require('./cloud-train-runner');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, env || {}),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    throw new Error([
      `command failed: ${process.execPath} ${args.join(' ')}`,
      `status: ${result.status}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }
  return result;
}

async function main() {
  const invariantResults = await verifyRuntimeTeacherWorkerInvariants(10600, 0, 2);
  check(invariantResults.length === 10,
    'worker invariant did not compare ten seeds',
    invariantResults.map((result) => result.seed));

  const serialSignature = await runtimeTeacherDatasetSignature(11600, 0, 1);
  const workerSignature = await runtimeTeacherDatasetSignature(11600, 0, 2);
  check(serialSignature.length > 0, 'serial dataset signature was empty');
  check(JSON.stringify(serialSignature) === JSON.stringify(workerSignature),
    'worker dataset content differs from serial dataset content',
    {
      serialExamples: serialSignature.length,
      workerExamples: workerSignature.length
    });

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
  check(new Set(probe.seeds).size === 4,
    'worker pool returned duplicate game seeds',
    probe);

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task106-workers-'));
  runNode([
    'ai/cloud-train-runner.js',
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
    '--curriculum-lr-reduction-attempted', 'false',
    '--curriculum-lr-reduction-improved', 'false',
    '--workers', '2',
    '--fail-after-game', '0'
  ], {
    DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT: '1'
  });
  const manifestPath = path.join(storageDir, 'runs', 'task106-worker-smoke', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(manifest.status === 'complete', 'worker training smoke did not complete', manifest);
  check(manifest.configuration.workers === 2,
    'worker training manifest did not record worker count',
    manifest.configuration);

  console.log('TASK-106 self-play worker smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
