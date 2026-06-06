

// Cell channels 0-11 are the original building/unit representation.
// Channels 12+ encode economy-aware building, production, and combat state.
// Keep ai/model-input-schema.md synchronized when adding channels.
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
    townPendingProductionMinTurns: 20,
    isBarrack: 21,
    barrackOwner: 22,
    barrackHpRatio: 23,
    barrackIncome: 24,
    barrackActiveProduction: 25,
    barrackActiveProductionTurns: 26,
    isPendingBarrack: 27,
    pendingBarrackOwner: 28,
    pendingBarrackTurns: 29,
    townPendingBarrackCount: 30,
    townPendingBarrackMinTurns: 31,
    isGoldmine: 32,
    goldmineOwner: 33,
    goldminePotentialIncome: 34,
    goldmineActiveIncome: 35,
    currentPlayerGold: 36,
    strongestOpponentGold: 37,
    relativeGoldAdvantage: 38,
    isFarm: 39,
    farmOwner: 40,
    farmHpRatio: 41,
    farmIncome: 42,
    isPendingFarm: 43,
    pendingFarmOwner: 44,
    pendingFarmTurns: 45,
    currentPlayerIncome: 46,
    strongestOpponentIncome: 47,
    relativeIncomeAdvantage: 48,
    unitMaxHp: 49,
    unitHpRatio: 50,
    unitMinRange: 51,
    unitBuildingDamage: 52,
    unitIsRanged: 53,
    isWall: 54,
    isBastion: 55,
    isTower: 56,
    externalOwner: 57,
    externalHpRatio: 58,
    externalBlocksMovement: 59,
    externalBlocksRanged: 60,
    externalRangeBonus: 61,
    isPendingWall: 62,
    isPendingBastion: 63,
    isPendingTower: 64,
    pendingExternalOwner: 65,
    pendingExternalTurns: 66,
    pendingExternalHitable: 67,
    isSuburb: 68,
    suburbOwner: 69,
    suburbIncome: 70,
    suburbExpansionAvailable: 71,
    suburbExpansionOwner: 72,
    townSuburbCount: 73,
    townSuburbIncome: 74,
    currentPlayerSuburbIncome: 75,
    strongestOpponentSuburbIncome: 76,
    relativeSuburbIncomeAdvantage: 77
}

var CELL_VECTOR_SIZE = 78
var TOWN_INCOME_VECTOR_SCALE = 20.0
var BARRACK_INCOME_VECTOR_SCALE = 20.0
var FARM_INCOME_VECTOR_SCALE = 20.0
var GOLDMINE_INCOME_VECTOR_SCALE = 100.0
var PLAYER_GOLD_VECTOR_SCALE = 1000.0
var PLAYER_INCOME_VECTOR_SCALE = 100.0
var TOWN_PRODUCTION_TURNS_VECTOR_SCALE = 10.0
var BARRACK_PRODUCTION_TURNS_VECTOR_SCALE = 10.0
var FARM_PRODUCTION_TURNS_VECTOR_SCALE = 10.0
var EXTERNAL_PRODUCTION_TURNS_VECTOR_SCALE = 10.0
var SUBURB_INCOME_VECTOR_SCALE = 20.0
var SUBURB_COUNT_VECTOR_SCALE = 20.0

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

function isBarrackObject(building) {
    return building && building.name == 'barrack' &&
        !(building.isBuildingProduction && building.isBuildingProduction())
}

function isPendingBarrackObject(building) {
    return building && building.name == 'barrack' &&
        building.isBuildingProduction && building.isBuildingProduction()
}

function isGoldmineObject(building) {
    return building && building.name == 'goldmine'
}

function isFarmObject(building) {
    return building && building.name == 'farm' &&
        !(building.isBuildingProduction && building.isBuildingProduction())
}

function isPendingFarmObject(building) {
    return building && building.name == 'farm' &&
        building.isBuildingProduction && building.isBuildingProduction()
}

