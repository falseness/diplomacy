const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {spawnSync} = require('child_process');
const {filename, transform, install} = require('../diagnostics/task102-way-fill.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '../..', filename), 'utf8');

if (process.argv[2] === 'negative') {
  const OriginalScript = vm.Script;
  vm.Script = class BrokenFillScript extends OriginalScript {
    constructor(text, options) {
      if (options?.filename === filename) text = text.replace('.fill(moves + 1)', '.fill(moves + 2)');
      super(text, options);
    }
  };
  install('audit');
  assert.throws(() => require('../cloud-train-runner')
    .collectRuntimeCombatTeacherGame(137087, 0, 1), /Way initialization value mismatch/);
  console.log('NEGATIVE_CONTROL: PASS real teacher rejects wrong initial distance');
} else {
  assert.equal(transform(source, 'A'), source);
  assert.notEqual(transform(source, 'B'), source);
  for (const arm of ['A', 'B', 'audit']) {
    new vm.Script(transform(source, arm));
    assert.throws(() => transform('', arm), /unique Way initialization/);
    assert.throws(() => transform(source + source, arm), /unique Way initialization/);
  }
  let checks = 0;
  const context = vm.createContext({grid: {newLogicText() {}},
    __task102WayFillChecked() { checks++; }});
  new vm.Script(transform(source, 'audit') + '\nglobalThis.way = new Way();').runInContext(context);
  const shapes = [[1], [3, 3], [1, 4, 2]];
  for (const shape of shapes) {
    const arr = shape.map(length => new Array(length));
    for (const moves of [0, 1, 5, Infinity]) {
      context.way.initialization({x: 0, y: 0}, moves, arr);
      context.way.initialization({x: shape.length - 1, y: shape.at(-1) - 1}, moves, arr);
    }
  }
  assert.equal(checks, 24);
  console.log('WAY_FILL_CONTROLS: PASS 24 real initialization value/ownership checks, rectangular/ragged/resized arrays and origins');
  const observer = install('A');
  const before = observer.counts.forwards;
  new vm.Script('globalThis.answer = 42', {filename: 'control.js'}).runInContext(context);
  assert.equal(context.answer, 42);
  assert.equal(observer.counts.forwards, before + 1);
  observer.restore();
  const child = spawnSync(process.execPath, [__filename, 'negative'], {encoding: 'utf8'});
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.equal(child.status, 0);
}
