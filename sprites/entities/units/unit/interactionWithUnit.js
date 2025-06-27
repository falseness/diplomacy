/*
pos вычисляется при каждом клике на юнита
это плохо
*/
class InterationWithUnit {
    #moves
    constructor(speed) {
        this.way = new Way()
        this.speed = speed
        this.#moves = speed
    }
    set moves(num) {
        this.#moves = num
    }
    get moves() {
        return this.#moves
    }
    nextTurn() {
        this.moves = this.speed
    }
    needInstructions() {
        return this.moves > 0
    }
    cantInteract(coord, unit) {
        return (this.way.getDistance(coord) > this.moves || coordsEqually(unit.coord, coord))
    }
    get isMovesOver() {
        return !this.moves
    }
    removeSelect() {
        border.visible = false
        grid.drawLogicText = false
        entityInterface.visible = false
    }
    getAvailableMoveCommandDestinations(unit) {
        return this.way.create(unit.coord, this.moves, grid.arr, unit.playerColor, border)
    }
    getAvailableCommandDestinations(unit) {
        return this.getAvailableMoveCommandDestinations(unit)
    }
    select(unit) {
        entityInterface.change(unit.info, unit.player.fullColor)
        grid.drawLogicText = false
        border.newBrokenLine()
        let borderRadius = this.moves
        if (!unit.isMyTurn) {
            borderRadius = this.speed
        }

        this.way.create(unit.coord, borderRadius, grid.arr, unit.playerColor, border)
    }
    addHittedUnitUndo(cell) {
        actionManager.lastAction.units.push(cell.unit.toJSON())
    }
    hitUnit(cell, unit) {
        this.addHittedUnitUndo(cell)

        let cellUnit = cell.unit
        let killed = cell.unit.hit(unit.dmg)
        if (!killed)
            this.addKillUnitUndo(cellUnit)
    }
    addHittedBuildingUndo(cell) {
        if (cell.building.isTown()) {
            actionManager.lastAction.town = cell.building.toUndoJSON()
        } 
        else {
            actionManager.lastAction.building = cell.building.toUndoJSON()
        }
    }
    hitBuilding(cell, unit) {
        this.addHittedBuildingUndo(cell)

        let cellBuilding = cell.building
        let killed = cell.building.hit(unit.dmg)
        if (!killed)
            this.addKillBuildingUndo(cellBuilding)
    }
    canHitSomethingOnCell(cell, unit) {
        return !this.cantInteract(cell.coord, unit) && 
            (this.cellHasEnemyBuilding(cell, unit) || this.cellHasEnemyUnit(cell, unit))
    }
    sendInstructions(cell, unit) {
        let coord = cell.coord
        if (this.cantInteract(coord, unit)) {
            this.removeSelect()
            return true
        }
        this.move(coord, cell, grid.arr, unit)
        if (this.isMovesOver) {
            this.removeSelect()
            return true
        }
        this.select(unit)
        return false
    }
    addThisUndo(unit) {
        actionManager.startAction('unit')
        actionManager.lastAction.units.push(unit.toJSON())
    }
    move(coord, cell, arr, unit) {
        this.addThisUndo(unit)
        //this.addUndo()
        this.moves -= this.way.getDistance(coord)
        let hitUnit = this.hitIfCellHasEnemy(cell, unit)
        let killEnemy = false
        if (this.cantStandOnCell(cell, unit)) 
            coord = this.way.getParent(coord)
        else
            killEnemy = true

        let killUnit = hitUnit && killEnemy
        this.paintHexagons(coord, arr, unit, killUnit)
        this.changeCoord(coord, unit, killUnit)
        if (isFogOfWar)
            unit.changeFogOfWarByVision()
    }
    paintHexagons(original_coord, arr, unit, isKillUnit) {
        let coord = Object.assign({}, original_coord)
    
        let capturedBuilding = grid.getBuilding(original_coord)
        let capturedBuildingColor = -1
        if (capturedBuilding.isStandable)
            capturedBuildingColor = capturedBuilding.playerColor
        
        while (!(coord.x == unit.coord.x && coord.y == unit.coord.y)) {
            let hexagon = arr[coord.x][coord.y].hexagon
            hexagon.repaint(unit.playerColor)
            coord = this.way.getParent(coord)
        }

        if (capturedBuildingColor != -1 && 
            capturedBuildingColor != unit.playerColor) { // <=> something building captured
            actionManager.lastAction.isBuildingCaptured = true
            capturedBuilding.updatePlayer()
            capturedBuilding.isRecentlyCaptured = true
        }
    }
    skipMoves(unit) {
        this.addThisUndo(unit)
        this.moves = 0
        this.addKillUnitUndo(unit)
    }
    addKillUnitUndo(unit) {
        actionManager.lastAction.killUnit.push({
            coord: {
                x: unit.coord.x,
                y: unit.coord.y
            }
        })
    }
    addKillBuildingUndo(building) {
        actionManager.lastAction.killBuilding = {
            coord: {
                x: building.coord.x,
                y: building.coord.y
            },
            name: building.name
        }
    }
    changeCoord(coord, unit, killUnit) {
        grid.setUnit(new Empty(), unit.coord)
        unit.coord = coord

        if (!killUnit) {
            let oldUnit = grid.getUnit(coord).toJSON()
            if (oldUnit.name == "Empty") {
                oldUnit.coord = {
                    x: coord.x,
                    y: coord.y
                }
            }
            actionManager.lastAction.units.push(oldUnit)
        }

        grid.setUnit(unit, unit.coord)
        unit.pos = unit.calcPos()
        unit.trimBars()

        this.addKillUnitUndo(unit)
    }
    cellHasEnemyBuilding(cell, unit) {
        return (cell.building.notEmpty() && 
            cell.building.playerColor != unit.playerColor && !cell.building.isPassable)
    }
    cellHasEnemyUnit(cell, unit) {
        return cell.unit.notEmpty() && 
            cell.unit.playerColor != unit.playerColor
    }
    
