const vm = require('vm');
const { readRepoFile } = require('./smokeHarness');

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runLoadModelSmoke(context) {
  return await new Function(
    'context',
    `return context.loadModel().then(function(model) {
      return {
        model: model,
        source: context.__loadedModelSource,
        playerType: context.GameMap.prototype.getPlayerType({
          playerType: 'AIPlayerWithEconomy'
        }).name
      };
    });`
  )(context);
}

function createBrowserLikeContext(aiModelUrl) {
  const context = vm.createContext({
    console,
    URLSearchParams,
    CELL_VECTOR_SIZE: 78,
    gameSettings: {
      aiModelUrl: aiModelUrl,
      testAI: false
    },
    window: {
      location: { search: '' }
    },
    Player: class Player {},
    NeutralPlayer: class NeutralPlayer {},
    SimpleAiPlayer: class SimpleAiPlayer {},
    SimpleAiPlayerWithEconomy: class SimpleAiPlayerWithEconomy {},
    AIPlayer: class AIPlayer {},
    AIPlayerWithEconomy: class AIPlayerWithEconomy {},
    tf: {
      loadLayersModel(source) {
        context.__loadedModelSource = source;
        return Promise.resolve({
          inputs: [{ shape: [null, null, null, 78] }]
        });
      }
    }
  });
  vm.runInContext(readRepoFile('ai/model.js'), context, {
    filename: 'ai/model.js'
  });
  const gamestartSource = readRepoFile('options/gamestart.js')
    .split('function packMap')[0];
  vm.runInContext(gamestartSource + '\nthis.GameMap = GameMap;', context, {
    filename: 'options/gamestart.js'
  });
  return context;
}

async function checkStartupReadiness() {
  const assert = require('assert').strict;
  for (const method of ['startAI', 'playAndTrain']) {
    let resolveLoad, rejectLoad;
    const calls = [];
    const context = vm.createContext({
      console, gameSettings: {},
      GameManager: {initValues() {calls.push('init');}},
      loadModel: () => new Promise((resolve, reject) => {resolveLoad=resolve; rejectLoad=reject;}),
      generateBrowserPlayAiCombatMap: () => ({start() {calls.push('map');}}),
      startTurn: () => calls.push('turn'),
      gameLoop() {}, requestAnimationFrame: () => calls.push('frame')
    });
    vm.runInContext(readRepoFile('ai/gameManagerTraining.js'), context);
    const failed = context.GameManager[method]();
    assert.deepEqual(calls, []);
    const failure = new Error('deliberate model load rejection');
    rejectLoad(failure);
    await assert.rejects(failed, error => error === failure);
    assert.deepEqual(calls, []);
    console.log('PASS ' + method + ' loading/failed expected starts=0 observed starts=' + calls.length);
    if (method === 'startAI') {
      const ready = context.GameManager.startAI();
      assert.deepEqual(calls, []);
      const model = {predict() {}};
      resolveLoad(model);
      await ready;
      assert.equal(context.ai_model, model);
      assert.deepEqual(calls, ['map','init','turn','frame']);
      console.log('PASS startAI ready expected=map,init,turn,frame observed=' + calls.join(','));
    }
  }
}

(async function main() {
  const configured = createBrowserLikeContext('models/economy/model.json');
  const configuredResult = await runLoadModelSmoke(configured);
  check(
    configuredResult.source == 'models/economy/model.json',
    'loadModel did not use gameSettings.aiModelUrl'
  );
  check(
    configuredResult.playerType == 'AIPlayerWithEconomy',
    'gamestart settings cannot select AIPlayerWithEconomy'
  );

  const fallback = createBrowserLikeContext(undefined);
  const fallbackResult = await runLoadModelSmoke(fallback);
  check(
    fallbackResult.source == 'indexeddb://diplomacy_weights750',
    'loadModel did not preserve IndexedDB fallback'
  );

  const fileUrl = createBrowserLikeContext('file:///mnt/storage/diplomacy/model.json');
  let rejectedFileUrl = false;
  try {
    await runLoadModelSmoke(fileUrl);
  }
  catch (error) {
    rejectedFileUrl = error.message.indexOf('file://') != -1;
  }
  check(rejectedFileUrl, 'browser model loading accepted a file:// checkpoint');

  await checkStartupReadiness();
  console.log('Browser AI inference wiring smoke passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
