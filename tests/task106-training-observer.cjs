// Read-only instrumentation for real training. It preserves arguments, return
// values, exceptions, model fitting options, and every attempted game outcome.
const fs = require('fs');
const Module = require('module');
const { threadId } = require('worker_threads');
const originalLoad = Module._load;
const observed = new WeakSet();
let sequence = 0;

function record(event) {
  fs.appendFileSync(process.env.TASK106_TRAINING_EVENTS, JSON.stringify({
    ...event, pid: process.pid, threadId, monotonicNs: process.hrtime.bigint().toString()
  }) + '\n');
}

function observeGames(exports) {
  const runGame = exports.runGame;
  exports.runGame = function(options) {
    const id = `${threadId}:game:${++sequence}`;
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

function observeFits(exports) {
  const fit = exports.LayersModel.prototype.fit;
  exports.LayersModel.prototype.fit = async function(inputs, targets, options) {
    const id = `${threadId}:fit:${++sequence}`;
    const shapes = (Array.isArray(inputs) ? inputs : [inputs])
      .map(input => input.shape);
    record({ event: 'fit-start', id, shapes, options });
    try {
      const result = await fit.apply(this, arguments);
      record({ event: 'fit-result', id, epochs: result.epoch.length });
      return result;
    } catch (error) {
      record({ event: 'fit-crash', id, error: String(error.stack || error) });
      throw error;
    }
  };
}

Module._load = function(request, ...args) {
  const exports = originalLoad.call(this, request, ...args);
  if (request.endsWith('benchmarkHarness') && !observed.has(exports)) {
    observed.add(exports);
    observeGames(exports);
  }
  if (request === '@tensorflow/tfjs-node' && !observed.has(exports)) {
    observed.add(exports);
    observeFits(exports);
  }
  return exports;
};
