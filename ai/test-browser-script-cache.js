const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const actualScript = vm.Script;
const actualRead = fs.readFileSync;
const actualCreateContext = vm.createContext;
const compiled = new Map();
const reads = new Map();
const contexts = new Set();
vm.Script = class ObservedScript extends actualScript {
  constructor(source, options) {
    super(source, options);
    const filename = options && options.filename;
    compiled.set(filename, (compiled.get(filename) || 0) + 1);
  }
};
fs.readFileSync = function(filename, ...args) {
  const normalized = path.relative(path.resolve(__dirname, '..'), String(filename));
  reads.set(normalized, (reads.get(normalized) || 0) + 1);
  return actualRead.call(this, filename, ...args);
};
vm.createContext = function(...args) {
  const context = actualCreateContext.apply(this, args);
  assert(!contexts.has(context), 'game reused mutable VM context');
  contexts.add(context);
  return context;
};
const {
  getBrowserScriptCacheStats,
  resetBrowserScriptCache,
  runGame: runRuntimeGame
} = require('./benchmarkHarness');

function coreResult(game) {
  return {
    winnerSide: game.winnerSide,
    winner: game.winner,
    roundCount: game.roundCount,
    inferenceCalls: game.inference.calls,
    inferencePositions: game.inference.positions
  };
}

async function main() {
  const {loadCheckpoint, createPredictor} = require('./benchmark-gamestart-trained-model');
  const checkpoint = await loadCheckpoint(
    process.env.TASK102_CHECKPOINT ||
      '/mnt/storage/diplomacy/task036-incremental-long/final/task036-long');
  const predictFunction = createPredictor(checkpoint.model, {
    calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0
  });
  console.log('CHECKPOINT: ' + JSON.stringify(checkpoint.report));
  function runGame(options) {
    return runRuntimeGame(Object.assign({predictFunction,
      modelIdentifier: checkpoint.model, inferenceSource: 'TASK-102 checkpoint'}, options));
  }
  try {
const setupContextCount = contexts.size;
for (let index = 0; index < 10; index += 1) {
  runGame({
    mapName: 'tiny-duel',
    playerA: 'AIPlayer',
    playerB: 'SimpleAiPlayer',
    seed: 10200 + index,
    roundLimit: 10,
    actionLimit: 3,
    commandLimit: 60
  });
}

const afterTen = getBrowserScriptCacheStats();
assert(afterTen.sources.length > 50, 'expected browser scripts from index.html');
assert.strictEqual(contexts.size - setupContextCount, 10, 'expected one fresh context per game');
for (const source of afterTen.sources) {
  assert.strictEqual(compiled.get(source), 1, `constructor spy: ${source}`);
  assert.strictEqual(reads.get(source), 1, `disk read spy: ${source}`);
  console.log(`SCRIPT_ONCE: ${source} vm.Script=1 diskReads=1`);
  assert.strictEqual(
    afterTen.compileCounts[source],
    1,
    `${source} was not compiled exactly once`
  );
  assert.strictEqual(
    afterTen.readCounts[source],
    1,
    `${source} was not read exactly once`
  );
}

const beforeExtra = new Map(compiled);
runGame({
  mapName: 'tiny-duel',
  playerA: 'AIPlayer',
  playerB: 'SimpleAiPlayer',
  seed: 10300,
  roundLimit: 10,
  actionLimit: 3,
  commandLimit: 60
});
assert.deepStrictEqual(
  getBrowserScriptCacheStats().compileCounts,
  afterTen.compileCounts,
  'cached run compiled a browser script after warmup'
);

for (const source of afterTen.sources) {
  assert.strictEqual(compiled.get(source), beforeExtra.get(source));
}
console.log('CACHE_SPY: PASS 10 games; zero new browser compilations after first game');
assert.strictEqual(contexts.size - setupContextCount, 11);
console.log('FRESH_CONTEXTS: PASS 11 distinct game contexts');
vm.Script = actualScript;
fs.readFileSync = actualRead;
vm.createContext = actualCreateContext;
resetBrowserScriptCache();
for (let index = 0; index < 20; index += 1) {
  const options = {
    mapName: 'tiny-duel',
    playerA: 'AIPlayer',
    playerB: 'SimpleAiPlayer',
    seed: 10400 + index,
    roundLimit: 30,
    actionLimit: 3,
    commandLimit: 60
  };
  const cached = coreResult(runGame(options));
  const noCache = coreResult(runGame(Object.assign({}, options, {
    disableBrowserScriptCache: true
  })));
  assert.deepStrictEqual(
    cached,
    noCache,
    `cached and no-cache result differed for seed ${options.seed}`
  );
  console.log('DETERMINISM_PAIR: ' + JSON.stringify({seed: options.seed, cached, noCache}));
}

console.log('DETERMINISM: PASS 20 cached/no-cache pairs including winner and inference counts');
console.log('Browser script cache smoke passed');

  } finally {
    checkpoint.model.dispose();
    vm.Script = actualScript;
    fs.readFileSync = actualRead;
    vm.createContext = actualCreateContext;
  }
}

main().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});
