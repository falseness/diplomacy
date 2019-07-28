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
    toUndoJSON() {
        let res = {
            coord: {
                x: this.coord.x,
                y: this.coord.y
            },
            player: this.playerColor,
            isSuburb: this.isSuburb
        }
        return res
    }
    repaint(_player) {
        if (this.playerColor == _player)
            return
        undoManager.lastUndo.hexagons.push(this.toUndoJSON())

        this.playerColor = _player
        if (!this.isSuburb)
            return

        this.isSuburb = false
        let building = grid.getBuilding(this.coord)
        if (building.isBuildingProduction()) {
            undoManager.lastUndo.buildingProduction = building.toUndoJSON()
            building.kill()
        }
    }
    draw(ctx) {
        let pos = this.pos

        if (this.isSuburb) {
            ctx.drawImage(this.player.suburbHexagon,
                pos.x, pos.y)
        } else {
            ctx.drawImage(this.player.hexagon,
                pos.x, pos.y)
        }
    }
}