class Unit extends Entity
{
    constructor(x, y, name, hp, dmg, speed, player)
    {
        super(x, y, name, hp, player)
        this.dmg = dmg
        this.speed = speed
        this.moves = speed
        
        grid.arr[x][y].unit = this
        
        this.way = new Way(player)
    }
    getInfo()
    {
        let unit = super.getInfo()
        unit.info.dmg = this.dmg
        unit.info.moves = this.moves + ' / ' + this.speed
        return unit
    }
    changeCoord(x, y)
    {
        grid.arr[this.coord.x][this.coord.y].unit = new Empty()
        
        this.coord.x = x
        this.coord.y = y
        grid.arr[x][y].unit = this
        
        let pos = this.getPos()
        this.object.x(pos.x)
        this.object.y(pos.y)
    }
    select(arr)
    {
        //let border = Math.max(grid.arr.length, grid.arr[0].length)
        if (this.moves > 0)
        {
            this.way.BFS([this.coord.x, this.coord.y], this.moves, arr, arr.length)
            layers.coordGrid.visible(false)
            layers.selectUnit.draw()
            
            return true
        }
        return false
    }
    move(x, y)
    {
        this.removeSelect()
        if (this.way.distance[x + this.way.border][y + this.way.border] &&
            this.way.distance[x + this.way.border][y + this.way.border] <= this.moves)
        {
            this.paintHexagons(x, y, grid.arr)
            this.changeCoord(x, y)
            this.moves -= this.way.distance[x + this.way.border][y + this.way.border]
            layers.entity.draw()
            return (this.moves == 0)
        }
        
        return true
    }
    removeSelect()
    {
        layers.coordGrid.visible(true)
        layers.selectUnit.destroyChildren()
        layers.selectUnit.draw()
    }
    paintHexagons(x, y, arr)
    {
        while (!(x == this.coord.x && y == this.coord.y))
        {
            arr[x][y].hexagon.repaint(this.player)
            
            let t = this.way.arr[x + this.way.border][y + this.way.border]
            
            x = t[0] - this.way.border
            y = t[1] - this.way.border
        }
    }
    nextTurn(whooseTurn)
    {
        if (this.player == whooseTurn)
        {
            this.moves = this.speed
        }
    }
}

class Way
{
    constructor(player)
    {
        this.color = 'white'//players[player].getHexColor()
    }
    BFS(v0, moves, arr, border)
    {
        /*
        Требуется рефакторинг BFS
        Сделай проверку для конца карты
        */
        this.border = border
        
        let used = []
        let distance = []
        let way = []

        for (let i = 0; i <= border * 2; ++i)
        {
            used.push([])
            distance.push([])
            way.push([])
            /*for (let j = v0[1] + border - moves; j < v0[1] + border + moves + border; ++j)
            {
                used[i][j] = false
                distance[i][j] = moves + 1
            }*/
        }

        distance[v0[0] + border][v0[1] + border] = 0
        used[v0[0] + border][v0[1] + border] = 1

        let Q = []
        Q.push(v0)

        while (Q.length > 0)
        {
            let v = Q.shift() 
            if (isArrEnd(v[0], v[1], arr.length, arr[0].length))
            {
                continue
            }
            let neighbours = arr[v[0]][v[1]].hexagon.getNeighbours()
            
            for (let i = 0; i < neighbours.length; ++i)
            {
                /*
                Draw line создает слишком много новых линий и не очищает!!
                */
                let x = neighbours[i][0] + border
                let y = neighbours[i][1] + border
                if (this.needToDrawLine(distance[v[0] + border][v[1] + border], distance[x][y], moves))
                    drawLine(arr[v[0]][v[1]].hexagon.getPos(), i, this.color)
                if (distance[v[0] + border][v[1] + border] <= moves && 
                    isArrEnd(neighbours[i][0], neighbours[i][1], arr.length, arr[0].length))
                {
                    drawLine(arr[v[0]][v[1]].hexagon.getPos(), i, this.color)
                }
                if (!used[neighbours[i][0] + border][neighbours[i][1] + border])
                {
                    Q.push(neighbours[i])
                    
                    way[neighbours[i][0] + border][neighbours[i][1] + border] = [v[0] + border, v[1] + border]
                    
                    used[x][y] = true
                    distance[x][y] = distance[v[0] + border][v[1] + border] + 1
                    
                    
                    if (distance[x][y] > moves + 1)
                    {
                        this.distance = distance
                        this.arr = way
                        return 
                    }
                    this.addDistanceText(neighbours[i][0], neighbours[i][1], distance[x][y])
                }
            }
        }
    }
    needToDrawLine(parent, child, max)
    {
        return (parent == max && !(child <= max))
    }
    addDistanceText(x, y, distance)
    {
        
        /*
        
        Займись этим позже!
        
        и drawLine тоже!
        
        Нельзя создавать миллион coordText
        let distanceText = new CoordText(x, y, distance)
        layers.selectUnit.add(distanceText.createObject())
        */
    }
}
function isArrEnd(x, y, lengthX, lengthY)
{
    return ((Math.min(x, y) < 0) || (x >= lengthX) || (y >= lengthY))
}
