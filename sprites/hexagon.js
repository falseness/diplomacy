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
    constructor(x, y)
    {
        super(x, y)
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
            fill: '#D0D0D0',//'#B5B8B1',
            stroke: 'black',
            strokeWidth: 3
        })
        this.object.rotate(90)
        
        this.object.on('click', function(event)
        {
            let coord = getCoord(event.target.attrs.x, event.target.attrs.y)
            console.log(coord.x + ' ' + coord.y)
            //Нужно вынести это в отдельную функцию или класс:
            
            let entity
            
            if (selected)
            {
                entity = selected
                if (selected.move(coord.x, coord.y, grid.arr))
                {
                    //selected = false Должен быть тут если что
                    layers.interface.visible(false)
                }
                    
                selected = false
            }
            else
            {
                gameInterface.draw()

                let hexagon = grid.arr[coord.x][coord.y]
                entity = hexagon.unit.isEmpty()?hexagon.building:hexagon.unit
                
                selected = entity
                
                entity.select(grid.arr)
                
            }
            gameInterface.change(entity.getInfo(), players)
        })
        return this.object
    }
}