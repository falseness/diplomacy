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
    getCell(coord) {
      return this.cells[coord.x + ':' + coord.y];
    },
    cells: {}
  }
});

const playersSource = fs.readFileSync(
  path.join(repoRoot, 'ai/players.js'), 'utf8');
new vm.Script(playersSource, { filename: 'ai/players.js' }).runInContext(context);

const result = new vm.Script(`
  function productionSelection(name, legalCells) {
    return {
      name: name,
      availableHexagons: legalCells.map(function(coord) {
        return { coord: coord }
      }),
      isEmpty: function() { return false },
      canCreateOnCell: function(cell) { return cell.legalFor == name }
    }
  }

  function producer(name, options) {
    options = options || {}
    return {
      name: name,
      killed: false,
      isBadlyDamaged: false,
      isPreparingUnit: Boolean(options.busy),
      prepared: [],
      placements: [],
      prepareCalls: 0,
      prepare: function(product) {
        this.prepareCalls += 1
        this.prepared.push(product)
        if (options.reject && options.reject.includes(product)) {
          return false
        }
        if (['noob', 'archer', 'KOHb', 'normchel', 'catapult'].includes(product)) {
          warPlayer.gold -= production[product].cost
          this.isPreparingUnit = true
          this.activeProduction = { isEmpty: function() { return true } }
          return true
        }
        let legalCells = (options.placements && options.placements[product]) || []
        this.activeProduction = productionSelection(product, legalCells)
        return true
      },
      sendInstructions: function(cell) {
        this.placements.push({ product: this.activeProduction.name, cell: cell.key })
        warPlayer.gold -= production[this.activeProduction.name].cost
        return true
      },
      removeSelect: function() {
        this.activeProduction = { isEmpty: function() { return true } }
      }
    }
  }

  function town(options) {
    let value = producer('town', options)
    value.playerColor = 1
    value.suburbs = [{ isSuburb: true, playerColor: 1 }]
    value.buildings = options.buildings || []
    value.buildingProduction = options.buildingProduction || []
    return value
  }

  grid.cells = {
    '1:0': { key: '1:0', legalFor: 'barrack' },
    '2:0': { key: '2:0', legalFor: 'suburb' },
    '3:0': { key: '3:0', legalFor: 'none' }
  }

  let unitTown = town({
    buildings: [producer('farm'), producer('barrack')]
  })
  let warPlayer = new SimpleAiPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 100, 'war')
  warPlayer.towns = [unitTown]
  let unitSpent = warPlayer.spendWarGold()

  let barrackTown = town({
    busy: true,
    placements: { barrack: [{ x: 1, y: 0 }] }
  })
  warPlayer = new SimpleAiPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 100, 'war')
  warPlayer.towns = [barrackTown]
  let barrackSpent = warPlayer.spendWarGold()

  let suburbTown = town({
    busy: true,
    placements: {
      barrack: [{ x: 3, y: 0 }],
      suburb: [{ x: 2, y: 0 }]
    }
  })
  warPlayer = new SimpleAiPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 100, 'war')
  warPlayer.towns = [suburbTown]
  let suburbSpent = warPlayer.spendWarGold()

  let blockedTown = town({
    busy: true,
    placements: {
      barrack: [{ x: 3, y: 0 }],
      suburb: [{ x: 3, y: 0 }]
    }
  })
  warPlayer = new SimpleAiPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 100, 'war')
  warPlayer.towns = [blockedTown]
  let blockedResults = []
  for (let turn = 0; turn < 10; ++turn) {
    blockedResults.push(warPlayer.spendWarGold())
  }

  ;({
    mode: warPlayer.economyMode,
    unitSpent: unitSpent,
    unitPrepared: unitTown.prepared,
    barrackSpent: barrackSpent,
    barrackPrepared: barrackTown.prepared,
    barrackPlacements: barrackTown.placements,
    suburbSpent: suburbSpent,
    suburbPrepared: suburbTown.prepared,
    suburbPlacements: suburbTown.placements,
    blockedResults: blockedResults,
    blockedPrepareCalls: blockedTown.prepareCalls
  })
`, { filename: 'simple-ai-war-mode-scenario.js' }).runInContext(context);

assert(result.mode === 'war', 'war mode must be explicit and inspectable');
assert(result.unitSpent, 'war mode did not spend available gold on a unit');
assert(result.unitPrepared[0] === 'noob',
  'war mode did not prioritize unit production');
assert(!result.unitPrepared.includes('farm'),
  'war mode selected an economy building before a unit');
assert(result.barrackSpent, 'war mode did not build missing war capacity');
assert(result.barrackPrepared[0] === 'barrack',
  'war mode did not choose a barrack when unit production was occupied');
assert(result.barrackPlacements[0].product === 'barrack',
  'war mode did not place the selected barrack');
assert(result.suburbSpent, 'war mode did not expand for blocked barrack placement');
assert(result.suburbPrepared.join(',') === 'barrack,suburb',
  'war mode suburb fallback order is not deterministic');
assert(result.suburbPlacements[0].product === 'suburb',
  'war mode expanded suburbs without first trying war capacity');
assert(result.blockedResults.every(function(value) { return value === false }),
  'war mode reported spending when no legal action existed');
assert(result.blockedPrepareCalls === 20,
  'war mode did not stop after checking each legal spending category once');

console.log('SimpleAiPlayerWithEconomy war-mode smoke passed');
