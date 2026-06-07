const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(label);
  }
}

const context = vm.createContext({
  console,
  Math,
  assert,
  production: {
    noob: { cost: 20 },
    suburb: { cost: 1 },
    farm: { cost: 32 },
    barrack: { cost: 25 },
    archer: { cost: 40 },
    KOHb: { cost: 40 },
    normchel: { cost: 40 },
    catapult: { cost: 60 }
  },
  Player: class Player {
    constructor(color, gold = 90) {
      this.color = color;
      this.gold = gold;
      this.towns = [];
      this.units = [];
    }
    get income() {
      return 7;
    }
    nextTurn() {
      this.gold += this.income;
    }
  },
  BestEnemyTargetForAI: class BestEnemyTargetForAI {
    GetCommandNearestToBestTarget(commands) {
      return commands[0] || null;
    }
  },
  gameSettings: { testAI: false },
  grid: {
    arr: [
      [
        { name: 'start', coord: { x: 0, y: 0 } },
        { name: 'move', coord: { x: 0, y: 1 } }
      ],
      [
        { name: 'attack', coord: { x: 1, y: 0 }, enemy: true },
        { name: 'economy', coord: { x: 1, y: 1 } }
      ]
    ],
    getCell(coord) {
      return this.arr[coord.x][coord.y];
    }
  }
});

new vm.Script(read('ai/players.js'), { filename: 'ai/players.js' }).runInContext(context);

const result = new vm.Script(`
  function unit(destination, attacks) {
    return {
      killed: false,
      moves: 1,
      coord: { x: 0, y: 0 },
      playerColor: 1,
      actions: [],
      getAvailableCommands: function() {
        return [{
          whoDoCommandCoord: { x: 0, y: 0 },
          destinationCoord: destination
        }]
      },
      getAvailableMoveCommands: function() {
        return this.getAvailableCommands()
      },
      canHitSomethingOnCell: function() {
        return attacks
      },
      sendInstructions: function(cell) {
        this.actions.push(cell.name)
        this.moves = 0
      }
    }
  }

  let farm = { name: 'farm', killed: false }
  let barrack = {
    name: 'barrack',
    killed: false,
    isPreparingUnit: false,
    prepared: [],
    prepare: function(product) {
      this.prepared.push(product)
      economy.gold -= production[product].cost
      return true
    }
  }
  let town = {
    name: 'town',
    killed: false,
    playerColor: 1,
    isBadlyDamaged: false,
    isPreparingUnit: false,
    suburbs: [{ isSuburb: true, playerColor: 1 }],
    buildings: [farm, barrack],
    prepared: [],
    prepare: function(product) {
      this.prepared.push(product)
      economy.gold -= production[product].cost
      this.activeProduction = { isEmpty: function() { return true } }
      return true
    }
  }
  let economy = new SimpleAiPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 50)
  let attacker = unit({ x: 1, y: 0 }, true)
  let mover = unit({ x: 0, y: 1 }, false)
  economy.towns = [town]
  economy.units = [attacker, mover]

  let state = economy.inspectEconomy()
  economy.nextTurn()

  let baseline = new SimpleAiPlayer({ r: 98, g: 168, b: 222 }, 50)
  ;({
    inherited: economy instanceof SimpleAiPlayer,
    separateBaseline: baseline instanceof SimpleAiPlayer &&
      !(baseline instanceof SimpleAiPlayerWithEconomy),
    goldBefore: state.gold,
    income: state.income,
    townCount: state.towns.length,
    barrackCount: state.barracks.length,
    farmCount: state.farms.length,
    suburbCount: state.suburbs.length,
    unitCount: state.units.length,
    products: state.productionChoices.map(function(choice) {
      return choice.product
    }),
    goldAfter: economy.gold,
    prepared: town.prepared,
    attackAction: attacker.actions[0],
    moveAction: mover.actions[0]
  })
`, { filename: 'simple-ai-economy-scenario.js' }).runInContext(context);

assert(result.inherited, 'economy player must inherit SimpleAiPlayer');
assert(result.separateBaseline, 'SimpleAiPlayer baseline changed or disappeared');
assert(result.goldBefore === 50 && result.income === 7, 'normal economy values unavailable');
assert(result.goldAfter === 37, 'economy player did not receive income and spend normal gold');
assert(result.prepared[0] === 'noob', 'economy player did not start direct production');
assert(result.townCount === 1, 'town inspection failed');
assert(result.barrackCount === 1, 'barrack inspection failed');
assert(result.farmCount === 1, 'farm inspection failed');
assert(result.suburbCount === 1, 'suburb inspection failed');
assert(result.unitCount === 2, 'unit inspection failed');
assert(result.products.includes('farm') && result.products.includes('barrack') &&
  result.products.includes('suburb') && result.products.includes('archer'),
'available production inspection failed');
assert(result.attackAction === 'attack', 'inherited attack behavior changed');
assert(result.moveAction === 'move', 'inherited movement fallback changed');

console.log('SimpleAiPlayerWithEconomy smoke passed');
