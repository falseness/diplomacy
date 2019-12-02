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
    fill(n, m) {
        this.createArr(n, this.arr)
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.arr[i][j] = new Cell(new Hexagon(i, j, 0), new Empty(), new Empty(),
                    new CoordText(i, j, i + ' ' + j), new CoordText(i, j, ''))
            }
        }
        //undoManager.clear()
        /*for (let x = 0; x <= k * 2; ++x)
        {
            for (let y = Math.max(-k, -x - k) + k; y <= Math.min(k, -x + k) + k; ++y)
            {
                let z = -x - y
                
                this.arr[x][y][z] = {hexagon: new Hexagon(x, y, z), text: new Text(x, y, z)}
                
                this.object.add(this.arr[x][y][z].hexagon.createObject())
                this.coordGrid.object.add(this.arr[x][y][z].text.createObject(x + ' ' + y + ' ' + z))
            }
        }*/
    }
    drawHexagons(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
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
    draw(ctx) {
        this.drawHexagons(ctx)

        attackBorder.draw(mainCtx)
        border.draw(mainCtx)
        
        this.drawOther(ctx)

        if (!this.drawLogicText && debug)
            this.drawTextCoord(ctx)

        if (this.drawLogicText)
            this.drawTextLogic(ctx)
    }
}

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray) {
    return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}
function isCoordNotOnGrid(coord) {
    return isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length)
}

function coordsEqually(coordOne, coordTwo) {
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}

function hexagonsEqually(hexagonOne, hexagonTwo) {
    return coordsEqually(hexagonOne.coord, hexagonTwo.coord)
}