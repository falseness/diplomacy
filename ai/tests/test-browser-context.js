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
