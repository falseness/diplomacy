const assert = require('assert');
const {
  getBrowserScriptCacheStats,
  resetBrowserScriptCache,
  runGame
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

resetBrowserScriptCache();
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
for (const source of afterTen.sources) {
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
}

console.log('Browser script cache smoke passed');
