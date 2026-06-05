const { loadAiScripts } = require('./smokeHarness');
const vm = require('vm');

const { context } = loadAiScripts();

function runInAiContext(source) {
  return new vm.Script(source, { filename: 'town-vectorization-smoke.js' }).runInContext(context);
}

runInAiContext(`
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

function otherBuilding() {
  return {
    isEmpty: function() { return false },
    isTown: function() { return false }
  }
}

function town(hp, playerColor, extra) {
  extra = extra || {}
  return {
    hp: hp,
    maxHP: 10,
    income: extra.income === undefined ? 8 : extra.income,
    activeProduction: extra.activeProduction || { notEmpty: function() { return false } },
    buildingProduction: extra.buildingProduction || [],
    isBadlyDamaged: hp === 0,
    isEmpty: function() { return false },
    isTown: function() { return true },
    playerColor: playerColor
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
players = [{}, {}, {}]
suddenDeathRound = 20
gameRound = 0

let emptyVector = vectorizeCell(cell(emptyBuilding(), 0))
let otherBuildingVector = vectorizeCell(cell(otherBuilding(), 1))
let friendlyTownVector = vectorizeCell(cell(town(10, 1), 1))
let enemyTownVector = vectorizeCell(cell(town(10, 2), 2))
let neutralTownVector = vectorizeCell(cell(town(10, 0), 0))

assertEqual(emptyVector.length, CELL_VECTOR_SIZE, 'cell vector size')
assertEqual(emptyVector[CELL_VECTOR_INDEX.hasBuilding], 0, 'empty has no building')
assertEqual(otherBuildingVector[CELL_VECTOR_INDEX.hasBuilding], 1, 'other building has building')
assertEqual(otherBuildingVector[CELL_VECTOR_INDEX.isTown], 0, 'other building is not town')
assertEqual(friendlyTownVector[CELL_VECTOR_INDEX.isTown], 1, 'friendly town channel')
assertEqual(friendlyTownVector[CELL_VECTOR_INDEX.townOwner], 1, 'friendly town owner')
assertEqual(enemyTownVector[CELL_VECTOR_INDEX.townOwner], -1, 'enemy town owner')
assertEqual(neutralTownVector[CELL_VECTOR_INDEX.townOwner], 0, 'neutral town owner')
assertClose(friendlyTownVector[CELL_VECTOR_INDEX.townHpRatio], 1, 'full town hp ratio')
assertClose(friendlyTownVector[CELL_VECTOR_INDEX.townIncome], 8 / TOWN_INCOME_VECTOR_SCALE, 'town income')

let damagedTownVector = vectorizeCell(cell(town(4, 1), 1))
assertClose(damagedTownVector[CELL_VECTOR_INDEX.townHpRatio], 0.4, 'damaged town hp ratio')

let badlyDamagedTownVector = vectorizeCell(cell(town(0, 1), 1))
assertEqual(badlyDamagedTownVector[CELL_VECTOR_INDEX.townBadlyDamaged], 1, 'badly damaged town')

let productionTownVector = vectorizeCell(cell(town(10, 1, {
  activeProduction: {
    turns: 2,
    notEmpty: function() { return true }
  },
  buildingProduction: [
    { turns: 3 },
    { turns: 1 }
  ]
}), 1))
assertEqual(productionTownVector[CELL_VECTOR_INDEX.townActiveProduction], 1, 'active town production')
assertClose(productionTownVector[CELL_VECTOR_INDEX.townActiveProductionTurns], 0.2, 'active town production turns')
assertEqual(productionTownVector[CELL_VECTOR_INDEX.townPendingProductionCount], 2, 'pending town production count')
assertClose(productionTownVector[CELL_VECTOR_INDEX.townPendingProductionMinTurns], 0.1, 'pending town production min turns')
assertModelCellVectorCompatible({ inputs: [{ shape: [null, 3, 3, CELL_VECTOR_SIZE] }] })

let mismatchWasDetected = false
try {
  assertModelCellVectorCompatible({ inputs: [{ shape: [null, 3, 3, 12] }] })
}
catch (error) {
  mismatchWasDetected = error.message.indexOf('channel mismatch') !== -1
}
assertEqual(mismatchWasDetected, true, 'stale model channel mismatch')

grid = {
  arr: [[cell(town(10, 1), 1), cell(town(10, 2), 2), cell(town(10, 0), 0)]],
  getCell: function(coord) {
    return this.arr[coord.x][coord.y]
  }
}

let vectorizedGrid = vectoriseGrid()[0]
assertEqual(vectorizedGrid[0][0][CELL_VECTOR_INDEX.townOwner], 1, 'grid friendly town owner')
assertEqual(vectorizedGrid[0][1][CELL_VECTOR_INDEX.townOwner], -1, 'grid enemy town owner')
assertEqual(vectorizedGrid[0][2][CELL_VECTOR_INDEX.townOwner], 0, 'grid neutral town owner')
`);

console.log('Town vectorization smoke passed');
