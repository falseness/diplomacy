const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

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
      return 0;
    }
  },
  BestEnemyTargetForAI: class BestEnemyTargetForAI {},
  grid: {
    cells: {},
    getCell(coord) {
      return this.cells[coord.x + ':' + coord.y];
    }
  }
});

const playersSource = fs.readFileSync(
  path.join(repoRoot, 'ai/players.js'), 'utf8');
new vm.Script(playersSource, { filename: 'ai/players.js' }).runInContext(context);

const result = new vm.Script(`
  function selection(name, coords) {
    return {
      name: name,
      availableHexagons: coords.map(function(coord) { return { coord: coord } }),
      isEmpty: function() { return false },
      canCreateOnCell: function(cell) { return cell.legalFor == name }
    }
  }

  function producer(options) {
    options = options || {}
    return {
      name: options.name || 'town',
      killed: false,
      isBadlyDamaged: false,
      isPreparingUnit: false,
      prepared: [],
      placements: [],
      prepare: function(product) {
        this.prepared.push(product)
        if (['noob', 'archer', 'KOHb', 'normchel', 'catapult'].includes(product)) {
          economyPlayer.gold -= production[product].cost
          this.isPreparingUnit = true
          this.activeProduction = { isEmpty: function() { return true } }
          return true
        }
        this.activeProduction = selection(
          product, (options.placements && options.placements[product]) || [])
        return true
      },
      sendInstructions: function(cell) {
        let product = this.activeProduction.name
        this.placements.push(product + '@' + cell.key)
        economyPlayer.gold -= production[product].cost
        return true
      },
      removeSelect: function() {
        this.activeProduction = { isEmpty: function() { return true } }
      }
    }
  }

  function town(options) {
    let value = producer(options)
    value.playerColor = 1
    value.suburbs = options.suburbs || [{ isSuburb: true, playerColor: 1 }]
    value.buildings = options.buildings || []
    value.buildingProduction = options.buildingProduction || []
    return value
  }

  function run(options) {
    let value = town(options)
    economyPlayer = new SimpleAiPlayerWithEconomy(
      { r: 255, g: 0, b: 0 }, 100, 'economy')
    economyPlayer.towns = [value]
    economyPlayer.units = options.units || [{}]
    let spent = economyPlayer.spendEconomyGold()
    return {
      spent: spent,
      prepared: value.prepared.slice(),
      placements: value.placements.slice()
    }
  }

  grid.cells = {
    '1:0': { key: '1:0', legalFor: 'suburb' },
    '2:0': { key: '2:0', legalFor: 'farm' },
    '3:0': { key: '3:0', legalFor: 'barrack' },
    '9:0': { key: '9:0', legalFor: 'none' }
  }

  let economyPlayer
  let suburb = run({
    placements: {
      farm: [{ x: 9, y: 0 }],
      suburb: [{ x: 1, y: 0 }]
    }
  })
  let farm = run({
    placements: {
      farm: [{ x: 2, y: 0 }],
      suburb: [{ x: 1, y: 0 }]
    }
  })
  let defense = run({
    units: [],
    placements: {
      farm: [{ x: 2, y: 0 }],
      suburb: [{ x: 1, y: 0 }]
    }
  })
  let killedDefense = run({
    units: [{ killed: true }],
    placements: {
      farm: [{ x: 2, y: 0 }],
      suburb: [{ x: 1, y: 0 }]
    }
  })
  let infrastructure = run({
    buildings: [{ name: 'farm', killed: false }],
    suburbs: [
      { isSuburb: true, playerColor: 1 },
      { isSuburb: true, playerColor: 1 },
      { isSuburb: true, playerColor: 1 }
    ],
    placements: {
      suburb: [{ x: 9, y: 0 }],
      farm: [{ x: 9, y: 0 }],
      barrack: [{ x: 3, y: 0 }]
    }
  })
  let repeatA = run({
    placements: {
      farm: [{ x: 9, y: 0 }],
      suburb: [{ x: 1, y: 0 }]
    }
  })
  let repeatB = run({
    placements: {
      farm: [{ x: 9, y: 0 }],
      suburb: [{ x: 1, y: 0 }]
    }
  })

  ;({
    suburb: suburb,
    farm: farm,
    defense: defense,
    killedDefense: killedDefense,
    infrastructure: infrastructure,
    repeatA: repeatA,
    repeatB: repeatB
  })
`, { filename: 'simple-ai-economy-mode-scenario.js' }).runInContext(context);

assert(result.suburb.spent, 'economy mode did not buy a legal suburb');
assert(result.suburb.placements[0] === 'suburb@1:0',
  'economy mode did not fall back from blocked farm placement to suburb growth');
assert(result.farm.spent, 'economy mode did not queue a legal farm');
assert(result.farm.placements[0] === 'farm@2:0',
  'economy mode did not prioritize a farm before suburb expansion');
assert(result.defense.spent && result.defense.prepared[0] === 'noob',
  'economy mode did not buy a minimal unit while completely undefended');
assert(result.killedDefense.spent &&
  result.killedDefense.prepared[0] === 'noob',
  'economy mode counted a killed unit as an active defense');
assert(result.infrastructure.spent,
  'economy mode did not build missing affordable infrastructure');
assert(result.infrastructure.placements[0] === 'barrack@3:0',
  'economy mode did not fall back to a missing barrack');
assert(JSON.stringify(result.repeatA) === JSON.stringify(result.repeatB),
  'fixed economy scenarios produced different spending order');

console.log('SimpleAiPlayerWithEconomy economy-mode smoke passed');
