class Grid extends SpritesGroup {
    constructor(x, y, size) {
        super(x, y)

        this.drawLogicText = false

        if (size)
            this.fill(size.x, size.y)
    }
    getBottom() {
        return this.arr[0][this.arr[0].length - 1].hexagon.getPos().y //+ basis.r * Math.sin(Math.PI / 3) * 2
    }
    getRight() {
        return this.arr[this.arr.length - 1][0].hexagon.getPos().x //+ basis.r * 2
    }
    setDrawLogicText(boolean) {
        this.drawLogicText = boolean
    }
    cleanLogicText() {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                this.arr[i][j].logicText.setText('')
            }
        }
    }
    newLogicText() {
        this.cleanLogicText()
        this.setDrawLogicText(true)
    }
    fill(n, m) {
        this.createArr(n, this.arr)
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.arr[i][j] = { hexagon: new Hexagon(i, j, 0), building: new Empty, unit: new Empty }
                let pos = this.arr[i][j].hexagon.getPos()
                this.arr[i][j].coordText = new CoordText(i, j, i + ' ' + j)
                this.arr[i][j].logicText = new CoordText(i, j, '')
            }
        }
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
    drawText(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                let cell = this.arr[i][j]
                if (this.drawLogicText)
                    cell.logicText.draw(ctx)
                else
                    cell.coordText.draw(ctx)
            }
        }
    }
    drawOther(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                let cell = this.arr[i][j]

                cell.building.draw(ctx)
                cell.unit.draw(ctx)
            }
        }
    }
    draw(ctx) {
        this.drawHexagons(ctx)
        this.drawText(ctx)
        this.drawOther(ctx)
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