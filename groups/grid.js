class Grid extends SpritesGroup
{
    constructor(x, y, size)
    {
        super(x, y)
        
        this.drawLogicText = false
        
        if (size)
            this.fill(size.x, size.y)
    }
    setDrawLogicText(boolean)
    {
        this.drawLogicText = boolean
    }
    cleanLogicText()
    {
        for (let i = 0; i < this.arr.length; ++i)
        {
            for (let j = 0; j < this.arr[i].length; ++j)
            {
                this.arr[i][j].logicText.setText('')
            }
        }
    }
    newLogicText()
    {
        this.cleanLogicText()
        this.setDrawLogicText(true)
    }
    fill(n, m)
    {
        this.createArr(n, this.arr)
        for (let i = 0; i < n; ++i)
        {
            for (let j = 0; j < m; ++j)
            {
                this.arr[i][j] = {hexagon: new Hexagon(i, j, 0), building: new Empty, unit: new Empty}
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
    draw()
    {
        for (let i = 0; i < this.arr.length; ++i)
        {
            for (let j = 0; j < this.arr[i].length; ++j)    
            {
                let cell = this.arr[i][j]
                cell.hexagon.draw()
                
                if (this.drawLogicText)
                    cell.logicText.draw()
                else
                    cell.coordText.draw()
                
                cell.building.draw()
                cell.unit.draw()
            }
        }
    }
}

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray)
{
        return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}
function coordsEqually(coordOne, coordTwo)
{
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}