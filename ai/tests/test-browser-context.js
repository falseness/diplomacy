const assert = require('assert');
const vm = require('vm');
const { createBrowserContext } = require('../browserScriptCache');

const first = createBrowserContext({ state: { turns: 0 } });
const second = createBrowserContext({ state: { turns: 0 } });
assert.notStrictEqual(first, second);
const initialize = new vm.Script(`
  var history = [];
  let lexicalHistory = [];
  function advance() {
    state.turns++;
    history.push(state.turns);
    lexicalHistory.push(state.turns);
  }
`);
initialize.runInContext(first);
initialize.runInContext(second);
new vm.Script('advance(); advance();').runInContext(first);
assert.strictEqual(first.state.turns, 2);
assert.strictEqual(second.state.turns, 0);
const snapshot = new vm.Script('JSON.stringify([history, lexicalHistory])');
assert.strictEqual(snapshot.runInContext(first), '[[1,2],[1,2]]');
assert.strictEqual(snapshot.runInContext(second), '[[],[]]');
const aliases = new vm.Script(`
  window === globalThis && globalThis === this &&
  Infinity === 1 / 0 && Number.isNaN(NaN)
`);
assert.strictEqual(aliases.runInContext(first), true);
assert.strictEqual(aliases.runInContext(second), true);
console.log('BROWSER_CONTEXT_ISOLATION: PASS shared compiled code, separate global and lexical state');
console.log('BROWSER_CONTEXT_GLOBALS: PASS window/globalThis aliases and native constants');
console.log('BROWSER_CONTEXT_MODE: ' +
  (vm.constants && vm.constants.DONT_CONTEXTIFY ? 'direct global' : 'contextified fallback'));

const hostRandom = Math.random;
const seeded = createBrowserContext({}, () => 0.25);
const otherSeeded = createBrowserContext({}, () => 0.75);
const inspectIntrinsics = new vm.Script(`({
  array: Array, object: Object, math: Math, random: Math.random(),
  nativeArray: Object.getPrototypeOf([]) === Array.prototype,
  nativeObject: Object.getPrototypeOf({}) === Object.prototype,
  temporaryRemoved: !('__browserRandom' in globalThis)
})`);
const seededState = inspectIntrinsics.runInContext(seeded);
const otherState = inspectIntrinsics.runInContext(otherSeeded);
assert.notStrictEqual(seededState.array, Array);
assert.notStrictEqual(seededState.object, Object);
assert.notStrictEqual(seededState.math, Math);
assert.notStrictEqual(seededState.array, otherState.array);
assert.strictEqual(seededState.random, 0.25);
assert.strictEqual(otherState.random, 0.75);
assert(seededState.nativeArray && seededState.nativeObject && seededState.temporaryRemoved);
assert.strictEqual(Math.random, hostRandom);
new vm.Script('Array.prototype.gameMarker = true; Math.gameMarker = true;').runInContext(seeded);
assert.strictEqual(new vm.Script('Array.prototype.gameMarker || Math.gameMarker').runInContext(otherSeeded), undefined);
assert.strictEqual(Array.prototype.gameMarker, undefined);
assert.strictEqual(Math.gameMarker, undefined);
console.log('BROWSER_CONTEXT_INTRINSICS: PASS realm-local builtins, seeded random and prototype isolation');
