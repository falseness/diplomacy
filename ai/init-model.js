const { loadAiScripts } = require('./smokeHarness');
const fs = require('fs');
const path = require('path');
const {
  ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
  createAlphaZeroLiteCombatModel,
  saveAlphaZeroLiteCombatModel,
  loadAlphaZeroLiteCombatModel
} = require('./alphazero-lite-combat');

const { context, scripts } = loadAiScripts();

const modelApi = new Function(
  'context',
  'return context.createAlphaZeroModel && context.trainModel && context.doTrainModel;'
)(context);

if (!modelApi) {
  throw new Error('AI model API did not load');
}

function removeDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }
  if (fs.rmSync) {
    fs.rmSync(directory, { recursive: true, force: true });
  } else {
    fs.rmdirSync(directory, { recursive: true });
  }
}

async function main() {
  const checkpointDir = path.join(
    '/mnt/storage/diplomacy',
    `init-model-alphazero-lite-${process.pid}`
  );
  removeDirectory(checkpointDir);
  try {
    const { model, metadata } = createAlphaZeroLiteCombatModel({
      boardHeight: 3,
      boardWidth: 3,
      channels: 21,
      actionSpaceSize: 8,
      filters: 8,
      residualBlocks: 1
    });
    await saveAlphaZeroLiteCombatModel(model, checkpointDir, metadata);
    model.dispose();
    const loaded = await loadAlphaZeroLiteCombatModel(checkpointDir);
    try {
      if (loaded.metadata.architectureVersion !==
          ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION) {
        throw new Error('AlphaZero-lite model metadata version did not round-trip');
      }
      if (loaded.model.outputs.length !== 2 ||
          loaded.model.outputs[0].shape[1] !== 8 ||
          loaded.model.outputs[1].shape[1] !== 1) {
        throw new Error('AlphaZero-lite model output signature is incompatible');
      }
    } finally {
      loaded.model.dispose();
    }
  } finally {
    removeDirectory(checkpointDir);
  }
  console.log(`AI init smoke loaded ${scripts.length} AI scripts and verified AlphaZero-lite checkpoint loading`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
