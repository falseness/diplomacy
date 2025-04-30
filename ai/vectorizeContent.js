

// 
/* [color \in {-1, 0, 1}, [[one hot unit type], moves, speed, dmg, range \in {1, 2, 5}, hp]]

*/

function vectorizeCell(cell) {
    result = new Array(12)
    result = result.fill(0)
    result[0] = 0
    if (!cell.building.isEmpty()) {
        result[0] = 1
        // todo: more complicated
    }
    result[1] = (cell.playerColor == 0 ? 0 : (cell.unit.isMyTurn ? 1 : -1))

    mapper = {
        'noob': 0,
        'archer': 1,
        'KOHb': 2,
        'normchel': 3,
        'catapult': 4
    }
    if (cell.unit.isEmpty()) {
        return result
    }
    let unit = cell.unit
    result[2 + mapper[unit.name]] = 1
    result[7] = cell.unit.isMyTurn ? unit.moves : unit.speed
    result[8] = unit.speed
    result[9] = unit.dmg
    result[10] = unit.name == 'archer' ? 2 : (unit.name == 'catapult' ? 5 : 1)
    result[11] = unit.hp
    return result
}


function vectoriseGridDebug() {
    assert(false)
}

function vectoriseGrid() {
    let result = new Array(grid.arr.length)

    for (let i = 0; i < grid.arr.length; ++i) {
        result[i] = new Array(grid.arr[i].length)
        for (let j = 0; j < grid.arr[i].length; ++j) {
            result[i][j] = vectorizeCell(grid.getCell({x: i, y: j}))
        }
    }
    let suddenDeathMetric = (suddenDeathRound - gameRound - 1) * (players.length - 1) + 
        players.length - whooseTurn
    return [result, suddenDeathMetric / 100.0]
}

function rotateRight(twoDimensionalArr) {
    assert(twoDimensionalArr.length != 0)
    assert(twoDimensionalArr[0].length != 0)
    let result = new Array(twoDimensionalArr[0].length)
    for (let i = 0; i < result.length; ++i) {
        result[i] = new Array(twoDimensionalArr.length)
    }
    for (let i = 0; i < twoDimensionalArr.length; ++i) {
        for (let j = 0; j < twoDimensionalArr[i].length; ++j) {
            result[j][twoDimensionalArr.length - i - 1] = twoDimensionalArr[i][j]
        }
    }

    return result
}

function reflectByVerticalLine(twoDimensionalArr) {
    assert(twoDimensionalArr.length != 0)
    assert(twoDimensionalArr[0].length != 0)
    let result = new Array(twoDimensionalArr.length)
    for (let i = 0; i < twoDimensionalArr.length; ++i) {
        result[i] = new Array(twoDimensionalArr[i].length)
        for (let j = 0; j < twoDimensionalArr[i].length; ++j) {
            result[i][twoDimensionalArr[i].length - j - 1] = twoDimensionalArr[i][j]
        }
    }
    return result
}

// function augmentGrid(vectorizedGrid) {
//     let result = [vectorizedGrid]
//     const rectangleRotationsCount = 4
//     for (let i = 1; i < rectangleRotationsCount; ++i) {
//         result.push([rotateRight(result[result.length - 1][0]), result[result.length - 1][1]])
//     }
//     for (let i = 0; i < result.length; ++i) {
//         console.log('hello', i)
//         console.log(JSON.stringify(result))
//     }
//     assert(false)
//     return result
// }