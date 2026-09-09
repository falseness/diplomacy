const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {execFileSync} = require('child_process');
const predecessor = '9ed13d0';
const original = execFileSync('git', ['show', `${predecessor}:sprites/border.js`], {encoding: 'utf8'});
const candidate = fs.readFileSync(path.resolve(__dirname, '../../sprites/border.js'), 'utf8');
function load(source) {
  const context = vm.createContext({basis: {r: 1}});
  new vm.Script(source + '\nglobalThis.border = new Border();').runInContext(context);
  return context;
}
function compare(before, after) {
  assert.equal(after.lines.length, before.lines.length);
  for (let i = 0; i < before.lines.length; i++) {
    for (const endpoint of ['begin', 'end']) {
      for (const axis of ['x', 'y']) {
        assert(Object.is(after.lines[i][endpoint][axis], before.lines[i][endpoint][axis]),
          `border coordinate mismatch ${i}.${endpoint}.${axis}`);
      }
    }
  }
}
const before = load(original), after = load(candidate);
let cases = 0;
for (const radius of [0, -0, 1, -1, 0.1, 19.37, 1e-300, 1e300, Infinity, -Infinity, NaN]) {
  before.basis.r = after.basis.r = radius;
  for (const pos of [{x: 0, y: -0}, {x: 1.2, y: -3.4}, {x: -12345, y: 12345}]) {
    for (const side of [0, 1, 2, 3, 4, 5, '0', '1', '2', '3', '4', '5']) {
      before.border.createLine(pos, side);
      after.border.createLine(pos, side);
      compare(before.border, after.border);
      cases++;
    }
  }
}
const oldLines = after.border.lines;
assert.equal(new Set(oldLines).size, cases);
assert.equal(new Set(oldLines.flatMap(line => [line.begin, line.end])).size, cases * 2);
after.border.clean();
assert.equal(after.border.lines.length, 0);
assert.equal(oldLines.length, cases);
assert.notStrictEqual(after.border.lines, oldLines);
for (const context of [before, after]) {
  context.basis.r = 15;
  context.border.newBrokenLine('red', 2, 'blue', 1);
  for (let side = 0; side < 6; side++) context.border.createLine({x: 10, y: 20}, side);
}
function drawTrace(border) {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, name) => (...args) => calls.push([name, ...args]),
    set: (_, name, value) => { calls.push(['set', name, value]); return true; }
  });
  border.draw(ctx);
  return calls;
}
assert.deepStrictEqual(drawTrace(after.border), drawTrace(before.border));
after.border.visible = before.border.visible = false;
assert.deepStrictEqual(drawTrace(after.border), []);
for (const side of [-1, 6, '00', null, undefined]) {
  assert.throws(() => after.border.createLine({x: 0, y: 0}, side), {name: 'TypeError'});
}
const faulty = load(candidate.replace('beginX + pos.x', 'beginX + pos.x + 1'));
faulty.basis.r = before.basis.r;
faulty.border.createLine({x: 10, y: 20}, 0);
assert.throws(() => compare({lines: [before.border.lines[0]]}, faulty.border), /border coordinate mismatch/);
console.log(`BORDER_ENDPOINTS: PASS ${cases} exact-coordinate cases including signed zero, live radius changes, independent endpoints, clean and draw callbacks`);
console.log('NEGATIVE_CONTROL: PASS changed real endpoint rejected');
