const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function compileScript(relativePath) {
  return new vm.Script(readRepoFile(relativePath), { filename: relativePath });
}

function loadScript(relativePath, context) {
  compileScript(relativePath).runInContext(context);
}

function createSmokeContext() {
  return vm.createContext({
    console,
    Math,
    Map: class SmokeMap {},
    Noob: class Noob {},
    Archer: class Archer {},
    KOHb: class KOHb {},
    Normchel: class Normchel {},
    gameSettings: { testAI: false },
    assert(condition) {
      if (!condition) {
        throw new Error('assertion failed');
      }
    }
  });
}

function loadAiScripts() {
  const context = createSmokeContext();
  const scripts = [
    'ai/generateMap.js',
    'ai/vectorizeContent.js',
    'ai/model.js'
  ];
  const browserOnlyScripts = [
    'ai/players.js',
    'ai/gameManagerTraining.js',
    'ai/runtimeIntegration.js'
  ];

  for (const script of scripts) {
    loadScript(script, context);
  }
  compileBrowserScripts(browserOnlyScripts);

  return { context, scripts: scripts.concat(browserOnlyScripts) };
}

function compileBrowserScripts(scriptPaths) {
  for (const scriptPath of scriptPaths) {
    compileScript(scriptPath);
  }
}

module.exports = {
  compileBrowserScripts,
  loadAiScripts,
  readRepoFile
};
