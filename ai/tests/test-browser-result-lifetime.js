const assert = require('assert');
const vm = require('vm');
const { detachBrowserResult } = require('../browserScriptCache');

function assertHostData(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.getPrototypeOf(value),
    Array.isArray(value) ? Array.prototype : Object.prototype,
    'returned data retains a foreign VM prototype');
  for (const child of Object.values(value)) assertHostData(child, seen);
}

async function main() {
  assert.strictEqual(typeof global.gc, 'function', 'run with --expose-gc');
  const contexts = [];
  const createContext = vm.createContext;
  vm.createContext = function(...args) {
    const context = createContext.apply(this, args);
    contexts.push(new WeakRef(context));
    return context;
  };
  const foreign = new vm.Script(`(() => {
    const shared = {values: [undefined, NaN, Infinity, -Infinity, -0]};
    return {first: shared, second: shared};
  })()`).runInNewContext();
  assert.throws(() => assertHostData(foreign), { code: 'ERR_ASSERTION' });
  const copy = detachBrowserResult(foreign);
  assertHostData(copy);
  assert.strictEqual(copy.first, copy.second);
  assert.strictEqual(copy.first.values[0], undefined);
  assert(Number.isNaN(copy.first.values[1]));
  assert.strictEqual(copy.first.values[2], Infinity);
  assert.strictEqual(copy.first.values[3], -Infinity);
  assert(Object.is(copy.first.values[4], -0));
  console.log('TRANSFER_VALUES: PASS aliases, undefined, NaN, infinities and negative zero');
  console.log('FOREIGN_PROTOTYPE_CONTROL: PASS rejects undetached VM result');

  const { runGame } = require('../benchmarkHarness');
  const { createTrainingBatch } = require('../economy-training');
  const retained = [];
  const Script = vm.Script;
  let trainingCompilations = 0;
  vm.Script = class extends Script {
    constructor(source, options) {
      super(source, options);
      if (options && options.filename === 'economy-training-self-play.js') {
        trainingCompilations++;
      }
    }
  };
  const firstGameContext = contexts.length;
  for (const seed of [10200, 10201]) {
    retained.push(runGame({mapName: 'tiny-duel', playerA: 'SimpleAiPlayer',
      playerB: 'SimpleAiPlayer', seed, roundLimit: 1, actionLimit: 3, commandLimit: 60}));
    retained.push(createTrainingBatch(seed, [2]));
  }
  vm.Script = Script;
  vm.createContext = createContext;
  retained.forEach(value => assertHostData(value));
  assert.strictEqual(trainingCompilations, 1);
  console.log('TRAINING_DRIVER_CACHE: PASS two games, one compilation');
  console.log('HOST_RESULTS: PASS two benchmark results and two full economy batches');
  const gameContexts = contexts.slice(firstGameContext);
  assert.strictEqual(gameContexts.length, 4);
  let alive;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    alive = gameContexts.filter(ref => ref.deref()).length;
    if (!alive) break;
  }
  assert.strictEqual(alive, 0, 'retained results keep game contexts alive');
  assert.strictEqual(retained.length, 4);
  retained.forEach(value => assertHostData(value));
  console.log('GAME_CONTEXT_COLLECTION: PASS four contexts collected with all results retained');
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
