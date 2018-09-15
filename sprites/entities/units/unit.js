const hexagonLine = 
[
    [[-basis.r / 2, -basis.r / 2 * Math.sqrt(3)], [basis.r / 2, -basis.r / 2 * Math.sqrt(3)]],
    [[basis.r / 2, -basis.r / 2 * Math.sqrt(3)], [basis.r, 0]],
    [[basis.r, 0], [basis.r / 2, basis.r / 2 * Math.sqrt(3)]],
    [[basis.r / 2, basis.r / 2 * Math.sqrt(3)], [-basis.r / 2, basis.r / 2 * Math.sqrt(3)]],
    [[-basis.r / 2, basis.r / 2 * Math.sqrt(3)], [-basis.r, 0]],
    [[-basis.r, 0], [-basis.r / 2, -basis.r / 2 * Math.sqrt(3)]]
]
class Unit extends Entity
{
    constructor(x, y, hp, dmg, speed, player)
    {
        super(x, y, hp, player)
        this.dmg = dmg
        this.speed = speed
        
        grid.arr[x][y].unit = this
    }
    getInfo()
    {
        let unit = super.getInfo()
        unit.info.push('dmg: ' + this.dmg, 'speed: ' + this.speed)
        return unit
    }
    select(arr)
    {
        /*
        Требуется рефакторинг BFS
        Сделай проверку для конца карты
        напиши класс и запихни функции addDistanceText, needToDrawLine, drawLine туда
        */
        //let border = Math.max(grid.arr.length, grid.arr[0].length)
        this.BFS([this.coord.x, this.coord.y], this.speed, arr, arr.length)
        layers.coordGrid.visible(false)
        layers.selectUnit.draw()
    }
    addDistanceText(x, y, distance)
    {
        let distanceText = new CoordText(x, y, distance)
        layers.selectUnit.add(distanceText.createObject())
    }
    needToDrawLine(parent, child, max)
    {
        return (parent == max && !(child <= max))
    }
    drawLine(pos, side)
    {
        layers.selectUnit.add(new Konva.Line({
          points: [hexagonLine[side][0][0] + pos.x, hexagonLine[side][0][1] + pos.y, hexagonLine[side][1][0] + pos.x, hexagonLine[side][1][1] + pos.y],
          stroke: 'red',
          strokeWidth: 4,
        }))
    }
    BFS(v0, speed, arr, border)
    {
        let used = []
        let distance = []
        let way = []

        for (let i = 0; i <= border * 2; ++i)
        {
            used.push([])
            distance.push([])
            way.push([])
            /*for (let j = v0[1] + border - speed; j < v0[1] + border + speed + border; ++j)
            {
                used[i][j] = false
                distance[i][j] = speed + 1
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
                let x = neighbours[i][0] + border
                let y = neighbours[i][1] + border
                if (this.needToDrawLine(distance[v[0] + border][v[1] + border], distance[x][y], speed))
                    this.drawLine(arr[v[0]][v[1]].hexagon.getPos(), i)
                if (distance[v[0] + border][v[1] + border] <= speed && 
                    isArrEnd(neighbours[i][0], neighbours[i][1], arr.length, arr[0].length))
                {
                    this.drawLine(arr[v[0]][v[1]].hexagon.getPos(), i)
                }
                if (!used[neighbours[i][0] + border][neighbours[i][1] + border])
                {
                    Q.push(neighbours[i])
                    
                    way[neighbours[i][0] + border][neighbours[i][1] + border] = [v[0] + border, v[1] + border]
                    
                    used[x][y] = true
                    distance[x][y] = distance[v[0] + border][v[1] + border] + 1
                    
                    
                    if (distance[x][y] > speed + 1)
                    {
                        return
                    }
                    this.addDistanceText(neighbours[i][0], neighbours[i][1], distance[x][y])
                }
            }
        }
    }
}
function isArrEnd(x, y, lengthX, lengthY)
{
    return ((Math.min(x, y) < 0) || (x >= lengthX) || (y >= lengthY))
}
