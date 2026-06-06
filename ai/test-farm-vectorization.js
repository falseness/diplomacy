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

function namedBuilding(name) {
  return {
    name: name,
    isEmpty: function() { return false },
    isTown: function() { return false }
  }
}

function farm(income) {
  return {
    name: 'farm',
    hp: 1,
    maxHP: 1,
    income: income,
    isEmpty: function() { return false },
    isTown: function() { return false },
    isBuildingProduction: function() { return false }
  }
}

function pendingFarm(turns) {
  return {
    name: 'farm',
    turns: turns,
    isEmpty: function() { return false },
    isTown: function() { return false },
    isBuildingProduction: function() { return true }
  }
}

function cell(building, playerColor) {
  return {
    building: building,
    unit: emptyUnit(),
    playerColor: playerColor
  }
}

function economyPlayer(baseIncome) {
  return {
    farmIncome: 0,
    get income() {
      return baseIncome + this.farmIncome
    },
    gold: 0
  }
}

whooseTurn = 1
players = [{ gold: 0, income: 0 }, economyPlayer(8), economyPlayer(12)]
suddenDeathRound = 20
gameRound = 0

let friendlyFarmCell = cell(farm(4), 1)
let enemyFarmCell = cell(farm(4), 2)
let pendingFarmCell = cell(pendingFarm(1), 1)
let wallCell = cell(namedBuilding('wall'), 1)

let friendlyFarmVector = vectorizeCell(friendlyFarmCell)
let enemyFarmVector = vectorizeCell(enemyFarmCell)
let pendingFarmVector = vectorizeCell(pendingFarmCell)
let wallVector = vectorizeCell(wallCell)

assertEqual(friendlyFarmVector.length, CELL_VECTOR_SIZE, 'cell vector size')
assertEqual(friendlyFarmVector[CELL_VECTOR_INDEX.isFarm], 1, 'friendly completed farm')
assertEqual(enemyFarmVector[CELL_VECTOR_INDEX.isFarm], 1, 'enemy completed farm')
assertEqual(wallVector[CELL_VECTOR_INDEX.isFarm], 0, 'wall is not farm')
assertEqual(friendlyFarmVector[CELL_VECTOR_INDEX.farmOwner], 1, 'friendly farm owner')
assertEqual(enemyFarmVector[CELL_VECTOR_INDEX.farmOwner], -1, 'enemy farm owner')
assertClose(friendlyFarmVector[CELL_VECTOR_INDEX.farmHpRatio], 1, 'farm hp ratio')
assertClose(friendlyFarmVector[CELL_VECTOR_INDEX.farmIncome], 0.2, 'farm income contribution')

assertEqual(pendingFarmVector[CELL_VECTOR_INDEX.isPendingFarm], 1, 'pending farm channel')
assertEqual(pendingFarmVector[CELL_VECTOR_INDEX.isFarm], 0, 'pending farm is not completed')
assertEqual(pendingFarmVector[CELL_VECTOR_INDEX.pendingFarmOwner], 1, 'pending farm owner')
assertClose(pendingFarmVector[CELL_VECTOR_INDEX.pendingFarmTurns], 0.1, 'pending farm turns')

assertClose(pendingFarmVector[CELL_VECTOR_INDEX.currentPlayerIncome], 0.08, 'income before completion')
assertClose(pendingFarmVector[CELL_VECTOR_INDEX.strongestOpponentIncome], 0.12, 'opponent income')
assertClose(pendingFarmVector[CELL_VECTOR_INDEX.relativeIncomeAdvantage], -0.04, 'income disadvantage')

players[1].farmIncome = 4
let completedFarmVector = vectorizeCell(friendlyFarmCell)
assertClose(completedFarmVector[CELL_VECTOR_INDEX.currentPlayerIncome], 0.12, 'income after completion')
assertClose(completedFarmVector[CELL_VECTOR_INDEX.relativeIncomeAdvantage], 0, 'income after farm completion')

let generatedMapGrid = {
  arr: [[friendlyFarmCell, enemyFarmCell, pendingFarmCell]],
  getCell: function(coord) {
    return this.arr[coord.x][coord.y]
  }
}
grid = generatedMapGrid
let generatedVectors = vectoriseGrid()[0]
assertEqual(generatedVectors[0][0][CELL_VECTOR_INDEX.farmOwner], 1, 'generated map friendly farm')
assertEqual(generatedVectors[0][1][CELL_VECTOR_INDEX.farmOwner], -1, 'generated map enemy farm')
assertEqual(generatedVectors[0][2][CELL_VECTOR_INDEX.isPendingFarm], 1, 'generated map pending farm')

let fixedMapGrid = {
  arr: [[cell(emptyBuilding(), 0)], [friendlyFarmCell]],
  getCell: function(coord) {
    return this.arr[coord.x][coord.y]
  }
}
grid = fixedMapGrid
let fixedVectors = vectoriseGrid()[0]
assertEqual(fixedVectors[1][0][CELL_VECTOR_INDEX.isFarm], 1, 'fixed map completed farm')
assertClose(fixedVectors[1][0][CELL_VECTOR_INDEX.currentPlayerIncome], 0.12, 'fixed map economy feature')

assertModelCellVectorCompatible({ inputs: [{ shape: [null, 2, 1, CELL_VECTOR_SIZE] }] })
`, { filename: 'farm-vectorization-smoke.js' }).runInContext(context);

console.log('Farm vectorization smoke passed');
