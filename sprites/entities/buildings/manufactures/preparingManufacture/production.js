class Production {
    #coord = {}
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        this.turns = turns
        this.cost = cost
        this.class = _class
        this.name = name
    }
    set coord(coord) {
        this.#coord = coord
        this.pos = grid.getCell(coord).pos
        this.pos.x -= assets.size / 2
        this.pos.y -= assets.size / 2
    }
    get coord() {
        return this.#coord
    }
    isSuburb(coord, arr, player) {
        let hexagon = arr[coord.x][coord.y].hexagon

        return player == hexagon.playerColor && hexagon.isSuburb
    }
    static isUnitProduction() {
        return false
    }
    static isBuildingProduction() {
        return false
    }
    isUnitProduction() {
        return false
    }
    isBuildingProduction() {
        return false
    }
    isSuburbProduction() {
        return false
    }
    nextTurn() {
        --this.turns

        return !this.turns
    }
    notEmpty() {
        return true
    }
    isEmpty() {
        return false
    }
    draw() {}
}
class UnitProduction extends Production {
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        super(turns, cost, _class, name)
    }
    toJSON() {
        let res = {
            turns: this.turns,
            cost: this.cost,
            name: this.name
        }
        return res
    }
    create(x, y) {
        let t = new this.class(x, y)

        return t
    }
    static isUnitProduction() {
        return true
    }
    isUnitProduction() {
        return true
    }
    cantCreateNow() {
        ++this.turns
    }
    draw(ctx) {
        drawCachedImageWithOpacity(ctx, cachedImages[this.name], this.pos, 0.6)
    }
}
class BuildingProduction extends Production {
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        super(turns, cost, _class, name)
        this.isSelected = false
    }
    isPassable() {
        return true
    }
    get isUnit() {
        return false
    }
    get isBuilding() {
        return true
    }
    choose() {
        this.isSelected = true
    }
    removeChoose() {
        this.isSelected = false
    }
    static isBuildingProduction() {
        return true
    }
    isBuildingProduction() {
        return true
    }
    isSuburbProduction() {
        return false
    }
}
class ManufactureProduction extends BuildingProduction {
    #town
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        super(turns, cost, _class, name)
        this.killed = false
    }
    toJSON() {
        let res = {
            name: this.name,
            turns: this.turns,
            coord: {
                x: this.coord.x,
                y: this.coord.y
            }
        }
        return res
    }
    toUndoJSON() {
        let res = this.toJSON()
        res.town = {
            coord: {
                x: this.town.coord.x,
                y: this.town.coord.y
            }
        }
        return res
    }
    isKilled() {
        return this.killed
    }
    kill() {
        this.killed = true
        grid.setBuilding(new Empty(), this.coord)
    }
    canCreateOnCell(cell, town) {
        return cell.building.isEmpty() &&
            this.isSuburb(cell.hexagon.coord, grid.arr, town.playerColor)
    }
    isPreparingStopped() {
        console.log("error")
    }
    create() {
        let t = new this.class(this.coord.x, this.coord.y, this.town)

        return t
    }
    get playerColor() {
        return this.town.playerColor
    }
    get player() {
        return players[this.playerColor]
    }
    get info() {
        let manufacture = {}
        manufacture.name = this.name
        manufacture.info = {
            turns: this.turns //,    
                //cost: this.cost
        }
        return manufacture
    }
    needInstructions() {
        return false
    }
    select() {
        entityInterface.change(this.info, this.player.fullColor)
    }
    removeSelect() {
        entityInterface.visible = false
    }
    get town() {
        return this.#town
    }
    set town(town) {
        this.#town = town
        this.text = new CoordText(this.coord.x, this.coord.y, this.turns)
    }
    sendInstructions(coord, town) {
        town.minusGold(this.cost)

        this.coord = coord
            //this.pos = grid.getCell(this.coord).pos
        this.town = town

        let needInstructions = town.gold >= this.cost
            /*if (needInstructions)
                this.select(town)*/
        return needInstructions
    }
    choose(town) {
        this.paintTownBorders(town, town.suburbs, grid.arr, town.playerColor)
        super.choose()
    }
    paintTownBorders(town, suburbs, arr, player) {
        border.newBrokenLine()

        this.availableHexagons = []
        let used = new Array(arr.length)

        for (let i = 0; i < arr.length; ++i) {
            used[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j)
                used[i][j] = false
        }

        // search available for purchase cells
        for (let i = 0; i < suburbs.length; ++i) {
            let hexagon = suburbs[i]
            used[hexagon.coord.x][hexagon.coord.y] = true

            let neighbours = hexagon.neighbours
            for (let j = 0; j < neighbours.length; ++j) {
                let neighbourCoord = neighbours[j]

                if (isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                    !this.isSuburb(neighbourCoord, arr, player)) {
                    border.createLine(hexagon.calcPos(), j)
                    continue
                }

                if (this.isSuburb(neighbourCoord, arr, player) &&
                    !used[neighbourCoord.x][neighbourCoord.y]) {
                    this.availableHexagons.push(arr[neighbourCoord.x][neighbourCoord.y].hexagon)

                    used[neighbourCoord.x][neighbourCoord.y] = true
                }
            }
        }
    }
    isPreparingFinished() {
        return !this.turns
    }
    get isMyTurn() {
        return whooseTurn == this.town.playerColor
    }
    nextTurn() {
        super.nextTurn()

        this.text.text = this.turns
    }
    draw(ctx) {
        if (!this.town)
            return

        /*if (this.isPreparingStopped())
            return*/
        drawCachedImageWithOpacity(ctx, cachedImages[this.name], this.pos)
        //drawImageWithOpacity(ctx, this.name, this.pos, 0.5)
        if (!grid.drawLogicText)
            this.text.draw(ctx)
    }
}
class SuburbProduction extends BuildingProduction {
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        super(turns, cost, _class, name)
        this.availableHexagons = []
    }
    suburbsCostformula(distance) {
        const mainCost = 1
        const diff = 2

        return mainCost + diff * (distance - 1)
    }
    canCreateOnCell(cell, town) {
        for (let i = 0; i < this.availableHexagons.length; ++i) {
            if (hexagonsEqually(this.availableHexagons[i], cell.hexagon)) {
                return town.gold >= this.suburbsCostformula(
                    this.distance[cell.coord.x][cell.coord.y])
            }
        }
        return false
    }
    sendInstructions(coord, town) {
        town.minusGold(this.suburbsCostformula(this.distance[coord.x][coord.y]))

        this.create(coord, town)
        this.choose(town)
        return this.availableHexagons.length && town.gold >= this.cost
    }
    create(coord, town) {
        grid.getHexagon(coord).isSuburb = true
        town.suburbs.push(grid.arr[coord.x][coord.y].hexagon)
    }
    choose(town) {
        grid.cleanLogicText()

        this.paintTownBorders(town, town.suburbs, grid.arr, town.playerColor)

        super.choose()
    }
    isSuburbProduction() {
        return true
    }
    getDistances(town, arr, player) {
        let used = new Array(arr.length)
        let distance = new Array(arr.length)
        for (let i = 0; i < arr.length; ++i) {
            used[i] = new Array(arr[i].length)
            distance[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j) {
                used[i][j] = false

                distance[i][j] = 0
            }
        }

        let Q = []
        Q.push(arr[town.coord.x][town.coord.y].hexagon)

        used[town.coord.x][town.coord.y] = true
        let suburbsUsedCount = 0

        while (Q.length > 0) {
            let v = Q.shift()


            let neighbours = v.neighbours
            for (let i = 0; i < neighbours.length; ++i) {
                if (isCoordNotOnMap(neighbours[i], arr.length, arr[0].length))
                    continue

                if (!used[neighbours[i].x][neighbours[i].y]) {
                    distance[neighbours[i].x][neighbours[i].y] = distance[v.coord.x][v.coord.y] + 1
                    Q.push(arr[neighbours[i].x][neighbours[i].y].hexagon)

                    used[neighbours[i].x][neighbours[i].y] = true
                }
            }
            if (this.isSuburb(v.coord, arr, player))
                ++suburbsUsedCount

            if (suburbsUsedCount == town.suburbs.length)
                break
        }
        return distance
    }
    paintTownBorders(town, suburbs, arr, player) {
        // init
        border.newBrokenLine()
        grid.drawLogicText = true

        this.distance = []
        this.availableHexagons = []
            //let suburbsNeighbours = []
        let used = new Array(arr.length)

        for (let i = 0; i < arr.length; ++i) {
            used[i] = new Array(arr[i].length)
            for (let j = 0; j < used[i].length; ++j)
                used[i][j] = false
        }

        // search available for purchase cells
        for (let i = 0; i < suburbs.length; ++i) {
            let hexagon = suburbs[i]
            used[hexagon.coord.x][hexagon.coord.y] = true

            let neighbours = hexagon.neighbours
            for (let j = 0; j < neighbours.length; ++j) {
                let neighbourCoord = neighbours[j]

                if (isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                    arr[neighbourCoord.x][neighbourCoord.y].hexagon.playerColor != player) {
                    border.createLine(hexagon.calcPos(), j)
                    continue
                }

                if (!this.isSuburb(neighbourCoord, arr, player) &&
                    !used[neighbourCoord.x][neighbourCoord.y]) {
                    this.availableHexagons.push(arr[neighbourCoord.x][neighbourCoord.y].hexagon)

                    used[neighbourCoord.x][neighbourCoord.y] = true
                }
            }
        }

        // create border lines
        this.distance = this.getDistances(town, arr, player)

        for (let i = 0; i < this.availableHexagons.length; ++i) {
            let coord = { x: this.availableHexagons[i].coord.x, y: this.availableHexagons[i].coord.y }

            let cell = arr[coord.x][coord.y]
            let cost = this.suburbsCostformula(this.distance[coord.x][coord.y])
            cell.logicText.text = cost

            let posI = this.availableHexagons[i].calcPos()

            let neighbours = this.availableHexagons[i].neighbours

            for (let j = 0; j < neighbours.length; ++j) {
                if (isCoordNotOnMap(neighbours[j], arr.length, arr[0].length) ||
                    !used[neighbours[j].x][neighbours[j].y])
                    border.createLine(posI, j)
            }
        }


        // BFS for find out distance

    }
}