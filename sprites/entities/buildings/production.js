
class Production {
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        this.turns = turns
        this.cost = cost
        this.class = _class
        this.name = name
    }
    getName() {
        return this.name
    }
    isSuburb(coord, arr, player) {
        let hexagon = arr[coord.x][coord.y].hexagon

        return player == hexagon.player && hexagon.isSuburb()
    }
    isUnitProduction() {
        return false
    }
    isBuildingProduction() {
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
    create(x, y, town) {
        let t = new this.class(x, y, town)
        
        return t
    }
    isUnitProduction() {
        return true
    }
    cantCreateNow() {
        ++this.turns
    }
}
class BuildingProduction extends Production {
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        super(turns, cost, _class, name)
        this.isSelected = false
        this.coord = {
            x: -1, 
            y: -1
        }
    }
    isWaitingForInstructions() {
        return this.isSelect
    }
    select() {
        this.isSelected = true
    }
    removeSelect() {
        this.isSelected = false
    }
    isBuildingProduction() {
        return true
    }
    isSuburbProduction() {
        return false
    }
}
class FarmProduction extends BuildingProduction {
    constructor(turns = 1, cost = 1, _class = new Empty(), name) {
        super(turns, cost, _class, name)
        this.preparingStopped = false
    }
    canCreateOnCell(cell, town) {
        for (let i = 0; i < town.buildingProduction.length; ++i) {
            if (coordsEqually(town.buildingProduction[i].coord, cell.hexagon.coord))
                return false
        }
        return cell.building.isEmpty() && 
            this.isSuburb(cell.hexagon.coord, grid.arr, town.getPlayer())
    }
    isPreparingStopped() {
        this.preparingStopped |= this.canCreateOnCell(grid.arr[this.coord.x][this.coord.y], this.town)
        return this.preparingStopped
    }
    create() {
        const income = 3
        let t = new this.class(this.coord.x, this.coord.y, income, this.town)
        
        return t
    }
    sendInstructions(coord, town) {
        town.gold -= this.cost
        
        this.coord = coord
        this.town = town
        this.text = new CoordText(coord.x, coord.y, this.turns)
        return false
    }
    select(town) {
        this.paintTownBorders(town, town.suburbs, grid.arr, town.getPlayer())
        super.select()
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
            let hexagon = suburbs[i].hexagon
            used[hexagon.coord.x][hexagon.coord.y] = true

            let neighbours = hexagon.getNeighbours()
            for (let j = 0; j < neighbours.length; ++j) {
                let neighbourCoord = neighbours[j]

                if (isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                    !this.isSuburb(neighbourCoord, arr, player)) {
                    border.createLine(hexagon.getPos(), j)
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
    nextTurn() {
        let preparingFinished = super.nextTurn()
        
        if (!preparingFinished)
            this.text.setText(this.turns)
        return preparingFinished
    }
    draw(ctx) {
        if (!this.town)
            return
        if (this.preparingStopped || this.isPreparingStopped())
            return
        
        drawImageWithOpacity(ctx, 'farm', grid.arr[this.coord.x][this.coord.y].hexagon.getPos(), 0.5)
        if (!grid.arr.drawLogicText)
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
                return town.gold >= this.suburbsCostformula(this.distance[cell.hexagon.coord.x][cell.hexagon.coord.y])
            }
        }
        return false
    }
    sendInstructions(coord, town) {
        town.gold -= this.suburbsCostformula(this.distance[coord.x][coord.y])
        
        this.create(coord, town)
        this.select(town)
        return true
    }
    create(coord, town) {
        grid.arr[coord.x][coord.y].hexagon.setIsSuburb(true)
        town.suburbs.push(grid.arr[coord.x][coord.y])
    }
    select(town) {
        grid.cleanLogicText()

        this.paintTownBorders(town, town.suburbs, grid.arr, town.getPlayer())
        
        super.select()
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


            let neighbours = v.getNeighbours()
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
            grid.setDrawLogicText(true)

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
                let hexagon = suburbs[i].hexagon
                used[hexagon.coord.x][hexagon.coord.y] = true

                let neighbours = hexagon.getNeighbours()
                for (let j = 0; j < neighbours.length; ++j) {
                    let neighbourCoord = neighbours[j]

                    if (isCoordNotOnMap(neighbourCoord, arr.length, arr[0].length) ||
                        arr[neighbourCoord.x][neighbourCoord.y].hexagon.player != player) {
                        border.createLine(hexagon.getPos(), j)
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
                cell.logicText.setText(cost)

                let posI = this.availableHexagons[i].getPos()

                let neighbours = this.availableHexagons[i].getNeighbours()

                for (let j = 0; j < neighbours.length; ++j) {
                    if (isCoordNotOnMap(neighbours[j]) ||
                        !used[neighbours[j].x][neighbours[j].y])
                        border.createLine(posI, j)
                }
            }


            // BFS for find out distance

        }
}