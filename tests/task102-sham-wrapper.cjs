const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {identity, install} = require('../ai/diagnostics/task102-sham-wrapper.cjs');
const source = fs.readFileSync(require.resolve('../ai/mutableVectorGrid.js'), 'utf8');
assert.equal(identity(source), source);
assert.throws(() => identity('changed source'), /unique coordinate fragment/);
assert.throws(() => identity(source + source), /unique coordinate fragment/);
const original = vm.Script;
const records = [];
for (const arm of ['A', 'S']) {
  const observer = install(arm);
  try {
    const script = new vm.Script(source, {filename: 'ai/mutableVectorGrid.js'});
    const context = vm.createContext({});
    script.runInContext(context);
    assert.equal(typeof context.addFastActionCoord, 'function');
    records.push(observer.scripts);
    assert.deepEqual(observer.counts, arm === 'S'
      ? {replacements: 1, forwards: 1} : {replacements: 0, forwards: 0});
  } finally {
    observer.restore();
  }
  assert.equal(vm.Script, original);
}
assert.deepEqual(records[0], records[1]);
console.log('SHAM_CONTROLS: PASS identity bytes, actual execution, forwarding, malformed/duplicate rejection and restoration');
