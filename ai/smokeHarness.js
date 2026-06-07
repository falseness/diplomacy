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

    completeFarm(playerIndex) {
      return {
        name: 'farm',
        hp: 1,
        maxHP: 1,
        income: 4,
        playerColor: playerIndex,
        isEmpty() { return false; },
        isTown() { return false; },
        isBuildingProduction() { return false; }
      };
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

      const cells = {};
      function emptyUnit() {
        return { isEmpty() { return true; }, isMyTurn: false };
      }
      function completeBarrack(playerIndex, configured) {
        return {
          name: 'barrack',
          hp: 1,
          maxHP: 1,
          income: -2,
          playerColor: playerIndex,
          isPreparingUnit: false,
          unitProduction: { turns: 0 },
          isEmpty() { return false; },
          isTown() { return false; },
          isBuildingProduction() { return false; }
        };
      }
      function pendingBarrack(playerIndex, configured) {
        return {
          name: 'barrack',
          turns: configured.turns,
          playerColor: playerIndex,
          isEmpty() { return false; },
          isTown() { return false; },
          isBuildingProduction() { return true; }
        };
      }
      function pendingFarm(playerIndex, configured) {
        return {
          name: 'farm',
          turns: configured.turns,
          playerColor: playerIndex,
          isEmpty() { return false; },
          isTown() { return false; },
          isBuildingProduction() { return true; }
        };
      }
      function completeExternal(name, playerIndex) {
        return {
          name,
          hp: 5,
          maxHP: 5,
          playerColor: playerIndex,
          rangeIncrease: name === 'tower' ? 1 : 0,
          isEmpty() { return false; },
          isTown() { return false; },
          isBuildingProduction() { return false; },
          isObstacle(color) { return name === 'wall' && color === playerIndex; },
          isBarrier() { return true; }
        };
      }
      function setCell(configured, playerIndex, building) {
        cells[configured.x + ':' + configured.y] = {
          coord: {x: configured.x, y: configured.y},
          playerColor: playerIndex,
          building,
          unit: emptyUnit()
        };
      }
      function completeGoldmine(configured) {
        return {
          name: 'goldmine',
          potentialIncome: configured.income,
          get income() {
            return this.runtimeTurn() >= 20 ? configured.income : 0;
          },
          runtimeTurn() { return 0; },
          isEmpty() { return false; },
          isTown() { return false; }
        };
      }

      this.runtime = {
        turn: 0,
        cells,
        players: this.players.map((player, playerIndex) => {
          const units = (player.units || []).map(unit => ({
            type: unit.type,
            name: unit.type.name,
            x: unit.x,
            y: unit.y,
            coord: {x: unit.x, y: unit.y},
            moves: 1,
            source: 'configured',
            getAvailableCommands() {
              return [{
                type: 'unit',
                whoDoCommandCoord: this.coord,
                destinationCoord: this.coord
              }];
            }
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
          const barracks = (player.barracks || []).map(configured => {
            const building = completeBarrack(playerIndex, configured);
            setCell(configured, playerIndex, building);
            return {configured, building};
          });
          const pendingBarracks = (player.pendingBarracks || []).map(configured => {
            const building = pendingBarrack(playerIndex, configured);
            setCell(configured, playerIndex, building);
            return {configured, building};
          });
          const farms = (player.farms || []).map(configured => {
            const building = this.completeFarm(playerIndex);
            setCell(configured, playerIndex, building);
            return {configured, building};
          });
          const pendingFarms = (player.pendingFarms || []).map(configured => {
            const building = pendingFarm(playerIndex, configured);
            setCell(configured, playerIndex, building);
            return {configured, building};
          });
          const externalBuildings = {};
          for (const property of ['walls', 'bastions', 'towers']) {
            const name = property.slice(0, -1);
            externalBuildings[property] = (player[property] || []).map(configured => {
              const building = completeExternal(name, playerIndex);
              setCell(configured, playerIndex, building);
              return {configured, building};
            });
          }
          return {
            gold: player.gold === undefined ? (playerIndex === 0 ? 0 : 90) : player.gold,
            towns,
            units,
            barracks,
            pendingBarracks,
            farms,
            pendingFarms,
            walls: externalBuildings.walls,
            bastions: externalBuildings.bastions,
            towers: externalBuildings.towers,
            get income() {
              const mineIncome = this.goldmines.reduce(
                (total, mine) => total + mine.building.income, 0);
              return 10 + this.farms.length * 4 + mineIncome;
            }
          };
        })
      };
      for (const configured of this.goldmines) {
        const owner = configured.owner === undefined ? 0 : configured.owner;
        const building = completeGoldmine(configured);
        building.runtimeTurn = () => this.runtime.turn;
        const mine = {configured, building};
        this.runtime.players[owner].goldmines =
          this.runtime.players[owner].goldmines || [];
        this.runtime.players[owner].goldmines.push(mine);
        setCell(configured, owner, building);
      }
      for (const player of this.runtime.players) {
        player.goldmines = player.goldmines || [];
      }
      return this.runtime;
    }

    advanceTurns(turns) {
      if (!this.runtime) {
        throw new Error('map must be started before advancing turns');
      }
      for (let turn = 0; turn < turns; ++turn) {
        for (const player of this.runtime.players) {
          player.gold += player.income;
          for (let i = 0; i < player.pendingBarracks.length; ++i) {
            const pending = player.pendingBarracks[i];
            pending.building.turns -= 1;
            if (pending.building.turns > 0) {
              continue;
            }
            const building = {
              name: 'barrack',
              hp: 1,
              maxHP: 1,
              income: -2,
              playerColor: pending.building.playerColor,
              isPreparingUnit: false,
              unitProduction: { turns: 0 },
              isEmpty() { return false; },
              isTown() { return false; },
              isBuildingProduction() { return false; }
            };
            player.barracks.push({configured: pending.configured, building});
            this.runtime.cells[pending.configured.x + ':' + pending.configured.y].building = building;
            player.pendingBarracks.splice(i--, 1);
          }
          for (let i = 0; i < player.pendingFarms.length; ++i) {
            const pending = player.pendingFarms[i];
            pending.building.turns -= 1;
            if (pending.building.turns > 0) {
              continue;
            }
            const building = this.completeFarm(pending.building.playerColor);
            player.farms.push({configured: pending.configured, building});
            this.runtime.cells[pending.configured.x + ':' + pending.configured.y].building = building;
            player.pendingFarms.splice(i--, 1);
          }
        }
        this.runtime.turn += 1;
      }
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
