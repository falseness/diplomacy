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

        let building = grid.getBuilding(this.coord)

        if (building.isExternalProduction()) {
            undoManager.lastUndo.externalProduction = building.toUndoJSON()
            building.kill()
        }
        if (!this.isSuburb)
            return

        this.isSuburb = false
        
        if (building.isBuildingProduction() && !building.isExternalProduction()) {
            undoManager.lastUndo.buildingProduction = building.toUndoJSON()
            building.kill()
        }
    }
    draw(ctx) {
        let pos = this.pos

        if (this.isSuburb) {
            drawCachedImage(ctx, this.player.suburbHexagon, pos)
        } 
        else {
            drawCachedImage(ctx, this.player.hexagon, pos)
        }
    }
}
class Suburb {
    static income = 1
    static get description() {
        let name = this.name[0].toLowerCase()
        for (let i = 1; i < this.name.length; ++i) {
            name += this.name[i]
        }
        let res = {
            name: name,
            info: {
                income: this.income + '\n'
            }
        }
        res.info['cost formula'] = '\n2 * (distance from town) - 1\n'
        res.info['cost formula'] += '\ncan only be placed on \ncaptured land'
        return res
    }
}