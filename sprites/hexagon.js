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
    constructor(x, y, player) {
        super(x, y)
        
        this.pos.x -= basis.hexHalfRectWithStrokeOffset.width
        this.pos.y -= basis.hexHalfRectWithStrokeOffset.height
        
        this.player = player
        this.suburb = new Empty()

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
        if (boolean)
            this.suburb = new SuburbImage({ x: this.coord.x, y: this.coord.y }, basis.r)
        else
            this.suburb = new Empty()
    }
    isSuburb() {
        return this.suburb.notEmpty()
    }
    getPlayer() {
        return this.player
    }
    repaint(player) {
        if (this.player != player) {
            this.player = player
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