// Read-only audit. Bounded timing is never final speed acceptance.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const {transform} = require('./task102-command-rebind.cjs');
const dir = process.argv[2];
const read = file => fs.readFileSync(path.join(dir, file));
const json = file => JSON.parse(read(file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = json('manifest.json');
assert.deepStrictEqual(manifest.order, ['A', 'B', 'B', 'A']);
const source = fs.readFileSync(path.resolve(__dirname, '../players.js'), 'utf8');
const labels = ['oracle', ...manifest.order.map((arm, i) => `${i + 1}-${arm}`)];
const records = labels.map(label => json(label + '.json'));
const raw = labels.map(label => zlib.gunzipSync(read(label + '.results.json.gz')));
const reference = records[0];
for (let i = 0; i < labels.length; i++) {
  const record = records[i];
  const results = JSON.parse(raw[i]);
  const log = read(labels[i] + '.log').toString();
  assert.match(log, /^EXIT_CODE: 0$/m);
  assert.match(log, /^REBIND_REPLAY: PASS 12 complete results$/m);
  assert.equal(results.length, 12);
  assert.equal(record.records.length, 12);
  assert.equal(record.variant, i === 0 ? 'audit' : manifest.order[i - 1]);
  assert(raw[i].equals(raw[0]), 'complete outputs including teacher examples');
  assert.equal(record.node, 'v20.20.2');
  assert.deepStrictEqual(record.execArgv, reference.execArgv);
  for (let j = 0; j < results.length; j++) {
    assert.equal(hash(JSON.stringify(results[j])), record.records[j].sha256);
    assert.deepStrictEqual(record.records[j].stats, reference.records[j].stats);
    assert.equal(record.records[j].group, j < 6 ? 'teacher' : 'component');
    assert.equal(record.records[j].index, j % 6);
    assert(record.records[j].elapsedMs > 0);
  }
  assert.equal(record.counts.replacements, 1);
  assert.equal(record.counts.forwards, record.scripts.reduce((sum, s) => sum + s.executions, 0));
  assert.equal(record.scripts.length, reference.scripts.length);
  for (let j = 0; j < record.scripts.length; j++) {
    const script = record.scripts[j];
    assert(script.executions > 0);
    assert.equal(script.filename, reference.scripts[j].filename);
    assert.equal(script.executions, reference.scripts[j].executions);
    assert.equal(script.sha256, script.filename === 'ai/players.js'
      ? hash(transform(source, record.variant)) : reference.scripts[j].sha256);
  }
  console.log(`CAPTURE: PASS ${labels[i]} 12 complete records, scripts, inference counts and exit`);
}
assert(reference.counts.checks > 0);
assert(reference.counts.originalReads > reference.counts.candidateReads);
console.log('REBIND_ORACLE: PASS ' + JSON.stringify(reference.counts));
for (const [file, expected] of Object.entries(manifest.hashes)) {
  assert.equal(hash(fs.readFileSync(file)), expected, file);
}
console.log('FROZEN_SOURCE: PASS actual predecessor and diagnostic source/checkpoint/Node hashes');
const summary = {};
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
for (const boundary of ['teacher', 'component', 'startupMs', 'totalMs']) {
  const values = records.slice(1).map(record => ['teacher', 'component'].includes(boundary)
    ? record.records.filter(item => item.group === boundary).reduce((sum, item) => sum + item.elapsedMs, 0)
    : record[boundary]);
  const before = [values[0], values[3]], after = [values[1], values[2]];
  summary[boundary] = {valuesMs: values, beforeMeanMs: mean(before), afterMeanMs: mean(after),
    reductionPercent: (1 - mean(after) / mean(before)) * 100,
    pairReductionPercent: [(1 - values[1] / values[0]) * 100, (1 - values[2] / values[3]) * 100],
    beforeRangePercent: (Math.max(...before) - Math.min(...before)) / mean(before) * 100,
    afterRangePercent: (Math.max(...after) - Math.min(...after)) / mean(after) * 100};
}
summary.advance = summary.teacher.reductionPercent >= 10 && summary.component.reductionPercent >= 10;
console.log(JSON.stringify(summary, null, 2));
console.log('SCREEN: ' + (summary.advance ? 'ADVANCE' : 'REJECT') + ' predeclared bounded mean rule; not speed acceptance');
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
