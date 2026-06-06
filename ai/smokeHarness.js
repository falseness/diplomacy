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
  class SmokeGameMap {
    constructor(mapSize, players, goldmines, lakes, mountains, bushes, hills) {
      this.mapSize = mapSize;
      this.players = players;
      this.goldmines = goldmines;
      this.lakes = lakes;
      this.mountains = mountains;
      this.bushes = bushes || [];
      this.hills = hills || [];
    }

    start() {
      const neighbours = [
        {x: -1, y: 0},
        {x: 1, y: 0},
        {x: 0, y: -1},
        {x: 0, y: 1},
        {x: -1, y: 1},
        {x: 1, y: -1}
      ];

      this.runtime = {
        turn: 0,
        players: this.players.map((player, playerIndex) => {
          const units = (player.units || []).map(unit => ({
            x: unit.x,
            y: unit.y,
            source: 'configured'
          }));
          const towns = player.towns.map(town => {
            const suburbs = [{x: town.x, y: town.y}];
            if (playerIndex > 0) {
              for (const offset of neighbours) {
                suburbs.push({x: town.x + offset.x, y: town.y + offset.y});
              }
              units.push({x: town.x, y: town.y, source: 'first-town-unit'});
            }
            return {coord: town, suburbs};
          });
          return {towns, units};
        })
      };
      return this.runtime;
    }

    advanceTurns(turns) {
      if (!this.runtime) {
        throw new Error('map must be started before advancing turns');
      }
      this.runtime.turn += turns;
      return this.runtime;
    }
  }

  return vm.createContext({
    console,
    Math,
    GameMap: SmokeGameMap,
    Map: SmokeGameMap,
    Noob: class Noob {},
    Archer: class Archer {},
    KOHb: class KOHb {},
    Normchel: class Normchel {},
    Catapult: class Catapult {},
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
