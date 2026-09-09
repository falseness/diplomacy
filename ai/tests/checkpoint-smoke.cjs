const assert = require('assert');
const { runGame } = require('../benchmarkHarness');

// Callers supply a frozen trained checkpoint with the exact runtime board shape.
// Keep limits, maps, classes and result accounting in the existing caller/harness.
async function runCheckpointSmoke(options, checkpointPath) {
  assert(checkpointPath, 'AI_MAP_SMOKE_CHECKPOINT must name a native trained checkpoint');
  const { loadCheckpoint, createPredictor } = require('../benchmark-trained-model');
  const checkpoint = await loadCheckpoint(checkpointPath);
  try {
    const predict = createPredictor(checkpoint.model, checkpoint.inference);
    console.log('MAP_CHECKPOINT: ' + JSON.stringify(checkpoint.report));
    const result = runGame({
      ...options,
      checkpointIdentifier: checkpointPath,
      predictFunction: (_model, vectors) => predict(checkpoint.model, vectors)
    });
    console.log('MAP_OUTCOME: ' + JSON.stringify(result));
    console.log('MAP_INFERENCE: ' + JSON.stringify(checkpoint.inference));
    assert(checkpoint.inference.calls > 0 && checkpoint.inference.positions > 0,
      'checkpoint did not score any runtime candidates');
    return result;
  } finally {
    checkpoint.model.dispose();
  }
}

module.exports = { runCheckpointSmoke };
