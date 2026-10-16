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
    get grassHex() {
        if (!this.grassHexImage) {
            let hash = Math.imul(this.coord.x + 1, 73856093) ^
                Math.imul(this.coord.y + 1, 19349663) ^
                Math.imul(grid.arr.length, 83492791) ^
                Math.imul(grid.arr[0].length, 2654435761)
            this.grassHexImage = cachedImages[grassHexImages[(hash >>> 0) % grassHexImages.length]]
        }
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
    draw(ctx, atmosphericTransform, edgeSources) {
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
        if (this.isSuburb) {
            drawCachedImage(ctx, this.player.suburbHexagon, pos)
        } 
        else {
            drawCachedImage(ctx, this.player.hexagon, pos)
        }
        drawCachedImage(ctx, this.grassHex, pos)
        this.drawAtmosphericSurface(ctx, atmosphericTransform, edgeSources)
    }
    drawAtmosphericSurface(ctx, atmosphericTransform, edgeSources) {
        if (!otherSettings.atmosphericVisuals) return
        const center = this.calcPos()
        // Atmospheric gradients are visual-only. Skip decoration whose entire
        // hex lies outside the current viewport or offscreen cache target.
        const transform = atmosphericTransform || ctx.getTransform()
        if (transform.b === 0 && transform.c === 0 && transform.a > 0 && transform.d > 0) {
            const x = center.x * transform.a + transform.e
            const y = center.y * transform.d + transform.f
            const rx = basis.r * transform.a + 1
            const ry = basis.r * transform.d + 1
            if (x + rx < 0 || y + ry < 0 ||
                    x - rx > ctx.canvas.width || y - ry > ctx.canvas.height)
                return
        }
        const vertices = mapDepth.getVertices(center)
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(vertices[0].x, vertices[0].y)
        for (const vertex of vertices.slice(1)) ctx.lineTo(vertex.x, vertex.y)
        ctx.closePath()
        ctx.clip()
        // Multiply preserves ownership hue while giving even white neutral tiles
        // a stone midtone. The world-space wash follows the board, not the camera.
        const bounds = mapDepth.surfaceBounds
        const span = bounds ? Math.max(1, bounds.right - bounds.left) : 1
        const across = bounds ? Math.max(0, Math.min(1, (center.x - bounds.left) / span)) : 0.5
        ctx.globalCompositeOperation = 'multiply'
        ctx.fillStyle = this.playerColor === 0
            ? `rgb(${Math.round(225 - 69 * across)}, ${Math.round(193 - 19 * across)}, ${Math.round(151 + 46 * across)})`
            : '#dedede'
        ctx.fill()
        // Gradients use world coordinates and follow the draw transform. Keep one
        // per live context/hex rather than recreating it each frame or zoom event.
        this.atmosphericGradients ||= new WeakMap()
        const gradientKey = [center.x, center.y, basis.r, this.playerColor === 0].join(':')
        let cached = this.atmosphericGradients.get(ctx)
        if (!cached || cached.key !== gradientKey) {
            const light = ctx.createLinearGradient(center.x - basis.r, center.y - basis.r,
                center.x + basis.r, center.y + basis.r)
            light.addColorStop(0, this.playerColor === 0 ? '#fff0d7' : '#fafafa')
            light.addColorStop(0.45, this.playerColor === 0 ? '#e8e2dc' : '#e2e2e2')
            light.addColorStop(1, this.playerColor === 0 ? '#78869c' : '#858585')
            cached = {key: gradientKey, light}
            this.atmosphericGradients.set(ctx, cached)
        }
        ctx.fillStyle = cached.light
        ctx.fill()
        // Inset bevels stay clipped to the existing hex, including at fog edges: the
        // pre-rendered edge variant facing this tile's strongest visible light.
        ctx.globalCompositeOperation = 'source-over'
        atmosphericLighting.drawEdges(ctx, center, edgeSources)
        ctx.restore()
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
