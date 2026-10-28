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
    getAvailableCommandDestinations(unit) {
        return this.way.create(unit.coord, this.moves, grid.arr, unit.playerColor, border)
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
        } else {
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
        return !unit.player.ignoresCell(cell) && !this.cantInteract(cell.coord, unit) &&
            (this.cellHasEnemyBuilding(cell, unit) || this.cellHasEnemyUnit(cell, unit))
    }
    sendInstructions(cell, unit) {
        if (unit.player.ignoresCell(cell)) return true
        // Rebuild demon movement before execution: a stored path may now cross
        // a neutral town after ownership or board state changed.
        if (unit.player.role === 'DEMONS')
            this.way.create(unit.coord, this.moves, grid.arr, unit.playerColor, border)
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
        if (gameSettings.coop) refreshCoopVision()
        else if (isFogOfWar) unit.changeFogOfWarByVision()
        grid.reportLoadingCells()
    }
    paintHexagons(original_coord, arr, unit, isKillUnit) {
        let coord = Object.assign({}, original_coord)

        let capturedBuilding = grid.getBuilding(original_coord)
        let capturedBuildingColor = -1
        if (capturedBuilding.isStandable)
            capturedBuildingColor = capturedBuilding.playerColor

        // Entry has already passed HP and defender clearance. No player razes
        // today (demons capture towns like humans); a razing player destroys
        // the building before repainting so it is never registered as its asset.
        if (capturedBuildingColor != -1 && unit.player.shouldRazeBuilding(capturedBuilding)) {
            const owner = capturedBuilding.player
            capturedBuilding.destroy()
            owner.updateTowns()
            grid.getHexagon(original_coord).isSuburb = false
            capturedBuildingColor = -1
        }

        while (!(coord.x == unit.coord.x && coord.y == unit.coord.y)) {
            let hexagon = arr[coord.x][coord.y].hexagon
            hexagon.repaint(unit.playerColor)
            coord = this.way.getParent(coord)
        }

        if (capturedBuildingColor != -1 &&
            capturedBuildingColor != unit.playerColor) { // <=> something building captured
            actionManager.lastAction.isBuildingCaptured = true
            capturedBuilding.updatePlayer(capturedBuildingColor)
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
        if (building.isBuildingProduction && building.isBuildingProduction()) {
            if (building.isExternalProduction && building.isExternalProduction()) {
                actionManager.lastAction.externalProduction = building.toUndoJSON()
            }
            else {
                let packedProduction = building.toUndoJSON()
                actionManager.lastAction.buildingProduction = packedProduction
                if (actionManager.lastAction.buildingProductions) {
                    actionManager.lastAction.buildingProductions.push(packedProduction)
                }
            }
        }
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
            let oldBuilding = grid.getBuilding(coord)
            if (oldBuilding && oldBuilding.notEmpty && oldBuilding.notEmpty() &&
                    oldBuilding.isBuildingProduction &&
                    oldBuilding.isBuildingProduction() &&
                    !(oldBuilding.isExternalProduction &&
                    oldBuilding.isExternalProduction()) &&
                    actionManager.lastAction.buildingProductions) {
                actionManager.lastAction.buildingProductions.push(
                    oldBuilding.toUndoJSON())
            }
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
        return (!unit.player.ignoresCell(cell) && cell.building.notEmpty() &&
            !unit.player.isAlliedWith(cell.building.player) && !cell.building.isPassable)
    }
    cellHasEnemyUnit(cell, unit) {
        return !unit.player.ignoresCell(cell) && cell.unit.notEmpty() &&
            !unit.player.isAlliedWith(cell.unit.player)
    }

    // A demon standing on its live portal is hit instead of the portal.
    demonShieldsPortal(cell, unit) {
        return cell.building.isDemonPortal === true && !cell.building.killed &&
            this.cellHasEnemyUnit(cell, unit)
    }
    markIgnoredBuilding(cell) {
        this.addHittedBuildingUndo(cell)
        cell.building.wasHitted = true
    }
    hitIfCellHasEnemy(cell, unit) {
        // the building is the priority target, except a demon-held portal
        if (this.cellHasEnemyBuilding(cell, unit) && !this.demonShieldsPortal(cell, unit)) {
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
        return !unit.player.canEnterBuilding(cell.building) ||
            (this.cellHasEnemyBuilding(cell, unit) && !cell.building.isStandable) ||
            cell.unit.notEmpty()
    }
}

// Way keys a cell by x * WAY_KEY_STRIDE + y (maps are far narrower than the stride).
const WAY_KEY_STRIDE = 1 << 16
class Way {
    // Only the cells the last search reached are stored (a few dozen per search on a map of
    // thousands of cells, searched several times per unit move): distanceOf and parentOf map
    // their keys to the distance and the parent coord. Every other cell of the map has the
    // distance filledMoves + 1 and is its own parent, as the full arrays of the old search had.
    constructor() {
        this.distanceOf = new Map()
        this.parentOf = new Map()
        this.searchArr = null
        this.filledMoves = 0
        this.distanceRows = null
    }
    // The whole distance array (x, y), built on demand for readers outside the search.
    get distance() {
        if (!this.distanceRows) {
            let arr = this.searchArr
            let rows = []
            for (let x = 0; arr && x < arr.length; ++x) {
                rows.push(new Array(arr[x].length).fill(this.filledMoves + 1))
            }
            for (let [key, distance] of this.distanceOf) {
                rows[Math.floor(key / WAY_KEY_STRIDE)][key % WAY_KEY_STRIDE] = distance
            }
            this.distanceRows = rows
        }
        return this.distanceRows
    }
    set distance(rows) {
        this.distanceRows = rows
    }
    isOnSearchedMap(coord) {
        let arr = this.searchArr
        return !!(arr && arr[coord.x] && coord.y >= 0 && coord.y < arr[coord.x].length)
    }
    distanceAt(coord) {
        let distance = this.distanceOf.get(coord.x * WAY_KEY_STRIDE + coord.y)
        return distance === undefined ? this.filledMoves + 1 : distance
    }
    setDistance(coord, distance) {
        this.distanceOf.set(coord.x * WAY_KEY_STRIDE + coord.y, distance)
    }
    // a cell is used (marked by the search) once it has a parent
    isUsed(coord) {
        return this.parentOf.has(coord.x * WAY_KEY_STRIDE + coord.y)
    }
    setParent(coord, parent) {
        this.parentOf.set(coord.x * WAY_KEY_STRIDE + coord.y, parent)
    }
    needToCreateLine(parent, child, moves) {
        return this.distanceAt(parent) == moves && this.distanceAt(child) > moves
    }
    getDistance(coord) {
        return this.isOnSearchedMap(coord) ? this.distanceAt(coord) : undefined
    }
    getParent(coord) {
        // an unreached cell (no parent) is its own parent
        let parent = this.isOnSearchedMap(coord) && this.parentOf.get(coord.x * WAY_KEY_STRIDE + coord.y)
        return parent ? Object.assign({}, parent) : { x: coord.x, y: coord.y }
    }
    // Resets only the cells the previous search reached (create dequeues every cell it marks).
    // Returns no used array: isUsed() answers for a cell.
    initialization(v0, moves, arr, bord, newBorder) {
        grid.newLogicText()
        this.distanceOf.clear()
        this.parentOf.clear()
        this.distanceRows = null
        this.searchArr = arr
        this.filledMoves = moves
        this.setDistance(v0, 0)
        this.setParent(v0, v0)
        return null
    }
    isCellImpassable(neighbour, v0, arr, player) {
        let cell = arr[neighbour.x][neighbour.y]
        let ourUnit = cell.unit.notEmpty() && cell.unit.playerColor == player &&
            !coordsEqually(neighbour, v0)
        // Teammate buildings cannot be captured, including by an intermediate path step.
        // Passable nature has no owner of its own (it reports the hex colour), so it stays walkable.
        let teammateBuilding = cell.building.notEmpty() && cell.building.playerColor != player &&
            !(cell.building.isNature && cell.building.isPassable) &&
            players[player].isAlliedWith(cell.building.player)
        let teammateUnit = cell.unit.notEmpty() && cell.unit.playerColor != player &&
            players[player].isAlliedWith(cell.unit.player)
        let buildingObstacle = cell.building.isObstacle(player) || teammateBuilding || teammateUnit
        // Co-op fog contains human sight only; automatic demons and a map's ignoresFog player do not use it.
        let fogged = isFogOfWar && players[player].role !== 'DEMONS' && !players[player].ignoresFog &&
            !grid.fogOfWar[neighbour.x][neighbour.y]
        return (players[player].ignoresCell(cell) || ourUnit || buildingObstacle || fogged)
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
        return !players[player].canEnterBuilding(cell.building) ||
            (!cell.building.isPassable && cell.building.playerColor != player) ||
            (cell.unit.notEmpty() && cell.unit.playerColor != player)
    }
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        let cell = grid.arr[coord.x][coord.y]
        if (this.cellHasEnemyEntity(cell, player)) {
            enemyEntityQ.push(coord)
            this.setDistance(coord, Math.max(moves, this.distanceAt(v) + 1))
        } else {
            Q.push(coord)
            this.setDistance(coord, this.distanceAt(v) + 1)
        }
        this.setParent(coord, v)
    }
    // return arr of visitedCoords except v0
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
            let distance = this.distanceAt(v)
            if (changeLogicText && distance)
                arr[v.x][v.y].logicText.text = distance
            if (distance > moves)
                continue
            visitedCoords.push(v)
            let neighbours = arr[v.x][v.y].hexagon.neighbours
            let sortedHexagonNeighbours = this.sortNeighbours(v0, v, neighbours, arr, player, bord)
            for (let i = 0; i < sortedHexagonNeighbours.length; ++i) {
                let coord = sortedHexagonNeighbours[i].hexagon.coord
                if (this.needToCreateLine(v, coord, moves)) {
                    bord.createLine(arr[v.x][v.y].hexagon.calcPos(), sortedHexagonNeighbours[i].side)
                }
                if (!this.isUsed(coord)) {
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

            // The InvisibleMountain ring of a hexagonal map ends the vision even for a unit on a
            // tower/hill/town (isIgnoreBarriers): nothing beyond the map edge is seen.
            let building = grid.arr[v.x][v.y].building
            if (dist[v.x][v.y] == visionRange || (!coordsEqually(v, v0) &&
                    (building.isMapEdge || (!isIgnoreBarriers && building.isBarrier()))))
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

class InfluenceFieldWay {
    constructor(grid_class) {
        this.influenceFieldVisited = []
        this.__distance = []
        this.__usedIndex = 0
        let n = grid_class.arr.length
        let m = grid_class.arr[0].length
        grid_class.fullInitArr(n, m, this.influenceFieldVisited, 0)
        grid_class.fullInitArr(n, m, this.__distance, 0)
        this.__grid_class = grid_class
    }
    paintInfluenceField(v0, influenceRange) {
        ++this.__usedIndex
        let Q = [v0]
        this.influenceFieldVisited[v0.x][v0.y] = this.__usedIndex
        this.__distance[v0.x][v0.y] = 0
        while (Q.length) {
            let v = Q.shift()
            let neighbours = this.__grid_class.arr[v.x][v.y].hexagon.neighbours
            if (this.__distance[v.x][v.y] >= influenceRange)
                continue
            for (let i = 0; i < neighbours.length; ++i) {
                let t = neighbours[i]
                if (isCoordNotOnMap(t, this.__grid_class.arr.length, this.__grid_class.arr[0].length))
                    continue
                if (this.influenceFieldVisited[t.x][t.y] == this.__usedIndex)
                    continue
                this.influenceFieldVisited[t.x][t.y] = this.__usedIndex
                this.__distance[t.x][t.y] = this.__distance[v.x][v.y] + 1
                Q.push(t)
            }
        }
    }
}

// used in simple ai player logic
// Runs two whole-map searches per AI step, so it keeps flat typed arrays and a cached
// neighbour table and draws no border lines or logic text. Plain BFS: the distances,
// and hence every target and command choice, equal those of Way.create.
// distance (rows over flatDistance) always holds the whole result of the last search.
class BestEnemyTargetForAI extends Way {
    getDistance(coord) {
        return this.distance[coord.x][coord.y]
    }
    // Before a search with `moves`: every cell to moves + 1. A search writes the distance of
    // exactly the cells it queues (queue[0..writtenCells)), so after one with the same moves
    // only those are reset, not the whole map.
    resetDistances(moves) {
        const distance = this.flatDistance
        if (this.writtenMoves === moves) {
            const queue = this.queue
            for (let i = 0; i < this.writtenCells; ++i) {
                distance[queue[i]] = moves + 1
            }
        } else {
            distance.fill(moves + 1)
        }
        this.writtenMoves = moves
        this.writtenCells = 0
    }
    isCellBlocked(cell, player) {
        return players[player].ignoresCell(cell) ||
            (cell.building.isStaticNature && cell.building.isObstacle(player))
    }
    isCellImpassable(neighbour, v0, arr, player) {
        return this.isCellBlocked(arr[neighbour.x][neighbour.y], player)
    }
    prepareSearch(arr) {
        const n = arr.length
        const m = arr[0].length
        if (this.searchArr === arr && this.searchN === n && this.searchM === m) {
            return
        }
        const size = n * m
        // neighbourTable[6k + side]: flat index of that neighbour of cell k, or -1 off the map
        const neighbourTable = new Int32Array(size * 6)
        for (let x = 0; x < n; ++x) {
            const sides = neighborhood[x & 1]
            for (let y = 0; y < m; ++y) {
                const base = (x * m + y) * 6
                for (let side = 0; side < 6; ++side) {
                    const nx = x + sides[side][0]
                    const ny = y + sides[side][1]
                    neighbourTable[base + side] = isCoordNotOnMap({x: nx, y: ny}, n, m) ? -1 : nx * m + ny
                }
            }
        }
        this.searchArr = arr
        this.searchN = n
        this.searchM = m
        this.neighbourTable = neighbourTable
        this.flatDistance = new Int32Array(size)
        this.queue = new Int32Array(size)
        // usedStamp[k] == searchStamp: cell k is reached in the current search;
        // blockedStamp[k] == searchStamp: blocked[k] is known for it
        this.usedStamp = new Uint32Array(size)
        this.blockedStamp = new Uint32Array(size)
        this.blocked = new Uint8Array(size)
        this.searchStamp = 0
        // wantedStamp[k] == wantedSearch: cell k is one whose distance search() waits for
        this.wantedStamp = new Uint32Array(size)
        this.wantedSearch = 0
        this.writtenMoves = null
        this.writtenCells = 0
        this.distance = new Array(n)
        for (let x = 0; x < n; ++x) {
            this.distance[x] = this.flatDistance.subarray(x * m, (x + 1) * m)
        }
    }
    create(v0, moves, arr, player) {
        this.prepareSearch(arr)
        const m = this.searchM
        const distance = this.flatDistance
        const neighbourTable = this.neighbourTable
        const queue = this.queue
        const blocked = this.blocked
        const usedStamp = this.usedStamp
        const blockedStamp = this.blockedStamp
        const stamp = ++this.searchStamp
        this.resetDistances(moves)
        const start = v0.x * m + v0.y
        distance[start] = 0
        usedStamp[start] = stamp
        let head = 0
        let tail = 0
        queue[tail++] = start
        while (head < tail) {
            const v = queue[head++]
            if (distance[v] > moves) {
                continue
            }
            const next = distance[v] + 1
            for (let side = 0; side < 6; ++side) {
                const k = neighbourTable[v * 6 + side]
                if (k < 0 || usedStamp[k] === stamp) {
                    continue
                }
                if (blockedStamp[k] !== stamp) {
                    blockedStamp[k] = stamp
                    blocked[k] = this.isCellBlocked(arr[(k / m) | 0][k % m], player) ? 1 : 0
                }
                if (blocked[k]) {
                    continue
                }
                usedStamp[k] = stamp
                distance[k] = next
                queue[tail++] = k
            }
        }
        this.writtenCells = tail
    }
    static unreachableDistance = 999999
    // create(v0, unreachableDistance, arr, player) stopped as soon as the distances a caller reads are final: those of
    // every cell of `wanted` (coords), or with `target` (cell -> bool) those up to the distance L of the nearest target
    // cell and at least up to distance 1 (GetCommandNearestToBestTarget reads it). A breadth-first search gives a cell
    // its final distance when it first reaches it and reaches the cells in distance order; a cell it did not reach keeps
    // the unreachable distance + 1, as a cell create() cannot reach. Returns that nearest target cell's coord, ties by
    // lowest x then y (the whole-map scan's order: the strict '<' keeps the first), or null (then every reachable cell
    // was searched).
    search(v0, arr, player, {wanted = null, target = null} = {}) {
        const moves = this.constructor.unreachableDistance
        this.prepareSearch(arr)
        const m = this.searchM
        const distance = this.flatDistance
        const neighbourTable = this.neighbourTable
        const queue = this.queue
        const blocked = this.blocked
        const usedStamp = this.usedStamp
        const blockedStamp = this.blockedStamp
        const stamp = ++this.searchStamp
        this.resetDistances(moves)
        const start = v0.x * m + v0.y
        distance[start] = 0
        usedStamp[start] = stamp
        let head = 0
        let tail = 0
        queue[tail++] = start
        this.writtenCells = tail
        let remaining = 0
        const wantedStamp = this.wantedStamp
        const wantedSearch = wanted ? ++this.wantedSearch : 0
        if (wanted) {
            for (const coord of wanted) {
                const k = coord.x * m + coord.y
                if (wantedStamp[k] !== wantedSearch) {
                    wantedStamp[k] = wantedSearch
                    ++remaining
                }
            }
            if (wantedStamp[start] === wantedSearch) --remaining
            if (!remaining) return null
        }
        let found = -1
        let foundDistance = moves + 1
        const consider = k => {
            if (distance[k] > foundDistance || (distance[k] === foundDistance && k > found)) return
            if (target(arr[(k / m) | 0][k % m])) {
                foundDistance = distance[k]
                found = k
            }
        }
        if (target) consider(start)
        while (head < tail) {
            const v = queue[head++]
            if (found >= 0 && distance[v] >= Math.max(foundDistance, 1)) {
                break
            }
            const next = distance[v] + 1
            for (let side = 0; side < 6; ++side) {
                const k = neighbourTable[v * 6 + side]
                if (k < 0 || usedStamp[k] === stamp) {
                    continue
                }
                if (blockedStamp[k] !== stamp) {
                    blockedStamp[k] = stamp
                    blocked[k] = this.isCellBlocked(arr[(k / m) | 0][k % m], player) ? 1 : 0
                }
                if (blocked[k]) {
                    continue
                }
                usedStamp[k] = stamp
                distance[k] = next
                queue[tail++] = k
                this.writtenCells = tail
                if (target) consider(k)
                if (wanted && wantedStamp[k] === wantedSearch && --remaining === 0) {
                    return null
                }
            }
        }
        return found >= 0 ? {x: (found / m) | 0, y: found % m} : null
    }
    calculateBestEnemyTarget(v0, grid_arr, myPlayerColor) {
        // The nearest building target (search stops at its distance), as the scan over the whole search found it.
        const buildingTarget = this.search(v0, grid_arr, myPlayerColor, {target: cell =>
            !players[myPlayerColor].ignoresObjective(cell) && cell.building.notEmpty() &&
            !players[myPlayerColor].isAlliedWith(cell.building.player) &&
            (!cell.building.isExternal || cell.building.isDemonPortal ||
                grid_arr[v0.x][v0.y].unit instanceof Bombard) && !cell.building.isNature})
        if (buildingTarget) {
            return buildingTarget
        }
        // No building target: the search reached every reachable cell.
        let resultCoord = { x: -1, y: -1 }
        let minDistance = this.constructor.unreachableDistance
        // Building-only siege must not pursue an enemy it can never damage.
        if (grid_arr[v0.x][v0.y].unit instanceof Bombard) return null
        for (let i = 0; i < grid_arr.length; ++i) {
            for (let j = 0; j < grid_arr[i].length; ++j) {
                if (this.distance[i][j] >= minDistance) {
                    continue
                }
                let cell = grid_arr[i][j]
                let is_unit_target = !players[myPlayerColor].ignoresCell(cell) && cell.unit.notEmpty() &&
                    !players[myPlayerColor].isAlliedWith(cell.unit.player)
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


        // only the distances of those commands' destinations are read
        this.search(target_coord, grid_arr, myPlayerColor, {wanted: commandsOnDistanceOne.map(command => command.destinationCoord)})
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
