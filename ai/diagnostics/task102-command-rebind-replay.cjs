// Bounded mechanism comparison, never full-workload acceptance evidence.
const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');
const zlib = require('zlib');
const {performance} = require('perf_hooks');
const [manifestPath, variant, prefix] = process.argv.slice(2);
assert(['A', 'B', 'audit'].includes(variant));
const processBegin = performance.now();
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [file, expected] of Object.entries(manifest.hashes)) {
  assert.equal(hash(fs.readFileSync(file)), expected, file);
}
const observer = require('./task102-command-rebind.cjs').install(variant);
async function main() {
  const trainer = require('../cloud-train-runner');
  const api = require('../benchmark-gamestart-trained-model');
  const {runGame} = require('../benchmarkHarness');
  const checkpoint = await api.loadCheckpoint(manifest.checkpoint);
  const startupMs = performance.now() - processBegin;
  const results = [], records = [];
  for (const group of ['teacher', 'component']) {
    for (let index = 0; index < 6; index += 1) {
      const begin = performance.now();
      const stats = {calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0};
      const result = group === 'teacher'
        ? trainer.collectRuntimeCombatTeacherGame(137087, 0, index + 1)
        : runGame({...manifest.component[index],
          predictFunction: api.createPredictor(checkpoint.model, stats),
          modelIdentifier: checkpoint.model,
          inferenceSource: 'TASK-102 bounded coordinate dedup diagnostic frozen checkpoint'});
      const elapsedMs = performance.now() - begin;
      results.push(result);
      const record = {group, index, elapsedMs, sha256: hash(JSON.stringify(result)), stats};
      records.push(record);
      console.log('REPLAY_GAME: ' + JSON.stringify(record));
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  checkpoint.model.dispose();
  fs.writeFileSync(prefix + '.results.json.gz', zlib.gzipSync(JSON.stringify(results)), {flag: 'wx'});
  fs.writeFileSync(prefix + '.json', JSON.stringify({variant, records, counts: observer.counts, scripts: observer.scripts, startupMs,
    totalMs: performance.now() - processBegin,
    node: process.version, execArgv: process.execArgv}) + '\n', {flag: 'wx'});
  assert(observer.scripts.every(record => record.executions > 0));
  assert.equal(observer.counts.replacements, 1);
  assert.equal(observer.counts.forwards, observer.scripts.reduce((sum, r) => sum + r.executions, 0));
  console.log('REBIND_REPLAY: PASS 12 complete results');
  if (variant === 'audit') { assert(observer.counts.checks > 0); assert(observer.counts.candidateReads < observer.counts.originalReads); }
  console.log('REBIND_EXECUTION: PASS ' + JSON.stringify(observer.counts));
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
