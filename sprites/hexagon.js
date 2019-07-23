const neighborhood = [
        [
            [0, -1],
            [1, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
            [-1, -1]
        ],
        [
            [0, -1],
            [1, 0],
            [1, 1],
            [0, 1],
            [-1, 1],
            [-1, 0]
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

class Hexagon extends Sprite {
    constructor(x, y, player, _isSuburb = false) {
        super(x, y)
        
        this.pos.x -= basis.hexHalfRectWithStrokeOffset.width
        this.pos.y -= basis.hexHalfRectWithStrokeOffset.height
        
        this.player = player
        this.suburb = _isSuburb

        /* let pos = this.getPos()
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
         
         this.object.on('click', click)*/
    }
    setIsSuburb(boolean) {
        this.suburb = boolean
    }
    isSuburb() {
        return this.suburb
    }
    getPlayer() {
        return this.player
    }
    repaint(player) {
        if (this.player != player) {
            this.player = player
            if (!this.isSuburb()) 
                return
                
            this.setIsSuburb(false)
            
            if (grid.arr[this.coord.x][this.coord.y].building.isBuildingProduction()) {
                grid.arr[this.coord.x][this.coord.y].building.kill()
            }
        }
    }
    draw(ctx) {
        let pos = this.pos
        
        if (this.isSuburb()) {
            ctx.drawImage(players[this.player].suburbHexagon,
                      pos.x, pos.y)
        }
        else {
            ctx.drawImage(players[this.player].hexagon,
                      pos.x, pos.y)
        }
    }
}