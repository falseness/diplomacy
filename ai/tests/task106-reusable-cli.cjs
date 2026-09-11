// Read-only CLI integration observer. Results and exceptions pass through intact.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

if (require.main !== module) {
  require('../../tests/task106-training-observer.cjs');
  const Module = require('node:module');
  const originalLoad = Module._load;
  const observed = new WeakSet();
  const record = event => fs.appendFileSync(process.env.TASK106_POOL_EVENTS,
    JSON.stringify({ ...event, pid: process.pid }) + '\n');
  // Observe normal loading; preloading a child's entry module would cache it
  // before Node executes it as main and suppress its message loop.
  Module._load = function(request, ...args) {
    const exports = originalLoad.call(this, request, ...args);
    if (request.endsWith('reusable-baseline-evaluation') && !observed.has(exports)) {
      observed.add(exports);
      for (const method of ['evaluate', 'close']) {
        const original = exports.ReusableBaselineEvaluator.prototype[method];
        exports.ReusableBaselineEvaluator.prototype[method] = async function(...values) {
          const result = await original.apply(this, values);
          record({ event: method, result });
          return result;
        };
      }
    }
    return exports;
  };
} else {
  const root = path.resolve(process.argv[2]);
  fs.mkdirSync(root, { recursive: true });
  const args = ['--run-id', 'task106-cli', '--games', '4', '--epochs', '1',
    '--seed', '106', '--workers', '2', '--old-vs-new-games', '1',
    '--curriculum-gate-games', '2', '--evaluation-cadence', '1',
    '--plateau-window', '2', '--plateau-min-delta', '2',
    '--curriculum-lr-reduction-attempted'];
  const summaries = [];
  for (const arm of ['serial', 'reusable', 'failure']) {
    const dir = path.join(root, arm);
    fs.mkdirSync(dir);
    const command = ['train.sh', '--storage-dir', dir, ...args];
    if (arm !== 'serial') command.push('--reusable-baseline-evaluation');
    if (arm === 'failure') command.push('--fail-after-game', '3');
    const env = { ...process.env,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
      DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT: '1',
      TASK106_TRAINING_EVENTS: path.join(dir, 'events.jsonl'),
      TASK106_POOL_EVENTS: path.join(dir, 'pool.jsonl'),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${__filename}` };
    console.log('COMMAND:', JSON.stringify(['bash', ...command]));
    const log = fs.openSync(path.join(dir, 'command.log'), 'w');
    const result = spawnSync('bash', command, { env, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    console.log('CLI EXIT:', arm, result.status, result.signal);
    assert.equal(result.signal, null);
    assert.equal(result.status, arm === 'failure' ? 1 : 0);
    const readLines = file => fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const pools = readLines(env.TASK106_POOL_EVENTS);
    if (arm === 'serial') assert.equal(pools.length, 0);
    else {
      const evaluations = pools.filter(e => e.event === 'evaluate');
      assert(evaluations.length >= (arm === 'failure' ? 1 : 2));
      assert.equal(new Set(evaluations.map(e => e.result.hash)).size, evaluations.length);
      const pids = evaluations[0].result.refreshes.map(r => r.pid);
      for (const e of evaluations) {
        assert.deepEqual(e.result.refreshes.map(r => r.pid), pids);
        assert.equal(e.result.results.length, 2);
        for (const r of e.result.refreshes) assert.equal(r.hash, e.result.hash);
      }
      const closed = pools.filter(e => e.event === 'close');
      assert.equal(closed.length, 1);
      for (const r of closed[0].result) {
        assert.equal(r.tensors, 0); assert.equal(r.exit.code, 0);
        assert.throws(() => process.kill(r.pid, 0), { code: 'ESRCH' });
      }
      console.log(`CLI LIFECYCLE: PASS arm=${arm} boundaries=${evaluations.length} distinctHashes=${evaluations.length} reusedChildren=2 zeroTensors reaped`);
    }
    const events = readLines(env.TASK106_TRAINING_EVENTS);
    const key = e => `${e.pid}:${e.id}`;
    const starts = new Map(events.filter(e => e.event === 'start').map(e => [key(e), e.scenario]));
    const results = events.filter(e => e.event === 'result');
    assert.equal(starts.size, results.length);
    assert.equal(new Set(results.map(key)).size, starts.size);
    assert(!events.some(e => e.event === 'crash' || e.event === 'fit-crash'));
    const ordered = results.map(e => ({ scenario: starts.get(key(e)), result: e.game }))
      .sort((a,b) => JSON.stringify(a.scenario).localeCompare(JSON.stringify(b.scenario)));
    const fits = events.filter(e => e.event === 'fit-start').map(e => ({ shapes: e.shapes, options: e.options }));
    const fitEpochs = events.filter(e => e.event === 'fit-result').map(e => e.epochs);
    assert.equal(fits.length, fitEpochs.length);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'runs/task106-cli/state.json')));
    if (arm === 'failure') {
      assert.equal(state.status, 'failed');
      assert.match(fs.readFileSync(path.join(dir, 'command.log'), 'utf8'), /forced failure after game 3/);
      console.log('CLI FAILURE: PASS original error preserved; manifest failed; children reaped');
      continue;
    }
    const weights = fs.readFileSync(path.join(dir, 'final/task106-cli/weights.bin'));
    const weightHash = require('node:crypto').createHash('sha256').update(weights).digest('hex');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'runs/task106-cli/manifest.json')));
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.configuration.reusableBaselineEvaluation, arm === 'reusable');
    summaries.push({ arm, ordered, fits, fitEpochs, weightHash, curriculum: state.curriculum });
    fs.writeFileSync(path.join(root, 'comparison.json'), JSON.stringify(summaries, null, 2));
    console.log(`CLI WORK: arm=${arm} games=${ordered.length} fits=${fits.length} nonResults=${ordered.filter(r=>r.result.nonResult).length}`);
    if (arm === 'reusable') {
      for (const field of ['ordered', 'fits', 'fitEpochs', 'weightHash', 'curriculum']) {
        assert.deepEqual(summaries[0][field], summaries[1][field], field);
        console.log('CLI PARITY: PASS', field);
      }
    }
  }
  console.log('REUSABLE CLI INTEGRATION: PASS');
}
