class Unit extends Entity {
    constructor(x, y, name, hp, dmg, speed, salary, town) {
        super(x, y, name, hp)
        this.dmg = dmg
        this.speed = speed
        this.moves = speed
        this.salary = salary
        this.town = town

        grid.arr[x][y].unit = this

        this.way = new Way()
    }
    getDMG() {
        return this.dmg
    }
    getSalary() {
        return this.salary
    }
    getPlayer() {
        return this.town.getPlayer()
    }
    getInfo() {
        let unit = super.getInfo()
        unit.info.dmg = this.dmg

        if (this.isMyTurn())
            unit.info.moves = this.moves + ' / ' + this.speed

        unit.info.salary = this.salary
        return unit
    }
    select() {
        //let border = Math.max(grid.arr.length, grid.arr[0].length)
        entityInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())

        let arr = grid.arr
        if (!this.isMyTurn()) {

            this.way.create(this.coord, 0, arr, this.getPlayer())

            grid.setDrawLogicText(false)
            return
        }
        this.way.create(this.coord, this.moves, arr, this.getPlayer())
    }
    removeSelect() {
        border.setVisible(false)
        grid.setDrawLogicText(false)
        entityInterface.setVisible(false)
    }
    needInstructions() {
        if (!this.isMyTurn())
            return false

        return this.moves > 0
    }
    sendInstructions(cell) {
        if (!this.isMyTurn())
            return true

        let coord = cell.hexagon.coord

        if (this.way.getDistance(coord) > this.moves ||
            coordsEqually(this.coord, coord)) {
            this.removeSelect()
            return true
        }

        this.move(coord, grid.arr)
        if (!this.moves) {
            this.removeSelect()
            return true
        }

        this.select()
        return false
    }
    paintHexagons(original_coord, arr) {
        let coord = Object.assign({}, original_coord)

        while (!(coord.x == this.coord.x && coord.y == this.coord.y)) {
            let hexagon = arr[coord.x][coord.y].hexagon
            if (hexagon.getPlayer() != this.getPlayer()) {
                hexagon.setIsSuburb(false)
                hexagon.repaint(this.getPlayer())
            }

            coord = this.way.getParent(coord)
        }
    }
    changeCoord(coord) {
        grid.arr[this.coord.x][this.coord.y].unit = new Empty()

        this.coord = coord
        grid.arr[this.coord.x][this.coord.y].unit = this
    }
    move(coord, arr) {
        this.moves -= this.way.getDistance(coord)
        let cell = arr[coord.x][coord.y]
            // the building is always priority target
        if ((cell.building.notEmpty() && cell.building.getPlayer() != this.getPlayer())) {
            cell.building.hit(this.getDMG())
        } else if (cell.unit.notEmpty()) {
            cell.unit.hit(this.getDMG())
        }
        // if enemy entity is not dead we cant stand on his cell
        if ((cell.building.notEmpty() && cell.building.getPlayer() != this.getPlayer()) ||
            cell.unit.notEmpty())
            coord = this.way.getParent(coord)

        this.paintHexagons(coord, grid.arr)

        this.changeCoord(coord)
    }
    kill() {
        grid.arr[this.coord.x][this.coord.y].unit = new Empty()

        this.killed = true

        this.town.updateUnitsArray()
    }
    nextTurn(whooseTurn) {
        if (this.getPlayer() == whooseTurn) {
            this.moves = this.speed
        }
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
    initialization(v0, moves, arr, newBorder) {
        if (newBorder)
            border.newBrokenLine()
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

        return (cell.unit.notEmpty() && cell.unit.getPlayer() == player &&
            !coordsEqually(neighbour, v0))
    }
    sortNeighbours(v0, v, neighbours, arr, player) {
        // if hexagon has the same color, he will be processed later

        let sortedHexagonNeighbours = []
        for (let i = 0; i < neighbours.length; ++i) {
            if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) ||
                this.isCellImpassable(neighbours[i], v0, arr, player)) {
                border.createLine(arr[v.x][v.y].hexagon.getPos(), i)
                continue
            }

            let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon

            if (hexagon.player != player)
                sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
        }
        for (let i = 0; i < neighbours.length; ++i) {
            if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) ||
                this.isCellImpassable(neighbours[i], v0, arr, player)) {
                border.createLine(arr[v.x][v.y].hexagon.getPos(), i)
                continue
            }

            let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon

            if (hexagon.player == player)
                sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
        }
        return sortedHexagonNeighbours
    }
    cellHasEnemyEntity(cell, player) {
        return (cell.building.notEmpty() && cell.building.getPlayer() != player) ||
            (cell.unit.notEmpty() && cell.unit.getPlayer() != player)
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
    create(v0, moves, arr, player, changeLogicText = true, newBorder = true) {
        // init
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

            if (changeLogicText)
                arr[v.x][v.y].logicText.setText(this.distance[v.x][v.y])

            if (this.distance[v.x][v.y] > moves)
                continue

            let neighbours = arr[v.x][v.y].hexagon.getNeighbours()

            let sortedHexagonNeighbours = this.sortNeighbours(v0, v, neighbours, arr, player)


            for (let i = 0; i < sortedHexagonNeighbours.length; ++i) {
                let coord = sortedHexagonNeighbours[i].hexagon.coord

                if (this.needToCreateLine(v, coord, moves)) {
                    border.createLine(arr[v.x][v.y].hexagon.getPos(), sortedHexagonNeighbours[i].side)
                }

                if (!used[coord.x][coord.y]) {
                    this.notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ)
                }
            }
        }
    }
}