class Hexagon extends Sprite {
    constructor(x, y, _player, _isSuburb = false) {
        super(x, y)
        this.pos.x -= basis.hexHalfRectWithStrokeOffset.width
        this.pos.y -= basis.hexHalfRectWithStrokeOffset.height

        this.playerColor = _player
        this.isSuburb = _isSuburb
    }
    get isMyTurn() {
        return this.playerColor == whooseTurn
    }
    // A cell whose contents the client does not have (hidden-information board,
    // grid colour null): no owner, no suburb, nothing on it, drawn like fog.
    get unknown() {
        return this.playerColor === null
    }
    // An unknown cell has no owner: callers reading owner fields get the neutral player.
    get player() {
        if (this.unknown)
            return players[0]
        return players[this.playerColor]
    }
    // Deterministic per-cell choice among the variants of a tile overlay.
    get tileHash() {
        return (Math.imul(this.coord.x + 1, 73856093) ^
            Math.imul(this.coord.y + 1, 19349663) ^
            Math.imul(grid.arr.length, 83492791) ^
            Math.imul(grid.arr[0].length, 2654435761)) >>> 0
    }
    get grassHex() {
        if (!this.grassHexImage)
            this.grassHexImage = cachedImages[grassHexImages[this.tileHash % grassHexImages.length]]
        return this.grassHexImage
    }
    firstpaint(_player) {
        this.playerColor = _player
    }
    sudoPaint(_player) {
        this.firstpaint(_player)
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
    repaint(_player, recordUndo = true) {
        if (this.playerColor == _player)
            return
        if (recordUndo) actionManager.lastAction.hexagons.push(this.toUndoJSON())

        this.playerColor = _player

        let building = grid.getBuilding(this.coord)

        if (building.isExternalProduction()) {
            if (recordUndo) actionManager.lastAction.externalProduction = building.toUndoJSON()
            building.kill()
        }
        if (!this.isSuburb) {
            refreshCoopVision()
            return
        }

        this.isSuburb = false
        
        if (building.isBuildingProduction() && !building.isExternalProduction()) {
            let packedProduction = building.toUndoJSON()
            if (recordUndo) actionManager.lastAction.buildingProduction = packedProduction
            if (recordUndo && actionManager.lastAction.buildingProductions) {
                actionManager.lastAction.buildingProductions.push(packedProduction)
            }
            building.kill()
        }
        refreshCoopVision()
    }
    draw(ctx, atmosphericTransform) {
        let pos = this.pos
        // The atmospheric path already knows this pass's transform. Cull the
        // whole offscreen tile, including its unchanged base raster, rather than
        // submitting base draws that cannot contribute visible pixels.
        const t = atmosphericTransform
        if (otherSettings.atmosphericVisuals && t &&
                t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0) {
            const x = pos.x * t.a + t.e, y = pos.y * t.d + t.f
            const w = basis.hexHalfRectWithStrokeOffset.width * 2 * t.a
            const h = basis.hexHalfRectWithStrokeOffset.height * 2 * t.d
            if (x + w < -1 || y + h < -1 ||
                    x > ctx.canvas.width + 1 || y > ctx.canvas.height + 1)
                return
        }

        if (this.unknown) {
            drawCachedImage(ctx, players[0].fogOfWarHexagon, pos)
            return
        }
        // Atmospheric tiles: marble or the owner's colour, inset in the grout that
        // Grid.drawHexagons lays under the visible cells. No outline, no grass.
        if (otherSettings.atmosphericVisuals) {
            atmosphericLighting.drawTile(ctx, this)
            return
        }
        if (this.isSuburb) {
            drawCachedImage(ctx, this.player.suburbHexagon, pos)
        } 
        else {
            drawCachedImage(ctx, this.player.hexagon, pos)
        }
        drawCachedImage(ctx, this.grassHex, pos)
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
class FogOfWarHexagon extends Hexagon {
    constructor(x, y) {
        super(x, y)
        
    }
    draw(ctx) {
        let pos = this.pos

        drawCachedImage(ctx, players[0].fogOfWarHexagon, pos)
    }
}