    markIgnoredBuilding(cell) {
        this.addHittedBuildingUndo(cell)
        cell.building.wasHitted = true
    }
    hitIfCellHasEnemy(cell, unit) {
        // the building is always priority target
        if (this.cellHasEnemyBuilding(cell, unit)) {
            if (cell.building.isHitable) {
                this.hitBuilding(cell, unit)
                return false
            }
            this.markIgnoredBuilding(cell)
        }
        
        if (this.cellHasEnemyUnit(cell, unit)) {
            this.hitUnit(cell, unit)
            return true
        }
        return false
    }
    cantStandOnCell(cell, unit) {
        return (this.cellHasEnemyBuilding(cell, unit) && !cell.building.isStandable) || 
            cell.unit.notEmpty()
    }
}

class Way {
    constructor() {
        this.distance = []
        this.parent = []
    }
    needToCreateLine(parent, child, moves) {
        return this.distance[parent.x][parent.y] == moves && this.distance[child.x][child.y] > moves
    }
    getDistance(coord) {
        return this.distance[coord.x][coord.y]
    }
    getParent(coord) {
        return Object.assign({}, this.parent[coord.x][coord.y])
    }
    initialization(v0, moves, arr, bord, newBorder) {
        grid.newLogicText()
        let used = new Array(arr.length)
        this.distance = new Array(arr.length)
        this.parent = new Array(arr.length)
        for (let i = 0; i < arr.length; ++i) {
            used[i] = new Array(arr[i].length)
            this.distance[i] = new Array(arr[i].length)
            this.parent[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j) {
                used[i][j] = false
                this.distance[i][j] = moves + 1
                this.parent[i][j] = { x: i, y: j }
            }
        }
        used[v0.x][v0.y] = true
        this.distance[v0.x][v0.y] = 0
        this.parent[v0.x][v0.y] = v0
        return used
    }
    isCellImpassable(neighbour, v0, arr, player) {
        let cell = arr[neighbour.x][neighbour.y]
        let ourUnit = cell.unit.notEmpty() && cell.unit.playerColor == player && 
                        !coordsEqually(neighbour, v0)
        let buildingObstacle = cell.building.isObstacle(player)
        let fogged = isFogOfWar && !grid.fogOfWar[neighbour.x][neighbour.y]
        return (ourUnit || buildingObstacle || fogged)       
    }
    sortNeighbours(v0, v, neighbours, arr, player, bord) {
        // if hexagon has the same color, he will be processed later
        let sortedHexagonNeighbours = []
        for (let i = 0; i < neighbours.length; ++i) {
            if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) || this.isCellImpassable(neighbours[i], v0, arr, player)) {
                bord.createLine(arr[v.x][v.y].hexagon.calcPos(), i)
                continue
            }
            let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon
            if (hexagon.playerColor != player) sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
        }
        for (let i = 0; i < neighbours.length; ++i) {
            if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) || this.isCellImpassable(neighbours[i], v0, arr, player)) {
                bord.createLine(arr[v.x][v.y].hexagon.calcPos(), i)
                continue
            }
            let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon
            if (hexagon.playerColor == player) sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
        }
        return sortedHexagonNeighbours
    }
    cellHasEnemyEntity(cell, player) {
        return (!cell.building.isPassable && cell.building.playerColor != player) ||
         (cell.unit.notEmpty() && cell.unit.playerColor != player)
    }
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        let cell = grid.arr[coord.x][coord.y]
        if (this.cellHasEnemyEntity(cell, player)) {
            enemyEntityQ.push(coord)
            this.distance[coord.x][coord.y] = Math.max(moves, this.distance[v.x][v.y] + 1)
        } else {
            Q.push(coord)
            this.distance[coord.x][coord.y] = this.distance[v.x][v.y] + 1
        }
        this.parent[coord.x][coord.y] = v
        used[coord.x][coord.y] = true
    }
    create(v0, moves, arr, player, bord, changeLogicText = false, newBorder = true) {
        // init
        let visitedCoords = []

        let used = this.initialization(v0, moves, arr, newBorder)
        let Q = []
        Q.push(v0)
        let enemyEntityQ = [] //for pass mode only
            // BFS
        while (Q.length > 0 || enemyEntityQ.length > 0) {
            let v
            if (Q.length) 
                v = Q.shift()
            else 
                v = enemyEntityQ.shift()
            if (changeLogicText && this.distance[v.x][v.y]) 
                arr[v.x][v.y].logicText.text = this.distance[v.x][v.y]
            if (this.distance[v.x][v.y] > moves) 
                continue
            visitedCoords.push(v)
            let neighbours = arr[v.x][v.y].hexagon.neighbours
            let sortedHexagonNeighbours = this.sortNeighbours(v0, v, neighbours, arr, player, bord)
            for (let i = 0; i < sortedHexagonNeighbours.length; ++i) {
                let coord = sortedHexagonNeighbours[i].hexagon.coord
                if (this.needToCreateLine(v, coord, moves)) {
                    bord.createLine(arr[v.x][v.y].hexagon.calcPos(), sortedHexagonNeighbours[i].side)
                }
                if (!used[coord.x][coord.y]) {
                    this.notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ)
                }
            }
        }
        return visitedCoords
    }
}
class VisionWay {
    constructor() {}
    changeFogOfWarByVision(v0, fogOfWarArr, visionRange, value = 1, isIgnoreBarriers = false) {
        if (visionRange < 0)
            return
        let us = ++grid.newVisionUsedValue
        let used = grid.visionUsed
        let dist = grid.visionDistance
        let Q = [v0]
        used[v0.x][v0.y] = us
        dist[v0.x][v0.y] = 0

        while (Q.length) {
            let v = Q.shift()
            
            fogOfWarArr[v.x][v.y] += value

            if (dist[v.x][v.y] == visionRange || (!isIgnoreBarriers && !coordsEqually(v, v0) &&
                grid.arr[v.x][v.y].building.isBarrier()))
                continue

            let neighbours = grid.arr[v.x][v.y].hexagon.neighbours
            for (let i = 0; i < neighbours.length; ++i) {
                let t = neighbours[i]

                if (isCoordNotOnMap(t, grid.arr.length, grid.arr[0].length))
                    continue

                if (used[t.x][t.y] != us) {
                    used[t.x][t.y] = us
                    dist[t.x][t.y] = dist[v.x][v.y] + 1
                    Q.push(t)
                }
            }
        }
    }
}

