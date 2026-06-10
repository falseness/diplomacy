const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const state = {
  gold: 200,
  unitMoves: 1,
  prepared: [],
  placed: []
};
const undoSnapshots = [];
const destinations = {
  suburb: [{ x: 2, y: 1 }],
  farm: [{ x: 1, y: 2 }],
  barrack: [{ x: 2, y: 2 }],
  wall: [{ x: 3, y: 1 }],
  bastion: [{ x: 3, y: 2 }],
  tower: [{ x: 3, y: 3 }]
};

function snapshot() {
  return JSON.stringify(state);
}

function saveUndo() {
  undoSnapshots.push(JSON.parse(snapshot()));
}

function restoreUndo() {
  const saved = undoSnapshots.pop();
  Object.assign(state, saved);
}

function makeProduction(isUnit) {
  class MockProduction {}
  MockProduction.isUnitProduction = () => isUnit;
  return MockProduction;
}

function makeProducer(name, x, y) {
  return {
    name,
    coord: { x, y },
    killed: false,
    isBadlyDamaged: false,
    isPreparingUnit: false,
    buildings: [],
    activeProduction: null,
    notEmpty() {
      return true;
    },
    needInstructions() {
      return false;
    },
    getAvailableProductionCells(product) {
      if (state.prepared.includes(`${name}:${product}`)) {
        return [];
      }
      return destinations[product] || [];
    },
    prepare(product) {
      const cost = production[product].cost;
      if (state.gold < cost) {
        return false;
      }
      saveUndo();
      state.gold -= cost;
      state.prepared.push(`${name}:${product}`);
      if (production[product].production.isUnitProduction()) {
        this.isPreparingUnit = true;
      } else {
        this.activeProduction = {
          canCreateOnCell(cell) {
            return (destinations[product] || []).some(coord =>
              coord.x === cell.coord.x && coord.y === cell.coord.y);
          }
        };
      }
      return true;
    },
    sendInstructions(cell) {
      state.placed.push(`${name}:${cell.coord.x},${cell.coord.y}`);
      this.activeProduction = null;
    },
    removeSelect() {
      this.activeProduction = null;
    }
  };
}

const production = {
  noob: { production: makeProduction(true), cost: 20 },
  suburb: { production: makeProduction(false), cost: 1 },
  farm: { production: makeProduction(false), cost: 32 },
  archer: { production: makeProduction(true), cost: 40 },
  KOHb: { production: makeProduction(true), cost: 40 },
  normchel: { production: makeProduction(true), cost: 40 },
  catapult: { production: makeProduction(true), cost: 60 },
  barrack: { production: makeProduction(false), cost: 25 },
  wall: { production: makeProduction(false), cost: 2 },
  bastion: { production: makeProduction(false), cost: 15 },
  tower: { production: makeProduction(false), cost: 30 },
  unaffordable: { production: makeProduction(true), cost: 999 }
};
const town = makeProducer('town', 1, 1);
const barrack = makeProducer('barrack', 1, 2);
town.buildings.push(barrack);
const unit = {
  killed: false,
  moves: 1,
  coord: { x: 0, y: 0 },
  isMyTurn: true,
  getAvailableCommands() {
    return [{
      type: 'unit',
      whoDoCommandCoord: { x: 0, y: 0 },
      destinationCoord: { x: 0, y: 1 }
    }];
  },
  select() {
    saveUndo();
  },
  sendInstructions() {
    state.unitMoves = 0;
    this.moves = 0;
  },
  skipMoves() {
    state.unitMoves = 0;
    this.moves = 0;
  }
};

const cells = new Map();
function getCell(coord) {
  const key = `${coord.x},${coord.y}`;
  if (!cells.has(key)) {
    cells.set(key, { coord: { x: coord.x, y: coord.y }, unit: null });
  }
  return cells.get(key);
}
getCell(unit.coord).unit = unit;

const context = vm.createContext({
  console,
  Math,
  state,
  snapshot,
  town,
  barrack,
  unit,
  production,
  ai_model: {},
  whooseTurn: 1,
  gameSettings: { testAI: false },
  Player: class Player {
    constructor(color, gold = 90) {
      this.color = color;
      this.gold = gold;
      this.towns = [];
      this.units = [];
    }
    nextTurn() {}
    updateUnits() {}
  },
  BestEnemyTargetForAI: class BestEnemyTargetForAI {},
  assert: check,
  areCoordsEqual(left, right) {
    return left.x === right.x && left.y === right.y;
  },
  vectoriseGrid() {
    const vector = Array(78).fill(0);
    vector[0] = state.gold / 1000;
    vector[1] = state.unitMoves;
    vector[2] = state.placed.length;
    return [vector];
  },
  predict(model, inputs) {
    return inputs.map(input => [input[0][2] * 10 +
      input[0][0] + (1 - input[0][1])]);
  },
  actionManager: {
    undo() {
      restoreUndo();
      unit.moves = state.unitMoves;
      town.activeProduction = null;
      barrack.activeProduction = null;
      town.isPreparingUnit = false;
      barrack.isPreparingUnit = false;
    }
  },
  grid: {
    arr: [[getCell(unit.coord)]],
    getCell,
    getBuilding(coord) {
      if (coord.x === town.coord.x && coord.y === town.coord.y) {
        return town;
      }
      return barrack;
    }
  }
});

new vm.Script(read('ai/players.js'), {
  filename: 'ai/players.js'
}).runInContext(context);

const result = new vm.Script(`
  let learned = new AIPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 200)
  learned.towns = [town]
  learned.units = [unit]
  let commands = learned.getActionCommands()
  let before = snapshot()
  let restored = commands.every(function(command) {
    if (!learned.applyActionCommand(command)) {
      return false
    }
    actionManager.undo()
    return snapshot() == before
  })
  let categories = Array.from(new Set(commands.map(function(command) {
    return command.type == 'economy' ? command.category : 'unit-command'
  })))
  let products = Array.from(new Set(commands.filter(function(command) {
    return command.type == 'economy'
  }).map(function(command) {
    return command.product
  })))
  learned.doActions()
  ;({
    inherited: learned instanceof AIPlayer,
    categories: categories,
    products: products,
    restored: restored,
    hasUnaffordable: products.includes('unaffordable'),
    finalPlaced: state.placed.length,
    finalGold: state.gold
  })
`, { filename: 'ai-player-economy-scenario.js' }).runInContext(context);

check(result.inherited, 'AIPlayerWithEconomy must inherit AIPlayer');
check(result.categories.includes('unit-command'),
  'legal unit movement/attack command was not enumerated');
check(result.categories.includes('unit-training'),
  'town or barrack unit production was not enumerated');
check(result.categories.includes('suburb-expansion'),
  'suburb expansion was not enumerated');
check(result.categories.includes('building-placement'),
  'building placement was not enumerated');
for (const product of ['noob', 'archer', 'suburb', 'farm', 'barrack']) {
  check(result.products.includes(product), `${product} action was not enumerated`);
}
check(!result.hasUnaffordable, 'unaffordable action was enumerated');
check(result.restored, 'apply/undo did not restore an action snapshot');
check(result.finalGold < 200,
  'full AIPlayerWithEconomy turn did not execute a legal economy action');

console.log('AIPlayerWithEconomy action search smoke passed');
