const { loadAiScripts } = require('./smokeHarness');
const vm = require('vm');

const { context } = loadAiScripts();

function runInAiContext(source) {
  return new vm.Script(source, {
    filename: 'mutable-vector-grid-smoke.js'
  }).runInContext(context);
}

runInAiContext(`
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

function buildRuntimeGrid(map, runtime) {
  let cells = new Array(map.mapSize.x)
  for (let x = 0; x < map.mapSize.x; ++x) {
    cells[x] = new Array(map.mapSize.y)
    for (let y = 0; y < map.mapSize.y; ++y) {
      cells[x][y] = {
        coord: {x: x, y: y},
        playerColor: 0,
        building: emptyBuilding(),
        unit: emptyUnit(),
        hexagon: { isSuburb: false }
      }
    }
  }
  for (let key in runtime.cells) {
    let runtimeCell = runtime.cells[key]
    cells[runtimeCell.coord.x][runtimeCell.coord.y] = runtimeCell
  }
  return {
    arr: cells,
    getCell: function(coord) {
      return this.arr[coord.x][coord.y]
    },
    getBuilding: function(coord) {
      return this.getCell(coord).building
    }
  }
}

let map = generateTownTrainingMap({
  size: 'tiny',
  seed: 88088,
  barracks: { completedPerPlayer: 1 },
  farms: { completedPerPlayer: 1 }
})
let runtime = map.start()
grid = buildRuntimeGrid(map, runtime)
players = runtime.players
whooseTurn = 1
gameRound = 0
suddenDeathRound = 40

let initialVectorGrid = vectoriseGrid()
let mutableGrid = createMutableVectorGrid(initialVectorGrid)
let initialComparison = compareVectorGridResults(initialVectorGrid, mutableGrid)
assert(initialComparison.equal, 'mutable grid should match initial vectoriseGrid result')
assertMutableVectorGridMatchesFresh(mutableGrid)
assert(mutableGrid.cells !== initialVectorGrid[0], 'mutable grid must clone cell columns')
assert(mutableGrid.cells[0][0] !== initialVectorGrid[0][0], 'mutable grid must clone cell vectors')

mutableGrid.cells[0][0][CELL_VECTOR_INDEX.currentPlayerGold] += 1
let mismatch = compareVectorGridResults(vectoriseGrid(), mutableGrid)
assert(!mismatch.equal, 'modified mutable grid should report mismatch')
assert(mismatch.mismatches[0].location.x === 0, 'mismatch should include x location')
assert(mismatch.mismatches[0].location.y === 0, 'mismatch should include y location')
assert(
  mismatch.mismatches[0].location.channel === CELL_VECTOR_INDEX.currentPlayerGold,
  'mismatch should include channel location'
)

mutableGrid = createMutableVectorGrid(vectoriseGrid())
let unsupportedLegalAction = {
  type: 'economy',
  category: 'farm',
  product: 'farm',
  producerCoord: players[whooseTurn].towns[0].coord,
  destinationCoord: players[whooseTurn].towns[0].suburbs[1]
}

let missingHandler = false
try {
  applyFastAction(mutableGrid, unsupportedLegalAction)
}
catch (error) {
  missingHandler =
    error.message.indexOf('Missing fast-action apply handler') !== -1 &&
    error.message.indexOf('farm') !== -1 &&
    error.message.indexOf('destinationCoord') !== -1
}
assert(missingHandler, 'unsupported legal action should report clear missing handler')
assert(mutableGrid.appliedFastActions.length === 0, 'failed fast action should not mutate history')

let dispatcher = createFastActionDispatcher({
  test: {
    apply: function(targetGrid, command) {
      targetGrid.cells[0][0][0] = command.value
      return {previous: 0}
    },
    undo: function(targetGrid, command, token) {
      targetGrid.cells[0][0][0] = token.previous
    }
  }
})
let applied = dispatcher.apply(mutableGrid, {
  type: 'test',
  value: 7
})
assert(mutableGrid.cells[0][0][0] === 7, 'custom fast-action apply did not run')
dispatcher.undo(mutableGrid, applied)
assert(mutableGrid.cells[0][0][0] === 0, 'custom fast-action undo did not run')
`);

console.log('Mutable vector grid smoke passed');
