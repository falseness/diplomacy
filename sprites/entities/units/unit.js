class Unit extends Entity {
    constructor(x, y, name, hp, dmg, speed, salary, town) {
        super(x, y, name, hp)
        this.dmg = dmg
        this.speed = speed
        this.moves = speed
        this.salary = salary
        this.killed = false
        this.town = town

        grid.arr[x][y].unit = this

        this.way = new Way()
    }
    getSalary() {
        return this.salary
    }
    getPlayer() {
        return this.town.getPlayer()
    }
    isKilled() {
        return this.killed
    }
    getInfo() {
        let unit = super.getInfo()
        unit.info.dmg = this.dmg
        unit.info.moves = this.moves + ' / ' + this.speed
        return unit
    }

    select() {
        //let border = Math.max(grid.arr.length, grid.arr[0].length)
        if (this.moves > 0) {
            let arr = grid.arr
            this.way.BFS(this.coord, this.moves, arr, this.getPlayer())
        }
    }
    removeSelect() {
        border.setVisible(false)
        grid.setDrawLogicText(false)
            //entityInterface.setVisible(false)
    }
    needInstructions() {
        return this.moves > 0
    }
    sendInstructions(cell) {
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
            arr[coord.x][coord.y].hexagon.repaint(this.getPlayer())

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

        this.paintHexagons(coord, grid.arr)

        this.changeCoord(coord)
    }
    kill() {
        grid.arr[this.coord.x][this.coord.y].unit = new Empty()

        this.killed = true

        this.town.UpdateUnitsArray()
    }
    nextTurn(whooseTurn) {
        if (this.getPlayer() == whooseTurn) {
            this.moves = this.speed
        }
    }
}
class Way {
    constructor() {
        this.color = 'white'
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
    BFS(v0, moves, arr, player) {
        // init
        border.newBrokenLine()
        grid.newLogicText(true)

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

        let Q = []
        Q.push(v0)

        used[v0.x][v0.y] = true
        this.distance[v0.x][v0.y] = 0
        this.parent[v0.x][v0.y] = v0
            // BFS
        while (Q.length > 0) {
            let v = Q.shift()

            arr[v.x][v.y].logicText.setText(this.distance[v.x][v.y])
            if (this.distance[v.x][v.y] > moves)
                continue

            let neighbours = arr[v.x][v.y].hexagon.getNeighbours()

            // if hexagon has the same color, he will be processed later

            let sortedHexagonNeighbours = []
            for (let i = 0; i < neighbours.length; ++i) {
                if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) ||
                    (arr[neighbours[i].x][neighbours[i].y].unit.notEmpty() && !coordsEqually(neighbours[i], v0))) {
                    border.createLine(arr[v.x][v.y].hexagon.getPos(), i)
                    continue
                }

                let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon

                if (hexagon.player != player)
                    sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
            }
            for (let i = 0; i < neighbours.length; ++i) {
                if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) ||
                    (arr[neighbours[i].x][neighbours[i].y].unit.notEmpty() && !coordsEqually(neighbours[i], v0))) {
                    border.createLine(arr[v.x][v.y].hexagon.getPos(), i)
                    continue
                }

                let hexagon = arr[neighbours[i].x][neighbours[i].y].hexagon

                if (hexagon.player == player)
                    sortedHexagonNeighbours.push({ hexagon: hexagon, side: i })
            }



            for (let i = 0; i < sortedHexagonNeighbours.length; ++i) {
                let coord = sortedHexagonNeighbours[i].hexagon.coord

                if (this.needToCreateLine(v, coord, moves)) {
                    border.createLine(arr[v.x][v.y].hexagon.getPos(), sortedHexagonNeighbours[i].side)
                }

                if (!used[coord.x][coord.y]) {
                    Q.push(coord)

                    this.distance[coord.x][coord.y] = this.distance[v.x][v.y] + 1

                    this.parent[coord.x][coord.y] = v
                    used[coord.x][coord.y] = true
                }
            }
        }
    }
}