function isExternalName(name) {
    return name == 'wall' || name == 'bastion' || name == 'tower'
}

function isExternalObject(building) {
    return building && isExternalName(building.name) &&
        !(building.isBuildingProduction && building.isBuildingProduction())
}

function isPendingExternalObject(building) {
    return building && isExternalName(building.name) &&
        building.isBuildingProduction && building.isBuildingProduction()
}

function productionName(production) {
    return production ? production.name : undefined
}

function playerGold(player) {
    return player && Number.isFinite(player.gold) ? player.gold : 0
}

function playerIncome(player) {
    return player && Number.isFinite(player.income) ? player.income : 0
}

function validTownSuburbCount(town) {
    if (!town || town.killed || !town.suburbs) {
        return 0
    }
    if (Number.isFinite(town.suburbsCount)) {
        return town.suburbsCount
    }
    let count = 0
    for (let i = 0; i < town.suburbs.length; ++i) {
        let suburb = town.suburbs[i]
        if (suburb && suburb.isSuburb && suburb.playerColor == town.playerColor) {
            ++count
        }
    }
    return count
}

function playerSuburbIncome(player) {
    if (!player || !player.towns) {
        return 0
    }
    let suburbCount = 0
    for (let i = 0; i < player.towns.length; ++i) {
        suburbCount += validTownSuburbCount(player.towns[i])
    }
    return suburbCount
}

function vectorizePlayerSuburbIncome(result) {
    let currentIncome = playerSuburbIncome(players[whooseTurn])
    let strongestOpponentIncome = 0
    for (let i = 1; i < players.length; ++i) {
        if (i != whooseTurn) {
            strongestOpponentIncome = Math.max(
                strongestOpponentIncome,
                playerSuburbIncome(players[i]))
        }
    }
    result[CELL_VECTOR_INDEX.currentPlayerSuburbIncome] =
        currentIncome / SUBURB_INCOME_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.strongestOpponentSuburbIncome] =
        strongestOpponentIncome / SUBURB_INCOME_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.relativeSuburbIncomeAdvantage] =
        (currentIncome - strongestOpponentIncome) / SUBURB_INCOME_VECTOR_SCALE
}

function vectorizePlayerGold(result) {
    let currentGold = playerGold(players[whooseTurn])
    let strongestOpponentGold = 0
    for (let i = 1; i < players.length; ++i) {
        if (i != whooseTurn) {
            strongestOpponentGold = Math.max(strongestOpponentGold, playerGold(players[i]))
        }
    }
    result[CELL_VECTOR_INDEX.currentPlayerGold] =
        currentGold / PLAYER_GOLD_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.strongestOpponentGold] =
        strongestOpponentGold / PLAYER_GOLD_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.relativeGoldAdvantage] =
        (currentGold - strongestOpponentGold) / PLAYER_GOLD_VECTOR_SCALE
}

function vectorizePlayerIncome(result) {
    let currentIncome = playerIncome(players[whooseTurn])
    let strongestOpponentIncome = -Infinity
    for (let i = 1; i < players.length; ++i) {
        if (i != whooseTurn) {
            strongestOpponentIncome = Math.max(
                strongestOpponentIncome,
                playerIncome(players[i]))
        }
    }
    if (strongestOpponentIncome == -Infinity) {
        strongestOpponentIncome = 0
    }
    result[CELL_VECTOR_INDEX.currentPlayerIncome] =
        currentIncome / PLAYER_INCOME_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.strongestOpponentIncome] =
        strongestOpponentIncome / PLAYER_INCOME_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.relativeIncomeAdvantage] =
        (currentIncome - strongestOpponentIncome) / PLAYER_INCOME_VECTOR_SCALE
}