// used in simple ai player logic
class BestEnemyTargetForAI extends Way {
    isCellImpassable(neighbour, v0, arr, player) {
        let cell = arr[neighbour.x][neighbour.y]
        return cell.building.isStaticNature && cell.building.isObstacle(player)       
    }
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        Q.push(coord)
        this.distance[coord.x][coord.y] = this.distance[v.x][v.y] + 1
        this.parent[coord.x][coord.y] = v
        used[coord.x][coord.y] = true
    }
    static unreachableDistance = 999999
    calculateBestEnemyTarget(v0, grid_arr, myPlayerColor) {
        // might be faster but it is not important
        this.create(v0, this.constructor.unreachableDistance, grid_arr, myPlayerColor, border)
        let resultCoord = { x: -1, y: -1 }
        let minDistance = this.constructor.unreachableDistance
        for (let i = 0; i < grid_arr.length; ++i) {
            for (let j = 0; j < grid_arr[i].length; ++j) {
                let cell = grid_arr[i][j] 
                let is_building_target = cell.building.notEmpty() && 
                    cell.building.playerColor != myPlayerColor && 
                    !cell.building.isExternal && !cell.building.isNature
                if (is_building_target && 
                    this.distance[i][j] < minDistance) {
                    minDistance = this.distance[i][j]
                    resultCoord = { x: i, y: j }
                }
            }
        }
        if (minDistance != this.constructor.unreachableDistance) {
            return resultCoord
        }
        for (let i = 0; i < grid_arr.length; ++i) {
            for (let j = 0; j < grid_arr[i].length; ++j) {
                let cell = grid_arr[i][j] 
                let is_unit_target = cell.unit.notEmpty() && 
                    cell.unit.playerColor != myPlayerColor
                if (is_unit_target && 
                    this.distance[i][j] < minDistance) {
                    minDistance = this.distance[i][j]
                    resultCoord = { x: i, y: j }
                }
            }
        }
        if (minDistance != this.constructor.unreachableDistance) {
            return resultCoord
        }
        return null
    }
    // might be empty array
    GetCommandNearestToBestTarget(availableCellsCommands, v0, grid_arr, myPlayerColor) {
        let target_coord = this.calculateBestEnemyTarget(v0, grid_arr, myPlayerColor)
        if (target_coord == null) {
            return null
        }
        let commandsOnDistanceOne = []
        
        for (let i = 0; i < availableCellsCommands.length; ++i) {
            if (this.distance[availableCellsCommands[i].destinationCoord.x][availableCellsCommands[i].destinationCoord.y] == 1) {
                commandsOnDistanceOne.push(availableCellsCommands[i])
            }
        }
        
        
        this.create(target_coord, this.constructor.unreachableDistance, grid_arr, myPlayerColor, border)
        // now distance means distance to building
        let bestCommand = null
        let minDistance = this.constructor.unreachableDistance
        for (let i = 0; i < commandsOnDistanceOne.length; ++i) {
            if (this.distance[commandsOnDistanceOne[i].destinationCoord.x][commandsOnDistanceOne[i].destinationCoord.y] < minDistance) {
                minDistance = this.distance[commandsOnDistanceOne[i].destinationCoord.x][commandsOnDistanceOne[i].destinationCoord.y]
                bestCommand = commandsOnDistanceOne[i]
            } 
        }
        return bestCommand
    }
}

