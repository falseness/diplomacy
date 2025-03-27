class Cell {
    constructor(hexagon, unit, building, coordText, logicText) {
        this.hexagon = hexagon
        this.unit = unit
        this.building = building
        // for escape menu. it writes coords of cells
        this.coordText = coordText
        // for suburbs 
        this.logicText = logicText
        
        // for now for texts of production 
        this.infoText = new CoordText(hexagon.coord.x, hexagon.coord.y, '')
    }
    get coord() {
        return this.hexagon.coord
    }
    get pos() {
        return this.hexagon.calcPos()
    }
    get hexColor() {
        return this.hexagon.player.hexColor
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
    get center() {
        return {
            x: this.right / 2,
            y: this.bottom / 2
        }
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
        let n = this.arr.length
        let m = this.arr[0].length
        this.fogOfWar = []
        this.fullInitArr(n, m, this.fogOfWar, 0)

        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (this.arr[i][j].building.isNature) {
                    this.fogOfWar[i][j] += 1
                }
            }
        }
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
            
            this.clearFogOfWarArr()

            this.fullInitArr(n, m, this.visionUsed, 0)
            this.fullInitArr(n, m, this.visionDistance, 0)

            this.newVisionUsedValue = 0

            this.visionWay = new VisionWay()
        }
    }
    //todo: refactor
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
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                cell.logicText.draw(ctx)
            }
        }
    }
    drawTextInfo(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                cell.infoText.draw(ctx)
                cell.infoText.text = ''
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

        if (isFogOfWar)
            this.drawFogOfWar(ctx)

        this.drawOther(ctx)

        if (this.drawLogicText) {
            this.drawTextLogic(ctx)
        }
        else if (debug) {
            this.drawTextCoord(ctx)
        }
        else {
            this.drawTextInfo(ctx)
        }
        

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