function vectorizeTown(town, playerColor, result) {
    result[CELL_VECTOR_INDEX.isTown] = 1
    result[CELL_VECTOR_INDEX.townOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.townHpRatio] = town.maxHP ? town.hp / town.maxHP : 0
    result[CELL_VECTOR_INDEX.townBadlyDamaged] = town.isBadlyDamaged ? 1 : 0
    result[CELL_VECTOR_INDEX.townIncome] = town.income / TOWN_INCOME_VECTOR_SCALE
    let suburbCount = validTownSuburbCount(town)
    result[CELL_VECTOR_INDEX.townSuburbCount] =
        suburbCount / SUBURB_COUNT_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.townSuburbIncome] =
        suburbCount / SUBURB_INCOME_VECTOR_SCALE

    if (hasActiveProduction(town)) {
        result[CELL_VECTOR_INDEX.townActiveProduction] = 1
        result[CELL_VECTOR_INDEX.townActiveProductionTurns] =
            town.activeProduction.turns / TOWN_PRODUCTION_TURNS_VECTOR_SCALE
    }

    if (town.buildingProduction && town.buildingProduction.length) {
        result[CELL_VECTOR_INDEX.townPendingProductionCount] =
            town.buildingProduction.length
        let minTurns = town.buildingProduction[0].turns
        let barrackCount = 0
        let barrackMinTurns = undefined
        for (let i = 1; i < town.buildingProduction.length; ++i) {
            minTurns = Math.min(minTurns, town.buildingProduction[i].turns)
        }
        for (let i = 0; i < town.buildingProduction.length; ++i) {
            if (productionName(town.buildingProduction[i]) == 'barrack') {
                ++barrackCount
                if (barrackMinTurns === undefined) {
                    barrackMinTurns = town.buildingProduction[i].turns
                }
                else {
                    barrackMinTurns = Math.min(barrackMinTurns, town.buildingProduction[i].turns)
                }
            }
        }
        result[CELL_VECTOR_INDEX.townPendingProductionMinTurns] =
            minTurns / TOWN_PRODUCTION_TURNS_VECTOR_SCALE
        result[CELL_VECTOR_INDEX.townPendingBarrackCount] = barrackCount
        if (barrackMinTurns !== undefined) {
            result[CELL_VECTOR_INDEX.townPendingBarrackMinTurns] =
                barrackMinTurns / BARRACK_PRODUCTION_TURNS_VECTOR_SCALE
        }
    }
}

function coordsMatch(a, b) {
    return a && b && a.x == b.x && a.y == b.y
}

function cellIsSuburb(cell) {
    return !!(cell && cell.hexagon && cell.hexagon.isSuburb)
}

function isLiveTownSuburb(town, suburb) {
    return town && !town.killed && suburb && suburb.isSuburb &&
        suburb.playerColor == town.playerColor
}

function isSuburbExpansionCell(cell) {
    if (!cell || !cell.hexagon || cell.hexagon.isSuburb ||
        cell.playerColor == 0 || !cell.coord) {
        return false
    }
    let owner = players[cell.playerColor]
    if (!owner || !owner.towns) {
        return false
    }
    for (let i = 0; i < owner.towns.length; ++i) {
        let town = owner.towns[i]
        if (!town || town.killed || town.playerColor != cell.playerColor ||
            !town.suburbs) {
            continue
        }
        for (let j = 0; j < town.suburbs.length; ++j) {
            let suburb = town.suburbs[j]
            if (!isLiveTownSuburb(town, suburb) || !suburb.neighbours) {
                continue
            }
            for (let k = 0; k < suburb.neighbours.length; ++k) {
                if (coordsMatch(suburb.neighbours[k], cell.coord)) {
                    return true
                }
            }
        }
    }
    return false
}

