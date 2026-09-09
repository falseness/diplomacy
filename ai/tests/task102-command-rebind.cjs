const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {spawnSync} = require('child_process');
const {transform, install} = require('../diagnostics/task102-command-rebind.cjs');
const source = fs.readFileSync(path.join(__dirname, '../players.js'), 'utf8');

if (process.argv[2] === 'negative') {
  const OriginalScript = vm.Script;
  vm.Script = class BrokenRebindScript extends OriginalScript {
    constructor(text, options) {
      if (options?.filename === 'ai/players.js') {
        // Remove only the candidate's first assignment, retaining the old oracle.
        text = text.replace('aiCommandSourceUnits.set(command, restored)', 'void restored');
      }
      super(text, options);
    }
  };
  install('audit');
  assert.throws(() => require('../cloud-train-runner')
    .collectRuntimeCombatTeacherGame(137087, 0, 1), /undo command identity mismatch/);
  console.log('NEGATIVE_CONTROL: PASS real teacher rejects omitted command rebinding');
} else {
  assert.equal(transform(source, 'A'), source);
  assert.notEqual(transform(source, 'B'), source);
  for (const arm of ['A', 'B', 'audit']) {
    new vm.Script(transform(source, arm));
    assert.throws(() => transform('', arm), /unique undo rebind fragment/);
    assert.throws(() => transform(source + source, arm), /unique undo rebind fragment/);
  }
  assert.throws(() => transform(source, 'unknown'));
  const original = vm.Script;
  const observer = install('A');
  const context = vm.createContext({});
  new vm.Script('globalThis.answer = 42', {filename: 'control.js'}).runInContext(context);
  assert.equal(context.answer, 42);
  assert.equal(observer.counts.forwards, 1);
  assert.equal(observer.scripts[0].executions, 1);
  observer.restore();
  assert.equal(vm.Script, original);
  console.log('REBIND_CONTROLS: PASS identity, unique replacement, syntax, forwarding and restoration');
  const child = spawnSync(process.execPath, [__filename, 'negative'], {encoding: 'utf8'});
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.equal(child.status, 0);
}
