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
        undoManager.lastUndo.units.push(cell.unit.toJSON())
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
            undoManager.lastUndo.town = cell.building.toJSON()
        } 
        else {
            undoManager.lastUndo.building = cell.building.toUndoJSON()
        }
    }
    hitBuilding(cell, unit) {
        this.addHittedBuildingUndo(cell)

        let cellBuilding = cell.building
        let killed = cell.building.hit(unit.dmg)
        if (!killed)
            this.addKillBuildingUndo(cellBuilding)
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
        undoManager.startUndo('unit')
        undoManager.lastUndo.units.push(unit.toJSON())
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
        this.paintHexagons(coord, arr, unit)
        this.changeCoord(coord, unit, killUnit)
    }
    paintHexagons(original_coord, arr, unit) {
        let coord = Object.assign({}, original_coord)
        while (!(coord.x == unit.coord.x && coord.y == unit.coord.y)) {
            let hexagon = arr[coord.x][coord.y].hexagon
            hexagon.repaint(unit.playerColor)
            coord = this.way.getParent(coord)
        }
    }
    addKillUnitUndo(unit) {
        undoManager.lastUndo.killUnit.push({
            coord: {
                x: unit.coord.x,
                y: unit.coord.y
            }
        })
    }
    addKillBuildingUndo(building) {
        undoManager.lastUndo.killBuilding = {
            coord: {
                x: building.coord.x,
                y: building.coord.y
            }
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
            undoManager.lastUndo.units.push(oldUnit)
        }

        grid.setUnit(unit, unit.coord)
        unit.pos = unit.calcPos()
        unit.trimHpBar()

        this.addKillUnitUndo(unit)
    }
    cellHasEnemyBuilding(cell, unit) {
        return (cell.building.notEmpty() && 
            cell.building.playerColor != unit.playerColor && !cell.building.isPassable)
    }
    hitIfCellHasEnemy(cell, unit) {
        // the building is always priority target
        if (this.cellHasEnemyBuilding(cell, unit)) {
            this.hitBuilding(cell, unit)
        } else if (cell.unit.notEmpty()) {
            this.hitUnit(cell, unit)
            return true
        }
        return false
    }
    cantStandOnCell(cell, unit) {
        return this.cellHasEnemyBuilding(cell, unit) || cell.unit.notEmpty()
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
        return (cell.unit.notEmpty() && cell.unit.playerColor == player && 
            !coordsEqually(neighbour, v0)) || 
            (cell.building.isWall() && cell.building.playerColor == player)
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
            if (hexagon.player != player) sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
        }
        for (let i = 0; i < neighbours.length; ++i) {
            if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) || this.isCellImpassable(neighbours[i], v0, arr, player)) {
                bord.createLine(arr[v.x][v.y].hexagon.calcPos(), i)
                continue
            }
            let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon
            if (hexagon.player == player) sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
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
    create(v0, moves, arr, player, bord, changeLogicText = true, newBorder = true) {
        // init
        let used = this.initialization(v0, moves, arr, newBorder)
        let Q = []
        Q.push(v0)
        let enemyEntityQ = [] //for pass mode only
            // BFS
        while (Q.length > 0 || enemyEntityQ.length > 0) {
            let v
            if (Q.length) v = Q.shift()
            else v = enemyEntityQ.shift()
            if (changeLogicText && this.distance[v.x][v.y]) arr[v.x][v.y].logicText.text = this.distance[v.x][v.y]
            if (this.distance[v.x][v.y] > moves) continue
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
    }
}