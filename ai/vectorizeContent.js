

// Cell channels 0-11 are the original building/unit representation.
// Channels 12+ encode town-specific state for economy-aware training.
var CELL_VECTOR_INDEX = {
    hasBuilding: 0,
    unitOwner: 1,
    unitTypeStart: 2,
    unitMoves: 7,
    unitSpeed: 8,
    unitDamage: 9,
    unitRange: 10,
    unitHp: 11,
    isTown: 12,
    townOwner: 13,
    townHpRatio: 14,
    townBadlyDamaged: 15,
    townIncome: 16,
    townActiveProduction: 17,
    townActiveProductionTurns: 18,
    townPendingProductionCount: 19,
    townPendingProductionMinTurns: 20
}

var CELL_VECTOR_SIZE = 21
var TOWN_INCOME_VECTOR_SCALE = 20.0
var TOWN_PRODUCTION_TURNS_VECTOR_SCALE = 10.0

function relativePlayerValue(playerColor) {
    if (playerColor == 0) {
        return 0
    }
    return playerColor == whooseTurn ? 1 : -1
}

function hasActiveProduction(town) {
    return town.activeProduction && town.activeProduction.notEmpty &&
        town.activeProduction.notEmpty()
}

function vectorizeTown(town, playerColor, result) {
    result[CELL_VECTOR_INDEX.isTown] = 1
    result[CELL_VECTOR_INDEX.townOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.townHpRatio] = town.maxHP ? town.hp / town.maxHP : 0
    result[CELL_VECTOR_INDEX.townBadlyDamaged] = town.isBadlyDamaged ? 1 : 0
    result[CELL_VECTOR_INDEX.townIncome] = town.income / TOWN_INCOME_VECTOR_SCALE

    if (hasActiveProduction(town)) {
        result[CELL_VECTOR_INDEX.townActiveProduction] = 1
        result[CELL_VECTOR_INDEX.townActiveProductionTurns] =
            town.activeProduction.turns / TOWN_PRODUCTION_TURNS_VECTOR_SCALE
    }

    if (town.buildingProduction && town.buildingProduction.length) {
        result[CELL_VECTOR_INDEX.townPendingProductionCount] =
            town.buildingProduction.length
        let minTurns = town.buildingProduction[0].turns
        for (let i = 1; i < town.buildingProduction.length; ++i) {
            minTurns = Math.min(minTurns, town.buildingProduction[i].turns)
        }
        result[CELL_VECTOR_INDEX.townPendingProductionMinTurns] =
            minTurns / TOWN_PRODUCTION_TURNS_VECTOR_SCALE
    }
}

function vectorizeCell(cell) {
    let result = new Array(CELL_VECTOR_SIZE)
    result = result.fill(0)
    if (!cell.building.isEmpty()) {
        result[CELL_VECTOR_INDEX.hasBuilding] = 1
        if (cell.building.isTown()) {
            vectorizeTown(cell.building, cell.playerColor, result)
        }
    }
    result[CELL_VECTOR_INDEX.unitOwner] =
        (cell.playerColor == 0 ? 0 : (cell.unit.isMyTurn ? 1 : -1))

    let mapper = {
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
    result[CELL_VECTOR_INDEX.unitTypeStart + mapper[unit.name]] = 1
    result[CELL_VECTOR_INDEX.unitMoves] = cell.unit.isMyTurn ? unit.moves : unit.speed
    result[CELL_VECTOR_INDEX.unitSpeed] = unit.speed
    result[CELL_VECTOR_INDEX.unitDamage] = unit.dmg
    result[CELL_VECTOR_INDEX.unitRange] = unit.name == 'archer' ? 2 : (unit.name == 'catapult' ? 5 : 1)
    result[CELL_VECTOR_INDEX.unitHp] = unit.hp
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
