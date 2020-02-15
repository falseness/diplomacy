class Cell {
    constructor(hexagon, unit, building, coordText, logicText) {
        this.hexagon = hexagon
        this.unit = unit
        this.building = building
        this.coordText = coordText
        this.logicText = logicText
    }
    get coord() {
        return this.hexagon.coord
    }
    get pos() {
        return this.hexagon.calcPos()
    }
}
class Grid extends SpritesGroup {
    drawLogicText = false
    constructor(x, y, size) {
        super(x, y)

        if (size) 
            this.fill(size.x, size.y)
    }
    toJSON() {
        let _grid = []
        for (let i = 0; i < this.arr.length; ++i) {
            _grid.push([])
            for (let j = 0; j < this.arr[i].length; ++j) {
                _grid[i].push(this.arr[i][j].hexagon.playerColor)
            }
        }
        return _grid
    }
    get bottom() {
        return this.arr[0][this.arr[0].length - 1].hexagon.pos.y //+ basis.r * Math.sin(Math.PI / 3) * 2
    }
    get right() {
        return this.arr[this.arr.length - 1][0].hexagon.pos.x //+ basis.r * 2
    }
    getCell(coord) {
        return this.arr[coord.x][coord.y]
    }
    getBuilding(coord) {
        return this.arr[coord.x][coord.y].building
    }
    getUnit(coord) {
        return this.arr[coord.x][coord.y].unit
    }
    getHexagon(coord) {
        return this.arr[coord.x][coord.y].hexagon
    }
    setBuilding(building, coord) {
        this.arr[coord.x][coord.y].building = building
    }
    setUnit(unit, coord) {
        this.arr[coord.x][coord.y].unit = unit
    }
    cleanLogicText() {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                this.arr[i][j].logicText.text = ''
            }
        }
    }
    newLogicText() {
        this.cleanLogicText()
        this.drawLogicText = true
    }
    clearFogOfWarArr() {
        let n = this.fogOfWar.length
        let m = this.fogOfWar[0].length
        this.fogOfWar = []
        this.fullInitArr(n, m, this.fogOfWar, 0)
    }
    fill(n, m) {
        this.createArr(n, this.arr)
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.arr[i][j] = new Cell(new Hexagon(i, j, 0), new Empty(), new Empty(),
                    new CoordText(i, j, i + ' ' + j), new CoordText(i, j, ''))
            }
        }
        if (isFogOfWar) {
            this.fogOfWar = [] 
            this.visionUsed = []
            this.visionDistance = []
            
            this.fullInitArr(n, m, this.fogOfWar, 0)
            this.fullInitArr(n, m, this.visionUsed, 0)
            this.fullInitArr(n, m, this.visionDistance, 0)

            this.newVisionUsedValue = 0

            this.visionWay = new VisionWay()
        }
    }
    drawHexagons(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                cell.hexagon.draw(ctx)
            }
        }
    }
    drawTextCoord(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                let cell = this.arr[i][j]
                cell.coordText.draw(ctx)
            }
        }
    }
    drawTextLogic(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                let cell = this.arr[i][j]
                cell.logicText.draw(ctx)
            }
        }
    }
    drawOther(ctx) {
        let tmpBuildings = []
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]

                cell.building.draw(ctx)
                if (cell.building.hasBar)
                    tmpBuildings.push(cell.building)
                cell.unit.draw(ctx)
            }
        }
        for (let i = 0; i < tmpBuildings.length; ++i) {
            tmpBuildings[i].drawBars(ctx)
        }
    }
    drawFogOfWar(ctx) {
        for (let i = 0; i < this.fogOfWar.length; ++i) {
            for (let j = 0; j < this.fogOfWar[i].length; ++j) {
                if (!this.fogOfWar[i][j]) {
                    let hexagon = new FogOfWarHexagon(i, j)
                    hexagon.draw(ctx)
                }
            }
        }
    }
    draw(ctx) {
        this.drawHexagons(ctx)

        this.drawOther(ctx)

        if (this.drawLogicText)
            this.drawTextLogic(ctx)

        if (isFogOfWar)
            this.drawFogOfWar(ctx)

        if (!this.drawLogicText && debug)
            this.drawTextCoord(ctx)

        attackBorder.draw(ctx)
        border.draw(ctx)
    }
}

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray) {
    return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}

function coordsEqually(coordOne, coordTwo) {
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}

function hexagonsEqually(hexagonOne, hexagonTwo) {
    return coordsEqually(hexagonOne.coord, hexagonTwo.coord)
}