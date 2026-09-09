// Explicit diagnostic only; production never installs this source transform.
const assert = require('assert');
const crypto = require('crypto');
const vm = require('vm');
const filename = 'sprites/entities/units/unit/interactionWithUnit.js';

function transform(source, arm) {
  assert(['A', 'B', 'audit'].includes(arm));
  assert.equal(source.split('    initialization(v0, moves, arr, bord, newBorder) {').length,
    2, 'unique Way initialization');
  const start = source.indexOf('    initialization(v0, moves, arr, bord, newBorder) {');
  const end = source.indexOf('    isCellImpassable(', start);
  assert(start >= 0 && end > start, 'Way initialization boundaries');
  const original = source.slice(start, end);
  let candidate = original;
  for (const [before, after] of [
    ['used[i] = new Array(arr[i].length)', 'used[i] = new Array(arr[i].length).fill(false)'],
    ['this.distance[i] = new Array(arr[i].length)', 'this.distance[i] = new Array(arr[i].length).fill(moves + 1)'],
    ['                used[i][j] = false\n', ''],
    ['                this.distance[i][j] = moves + 1\n', '']
  ]) {
    assert.equal(candidate.split(before).length, 2, 'unique initialization expression');
    candidate = candidate.replace(before, after);
  }
  if (arm === 'A') return source;
  if (arm === 'B') return source.slice(0, start) + candidate + source.slice(end);
  const asFunction = method => method.trim().replace('initialization(', 'function(');
  return source + `\n;(() => {
    const reference = ${asFunction(original)};
    const candidate = ${asFunction(candidate)};
    Way.prototype.initialization = function(...args) {
      const previousDistance = this.distance, previousParent = this.parent;
      const expectedUsed = reference.apply(this, args);
      const expectedDistance = this.distance, expectedParent = this.parent;
      const actualUsed = candidate.apply(this, args);
      const expected = JSON.stringify([expectedUsed, expectedDistance, expectedParent]);
      const actual = JSON.stringify([actualUsed, this.distance, this.parent]);
      if (expected !== actual) throw Error('Way initialization value mismatch');
      if (this.distance === previousDistance || this.parent === previousParent)
        throw Error('Way initialization retained prior matrices');
      for (let x = 0; x < actualUsed.length; ++x) {
        if (actualUsed[x] === expectedUsed[x] || this.distance[x] === expectedDistance[x] ||
            this.parent[x] === expectedParent[x]) throw Error('Way initialization shared rows');
        for (let y = 0; y < actualUsed[x].length; ++y) {
          if (x === args[0].x && y === args[0].y) {
            if (this.parent[x][y] !== args[0]) throw Error('Way origin identity mismatch');
          } else if (this.parent[x][y] === expectedParent[x][y]) {
            throw Error('Way initialization shared parent coordinates');
          }
        }
      }
      __task102WayFillChecked(this.constructor.name);
      return actualUsed;
    };
  })();`;
}

function install(arm) {
  const OriginalScript = vm.Script;
  const scripts = [], records = new WeakMap();
  const counts = {replacements: 0, forwards: 0, checks: 0, classes: {}};
  vm.Script = class WayFillScript extends OriginalScript {
    constructor(source, options) {
      if (options?.filename === filename) {
        source = transform(source, arm);
        counts.replacements++;
      }
      super(source, options);
      const record = {filename: options?.filename || '<anonymous>',
        sha256: crypto.createHash('sha256').update(source).digest('hex'), executions: 0};
      scripts.push(record);
      records.set(this, record);
    }
    runInContext(context, options) {
      counts.forwards++;
      records.get(this).executions++;
      if (arm === 'audit') context.__task102WayFillChecked = name => {
        counts.checks++;
        counts.classes[name] = (counts.classes[name] || 0) + 1;
      };
      return super.runInContext(context, options);
    }
  };
  return {scripts, counts, restore() { vm.Script = OriginalScript; }};
}

module.exports = {filename, transform, install};
