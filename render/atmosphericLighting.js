// Stationary decoration, derived only from currently authorized visible cells.
// A cached world-space light map (an upper-left key light falling off to a cool
// ambient, warm lamps added with 'lighter') is multiplied over the board's terrain
// and buildings, then a color-dodge gain map lifts it to warm cream marble.
// Units, overlays and UI are drawn after it, so they are never darkened.
const atmosphericLighting = {
    // Light map units: 0..255 per channel, 255 = the unchanged surface.
    // A broad key light from the upper left. Stops along the board diagonal:
    // [t, ambient, gain], overall lift = ambient / (255 - gain): the yellow-tan tile
    // art becomes the concept's peach-cream marble (red lifted most, blue above
    // green), bright near the key light, falling off to a slightly lavender grey.
    KEY: [
        [0, [205, 205, 205], [115, 105, 117]],
        [0.15, [205, 205, 205], [115, 105, 117]],
        [0.35, [205, 205, 205], [93, 74, 84]],
        [0.5, [205, 205, 205], [83, 65, 75]],
        [0.65, [205, 205, 205], [72, 57, 69]],
        [0.85, [205, 205, 205], [53, 48, 62]],
        [1, [205, 205, 205], [53, 48, 62]]
    ],
    // Lamp light added to the ambient (no blue: the warm filter below removes some).
    LAMP: {
        town: {color: [255, 150, 84], power: 1},
        goldmine: {color: [255, 146, 78], power: 1},
        demonPortal: {color: [255, 120, 90], power: 0.9}
    },
    // Color-dodge gain at the lamp: x2.4 red, x1.86 green, x1.12 blue (gold, like the concept's lit stone),
    // brighter than the key-lit cream so the pools stay above it.
    GAIN: '150,118,28',
    OWNED_GAIN: '51,51,51',
    TAIL_RADII: 2.5,
    // Hex edge bevels: 12 pre-rendered variants of the tile rim, lit from 0, 30, ... 330
    // degrees (screen space, y down). Each tile draws the variant facing its strongest
    // light: the nearest-strongest visible lamp within reach, else the upper-left key.
    EDGE: {
        directions: 12,
        keyAngle: -120,
        keyIntensity: 0.75,
        reachRadii: 3,
        width: 0.10,
        rasterScale: 1.5
    },
    edgeVariants: null,
    edgeVariantBuilds: 0,
    // Soft object shadows: a darkened, blurred silhouette of the board object's own sprite,
    // turned about the object's base to point away from its strongest visible light (a lamp
    // within reach, else the upper-left key) and fading towards its tip.
    SHADOW: {
        color: '38,28,46',
        keyAlpha: 0.62,
        lampAlpha: 0.3,
        length: 1.5,
        width: 0.9,
        blur: 0.05,
        tipAlpha: 0.15,
        reachRadii: 3.5
    },
    // Flat objects cast no shadow.
    flatObjects: ['lake', 'sea'],
    shadowSilhouettes: new WeakMap(),
    shadowSilhouetteBuilds: 0,
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
            const emitsLight = building && !building.killed && this.emitsLight(building)
            if (!includeCells && !emitsLight) continue
            const pos = hex.calcPos()
            if (includeCells) cells.push({x, y, pos, owned: hex.playerColor !== 0})
            if (emitsLight) sources.push({x, y, pos, name: building.isDemonPortal ? 'demonPortal' : building.name})
        }
        return {cells, sources, key: includeKey ? JSON.stringify([cells, sources]) : ''}
    },
    emitsLight(building) {
        return building.name === 'town' || building.name === 'goldmine' || building.isDemonPortal || building.name === 'demonPortal'
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
        // Owned ground keeps its team colour: there the map is made neutral grey (same
        // luminosity), so the multiply only darkens or keeps it, never retints it.
        const owned = cells.filter(cell => cell.owned)
        if (owned.length) {
            g.save()
            this.hexPath(g, owned)
            g.clip()
            g.globalCompositeOperation = 'saturation'
            g.fillStyle = '#808080'
            g.fill()
            g.restore()
        }
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
            this.pool(k, source, 0.9 * basis.r, [[0, 1], [0.4, 0.7], [1, 0]], '28,24,0')
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
        // Owned ground gets a neutral gain of at most x1.25 instead (key and lamps), which
        // undoes the ambient: a per-channel or clipping lift would push team colours off hue.
        if (owned.length) {
            this.hexPath(k, owned)
            k.clip()
            k.globalCompositeOperation = 'copy'
            k.fillStyle = this.keyGradient(k, bounds, 'owned')
            k.fill()
            k.globalCompositeOperation = 'lighten'
            for (const source of sources)
                this.pool(k, source, 0.8 * r, [[0, 1], [0.25, 0.85], [0.5, 0.45], [0.75, 0.14], [1, 0]],
                    this.OWNED_GAIN)
        }
        k.restore()
    },
    // World-space diagonal gradient, so panning never changes the light.
    keyGradient(g, bounds, part) {
        const gradient = g.createLinearGradient(bounds.left, bounds.top, bounds.right, bounds.bottom)
        for (const [t, ambient, gain] of this.KEY)
            gradient.addColorStop(t, `rgb(${part === 'ambient' ? ambient : part === 'gain' ? gain : Array(3).fill(Math.min(...gain, parseInt(this.OWNED_GAIN)))})`)
        return gradient
    },
    // One variant per light direction, built once (same geometry as getVertices): a thin
    // dark joint on every edge, a warm lit band on the edges facing the light and a shaded
    // band on the edges turned away, each fading towards the tile's centre.
    edgeVariant(index) {
        if (!this.edgeVariants || this.edgeVariants.radius !== basis.r) {
            this.edgeVariants = Object.assign(new Array(this.EDGE.directions), {radius: basis.r})
            ++this.edgeVariantBuilds
            const r = basis.r, s = this.EDGE.rasterScale, size = Math.ceil(2 * r * s) + 4
            for (let k = 0; k < this.EDGE.directions; k++) {
                const surface = document.createElement('canvas')
                surface.width = surface.height = size
                const g = surface.getContext('2d')
                g.setTransform(s, 0, 0, s, size / 2, size / 2)
                const outer = mapDepth.getVertices({x: 0, y: 0})
                const inset = 1 - this.EDGE.width * 2 / Math.sqrt(3)
                const inner = outer.map(({x, y}) => ({x: x * inset, y: y * inset}))
                const light = k * 2 * Math.PI / this.EDGE.directions
                // Clipped to the hex here, so tiles draw the variant without a clip of their own.
                g.beginPath()
                outer.forEach(({x, y}, i) => i ? g.lineTo(x, y) : g.moveTo(x, y))
                g.closePath()
                g.clip()
                for (let i = 0; i < 6; i++) {
                    const j = (i + 1) % 6
                    const facing = Math.cos((-90 + 60 * i) * Math.PI / 180 - light)
                    const color = facing > 0 ? `255,206,136,${(0.95 * facing).toFixed(3)}`
                        : `46,34,40,${(0.5 * -facing).toFixed(3)}`
                    const a = {x: (outer[i].x + outer[j].x) / 2, y: (outer[i].y + outer[j].y) / 2}
                    const b = {x: (inner[i].x + inner[j].x) / 2, y: (inner[i].y + inner[j].y) / 2}
                    const band = g.createLinearGradient(a.x, a.y, b.x, b.y)
                    band.addColorStop(0, `rgba(${color})`)
                    band.addColorStop(0.5, `rgba(${color.replace(/[^,]+$/, x => (x * 0.8).toFixed(3))})`)
                    band.addColorStop(1, `rgba(${color.replace(/[^,]+$/, '0')})`)
                    g.fillStyle = band
                    g.beginPath()
                    g.moveTo(outer[i].x, outer[i].y)
                    g.lineTo(outer[j].x, outer[j].y)
                    g.lineTo(inner[j].x, inner[j].y)
                    g.lineTo(inner[i].x, inner[i].y)
                    g.closePath()
                    g.fill()
                }
                g.strokeStyle = 'rgba(27,39,58,0.4)'
                g.lineWidth = r * 0.03
                g.beginPath()
                outer.forEach(({x, y}, i) => i ? g.lineTo(x, y) : g.moveTo(x, y))
                g.closePath()
                g.stroke()
                this.edgeVariants[k] = surface
            }
        }
        return this.edgeVariants[index]
    },
    // The strongest visible lamp within reach of a point (its own lamp excluded) and its strength.
    strongestLamp(center, sources, reachRadii) {
        const reach = reachRadii * basis.r
        let best = null, strength = 0
        for (const source of sources || []) {
            const c = this.core(source)
            const d = Math.hypot(c.x - center.x, c.y - center.y)
            if (d < 0.5 * basis.r || d >= reach) continue
            const s = (this.LAMP[source.name] || this.LAMP.goldmine).power * (1 - (d / reach) ** 2)
            if (s > strength) {
                strength = s
                best = c
            }
        }
        return {best, strength}
    },
    // Variant index and intensity for a tile centre, from visible light sources only.
    edgeLight(center, sources) {
        const {best, strength} = this.strongestLamp(center, sources, this.EDGE.reachRadii)
        const n = this.EDGE.directions
        const angle = best ? Math.atan2(best.y - center.y, best.x - center.x) * 180 / Math.PI
            : this.EDGE.keyAngle
        return {
            index: ((Math.round(angle / (360 / n)) % n) + n) % n,
            intensity: best ? Math.min(1, this.EDGE.keyIntensity + 0.6 * strength) : this.EDGE.keyIntensity
        }
    },
    // Draws the chosen pre-rendered edge variant over a tile (world transform, no clip needed).
    drawEdges(ctx, center, sources) {
        const {index, intensity} = this.edgeLight(center, sources)
        const variant = this.edgeVariant(index)
        const size = variant.width / this.EDGE.rasterScale
        const alpha = ctx.globalAlpha
        ctx.globalAlpha = alpha * intensity
        ctx.drawImage(variant, center.x - size / 2, center.y - size / 2, size, size)
        ctx.globalAlpha = alpha
    },
    // Built once per sprite raster: the sprite's alpha, blurred, filled with the shadow
    // colour and faded from its base (lowest opaque row) to its top.
    shadowSilhouette(image) {
        let silhouette = this.shadowSilhouettes.get(image)
        if (silhouette) return silhouette
        const pad = Math.ceil(this.SHADOW.blur * basis.r * 2) + 2
        const surface = document.createElement('canvas')
        surface.width = image.width + 2 * pad
        surface.height = image.height + 2 * pad
        const g = surface.getContext('2d')
        g.drawImage(image, pad, pad)
        let base = pad + Math.round(image.height * 0.8)
        try {
            const alpha = g.getImageData(0, 0, surface.width, surface.height).data
            for (let i = 3; i < alpha.length; i += 4) if (alpha[i] > 64) base = Math.floor(i / 4 / surface.width)
        } catch (_) {}
        g.clearRect(0, 0, surface.width, surface.height)
        g.filter = `blur(${(this.SHADOW.blur * basis.r).toFixed(2)}px)`
        g.drawImage(image, pad, pad)
        g.filter = 'none'
        g.globalCompositeOperation = 'source-in'
        g.fillStyle = `rgb(${this.SHADOW.color})`
        g.fillRect(0, 0, surface.width, surface.height)
        g.globalCompositeOperation = 'destination-in'
        const fade = g.createLinearGradient(0, base, 0, pad)
        fade.addColorStop(0, 'rgba(0,0,0,1)')
        fade.addColorStop(1, `rgba(0,0,0,${this.SHADOW.tipAlpha})`)
        g.fillStyle = fade
        g.fillRect(0, 0, surface.width, surface.height)
        silhouette = {surface, pad, base: base - pad}
        this.shadowSilhouettes.set(image, silhouette)
        ++this.shadowSilhouetteBuilds
        return silhouette
    },
    // Board objects (not units or lamps) on authorized visible cells cast their shadows, clipped to
    // the visible cells, under the fog and before any sprite is drawn.
    drawShadows(ctx, board) {
        if (!otherSettings.atmosphericVisuals) return
        const {cells, sources} = this.collect(board, false)
        const t = ctx.getTransform()
        const axisAligned = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0
        const casters = []
        for (const {x, y, pos} of cells) {
            const building = board.arr[x][y].building
            if (!building.notEmpty() || building.killed || building.isInvisible || building.isMapEdge ||
                building.isBuildingProduction() || board.observedBuilding(board.arr[x][y]) ||
                this.flatObjects.includes(building.name) || this.emitsLight(building)) continue
            if (axisAligned) {
                const sx = pos.x * t.a + t.e, sy = pos.y * t.d + t.f
                const rx = 2.5 * basis.r * t.a, ry = 2.5 * basis.r * t.d
                if (sx + rx < 0 || sy + ry < 0 || sx - rx > ctx.canvas.width || sy - ry > ctx.canvas.height) continue
            }
            const image = cachedImages[board.getEntityBodyImageName(building)]
            if (image && image.width) casters.push({building, image, pos})
        }
        if (!casters.length) return
        ctx.save()
        this.hexPath(ctx, cells)
        ctx.clip()
        for (const {building, image, pos} of casters) {
            const {best, strength} = this.strongestLamp(pos, sources, this.SHADOW.reachRadii)
            // Direction from the light to the object: the shadow points away from the light.
            const angle = best ? Math.atan2(pos.y - best.y, pos.x - best.x) : (this.EDGE.keyAngle + 180) * Math.PI / 180
            const dir = {x: Math.cos(angle), y: Math.sin(angle)}
            const {surface, pad, base} = this.shadowSilhouette(image)
            const L = this.SHADOW.length, W = this.SHADOW.width
            // Sprite up (-y) -> L * dir, sprite right (+x) -> W * perpendicular, about the base.
            const ox = building.pos.x + image.width / 2, oy = building.pos.y + base
            ctx.save()
            ctx.globalAlpha = this.SHADOW.keyAlpha + this.SHADOW.lampAlpha * strength
            ctx.transform(-W * dir.y, W * dir.x, -L * dir.x, -L * dir.y, ox, oy)
            ctx.drawImage(surface, -image.width / 2 - pad, -base - pad)
            ctx.restore()
        }
        ctx.restore()
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
