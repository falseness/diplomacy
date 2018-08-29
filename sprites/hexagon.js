const neighborhood = 
[
   [
        [1, 0], [0, -1], [-1, -1],
        [-1, 0], [1, -1], [0, 1]
   ],
   [ 
        [1, 0], [-1, 1], [0, -1],
        [-1, 0], [0, 1], [1, 1] 
   ]
]
/*function getNeighbours(x, y)
{
    let neighbours = []
    let parity = x & 1
    for (let i = 0; i < neighborhood[parity].length; ++i)
    {
        neighbours.push([x + neighborhood[parity][i][0], y + neighborhood[parity][i][1]])
    }
    return neighbours
}*/

class Hexagon extends Sprite
{
    constructor(x, y, z)
    {
        super(x, y, z)
    }
    createObject()
    {
        let pos = this.getPos()
        this.object = new Konva.RegularPolygon(
        {
            x: pos.x,
            y: pos.y,
            sides: 6,
            radius: basis.r,
            fill: 'red',
            stroke: 'black',
            strokeWidth: 3
        })
        this.object.rotate(90)
        
        this.object.on('click', function(event)
        {
            let coord = getCoord(event.target.attrs.x, event.target.attrs.y)
            console.log(coord.x + ' ' + coord.y)
            grid.arr[coord.x][coord.y].unit.drawInterface()
            
            layers.interface.draw()
        })
        return this.object
    }
}