function vectorizeSuburb(cell, result) {
    if (cellIsSuburb(cell)) {
        result[CELL_VECTOR_INDEX.isSuburb] = 1
        result[CELL_VECTOR_INDEX.suburbOwner] =
            relativePlayerValue(cell.playerColor)
        result[CELL_VECTOR_INDEX.suburbIncome] =
            1 / SUBURB_INCOME_VECTOR_SCALE
    }
    if (isSuburbExpansionCell(cell)) {
        result[CELL_VECTOR_INDEX.suburbExpansionAvailable] = 1
        result[CELL_VECTOR_INDEX.suburbExpansionOwner] =
            relativePlayerValue(cell.playerColor)
    }
}

function vectorizeBarrack(barrack, playerColor, result) {
    result[CELL_VECTOR_INDEX.isBarrack] = 1
    result[CELL_VECTOR_INDEX.barrackOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.barrackHpRatio] = barrack.maxHP ? barrack.hp / barrack.maxHP : 0
    result[CELL_VECTOR_INDEX.barrackIncome] = barrack.income / BARRACK_INCOME_VECTOR_SCALE

    if (barrack.isPreparingUnit) {
        result[CELL_VECTOR_INDEX.barrackActiveProduction] = 1
        result[CELL_VECTOR_INDEX.barrackActiveProductionTurns] =
            barrack.unitProduction.turns / BARRACK_PRODUCTION_TURNS_VECTOR_SCALE
    }
}

function vectorizePendingBarrack(barrackProduction, playerColor, result) {
    result[CELL_VECTOR_INDEX.isPendingBarrack] = 1
    result[CELL_VECTOR_INDEX.pendingBarrackOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.pendingBarrackTurns] =
        barrackProduction.turns / BARRACK_PRODUCTION_TURNS_VECTOR_SCALE
}

function vectorizeGoldmine(goldmine, playerColor, result) {
    result[CELL_VECTOR_INDEX.isGoldmine] = 1
    result[CELL_VECTOR_INDEX.goldmineOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.goldminePotentialIncome] =
        goldmine.potentialIncome / GOLDMINE_INCOME_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.goldmineActiveIncome] =
        goldmine.income / GOLDMINE_INCOME_VECTOR_SCALE
}

function vectorizeFarm(farm, playerColor, result) {
    result[CELL_VECTOR_INDEX.isFarm] = 1
    result[CELL_VECTOR_INDEX.farmOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.farmHpRatio] =
        farm.maxHP && Number.isFinite(farm.hp) ? farm.hp / farm.maxHP : 0
    result[CELL_VECTOR_INDEX.farmIncome] =
        (Number.isFinite(farm.income) ? farm.income : 0) / FARM_INCOME_VECTOR_SCALE
}

function vectorizePendingFarm(farmProduction, playerColor, result) {
    result[CELL_VECTOR_INDEX.isPendingFarm] = 1
    result[CELL_VECTOR_INDEX.pendingFarmOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.pendingFarmTurns] =
        farmProduction.turns / FARM_PRODUCTION_TURNS_VECTOR_SCALE
}

function vectorizeExternal(building, playerColor, result) {
    let typeIndex = {
        wall: CELL_VECTOR_INDEX.isWall,
        bastion: CELL_VECTOR_INDEX.isBastion,
        tower: CELL_VECTOR_INDEX.isTower
    }
    result[typeIndex[building.name]] = 1
    result[CELL_VECTOR_INDEX.externalOwner] = relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.externalHpRatio] =
        building.maxHP && Number.isFinite(building.hp) ?
            building.hp / building.maxHP : 0
    result[CELL_VECTOR_INDEX.externalBlocksMovement] =
        building.name == 'wall' ? 1 : 0
    result[CELL_VECTOR_INDEX.externalBlocksRanged] = 1
    result[CELL_VECTOR_INDEX.externalRangeBonus] =
        building.name == 'tower' && Number.isFinite(building.rangeIncrease) ?
            building.rangeIncrease : 0
}

