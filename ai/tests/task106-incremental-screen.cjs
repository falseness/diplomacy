// Audit the predeclared cold CLI source comparison; never rerun or drop samples.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const root = path.resolve(process.argv[2]);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = file => fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
const plan = read(path.join(root, 'plan.json'));
const samples = read(path.join(root, 'samples.json'));
assert.deepEqual(plan.order, ['before', 'after', 'after', 'before']);
assert.deepEqual(samples.map(s => s.arm), plan.order);
assert.equal(plan.screenThreshold, 10);
assert.equal(plan.revisions.before, '0fb9f685833cfe79472779df206e7c1a24b8071c');
assert.equal(plan.revisions.after, 'ce668cd86ae184c06308fc2fa8a7bf93f70780f4');
const summaries = [];
for (const sample of samples) {
  assert.equal(sample.exit, 0);
  assert(Number.isFinite(sample.seconds) && sample.seconds > 0);
  assert.equal(sample.command.includes('--reusable-baseline-evaluation'), sample.arm === 'after');
  const dir = sample.directory;
  const events = lines(path.join(dir, 'events.jsonl'));
  const key = e => `${e.pid}:${e.id}`;
  const starts = new Map(events.filter(e => e.event === 'start').map(e => [key(e), e.scenario]));
  const results = events.filter(e => e.event === 'result');
  assert.equal(starts.size, 39);
  assert.equal(results.length, starts.size);
  assert.equal(new Set(results.map(key)).size, starts.size);
  assert(!events.some(e => e.event === 'crash' || e.event === 'fit-crash'));
  const ordered = results.map(e => {
    assert(starts.has(key(e)));
    return { scenario: starts.get(key(e)), result: e.game };
  }).sort((a, b) => JSON.stringify(a.scenario).localeCompare(JSON.stringify(b.scenario)));
  const fits = events.filter(e => e.event === 'fit-start').map(e => ({ shapes: e.shapes, options: e.options }));
  const fitEpochs = events.filter(e => e.event === 'fit-result').map(e => e.epochs);
  assert.equal(fits.length, 10);
  assert.equal(fitEpochs.length, 10);
  const state = read(path.join(dir, 'runs/task106-cli/state.json'));
  const manifest = read(path.join(dir, 'runs/task106-cli/manifest.json'));
  assert.equal(state.status, 'complete');
  assert.equal(manifest.status, 'complete');
  assert.equal(state.completedGames, 4);
  assert.equal(Boolean(manifest.configuration.reusableBaselineEvaluation), sample.arm === 'after');
  const weightHash = createHash('sha256').update(fs.readFileSync(path.join(dir, 'final/task106-cli/weights.bin'))).digest('hex');
  const summary = { ordered, fits, fitEpochs, weightHash, curriculum: state.curriculum };
  if (summaries.length) {
    for (const field of Object.keys(summary)) {
      assert.deepEqual(summary[field], summaries[0][field], field);
      console.log(`INCREMENTAL PARITY: PASS sample=${summaries.length + 1} ${field}`);
    }
  }
  summaries.push(summary);
  const pools = lines(path.join(dir, 'pool.jsonl'));
  if (sample.arm === 'before') assert.equal(pools.length, 0);
  else {
    const evaluations = pools.filter(e => e.event === 'evaluate');
    assert.equal(evaluations.length, 2);
    assert.equal(new Set(evaluations.map(e => e.result.hash)).size, 2);
    const pids = evaluations[0].result.refreshes.map(r => r.pid);
    assert.equal(new Set(pids).size, 2);
    const tensors = new Map();
    const rss = [];
    for (const { result } of evaluations) {
      assert.deepEqual(result.refreshes.map(r => r.pid), pids);
      assert.equal(result.results.length, 2);
      assert.equal(result.messages.length, 2);
      for (const refresh of result.refreshes) assert.equal(refresh.hash, result.hash);
      for (const message of result.messages) {
        assert.equal(message.hash, result.hash);
        if (tensors.has(message.pid)) assert.equal(message.tensors, tensors.get(message.pid));
        else tensors.set(message.pid, message.tensors);
        assert(message.tensors > 0);
        assert(message.memory.rss > 0);
        rss.push(message.memory.rss);
      }
    }
    const closed = pools.filter(e => e.event === 'close');
    assert.equal(closed.length, 1);
    assert.equal(closed[0].result.length, 2);
    for (const result of closed[0].result) {
      assert(pids.includes(result.pid));
      assert.equal(result.tensors, 0);
      assert.equal(result.exit.code, 0);
      assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
    }
    console.log(`INCREMENTAL LIFECYCLE: PASS sample=${summaries.length} freshHashes=2 stableTensors=${JSON.stringify([...tensors.values()])} zeroFinalTensors reaped RSS=${JSON.stringify(rss)}`);
  }
  console.log(`INCREMENTAL WORK: PASS sample=${summaries.length} games=39 fits=10 nonResults=${ordered.filter(r => r.result.nonResult).length} seconds=${sample.seconds}`);
}
const mean = arm => samples.filter(s => s.arm === arm).reduce((sum, s) => sum + s.seconds, 0) / 2;
const before = mean('before');
const after = mean('after');
const reductionPercent = 100 * (before - after) / before;
const passed = reductionPercent >= plan.screenThreshold;
fs.writeFileSync(path.join(root, 'screen-audit.json'), JSON.stringify({
  revisions: plan.revisions, samples, summaries, beforeMeanSeconds: before,
  afterMeanSeconds: after, reductionPercent, passed,
  canonical: false
}, null, 2) + '\n');
console.log(`INCREMENTAL SCREEN: ${passed ? 'PASS' : 'FAIL'} beforeMeanSeconds=${before} afterMeanSeconds=${after} reductionPercent=${reductionPercent} required=10`);
process.exitCode = passed ? 0 : 1;
