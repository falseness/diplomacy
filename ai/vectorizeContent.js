

// 
/* [color \in {-1, 0, 1}, [[one hot unit type], moves, speed, dmg, range \in {1, 2, 5}, hp]]

*/

function vectorizeCell(cell) {
    result = new Array(12)
    result = result.fill(0)
    result[0] = 1
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
    result[7] = unit.moves
    result[8] = unit.speed
    result[9] = unit.dmg
    result[10] = unit.name == 'archer' ? 2 : (unit.name == 'catapult' ? 5 : 1)
    result[11] = unit.hp
    return result
}


function vectoriseGridDebug() {
    let result = new Array(maxGridX)

    for (let i = 0; i < grid.arr.length; ++i) {
        result[i] = new Array(maxGridY)
        for (let j = 0; j < grid.arr[i].length; ++j) {
            result[i][j] = vectorizeCell(grid.getCell({x: i, y: j}))
        }
    }
    for (let i = 0; i < maxGridX; ++i) {
        let start = 0
        if (i >= grid.arr.length) {
            result[i] = new Array(maxGridY)
            start = 0    
        }
        else {
            start = grid.arr[i].length
        }
        for (let j = start; j < maxGridY; ++j) {
            let tmp = new Array(12)
            result[i][j] = tmp.fill(0)
        }
        
    }
    return result
}

function vectoriseGrid() {
    return tf.tensor3d(vectoriseGridDebug())
}