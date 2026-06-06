const { loadAiScripts } = require('./smokeHarness');
const vm = require('vm');

const { context } = loadAiScripts();

new vm.Script(`
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function assertClose(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function emptyUnit() {
  return {
    isEmpty: function() { return true },
    isMyTurn: false
  }
}

function emptyBuilding() {
  return {
    isEmpty: function() { return true },
    isTown: function() { return false }
  }
}

function natureBuilding(name) {
  return {
    name: name,
    isEmpty: function() { return false },
    isTown: function() { return false }
  }
}

function goldmine(potentialIncome, openingRound) {
  return {
    name: 'goldmine',
    potentialIncome: potentialIncome,
    get income() {
      return gameRound >= openingRound ? potentialIncome : 0
    },
    isEmpty: function() { return false },
    isTown: function() { return false }
  }
}

function cell(building, playerColor) {
  return {
    building: building,
    unit: emptyUnit(),
    playerColor: playerColor
  }
}

whooseTurn = 1
players = [{ gold: 0 }, { gold: 600 }, { gold: 900 }]
suddenDeathRound = 30
gameRound = 5

let neutralCell = cell(goldmine(25, 10), 0)
let friendlyCell = cell(goldmine(50, 0), 1)
let enemyCell = cell(goldmine(75, 0), 2)
let mountainCell = cell(natureBuilding('mountain'), 0)
let emptyCell = cell(emptyBuilding(), 0)

let neutralVector = vectorizeCell(neutralCell)
let friendlyVector = vectorizeCell(friendlyCell)
let enemyVector = vectorizeCell(enemyCell)
let mountainVector = vectorizeCell(mountainCell)
let emptyVector = vectorizeCell(emptyCell)

assertEqual(neutralVector.length, CELL_VECTOR_SIZE, 'cell vector size')
assertEqual(neutralVector[CELL_VECTOR_INDEX.isGoldmine], 1, 'neutral goldmine channel')
assertEqual(friendlyVector[CELL_VECTOR_INDEX.goldmineOwner], 1, 'friendly goldmine owner')
assertEqual(enemyVector[CELL_VECTOR_INDEX.goldmineOwner], -1, 'enemy goldmine owner')
assertEqual(neutralVector[CELL_VECTOR_INDEX.goldmineOwner], 0, 'neutral goldmine owner')
assertClose(neutralVector[CELL_VECTOR_INDEX.goldminePotentialIncome], 0.25, 'potential income')
assertClose(neutralVector[CELL_VECTOR_INDEX.goldmineActiveIncome], 0, 'closed mine active income')
assertClose(friendlyVector[CELL_VECTOR_INDEX.goldmineActiveIncome], 0.5, 'friendly active income')
assertClose(enemyVector[CELL_VECTOR_INDEX.goldmineActiveIncome], 0.75, 'enemy active income')
assertEqual(mountainVector[CELL_VECTOR_INDEX.isGoldmine], 0, 'nature is not goldmine')
assertEqual(emptyVector[CELL_VECTOR_INDEX.isGoldmine], 0, 'empty is not goldmine')

assertClose(friendlyVector[CELL_VECTOR_INDEX.currentPlayerGold], 0.6, 'current player gold')
assertClose(friendlyVector[CELL_VECTOR_INDEX.strongestOpponentGold], 0.9, 'opponent gold')
assertClose(friendlyVector[CELL_VECTOR_INDEX.relativeGoldAdvantage], -0.3, 'relative gold disadvantage')

players[1].gold += 200
players[2].gold += 75
let afterIncomeVector = vectorizeCell(friendlyCell)
assertClose(afterIncomeVector[CELL_VECTOR_INDEX.currentPlayerGold], 0.8, 'current gold after income')
assertClose(afterIncomeVector[CELL_VECTOR_INDEX.strongestOpponentGold], 0.975, 'opponent gold after income')
assertClose(afterIncomeVector[CELL_VECTOR_INDEX.relativeGoldAdvantage], -0.175, 'gold advantage after income')

gameRound = 10
let openedNeutralVector = vectorizeCell(neutralCell)
assertClose(openedNeutralVector[CELL_VECTOR_INDEX.goldmineActiveIncome], 0.25, 'mine income after opening')

neutralCell.playerColor = 1
let capturedVector = vectorizeCell(neutralCell)
assertEqual(capturedVector[CELL_VECTOR_INDEX.goldmineOwner], 1, 'captured goldmine owner')

whooseTurn = 2
let reversedPerspectiveVector = vectorizeCell(neutralCell)
assertEqual(reversedPerspectiveVector[CELL_VECTOR_INDEX.goldmineOwner], -1, 'captured mine enemy perspective')
assertClose(reversedPerspectiveVector[CELL_VECTOR_INDEX.currentPlayerGold], 0.975, 'reversed current gold')
assertClose(reversedPerspectiveVector[CELL_VECTOR_INDEX.strongestOpponentGold], 0.8, 'reversed opponent gold')
assertClose(reversedPerspectiveVector[CELL_VECTOR_INDEX.relativeGoldAdvantage], 0.175, 'reversed gold advantage')

grid = {
  arr: [[neutralCell, friendlyCell, enemyCell]],
  getCell: function(coord) {
    return this.arr[coord.x][coord.y]
  }
}

let vectorizedGrid = vectoriseGrid()[0]
assertEqual(vectorizedGrid[0][0][CELL_VECTOR_INDEX.goldmineOwner], -1, 'grid captured mine owner')
assertClose(vectorizedGrid[0][1][CELL_VECTOR_INDEX.currentPlayerGold], 0.975, 'grid global gold feature')
assertModelCellVectorCompatible({ inputs: [{ shape: [null, 1, 3, CELL_VECTOR_SIZE] }] })
`, { filename: 'gold-vectorization-smoke.js' }).runInContext(context);

console.log('Gold vectorization smoke passed');
