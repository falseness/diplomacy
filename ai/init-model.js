const { loadAiScripts } = require('./smokeHarness');

const { context, scripts } = loadAiScripts();

const modelApi = new Function(
  'context',
  'return context.createAlphaZeroModel && context.trainModel && context.doTrainModel;'
)(context);

if (!modelApi) {
  throw new Error('AI model API did not load');
}

console.log(`AI init smoke loaded ${scripts.length} AI scripts`);
