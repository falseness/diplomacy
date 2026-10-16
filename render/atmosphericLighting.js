// Stationary decoration, derived only from currently authorized visible cells.
// A cached world-space light map (an upper-left key light falling off to a cool
// ambient, warm lamps added with 'lighter') is multiplied over the board's terrain
// and buildings, then a color-dodge gain map lifts it to warm cream marble.
// Units, overlays and UI are drawn after it, so they are never darkened.
const atmosphericLighting = {
    // Light map units: 0..255 per channel, 255 = the unchanged surface.
    // A broad key light from the upper left. Stops along the board diagonal:
    // [t, ambient, gain], overall lift = ambient / (255 - gain): warm peach-cream
    // marble near the key light, cooler grey-lilac stone far from it.
    KEY: [
        [0, [195, 206, 211], [125, 110, 104]],
        [0.15, [212, 211, 209], [110, 100, 100]],
        [0.35, [186, 179, 183], [100, 92, 96]],
        [0.6, [199, 195, 189], [80, 78, 92]],
        [0.85, [200, 198, 190], [70, 70, 90]],
        [1, [200, 198, 190], [70, 70, 90]]
    ],
    // Lamp light added to the ambient (no blue: the warm filter below removes some).
    LAMP: {
        town: {color: [255, 150, 84], power: 1},
        goldmine: {color: [255, 146, 78], power: 1},
        demonPortal: {color: [255, 120, 90], power: 0.9}
    },
    // Color-dodge gain at the lamp: x2 red, x1.47 green, x1.13 blue (gold, like the concept's lit stone).
    GAIN: '128,82,30',
    TAIL_RADII: 2.5,
    maxDimension: 2048,
    maxPixels: 2 * 1024 * 1024,
    map: null,
    gain: null,
    mapKey: '',
    mapScale: 0,
    rebuilds: 0,
    release() {
        if (this.map) this.map.width = this.map.height = 0
        if (this.gain) this.gain.width = this.gain.height = 0
        this.map = this.gain = null
        this.mapKey = ''
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
            if (emitsLight) sources.push({x, y, pos, name: building.isDemonPortal ? 'demonPortal' : building.name})
        }
        return {cells, sources, key: includeKey ? JSON.stringify([cells, sources]) : ''}
    },
    hexPath(ctx, cells) {
        ctx.beginPath()
        for (const cell of cells) {
            const points = mapDepth.getVertices(cell.pos)
            ctx.moveTo(points[0].x, points[0].y)
            for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
            ctx.closePath()
        }
    },
    // Light map resolution follows the zoom, bounded in size.
    resolution(bounds) {
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        return Math.min(canvas.scale, this.maxDimension / w, this.maxDimension / h,
            Math.sqrt(this.maxPixels / (w * h)))
    },
    // The light map is rebuilt only when visible cells/sources (fog), board size or the
    // settled zoom change. Panning draws the same map through the camera transform,
    // and a zoom gesture reuses it scaled until the gesture settles.
    lightMap(board) {
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds
        if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null
        const collected = this.collect(board)
        const key = collected.key + JSON.stringify(bounds)
        const scale = this.resolution(bounds)
        const zooming = performance.now() < gameEvent.screen.surfaceZoomUntil
        if (this.map && this.mapKey === key && (this.mapScale === scale || zooming))
            return this.map
        this.build(collected, bounds, scale)
        this.mapKey = key
        this.mapScale = scale
        ++this.rebuilds
        return this.map
    },
    canvasFor(name, bounds, scale) {
        const surface = this[name] || document.createElement('canvas')
        atmosphericBackground.watch(surface)
        surface.width = Math.max(1, Math.ceil((bounds.right - bounds.left) * scale))
        surface.height = Math.max(1, Math.ceil((bounds.bottom - bounds.top) * scale))
        const g = surface.getContext('2d')
        g.setTransform(scale, 0, 0, scale, -bounds.left * scale, -bounds.top * scale)
        this[name] = surface
        return g
    },
    pool(g, source, radius, stops, color) {
        const c = this.core(source)
        g.save()
        // The pool sits on the opening and spills forward (down the board) as a soft cone.
        g.translate(c.x, c.y + 0.8 * basis.r)
        g.scale(1, 1.3)
        const gradient = g.createRadialGradient(0, -0.1 * radius, 0, 0, 0, radius)
        for (const [t, alpha] of stops)
            gradient.addColorStop(t, `rgba(${color},${alpha.toFixed(3)})`)
        g.fillStyle = gradient
        g.fillRect(-radius, -radius, 2 * radius, 2 * radius)
        g.restore()
    },
    build({cells, sources}, bounds, scale) {
        const r = this.TAIL_RADII * basis.r
        // (1) Light map, multiplied over the board: neutral (unchanged) everywhere except
        // the authorized visible cells, which get the cool ambient plus warm lamps.
        const g = this.canvasFor('map', bounds, scale)
        g.fillStyle = '#fff'
        g.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        this.hexPath(g, cells)
        g.save()
        g.clip()
        g.fillStyle = this.keyGradient(g, bounds, 'ambient')
        g.fill()
        // Each lamp is added: smooth falloff over about 2.5 hex radii, no hard rim.
        g.globalCompositeOperation = 'lighter'
        for (const source of sources) {
            const lamp = this.LAMP[source.name] || this.LAMP.goldmine
            this.pool(g, source, r, [[0, 0.85], [0.15, 0.72], [0.32, 0.5], [0.5, 0.3],
                [0.7, 0.13], [0.86, 0.04], [1, 0]].map(([t, a]) => [t, a * lamp.power]), lamp.color)
        }
        // The bright key-lit ambient saturates the lamps to white, so the pool is filtered
        // gold afterwards: lamp-lit stone stays golden instead of pale.
        g.globalCompositeOperation = 'multiply'
        for (const source of sources)
            this.pool(g, source, r, [[0, 1], [0.5, 0.5], [1, 0]], '255,222,184')
        // The lamp's own building is lit warm tan (its art kept), not bleached.
        for (const {pos} of sources) {
            const tint = g.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 0.8 * basis.r)
            tint.addColorStop(0, 'rgba(255,214,160,1)')
            tint.addColorStop(0.6, 'rgba(255,214,160,0.7)')
            tint.addColorStop(1, 'rgba(255,214,160,0)')
            g.fillStyle = tint
            g.fillRect(pos.x - basis.r, pos.y - basis.r, 2 * basis.r, 2 * basis.r)
        }
        g.restore()
        // (2) Gain map, 'color-dodge' after the multiply: base / (1 - gain) is a
        // multiplicative lift, so lit stone keeps its grain and dark joints. The gain is
        // a low, near-neutral cream-gold so no channel saturates into flat paint.
        const k = this.canvasFor('gain', bounds, scale)
        k.clearRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        this.hexPath(k, cells)
        k.save()
        k.clip()
        for (const source of sources)
            this.pool(k, source, 0.8 * r, [[0, 1], [0.25, 0.85], [0.5, 0.45], [0.75, 0.14], [1, 0]],
                this.GAIN)
        // The hottest spot just in front of the opening goes towards cream-gold.
        k.globalCompositeOperation = 'lighter'
        for (const source of sources)
            this.pool(k, source, 0.9 * basis.r, [[0, 1], [0.4, 0.7], [1, 0]], '28,20,0')
        // The lamp's own sprite keeps its art: no gain over the building.
        k.globalCompositeOperation = 'destination-out'
        for (const {pos} of sources) {
            const hole = k.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 0.7 * basis.r)
            hole.addColorStop(0, 'rgba(0,0,0,1)')
            hole.addColorStop(0.6, 'rgba(0,0,0,0.8)')
            hole.addColorStop(1, 'rgba(0,0,0,0)')
            k.fillStyle = hole
            k.fillRect(pos.x - basis.r, pos.y - basis.r, 2 * basis.r, 2 * basis.r)
        }
        // The key light's lift lies under the lamp pools (and fills the sprite holes).
        k.globalCompositeOperation = 'destination-over'
        k.fillStyle = this.keyGradient(k, bounds, 'gain')
        k.fill()
        k.restore()
    },
    // World-space diagonal gradient, so panning never changes the light.
    keyGradient(g, bounds, part) {
        const gradient = g.createLinearGradient(bounds.left, bounds.top, bounds.right, bounds.bottom)
        for (const [t, ambient, gain] of this.KEY)
            gradient.addColorStop(t, `rgb(${part === 'ambient' ? ambient : gain})`)
        return gradient
    },
    core(source) {
        return {x: source.pos.x, y: source.pos.y + basis.r * 0.23}
    },
    visibleSources(ctx, sources, radius, offsetY = 0) {
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) return sources
        return sources.filter(({pos}) => {
            const x = pos.x * t.a + t.e, y = (pos.y + offsetY) * t.d + t.f
            const rx = radius * t.a + 1, ry = radius * t.d + 1
            return x + rx >= 0 && y + ry >= 0 &&
                x - rx <= ctx.canvas.width && y - ry <= ctx.canvas.height
        })
    },
    // Multiplies the light map over the already drawn terrain and buildings
    // (world transform), then adds the small bright lamp cores with 'screen'.
    draw(ctx, board) {
        if (!otherSettings.atmosphericVisuals) return
        const map = this.lightMap(board)
        if (!map) return
        const bounds = mapDepth.surfaceBounds
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        const t = ctx.getTransform()
        // Only the on-screen part of the map is submitted.
        let left = bounds.left, top = bounds.top, right = bounds.right, bottom = bounds.bottom
        if (t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0) {
            left = Math.max(left, -t.e / t.a)
            top = Math.max(top, -t.f / t.d)
            right = Math.min(right, (ctx.canvas.width - t.e) / t.a)
            bottom = Math.min(bottom, (ctx.canvas.height - t.f) / t.d)
        }
        if (left >= right || top >= bottom) return
        const sx = map.width / w, sy = map.height / h
        ctx.save()
        ctx.globalCompositeOperation = 'multiply'
        ctx.drawImage(map, (left - bounds.left) * sx, (top - bounds.top) * sy,
            (right - left) * sx, (bottom - top) * sy, left, top, right - left, bottom - top)
        ctx.globalCompositeOperation = 'color-dodge'
        ctx.drawImage(this.gain, (left - bounds.left) * sx, (top - bounds.top) * sy,
            (right - left) * sx, (bottom - top) * sy, left, top, right - left, bottom - top)
        ctx.restore()
        this.bloom(ctx, board)
    },
    // A small gold glow inside the opening; the sprite around it stays readable.
    bloom(ctx, board) {
        const r = basis.r * 0.4
        const sources = this.visibleSources(ctx, this.collect(board, false, false).sources, r, basis.r * 0.23)
        if (!sources.length) return
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        for (const source of sources) {
            const c = this.core(source)
            const core = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
            core.addColorStop(0, 'rgba(255,244,196,1)')
            core.addColorStop(0.25, 'rgba(255,234,160,1)')
            core.addColorStop(0.45, 'rgba(255,200,90,0.8)')
            core.addColorStop(0.75, 'rgba(240,150,40,0.3)')
            core.addColorStop(1, 'rgba(230,130,40,0)')
            ctx.fillStyle = core
            ctx.fillRect(c.x - r, c.y - r, 2 * r, 2 * r)
        }
        ctx.restore()
    }
}
