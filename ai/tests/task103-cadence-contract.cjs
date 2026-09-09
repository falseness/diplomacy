// Diagnostic only: isolate the saved cadence source-contract failure without
// launching training, changing its runtime, or claiming the cadence suite passes.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const runnerPath = 'ai/cloud-train-runner.js';
const testPath = 'ai/test-task104-training-cadence.js';
const change = '1a70d88730d6bbc1e8150ac4ea3a497853f4c96f';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const sha = (source) => crypto.createHash('sha256').update(source).digest('hex');
const test = fs.readFileSync(path.join(root, testPath), 'utf8');
const start = test.indexOf('function assertSourceUsesInMemoryMetrics() {');
const end = test.indexOf('\nfunction assertCadenceOneMatchesLegacy(', start);
assert(start >= 0 && end > start, 'cannot isolate the actual source-contract function');
const contract = test.slice(start, end);
const expectedFailure = 'cadence K should reduce synthetic fit work without changing cadence=1 behavior';
const parent = git('rev-parse', `${change}^`).trim();
const current = git('rev-parse', 'HEAD').trim();
console.log(JSON.stringify({ node: process.version, parent, change, current,
  testPath, testSha256: sha(test), contractSha256: sha(contract),
  dirty: git('status', '--short') }));

for (const [label, revision, source, expected] of [
  ['parent', parent, git('show', `${parent}:${runnerPath}`), null],
  ['change', change, git('show', `${change}:${runnerPath}`), expectedFailure],
  ['current', current, fs.readFileSync(path.join(root, runnerPath), 'utf8'), expectedFailure]
]) {
  let failure = null;
  try {
    vm.runInNewContext(`${contract}\nassertSourceUsesInMemoryMetrics();`, {
      __dirname: path.join(root, 'ai'), path,
      fs: { readFileSync(file, encoding) {
        assert.strictEqual(file, path.join(root, runnerPath));
        assert.strictEqual(encoding, 'utf8');
        return source;
      } },
      check(condition, message) { assert(condition, message); }
    }, { filename: testPath });
  } catch (error) {
    failure = error.message;
  }
  console.log(JSON.stringify({ label, revision, runnerSha256: sha(source), failure }));
  assert.strictEqual(failure, expected, `${label}: unexpected source-contract result`);
}
console.log('CADENCE_CONTRACT_ISOLATION: PASS actual current assertion passes against parent, fails against change and current');
console.log('CADENCE_SUITE: UNRESOLVED; no training, metrics equivalence or speed gate executed');