function vectorizePendingExternal(buildingProduction, playerColor, result) {
    let typeIndex = {
        wall: CELL_VECTOR_INDEX.isPendingWall,
        bastion: CELL_VECTOR_INDEX.isPendingBastion,
        tower: CELL_VECTOR_INDEX.isPendingTower
    }
    result[typeIndex[buildingProduction.name]] = 1
    result[CELL_VECTOR_INDEX.pendingExternalOwner] =
        relativePlayerValue(playerColor)
    result[CELL_VECTOR_INDEX.pendingExternalTurns] =
        buildingProduction.turns / EXTERNAL_PRODUCTION_TURNS_VECTOR_SCALE
    result[CELL_VECTOR_INDEX.pendingExternalHitable] = 1
}

function finiteUnitValue(value) {
    return Number.isFinite(value) ? value : 0
}

function unitCombatRange(unit) {
    if (Number.isFinite(unit.range)) {
        return unit.range
    }
    return unit.name == 'archer' ? 2 : (unit.name == 'catapult' ? 5 : 1)
}

function vectorizeCell(cell) {
    let result = new Array(CELL_VECTOR_SIZE)
    result = result.fill(0)
    vectorizePlayerGold(result)
    vectorizePlayerIncome(result)
    vectorizePlayerSuburbIncome(result)
    vectorizeSuburb(cell, result)
    if (!cell.building.isEmpty()) {
        result[CELL_VECTOR_INDEX.hasBuilding] = 1
        if (cell.building.isTown()) {
            vectorizeTown(cell.building, cell.playerColor, result)
        }
        else if (isBarrackObject(cell.building)) {
            vectorizeBarrack(cell.building, cell.playerColor, result)
        }
        else if (isPendingBarrackObject(cell.building)) {
            vectorizePendingBarrack(cell.building, cell.playerColor, result)
        }
        else if (isGoldmineObject(cell.building)) {
            vectorizeGoldmine(cell.building, cell.playerColor, result)
        }
        else if (isFarmObject(cell.building)) {
            vectorizeFarm(cell.building, cell.playerColor, result)
        }
        else if (isPendingFarmObject(cell.building)) {
            vectorizePendingFarm(cell.building, cell.playerColor, result)
        }
        else if (isExternalObject(cell.building)) {
            vectorizeExternal(cell.building, cell.playerColor, result)
        }
        else if (isPendingExternalObject(cell.building)) {
            vectorizePendingExternal(cell.building, cell.playerColor, result)
        }
    }
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
    result[CELL_VECTOR_INDEX.unitOwner] =
        cell.playerColor == 0 ? 0 : relativePlayerValue(cell.playerColor)
    if (mapper[unit.name] !== undefined) {
        result[CELL_VECTOR_INDEX.unitTypeStart + mapper[unit.name]] = 1
    }
    result[CELL_VECTOR_INDEX.unitMoves] = finiteUnitValue(unit.moves)
    result[CELL_VECTOR_INDEX.unitSpeed] = finiteUnitValue(unit.speed)
    result[CELL_VECTOR_INDEX.unitDamage] = finiteUnitValue(unit.dmg)
    result[CELL_VECTOR_INDEX.unitRange] = unitCombatRange(unit)
    result[CELL_VECTOR_INDEX.unitHp] = finiteUnitValue(unit.hp)
    result[CELL_VECTOR_INDEX.unitMaxHp] = finiteUnitValue(unit.maxHP)
    result[CELL_VECTOR_INDEX.unitHpRatio] =
        unit.maxHP ? finiteUnitValue(unit.hp) / unit.maxHP : 0
    result[CELL_VECTOR_INDEX.unitMinRange] = unit.name == 'catapult' ? 2 : 1
    result[CELL_VECTOR_INDEX.unitBuildingDamage] =
        finiteUnitValue(unit.buildingDMG)
    result[CELL_VECTOR_INDEX.unitIsRanged] =
        unit.name == 'archer' || unit.name == 'catapult' ? 1 : 0
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
