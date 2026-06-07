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

const modelInputs = [];
let undoCount = 0;
let economyPrepared = false;

const producer = {
  name: 'town',
  coord: { x: 1, y: 1 },
  killed: false,
  isBadlyDamaged: false,
  isPreparingUnit: false,
  buildings: [],
  notEmpty() {
    return true;
  },
  prepare(product) {
    check(product === 'noob', 'unexpected economy product');
    economyPrepared = true;
    return true;
  }
};

const unit = {
  killed: false,
  moves: 1,
  coord: { x: 0, y: 0 },
  isMyTurn: true,
  getAvailableCommands() {
    return [{
      type: 'unit',
      whoDoCommandCoord: { x: 0, y: 0 },
      destinationCoord: { x: 0, y: 0 }
    }];
  },
  select() {},
  skipMoves() {
    this.moves = 0;
  }
};

const context = vm.createContext({
  console,
  Math,
  producer,
  unit,
  production: { noob: { cost: 20 } },
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
    vector[36] = economyPrepared ? 0.7 : 0.9;
    vector[49] = unit.moves;
    return [vector];
  },
  predict(model, inputs) {
    modelInputs.push(inputs);
    return inputs.map(input => {
      const vector = input[0];
      return [vector[36] === 0.7 ? 0.8 : 0.3];
    });
  },
  actionManager: {
    undo() {
      undoCount += 1;
      economyPrepared = false;
      unit.moves = 1;
    }
  },
  grid: {
    arr: [
      [{ unit, playerColor: 1 }]
    ],
    getCell() {
      return { unit };
    },
    getBuilding(coord) {
      check(coord.x === 1 && coord.y === 1, 'wrong producer coordinate');
      return producer;
    }
  }
});

new vm.Script(read('ai/players.js'), {
  filename: 'ai/players.js'
}).runInContext(context);
const gameMapSource = read('options/gamestart.js').split('\nmaps =')[0];
new vm.Script(gameMapSource, {
  filename: 'options/gamestart.js'
}).runInContext(context);

const result = new vm.Script(`
  let learned = new AIPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 40)
  learned.towns = [producer]
  learned.units = [unit]
  let baseline = new AIPlayer({ r: 98, g: 168, b: 222 }, 40)
  let economyCommands = learned.getEconomyCommands()
  let selected = learned.selectBestCommand()
  let gameMap = Object.create(GameMap.prototype)
  ;({
    inherited: learned instanceof AIPlayer,
    separateBaseline: baseline instanceof AIPlayer &&
      !(baseline instanceof AIPlayerWithEconomy),
    selectedType: selected[0].type,
    selectedProduct: selected[0].product,
    economyCommandCount: economyCommands.length,
    economyPlayerType: gameMap.getPlayerType({
      playerType: 'AIPlayerWithEconomy'
    }).name,
    baselinePlayerType: gameMap.getPlayerType({
      playerType: 'AIPlayer'
    }).name
  })
`, { filename: 'ai-player-economy-scenario.js' }).runInContext(context);

check(result.inherited, 'AIPlayerWithEconomy must inherit AIPlayer');
check(result.separateBaseline, 'AIPlayer must remain independently available');
check(result.economyCommandCount === 1, 'valid economy action was not enumerated');
check(result.selectedType === 'economy' && result.selectedProduct === 'noob',
  'model evaluation did not compare economy and combat actions');
check(result.economyPlayerType === 'AIPlayerWithEconomy',
  'AIPlayerWithEconomy is not independently selectable');
check(result.baselinePlayerType === 'AIPlayer',
  'AIPlayer selection was replaced');
check(undoCount === 2, 'simulated combat and economy actions were not both undone');
check(modelInputs.some(inputs => inputs[0][0].length === 78),
  'economy-aware 78-channel vectors were not evaluated');

console.log('AIPlayerWithEconomy smoke passed');
