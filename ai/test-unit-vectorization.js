const vm = require('vm');
const { loadAiScripts, readRepoFile } = require('./smokeHarness');

const { context } = loadAiScripts();

function runInAiContext(source) {
  return new vm.Script(source, { filename: 'unit-vectorization-smoke.js' }).runInContext(context);
}

runInAiContext(`
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual)
  }
}

function assertClose(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual)
  }
}

function emptyBuilding() {
  return {
    isEmpty: function() { return true },
    isTown: function() { return false }
  }
}

function makeUnit(spec, owner, coord) {
  return {
    name: spec.name,
    moves: spec.moves,
    speed: spec.speed,
    dmg: spec.dmg,
    range: spec.range,
    hp: spec.hp,
    maxHP: spec.maxHP,
    buildingDMG: spec.buildingDMG,
    coord: coord,
    killed: false,
    isMyTurn: owner == whooseTurn,
    isEmpty: function() { return false },
    getAvailableCommands: function() {
      return [{
        type: 'unit',
        whoDoCommandCoord: this.coord,
        destinationCoord: {x: this.coord.x, y: this.coord.y}
      }]
    },
    getAvailableMoveCommands: function() {
      return this.getAvailableCommands()
    },
    canHitSomethingOnCell: function() { return false },
    select: function() {},
    skipMoves: function() { this.moves = 0 },
    sendInstructions: function() { this.moves = 0 }
  }
}

function makeCell(unit, owner) {
  return {
    building: emptyBuilding(),
    unit: unit,
    playerColor: owner
  }
}

whooseTurn = 1
players = [{}, {gold: 90, income: 0}, {gold: 90, income: 0}]
suddenDeathRound = 2000
gameRound = 0

let specs = [
  {name: 'noob', moves: 1, speed: 2, dmg: 1, range: 1, hp: 2, maxHP: 2},
  {name: 'archer', moves: 2, speed: 2, dmg: 2, range: 2, hp: 1, maxHP: 1},
  {name: 'KOHb', moves: 3, speed: 4, dmg: 1, range: 1, hp: 2, maxHP: 3},
  {name: 'normchel', moves: 1, speed: 2, dmg: 1, range: 1, hp: 4, maxHP: 5},
  {name: 'catapult', moves: 2, speed: 2, dmg: 0, range: 5, hp: 1, maxHP: 1, buildingDMG: 4}
]

let friendlyCells = []
let enemyCells = []
let signatures = {}
for (let i = 0; i < specs.length; ++i) {
  let friendly = makeCell(makeUnit(specs[i], 1, {x: 0, y: i}), 1)
  let enemy = makeCell(makeUnit(specs[i], 2, {x: 1, y: i}), 2)
  friendlyCells.push(friendly)
  enemyCells.push(enemy)

  let vector = vectorizeCell(friendly)
  assertEqual(vector.length, CELL_VECTOR_SIZE, specs[i].name + ' vector size')
  assertEqual(vector[CELL_VECTOR_INDEX.unitOwner], 1, specs[i].name + ' friendly owner')
  assertEqual(vector[CELL_VECTOR_INDEX.unitTypeStart + i], 1, specs[i].name + ' type channel')
  assertEqual(vector[CELL_VECTOR_INDEX.unitMoves], specs[i].moves, specs[i].name + ' remaining moves')
  assertEqual(vector[CELL_VECTOR_INDEX.unitSpeed], specs[i].speed, specs[i].name + ' speed')
  assertEqual(vector[CELL_VECTOR_INDEX.unitDamage], specs[i].dmg, specs[i].name + ' damage')
  assertEqual(vector[CELL_VECTOR_INDEX.unitRange], specs[i].range, specs[i].name + ' range')
  assertEqual(vector[CELL_VECTOR_INDEX.unitHp], specs[i].hp, specs[i].name + ' hp')
  assertEqual(vector[CELL_VECTOR_INDEX.unitMaxHp], specs[i].maxHP, specs[i].name + ' max hp')
  assertClose(vector[CELL_VECTOR_INDEX.unitHpRatio], specs[i].hp / specs[i].maxHP, specs[i].name + ' hp ratio')
  signatures[specs[i].name] = vector.slice(
    CELL_VECTOR_INDEX.unitTypeStart,
    CELL_VECTOR_INDEX.unitTypeStart + specs.length).join(',')

  let enemyVector = vectorizeCell(enemy)
  assertEqual(enemyVector[CELL_VECTOR_INDEX.unitOwner], -1, specs[i].name + ' enemy owner')
  assertEqual(enemyVector[CELL_VECTOR_INDEX.unitMoves], specs[i].moves, specs[i].name + ' enemy remaining moves')
  assertEqual(friendly.unit.getAvailableCommands().length, 1, specs[i].name + ' available commands')
}

assertEqual(Object.keys(signatures).length, specs.length, 'unit signature count')
assertEqual(new Set(Object.values(signatures)).size, specs.length, 'distinct unit signatures')

let archerVector = vectorizeCell(friendlyCells[1])
assertEqual(archerVector[CELL_VECTOR_INDEX.unitIsRanged], 1, 'archer ranged flag')
assertEqual(archerVector[CELL_VECTOR_INDEX.unitMinRange], 1, 'archer minimum range')

let catapultVector = vectorizeCell(friendlyCells[4])
assertEqual(catapultVector[CELL_VECTOR_INDEX.unitIsRanged], 1, 'catapult ranged flag')
assertEqual(catapultVector[CELL_VECTOR_INDEX.unitMinRange], 2, 'catapult blind-area minimum range')
assertEqual(catapultVector[CELL_VECTOR_INDEX.unitBuildingDamage], 4, 'catapult building damage')

let emptyUnit = {
  isEmpty: function() { return true },
  isMyTurn: false
}
let emptyCellVector = vectorizeCell(makeCell(emptyUnit, 0))
assertEqual(emptyCellVector[CELL_VECTOR_INDEX.unitOwner], 0, 'empty cell unit owner')
assertEqual(emptyCellVector[CELL_VECTOR_INDEX.unitIsRanged], 0, 'empty cell ranged flag')

let occupiedBuilding = {
  isEmpty: function() { return false },
  isTown: function() { return false },
  name: 'wall'
}
let impossibleStack = makeCell(friendlyCells[0].unit, 1)
impossibleStack.building = occupiedBuilding
let impossibleVector = vectorizeCell(impossibleStack)
assertEqual(impossibleVector[CELL_VECTOR_INDEX.hasBuilding], 1, 'stacked state building retained')
assertEqual(impossibleVector[CELL_VECTOR_INDEX.unitTypeStart], 1, 'stacked state unit retained')

Map = function TrainingMap(mapSize, mapPlayers, goldmines, lakes, mountains) {
  this.mapSize = mapSize
  this.players = mapPlayers
  this.goldmines = goldmines
  this.lakes = lakes
  this.mountains = mountains
}
let generated = generateTinyMapAllUnits()
for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
  let names = generated.players[playerIndex].units.map(function(unit) {
    return unit.type.name
  })
  assertEqual(names.length, specs.length, 'generated unit count for player ' + playerIndex)
  for (let i = 0; i < specs.length; ++i) {
    assertEqual(names[i], ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'][i],
      'generated unit type for player ' + playerIndex + ' index ' + i)
  }
}

grid = {
  arr: [friendlyCells],
  getCell: function(coord) { return this.arr[coord.x][coord.y] }
}

function Player() {}
Player.prototype.nextTurn = function() {}
function BestEnemyTargetForAI() {}
BestEnemyTargetForAI.prototype.GetCommandNearestToBestTarget = function(commands) {
  return commands[0] || null
}
`);

new vm.Script(readRepoFile('ai/players.js'), { filename: 'ai/players.js' }).runInContext(context);

runInAiContext(`
let ai = new SimpleAiPlayer({r: 255, g: 0, b: 0})
ai.units = friendlyCells.map(function(cell) { return cell.unit })
ai.play()
for (let i = 0; i < ai.units.length; ++i) {
  assertEqual(ai.units[i].moves, 0, specs[i].name + ' completed AI turn')
}
`);

console.log('Unit vectorization and AI command smoke passed');
