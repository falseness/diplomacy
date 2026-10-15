// Stationary decoration, derived only from currently authorized visible cells.
// Prepared once; normal alpha blending bounds overlapping light intensity.
const atmosphericLighting = {
    texture: null,
    prepare() {
        if (this.texture) return this.texture
        const image = document.createElement('canvas')
        image.width = image.height = 128
        const ctx = image.getContext('2d')
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
        gradient.addColorStop(0, 'rgba(255,192,78,0.32)')
        gradient.addColorStop(0.35, 'rgba(255,174,54,0.16)')
        gradient.addColorStop(1, 'rgba(255,158,40,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 128, 128)
        atmosphericBackground.watch(image)
        this.texture = image
        return image
    },
    collect(board, includeKey = true, includeCells = true) {
        const cells = [], sources = []
        if (!otherSettings.atmosphericVisuals) return {cells, sources, key: ''}
        for (const row of board.arr) for (const cell of row) {
            const {x, y} = cell.coord
            // Never inspect a hidden building, including public fog landmarks.
            if (isFogOfWar && !board.fogOfWar[x][y]) continue
            const hex = board.observedHexagon(cell) || cell.hexagon
            if (hex.unknown) continue
            const observation = board.observedBuilding(cell)
            const building = observation ? onlineObservation.buildings.get(x + ',' + y)?.sprite : cell.building
            if (building?.isMapEdge) continue
            const emitsLight = building && !building.killed &&
                (building.name === 'town' || building.name === 'goldmine' || building.isDemonPortal || building.name === 'demonPortal')
            if (!includeCells && !emitsLight) continue
            const pos = hex.calcPos()
            if (includeCells) cells.push({x, y, pos})
            if (emitsLight) sources.push({x, y, pos, name: building.name})
        }
        return {cells, sources, key: includeKey ? JSON.stringify([cells, sources]) : ''}
    },
    clip(ctx, cells) {
        ctx.beginPath()
        const transform = ctx.getTransform()
        const axisAligned = transform.b === 0 && transform.c === 0 &&
            transform.a > 0 && transform.d > 0
        for (const cell of cells) {
            // Cull only paths wholly outside this target, including offscreen
            // cache targets. Keep a device-pixel margin for antialiasing.
            if (axisAligned) {
                const x = cell.pos.x * transform.a + transform.e
                const y = cell.pos.y * transform.d + transform.f
                const rx = basis.r * transform.a + 1
                const ry = basis.r * transform.d + 1
                if (x + rx < 0 || y + ry < 0 ||
                        x - rx > ctx.canvas.width || y - ry > ctx.canvas.height)
                    continue
            }
            const points = mapDepth.getVertices(cell.pos)
            ctx.moveTo(points[0].x, points[0].y)
            for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
            ctx.closePath()
        }
        ctx.clip()
    },
    visibleSources(ctx, sources, radius) {
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) return sources
        return sources.filter(({pos}) => {
            const x = pos.x * t.a + t.e, y = pos.y * t.d + t.f
            const rx = radius * t.a + 1, ry = radius * t.d + 1
            return x + rx >= 0 && y + ry >= 0 &&
                x - rx <= ctx.canvas.width && y - ry <= ctx.canvas.height
        })
    },
    draw(ctx, board) {
        const collected = this.collect(board, false)
        const radius = basis.r * 2.1
        const sources = this.visibleSources(ctx, collected.sources, radius)
        if (!sources.length) return
        const cells = collected.cells
        ctx.save()
        // Cells outside every light's bounds cannot contribute pixels. Avoid a
        // full-board clip path on each frame, retaining the same authorized cells.
        const reach = radius + basis.r
        this.clip(ctx, cells.filter(cell => sources.some(source =>
            Math.abs(cell.pos.x - source.pos.x) <= reach &&
            Math.abs(cell.pos.y - source.pos.y) <= reach)))
        for (const {pos} of sources)
            ctx.drawImage(this.prepare(), pos.x - radius, pos.y - radius, radius * 2, radius * 2)
        ctx.restore()
    },
    glow(ctx, board) {
        const sources = this.visibleSources(ctx, this.collect(board, false, false).sources, basis.r * 0.4)
        if (!sources.length) return
        ctx.save()
        // Each small center glow lies wholly inside its own visible source hex.
        this.clip(ctx, sources)
        for (const {x, y, pos} of sources) {
            // Keep units completely readable when standing on a source.
            if (board.getStillUnit(board.arr[x][y])) continue
            const r = basis.r * 0.12
            ctx.fillStyle = 'rgba(255,224,145,0.65)'
            ctx.beginPath()
            ctx.ellipse(pos.x, pos.y + basis.r * 0.23, r * 0.6, r, 0, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.restore()
    }
}
