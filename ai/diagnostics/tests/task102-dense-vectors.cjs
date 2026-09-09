const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {transform, install} = require('../task102-dense-vectors.cjs');
const source = fs.readFileSync('ai/vectorizeContent.js', 'utf8');
if (process.argv.includes('--invariants')) {
  const counts = install(true);
  require('../../test-fast-unit-actions.js');
  assert(counts.vectorizeCellLocal > 0 && counts.computeGlobalVectorChannels > 0);
  console.log('DENSE_INVARIANTS: PASS ' + JSON.stringify(counts));
} else {
  const context = vm.createContext({});
  vm.runInContext(transform(source), context);
  vm.runInContext(`
    const first = task102ZeroVector();
    first[0] = 99;
    const second = task102ZeroVector();
    if (first === second || second.some(x => !Object.is(x, 0))) throw Error('ownership/zero');
    CELL_VECTOR_SIZE += 1;
    const resized = task102ZeroVector();
    if (resized.length !== CELL_VECTOR_SIZE || resized.some(x => !Object.is(x, 0))) throw Error('resize');
  `, context);
  assert.throws(() => transform(''), /two vector constructors/);
  const checked = vm.createContext({__task102DenseChecked() {}});
  vm.runInContext(transform(source, true), checked);
  vm.runInContext(`
    vectorizePlayerGold = vectorizePlayerIncome = vectorizePlayerSuburbIncome = () => {};
    currentTownDefenseMargin = () => 0;
    computeGlobalVectorChannels();
    task102ZeroVector = () => new Array(CELL_VECTOR_SIZE).fill(1);
  `, checked);
  assert.throws(() => vm.runInContext('computeGlobalVectorChannels()', checked), /oracle mismatch/);
  console.log('DENSE_CONTROLS: PASS independent vectors, positive zero, schema resizing, malformed source and corrupt constructor rejected');
}
