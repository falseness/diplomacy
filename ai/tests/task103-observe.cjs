// Observe real exported games without changing options, players, or outcomes.
const fs = require('fs');
const Module = require('module');
const originalLoad = Module._load;
const observed = new WeakSet();
let sequence = 0;
function record(event) {
  fs.appendFileSync(process.env.TASK103_OUTCOMES, JSON.stringify(event) + '\n');
}
Module._load = function(...args) {
  const exports = originalLoad.apply(this, args);
  if (typeof args[0] === 'string' && args[0].endsWith('benchmarkHarness') &&
      exports.runGame && !observed.has(exports)) {
    observed.add(exports);
    const runGame = exports.runGame;
    exports.runGame = function(options) {
      const id = ++sequence;
      const scenario = {};
      for (const key of ['mapName', 'playerA', 'playerB', 'seed', 'roundLimit',
        'actionLimit', 'commandLimit', 'inferenceSource', 'gameMap']) {
        if (options[key] !== undefined) scenario[key] = options[key];
      }
      record({ event: 'start', id, scenario });
      try {
        const game = runGame.apply(this, arguments);
        record({ event: 'result', id, game });
        return game;
      } catch (error) {
        record({ event: 'crash', id, error: String(error.stack || error) });
        throw error;
      }
    };
  }
  return exports;
};
