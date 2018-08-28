class Grid extends SpritesGroup
{
    constructor(x, y, coordGrid)
    {
        super(x, y)
        this.coordGrid = coordGrid
    }
    createArr(n)
    {
        this.arr = []
        for (let i = 0; i < n; ++i)
        {
            this.arr.push([])
        }
    }
    fill(n, m)
    {
        this.createArr(n)
        for (let i = 0; i < n; ++i)
        {
            for (let j = 0; j < m; ++j)
            {
                this.arr[i][j] = {hexagon: new Hexagon(i, j), building: new Empty, unit: new Empty, text: new Text (i, j)}
                this.object.add(this.arr[i][j].hexagon.createObject())
                //layers.grid.add(this.arr[i][j].hexagon.createObject())
                this.coordGrid.object.add(this.arr[i][j].text.createObject())
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
}
