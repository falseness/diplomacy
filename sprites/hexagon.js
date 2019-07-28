class Hexagon extends Sprite {
    constructor(x, y, _player, _isSuburb = false) {
        super(x, y)
        
        this.pos.x -= basis.hexHalfRectWithStrokeOffset.width
        this.pos.y -= basis.hexHalfRectWithStrokeOffset.height
        
        this.playerColor = _player
        this.isSuburb = _isSuburb
    }
    get player() {
        return players[this.playerColor]
    }
    firstpaint(_player) {
        this.playerColor = _player
    }
    repaint(_player) {
        if (this.playerColor == _player) 
            return
            
        this.playerColor= _player
        if (!this.isSuburb) 
            return
            
        this.isSuburb = false
        
        if (grid.getBuilding(this.coord).isBuildingProduction()) {
            grid.getBuilding(this.coord).kill()
        }
    }
    draw(ctx) {
        let pos = this.pos
        
        if (this.isSuburb) {
            ctx.drawImage(this.player.suburbHexagon,
                      pos.x, pos.y)
        }
        else {
            ctx.drawImage(this.player.hexagon,
                      pos.x, pos.y)
        }
    }
}