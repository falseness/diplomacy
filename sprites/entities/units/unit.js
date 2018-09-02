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
    select()
    {
        //let border = Math.max(grid.arr.length, grid.arr[0].length)
        BFS([this.coord.x, this.coord.y], this.speed, grid.arr.length)
        layers.coordGrid.visible(false)
        layers.selectUnit.draw()
    }
}
function BFS(v0, speed, border)
{
    let used = []
    let way = []
    
    for (let i = 0; i <= border * 2; ++i)
    {
        used[i] = []
        way[i] = []
        /*for (let j = v0[1] + border - speed; j < v0[1] + border + speed + border; ++j)
        {
            used[i][j] = false
            way[i][j] = speed + 1
        }*/
    }
    
    way[v0[0] + border][v0[1] + border] = 0
    
    let Q = []
    Q.push(v0)
    
    used[v0[0] + border][v0[1] + border] = 1
    
    while (Q.length > 0)
    {
        let v = Q.shift()
        if (Math.min(v[0], v[1]) < 0 || v[0] >= grid.arr.length || v[1] >= grid.arr[0].length)
            continue
        let neighbours = grid.arr[v[0]][v[1]].hexagon.getNeighbours()
        for (let i = 0; i < neighbours.length; ++i)
        {
            if (!used[neighbours[i][0] + border][neighbours[i][1] + border])
            {
                Q.push(neighbours[i])
                used[neighbours[i][0] + border][neighbours[i][1] + border] = true
                way[neighbours[i][0] + border][neighbours[i][1] + border] = way[v[0] + border][v[1] + border] + 1
                if (way[v[0] + border][v[1] + border] == speed && way[neighbours[i][0] + border][neighbours[i][1] + border] == speed + 1)
                {
                    let pos = grid.arr[v[0]][v[1]].hexagon.getPos()
                    layers.selectUnit.add(new Konva.Line({
                      points: [hexagonLine[i][0][0] + pos.x, hexagonLine[i][0][1] + pos.y, hexagonLine[i][1][0] + pos.x, hexagonLine[i][1][1] + pos.y],
                      stroke: 'red',
                      strokeWidth: 4,
                    }))
                }
                if (way[neighbours[i][0] + border][neighbours[i][1] + border] > speed + 1)
                {
                    console.log(way)
                    return
                }
                let wayText = new CoordText(neighbours[i][0], neighbours[i][1], way[neighbours[i][0] + border][neighbours[i][1] + border])
                layers.selectUnit.add(wayText.createObject())
            }
        }
    }
    console.log(way)
}