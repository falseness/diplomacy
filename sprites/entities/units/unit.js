class Unit extends Entity
{
    constructor(x, y, name, hp, dmg, speed, salary, player)
    {
        super(x, y, name, hp, player)
        this.dmg = dmg
        this.speed = speed
        this.moves = speed
        this.salary = salary
        
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
        this.paintHexagons(x, y, grid.arr)
        
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
            border.draw()
            
            return true
        }
        return false
    }
    canReachHexagon(x, y)
    {
        return (this.way.distance[x + this.way.indent][y + this.way.indent] &&
                this.way.distance[x + this.way.indent][y + this.way.indent] <= this.moves)
    }
    turnsIsOver()
    {
        return (!this.moves)
    }
    move(x, y)
    {
        if (this.canReachHexagon(x, y))
        {
            this.changeCoord(x, y)
            this.moves -= this.way.distance[x + this.way.indent][y + this.way.indent]
            
            
            layers.entity.draw()
            
            return this.turnsIsOver()
        }
        
        return true
    }
    removeSelect(x, y)
    {
        layers.coordGrid.visible(true)
        border.remove()
        
        return this.move(x, y)
    }
    paintHexagons(x, y, arr)
    {
        while (!(x == this.coord.x && y == this.coord.y))
        {
            arr[x][y].hexagon.repaint(this.player)
            
            let t = this.way.arr[x + this.way.indent][y + this.way.indent]
            
            x = t[0] - this.way.indent
            y = t[1] - this.way.indent 
        }
    }
    kill()
    {
        grid.arr[this.coord.x][this.coord.y].unit = new Empty()
        
        this.object.destroy()
        layers.entity.draw()
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
    BFS(v0, moves, arr, indent)
    {
        /*
        Требуется рефакторинг BFS
        Сделай проверку для конца карты
        */
        this.indent = indent
        
        let used = []
        let distance = []
        let way = []

        for (let i = 0; i <= indent * 2; ++i)
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

        distance[v0[0] + indent][v0[1] + indent] = 0
        used[v0[0] + indent][v0[1] + indent] = 1

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
                let x = neighbours[i][0] + indent
                let y = neighbours[i][1] + indent
                if (this.needToDrawLine(distance[v[0] + indent][v[1] + indent], distance[x][y], moves))
                    border.drawLine(arr[v[0]][v[1]].hexagon.getPos(), i, this.color)
                if (distance[v[0] + indent][v[1] + indent] <= moves && 
                    isArrEnd(neighbours[i][0], neighbours[i][1], arr.length, arr[0].length))
                {
                    border.drawLine(arr[v[0]][v[1]].hexagon.getPos(), i, this.color)
                }
                if (!used[neighbours[i][0] + indent][neighbours[i][1] + indent])
                {
                    Q.push(neighbours[i])
                    
                    way[neighbours[i][0] + indent][neighbours[i][1] + indent] = [v[0] + indent, v[1] + indent]
                    
                    used[x][y] = true
                    distance[x][y] = distance[v[0] + indent][v[1] + indent] + 1
                    
                    
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
        layers.border.add(distanceText.createObject())
        */
    }
}
function isArrEnd(x, y, lengthX, lengthY)
{
    return ((Math.min(x, y) < 0) || (x >= lengthX) || (y >= lengthY))
}
