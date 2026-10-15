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
        // A bright threshold rolls into broad amber ground illumination.
        // The transparent edge avoids a visible ring or hard disk.
        gradient.addColorStop(0, 'rgba(255,220,126,0.78)')
        gradient.addColorStop(0.18, 'rgba(255,196,77,0.62)')
        gradient.addColorStop(0.48, 'rgba(255,174,48,0.34)')
        gradient.addColorStop(0.78, 'rgba(255,158,40,0.09)')
        gradient.addColorStop(1, 'rgba(255,158,40,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 128, 128)
        this.texture = image
        return image
    },
    collect(board) {
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
            const pos = hex.calcPos()
            cells.push({x, y, pos})
            if (building && !building.killed &&
                (building.name === 'town' || building.name === 'goldmine' || building.isDemonPortal || building.name === 'demonPortal'))
                sources.push({x, y, pos, name: building.name})
        }
        return {cells, sources, key: JSON.stringify([cells, sources])}
    },
    clip(ctx, cells) {
        ctx.beginPath()
        for (const cell of cells) {
            const points = mapDepth.getVertices(cell.pos)
            ctx.moveTo(points[0].x, points[0].y)
            for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
            ctx.closePath()
        }
        ctx.clip()
    },
    draw(ctx, board) {
        const {cells, sources} = this.collect(board)
        if (!sources.length) return
        ctx.save()
        this.clip(ctx, cells)
        const radius = basis.r * 2.3
        for (const {pos} of sources)
            ctx.drawImage(this.prepare(), pos.x - radius, pos.y + basis.r * 0.23 - radius, radius * 2, radius * 2)
        ctx.restore()
    },
    glow(ctx, board) {
        const {cells, sources} = this.collect(board)
        if (!sources.length) return
        ctx.save()
        this.clip(ctx, cells)
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
