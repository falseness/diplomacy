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
  return { isEmpty: function() { return true } }
}

function cell(building, playerColor) {
  return {
    building: building,
    unit: emptyUnit(),
    playerColor: playerColor
  }
}

function baseBuilding(name, extra) {
  return Object.assign({
    name: name,
    hp: 5,
    maxHP: 5,
    isEmpty: function() { return false },
    isTown: function() { return false },
    isBuildingProduction: function() { return false }
  }, extra || {})
}

function town() {
  return baseBuilding('town', {
    hp: 10,
    maxHP: 10,
    income: 4,
    activeProduction: { notEmpty: function() { return false } },
    buildingProduction: [],
    isBadlyDamaged: false,
    isTown: function() { return true }
  })
}

function barrack() {
  return baseBuilding('barrack', {
    hp: 1,
    maxHP: 1,
    income: -2,
    isPreparingUnit: false
  })
}

function farm() {
  return baseBuilding('farm', {
    hp: 1,
    maxHP: 1,
    income: 4
  })
}

function external(name, hp) {
  return baseBuilding(name, {
    hp: hp,
    rangeIncrease: name == 'tower' ? 1 : 0
  })
}

function pending(name, turns) {
  return baseBuilding(name, {
    turns: turns,
    isBuildingProduction: function() { return true }
  })
}

whooseTurn = 1
players = [{ gold: 0, income: 0 }, { gold: 0, income: 0 }, { gold: 0, income: 0 }]
suddenDeathRound = 20
gameRound = 0

let completed = {
  town: vectorizeCell(cell(town(), 1)),
  barrack: vectorizeCell(cell(barrack(), 1)),
  farm: vectorizeCell(cell(farm(), 1)),
  wall: vectorizeCell(cell(external('wall', 4), 1)),
  bastion: vectorizeCell(cell(external('bastion', 3), 2)),
  tower: vectorizeCell(cell(external('tower', 2), 1))
}

let typeChannels = [
  CELL_VECTOR_INDEX.isTown,
  CELL_VECTOR_INDEX.isBarrack,
  CELL_VECTOR_INDEX.isFarm,
  CELL_VECTOR_INDEX.isWall,
  CELL_VECTOR_INDEX.isBastion,
  CELL_VECTOR_INDEX.isTower
]
let names = Object.keys(completed)
for (let i = 0; i < names.length; ++i) {
  for (let j = 0; j < typeChannels.length; ++j) {
    assertEqual(
      completed[names[i]][typeChannels[j]],
      i == j ? 1 : 0,
      names[i] + ' distinct completed type channel ' + j)
  }
}

assertEqual(completed.wall[CELL_VECTOR_INDEX.externalOwner], 1, 'friendly wall owner')
assertEqual(completed.bastion[CELL_VECTOR_INDEX.externalOwner], -1, 'enemy bastion owner')
assertClose(completed.wall[CELL_VECTOR_INDEX.externalHpRatio], 0.8, 'wall health')
assertClose(completed.bastion[CELL_VECTOR_INDEX.externalHpRatio], 0.6, 'bastion health')
assertClose(completed.tower[CELL_VECTOR_INDEX.externalHpRatio], 0.4, 'tower health')
assertEqual(completed.wall[CELL_VECTOR_INDEX.externalBlocksMovement], 1, 'wall movement blocking')
assertEqual(completed.bastion[CELL_VECTOR_INDEX.externalBlocksMovement], 0, 'bastion movement blocking')
assertEqual(completed.wall[CELL_VECTOR_INDEX.externalBlocksRanged], 1, 'wall ranged blocking')
assertEqual(completed.bastion[CELL_VECTOR_INDEX.externalBlocksRanged], 1, 'bastion ranged blocking')
assertEqual(completed.tower[CELL_VECTOR_INDEX.externalBlocksRanged], 1, 'tower ranged blocking')
assertEqual(completed.tower[CELL_VECTOR_INDEX.externalRangeBonus], 1, 'tower range bonus')

