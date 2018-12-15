const neighborhood = 
[
   [
        [0, -1], [1, -1], [1, 0],
        [0, 1], [-1, 0], [-1, -1]
   ],
   [ 
        [0, -1], [1, 0], [1, 1], 
        [0, 1], [-1, 1], [-1, 0]
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
    constructor(x, y, player)
    {
        super(x, y)
        this.player = player
        
        let pos = this.getPos()
        this.object = new Konva.RegularPolygon(
        {
            x: pos.x,
            y: pos.y,
            sides: 6,
            radius: basis.r,
            fill: players[this.player].getHexColor(), //'#D0D0D0',//'#B5B8B1',
            stroke: 'black',
            strokeWidth: 3
        })
        this.object.rotate(90)
        
        this.object.on('click', click)
    }
    getObject()
    {
        return this.object
    }
    repaint(player)
    {
        if (this.player != player)
        {
            this.player = player

            this.object.fill(players[player].getHexColor())   
            this.object.draw()
        }
    }
}