let pendingBarrack = vectorizeCell(cell(pending('barrack', 3), 1))
let pendingFarm = vectorizeCell(cell(pending('farm', 1), 1))
let pendingWall = vectorizeCell(cell(pending('wall', 4), 1))
let pendingBastion = vectorizeCell(cell(pending('bastion', 2), 2))
let pendingTower = vectorizeCell(cell(pending('tower', 1), 1))

assertEqual(pendingBarrack[CELL_VECTOR_INDEX.isPendingBarrack], 1, 'pending manufacture barrack')
assertEqual(pendingFarm[CELL_VECTOR_INDEX.isPendingFarm], 1, 'pending manufacture farm')
assertEqual(pendingWall[CELL_VECTOR_INDEX.isPendingWall], 1, 'pending wall')
assertEqual(pendingBastion[CELL_VECTOR_INDEX.isPendingBastion], 1, 'pending bastion')
assertEqual(pendingTower[CELL_VECTOR_INDEX.isPendingTower], 1, 'pending tower')
assertEqual(pendingWall[CELL_VECTOR_INDEX.isWall], 0, 'pending wall is not completed')
assertEqual(pendingBastion[CELL_VECTOR_INDEX.isBastion], 0, 'pending bastion is not completed')
assertEqual(pendingTower[CELL_VECTOR_INDEX.isTower], 0, 'pending tower is not completed')
assertEqual(pendingWall[CELL_VECTOR_INDEX.pendingExternalOwner], 1, 'pending wall owner')
assertEqual(pendingBastion[CELL_VECTOR_INDEX.pendingExternalOwner], -1, 'pending bastion owner')
assertClose(pendingWall[CELL_VECTOR_INDEX.pendingExternalTurns], 0.4, 'pending wall turns')
assertEqual(pendingWall[CELL_VECTOR_INDEX.pendingExternalHitable], 1, 'pending wall hitability')

let completedWall = vectorizeCell(cell(external('wall', 5), 1))
let completedBastion = vectorizeCell(cell(external('bastion', 5), 2))
let completedTower = vectorizeCell(cell(external('tower', 5), 1))
assertEqual(completedWall[CELL_VECTOR_INDEX.isPendingWall], 0, 'completed wall clears pending state')
assertEqual(completedWall[CELL_VECTOR_INDEX.isWall], 1, 'completed wall sets completed state')
assertEqual(completedBastion[CELL_VECTOR_INDEX.isPendingBastion], 0, 'completed bastion clears pending state')
assertEqual(completedBastion[CELL_VECTOR_INDEX.isBastion], 1, 'completed bastion sets completed state')
assertEqual(completedTower[CELL_VECTOR_INDEX.isPendingTower], 0, 'completed tower clears pending state')
assertEqual(completedTower[CELL_VECTOR_INDEX.isTower], 1, 'completed tower sets completed state')

grid = {
  arr: [[
    cell(town(), 1),
    cell(barrack(), 1),
    cell(farm(), 1),
    cell(external('wall', 5), 1),
    cell(external('bastion', 5), 2),
    cell(external('tower', 5), 1),
    cell(pending('farm', 1), 1),
    cell(pending('wall', 4), 1)
  ]],
  getCell: function(coord) {
    return this.arr[coord.x][coord.y]
  }
}
let mapVectors = vectoriseGrid()[0][0]
assertEqual(mapVectors.length, 8, 'all-building map cell count')
assertEqual(mapVectors[5][CELL_VECTOR_INDEX.isTower], 1, 'map tower vector')
assertEqual(mapVectors[6][CELL_VECTOR_INDEX.isPendingFarm], 1, 'map pending manufacture vector')
assertEqual(mapVectors[7][CELL_VECTOR_INDEX.isPendingWall], 1, 'map pending external vector')
assertModelCellVectorCompatible({ inputs: [{ shape: [null, 1, 8, CELL_VECTOR_SIZE] }] })
`, { filename: 'building-vectorization-smoke.js' }).runInContext(context);

console.log('Building vectorization smoke passed');
