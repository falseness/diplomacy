// Stationary decoration, derived only from currently authorized visible cells.
// A cached world-space light map (an upper-left key light falling off to a cool
// ambient, warm lamps added with 'lighter') is multiplied over the board's terrain
// and buildings, then a color-dodge gain map lifts it to warm cream marble.
// Units, overlays and UI are drawn after it, so they are never darkened.
const atmosphericLighting = {
    // Light map units: 0..255 per channel, 255 = the unchanged surface.
    // A broad key light from the left, falling mostly across the board (DIRECTION, world
    // space) and a little down it. Stops along that axis: [t, ambient, gain], overall
    // lift = ambient / (255 - gain): the near-neutral marble tiles (TILE) become warm
    // peach-cream near the key light, then pale cream-grey, then a pale neutral grey-white on the far side.
    KEY: [
        [0, [205, 205, 205], [108, 74, 25]],
        [0.15, [205, 205, 205], [108, 74, 25]],
        [0.26, [205, 205, 205], [98, 61, 28]],
        [0.38, [205, 205, 205], [80, 52, 28]],
        [0.5, [205, 205, 205], [64, 46, 31]],
        [0.62, [205, 205, 205], [44, 40, 36]],
        [0.75, [205, 205, 205], [32, 34, 40]],
        [0.85, [205, 205, 205], [30, 33, 40]],
        [1, [205, 205, 205], [30, 33, 40]]
    ],
    // Key light axis (x, y); y per unit of x.
    DIRECTION: [1, 0.6],
    // Lamps: power weighs each lamp for shadow direction. Light is the SPILL below.
    LAMP: {
        town: {power: 1},
        goldmine: {power: 1},
        demonPortal: {power: 0.9}
    },
    // Lamp spill: a soft cream-gold halo around each doorway that lights the building and
    // the stone beside it, then amber pools on the stone in front of (below) the doorway,
    // broad and fading down the board, like the concept. Each layer is an ellipse
    // [centre below the cell centre, half width, half height] (hex radii) blended over the
    // key light (source-over), so a pool looks the same on both sides of the board and fades
    // into the key-lit stone with no rim. map: multiply colour (blue held back -> amber,
    // outer layers paler cream), gain: color-dodge lift. Hot layer last, just below the door.
    SPILL: [
        {dy: 0.55, rx: 1.8, ry: 1.4, alpha: 0.85, map: [255, 236, 210], gain: [80, 54, 28]},
        {dy: 1.35, rx: 1.5, ry: 1.35, alpha: 0.9, map: [255, 224, 170], gain: [100, 58, 8]},
        {dy: 1.05, rx: 1.05, ry: 0.85, alpha: 0.95, map: [255, 226, 144], gain: [108, 68, 0]},
        {dy: 0.8, rx: 0.75, ry: 0.6, alpha: 1, map: [255, 238, 170], gain: [124, 96, 6]},
        {dy: 0.55, rx: 0.5, ry: 0.3, alpha: 0.9, map: [255, 226, 150], gain: [128, 90, 4]}
    ],
    // Smooth (near-Gaussian) radial falloff of every spill layer, so no rim or hex edge shows.
    SPILL_STOPS: [[0, 1], [0.1, 0.985], [0.2, 0.94], [0.3, 0.87], [0.4, 0.77], [0.5, 0.64], [0.6, 0.49],
        [0.7, 0.33], [0.8, 0.18], [0.9, 0.06], [1, 0]],
    // Glow of owned tiles on the stone next to them: reach in hex radii, colour mixed towards white.
    // Owned tiles: colour gamma (deeper) and a stone mix [r, g, b, amount].
    TERRITORY: {reach: 2.2, mix: 0.5, depth: 2.1, stone: [215, 200, 190, 0.12]},
    // Upper-left key light direction (degrees, screen space, y down) for shadows.
    KEY_ANGLE: -120,
    // Tile look: pale cream marble tiles set in thin light grout. Each visible cell is
    // inset by half the grout width over a grout fill of the visible cells, so there
    // are no outlines or seams. Neutral tiles draw one of a few procedurally generated,
    // cached marble variants; owned tiles keep their colour under a faint sheen.
    TILE: {
        variants: 8,
        rasterScale: 1.5,
        // Near neutral before the light map, which warms it on the key side (about 1.45 red)
        // and leaves it a pale neutral grey on the far side (about 0.91 red, 0.95 blue).
        grout: '#615658',
        groutWidth: 0.065,
        stone: [153, 147, 155],
        sheen: 0.1,
        // Polished slab sheen: a soft highlight towards the upper left of each neutral tile.
        polish: 0.16
    },
    tileVariants: null,
    tileVariantBuilds: 0,
    tileFills: new Map(),
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
        // The key lists the collected cells and sources by coordinate (positions follow from
        // the coordinates and the hex radius); a plain string, cheap to compare every frame.
        let key = includeKey ? basis.r + '|' : ''
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
            const name = emitsLight ? building.isDemonPortal ? 'demonPortal' : building.name : ''
            // Owned tiles keep their player colour: no stone lighting, a soft glow of it instead.
            const owner = hex.playerColor ? hex.player?.color : null
            if (includeCells) cells.push({x, y, pos, owner})
            if (emitsLight) sources.push({x, y, pos, name})
            if (includeKey) key += x + ',' + y + (emitsLight ? ',' + name : '') +
                (owner ? ',o' + hex.playerColor : '') + ';'
        }
        return {cells, sources, key}
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
    // Light map resolution follows the zoom (or a fixed raster's scale), bounded in size.
    resolution(bounds, cap = canvas.scale) {
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        return Math.min(cap, this.maxDimension / w, this.maxDimension / h,
            Math.sqrt(this.maxPixels / (w * h)))
    },
    // The light map is rebuilt only when visible cells/sources (fog), board size or the
    // settled zoom change. Panning draws the same map through the camera transform,
    // and a zoom gesture reuses it scaled until the gesture settles.
    lightMap(board, cap) {
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds
        if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null
        const collected = this.collect(board)
        const key = collected.key + JSON.stringify(bounds)
        const scale = this.resolution(bounds, cap)
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
    // One spill layer of a lamp: an elliptical radial gradient of colour, alpha by SPILL_STOPS.
    spill(g, source, layer, color) {
        g.save()
        g.translate(source.pos.x, source.pos.y + layer.dy * basis.r)
        g.scale(layer.rx * basis.r, layer.ry * basis.r)
        const gradient = g.createRadialGradient(0, 0, 0, 0, 0, 1)
        for (const [t, alpha] of this.SPILL_STOPS)
            gradient.addColorStop(t, `rgba(${color},${(alpha * layer.alpha).toFixed(3)})`)
        g.fillStyle = gradient
        g.fillRect(-1, -1, 2, 2)
        g.restore()
    },
    build({cells, sources}, bounds, scale) {
        // (1) Light map, multiplied over the board: neutral (unchanged) everywhere except
        // the authorized visible cells, which get the cool ambient plus warm lamps.
        const g = this.canvasFor('map', bounds, scale)
        g.fillStyle = '#fff'
        g.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        const stone = cells.filter(cell => !cell.owner)
        this.hexPath(g, stone)
        g.save()
        g.clip()
        g.fillStyle = this.keyGradient(g, bounds, 'ambient')
        g.fill()
        // Territory glow: each owned tile tints the stone around it with its colour.
        g.globalCompositeOperation = 'multiply'
        for (const {pos, owner} of cells) {
            if (!owner) continue
            const reach = this.TERRITORY.reach * basis.r, mix = c => Math.round(c + (255 - c) * this.TERRITORY.mix)
            const glow = g.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, reach)
            glow.addColorStop(0, `rgba(${mix(owner.r)},${mix(owner.g)},${mix(owner.b)},1)`)
            glow.addColorStop(0.45, `rgba(${mix(owner.r)},${mix(owner.g)},${mix(owner.b)},0.55)`)
            glow.addColorStop(1, `rgba(${mix(owner.r)},${mix(owner.g)},${mix(owner.b)},0)`)
            g.fillStyle = glow
            g.fillRect(pos.x - reach, pos.y - reach, 2 * reach, 2 * reach)
        }
        // Lamp spill (multiply part): the blue is held back towards amber.
        g.globalCompositeOperation = 'source-over'
        for (const layer of this.SPILL)
            for (const source of sources) this.spill(g, source, layer, layer.map)
        g.restore()
        // (2) Gain map, 'color-dodge' after the multiply: base / (1 - gain) is a
        // multiplicative lift, so lit stone keeps its grain and dark joints. The gain is
        // a low, near-neutral cream-gold so no channel saturates into flat paint.
        const k = this.canvasFor('gain', bounds, scale)
        k.clearRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        this.hexPath(k, stone)
        k.save()
        k.clip()
        // The key light's lift, then each lamp's spill blended over it.
        k.fillStyle = this.keyGradient(k, bounds, 'gain')
        k.fill()
        for (const layer of this.SPILL)
            for (const source of sources) this.spill(k, source, layer, layer.gain)
        k.restore()
    },
    // World-space gradient along DIRECTION, from the top left corner to the farthest corner,
    // so panning never changes the light.
    keyGradient(g, bounds, part) {
        const [dx, dy] = this.DIRECTION
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        const k = (w * dx + h * dy) / (dx * dx + dy * dy)
        const gradient = g.createLinearGradient(bounds.left, bounds.top, bounds.left + k * dx, bounds.top + k * dy)
        for (const [t, ambient, gain] of this.KEY)
            gradient.addColorStop(t, `rgb(${part === 'ambient' ? ambient : gain})`)
        return gradient
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
    // Hexagon of radius r about (x, y), as getVertices.
    hexagonPath(g, x, y, r) {
        const h = r * Math.sqrt(3) / 2
        g.moveTo(x - r / 2, y - h)
        g.lineTo(x + r / 2, y - h)
        g.lineTo(x + r, y)
        g.lineTo(x + r / 2, y + h)
        g.lineTo(x - r / 2, y + h)
        g.lineTo(x - r, y)
        g.closePath()
    },
    // Inset tile radius: the grout shows half its width on each side of an edge.
    tileRadius() {
        return basis.r * (1 - this.TILE.groutWidth / Math.sqrt(3))
    },
    // A small deterministic generator, so every variant looks the same on every load.
    random(seed) {
        let a = seed >>> 0
        return () => {
            a = (a + 0x6D2B79F5) >>> 0
            let t = Math.imul(a ^ (a >>> 15), 1 | a)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    },
    // Marble variants, built once per hex radius: cream stone with soft light and warm
    // grey clouds, a few thin grey veins with faint halos, and a soft sheen from the
    // upper left. Clipped to the inset tile, centred in the raster.
    tileVariant(index) {
        if (!this.tileVariants || this.tileVariants.radius !== basis.r) {
            this.tileVariants = Object.assign(new Array(this.TILE.variants), {radius: basis.r})
            ++this.tileVariantBuilds
        }
        if (this.tileVariants[index]) return this.tileVariants[index]
        const r = basis.r, s = this.TILE.rasterScale, size = Math.ceil(2 * r * s) + 4
        const surface = document.createElement('canvas')
        surface.width = surface.height = size
        const g = surface.getContext('2d')
        g.setTransform(s, 0, 0, s, size / 2, size / 2)
        g.beginPath()
        this.hexagonPath(g, 0, 0, this.tileRadius())
        g.clip()
        const rand = this.random(0x9e3779b9 * (index + 1))
        // Each slab is a little lighter or darker than its neighbours.
        const shade = 0.94 + 0.12 * rand()
        const [sr, sg, sb] = this.TILE.stone.map(v => Math.round(v * shade))
        g.fillStyle = `rgb(${sr},${sg},${sb})`
        g.fillRect(-r, -r, 2 * r, 2 * r)
        // Clouds: broad, low contrast mottling.
        for (let i = 0; i < 26; i++) {
            const x = (rand() * 2 - 1) * r, y = (rand() * 2 - 1) * r, radius = (0.25 + 0.5 * rand()) * r
            const tone = rand() < 0.6 ? 1.07 : 0.95
            const color = `${[sr, sg, sb].map(v => Math.min(255, Math.round(v * tone))).join(',')},` +
                (0.15 + 0.2 * rand()).toFixed(3)
            const cloud = g.createRadialGradient(x, y, 0, x, y, radius)
            cloud.addColorStop(0, `rgba(${color})`)
            cloud.addColorStop(1, `rgba(${color.replace(/[^,]+$/, '0')})`)
            g.fillStyle = cloud
            g.fillRect(x - radius, y - radius, 2 * radius, 2 * radius)
        }
        // Veins: wandering curves across the tile, a faint wide halo under a fine line.
        g.lineCap = 'round'
        const veins = 1 + Math.floor(rand() * 2)
        for (let v = 0; v < veins; v++) {
            const a = rand() * 2 * Math.PI, b = a + Math.PI * (0.6 + 0.6 * rand())
            const points = [{x: Math.cos(a) * r, y: Math.sin(a) * r}]
            for (let k = 1; k < 4; k++) {
                const t = k / 4
                points.push({
                    x: (1 - t) * Math.cos(a) * r + t * Math.cos(b) * r + (rand() - 0.5) * 0.45 * r,
                    y: (1 - t) * Math.sin(a) * r + t * Math.sin(b) * r + (rand() - 0.5) * 0.45 * r
                })
            }
            points.push({x: Math.cos(b) * r, y: Math.sin(b) * r})
            const strength = v === 0 ? 1 : 0.6
            // Soft, feathery warm grey: wide faint bands under a fine light-grey core, no crack line.
            for (const [width, alpha] of [[0.3, 0.05], [0.14, 0.055], [0.06, 0.06], [0.025, 0.065]]) {
                g.strokeStyle = `rgba(${Math.round(sr * 0.8)},${Math.round(sg * 0.79)},${Math.round(sb * 0.8)},${(alpha * strength).toFixed(3)})`
                g.lineWidth = width * r
                g.beginPath()
                g.moveTo(points[0].x, points[0].y)
                for (let k = 1; k < points.length - 1; k++) {
                    const m = {x: (points[k].x + points[k + 1].x) / 2, y: (points[k].y + points[k + 1].y) / 2}
                    g.quadraticCurveTo(points[k].x, points[k].y, m.x, m.y)
                }
                g.lineTo(points[points.length - 1].x, points[points.length - 1].y)
                g.stroke()
            }
        }
        // A fine lit lip inside the upper edges, under the grout's shadow line.
        const lip = this.tileRadius() - 0.02 * r
        const h = lip * Math.sqrt(3) / 2
        g.strokeStyle = 'rgba(255,250,240,0.22)'
        g.lineWidth = 0.03 * r
        g.lineJoin = 'round'
        g.beginPath()
        g.moveTo(-lip, 0)
        g.lineTo(-lip / 2, -h)
        g.lineTo(lip / 2, -h)
        g.lineTo(lip, 0)
        g.stroke()
        // Polish: a soft highlight towards the upper left, so the slab reads as polished marble.
        const polish = g.createRadialGradient(-0.35 * r, -0.4 * r, 0, -0.35 * r, -0.4 * r, 1.2 * r)
        polish.addColorStop(0, `rgba(255,252,246,${this.TILE.polish})`)
        polish.addColorStop(0.5, `rgba(255,252,246,${(this.TILE.polish * 0.35).toFixed(3)})`)
        polish.addColorStop(1, 'rgba(255,252,246,0)')
        g.fillStyle = polish
        g.fillRect(-r, -r, 2 * r, 2 * r)
        this.drawSheen(g, 0, 0, this.TILE.sheen)
        return this.tileVariants[index] = surface
    },
    // A soft polished sheen from the upper left, fading out before the far corner.
    drawSheen(g, x, y, alpha) {
        const r = basis.r
        const sheen = g.createLinearGradient(x - r, y - r, x + r, y + r)
        sheen.addColorStop(0, `rgba(255,255,255,${alpha})`)
        sheen.addColorStop(0.45, 'rgba(255,255,255,0)')
        sheen.addColorStop(1, `rgba(90,80,90,${(alpha / 3).toFixed(3)})`)
        g.fillStyle = sheen
        g.fillRect(x - r, y - r, 2 * r, 2 * r)
    },
    // Owned tile colour, deepened like coloured stone (TERRITORY.depth gamma, a little stone
    // mixed in), then as the classic tile shows it: full on suburbs, lightened elsewhere.
    tileFill(hexagon) {
        const {r, g, b} = hexagon.player.color
        const key = r + ',' + g + ',' + b + (hexagon.isSuburb ? ',s' : '')
        let fill = this.tileFills.get(key)
        if (!fill) {
            const {depth, stone} = this.TERRITORY
            const deep = (c, i) => 255 * (c / 255) ** depth * (1 - stone[3]) + stone[i] * stone[3]
            const mix = (c, i) => Math.round(hexagon.isSuburb ? deep(c, i) : deep(c, i) + (255 - deep(c, i)) * 0.4)
            fill = `rgb(${mix(r, 0)},${mix(g, 1)},${mix(b, 2)})`
            this.tileFills.set(key, fill)
        }
        return fill
    },
    // The grout: one fill of the drawn, known cells, before their inset tiles.
    drawGrout(ctx, hexagons) {
        ctx.save()
        ctx.beginPath()
        for (const hexagon of hexagons) {
            if (hexagon.unknown) continue
            const c = hexagon.calcPos()
            this.hexagonPath(ctx, c.x, c.y, basis.r)
        }
        ctx.fillStyle = this.TILE.grout
        ctx.fill()
        ctx.restore()
    },
    drawTile(ctx, hexagon) {
        const c = hexagon.calcPos()
        if (hexagon.playerColor === 0) {
            const variant = this.tileVariant(hexagon.tileHash % this.TILE.variants)
            const size = variant.width / this.TILE.rasterScale
            ctx.drawImage(variant, c.x - size / 2, c.y - size / 2, size, size)
            return
        }
        ctx.save()
        ctx.beginPath()
        this.hexagonPath(ctx, c.x, c.y, this.tileRadius())
        ctx.fillStyle = this.tileFill(hexagon)
        ctx.fill()
        ctx.clip()
        // Lit at the centre, a little deeper towards the grout.
        const shade = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, basis.r)
        shade.addColorStop(0, 'rgba(255,255,255,0.1)')
        shade.addColorStop(0.5, 'rgba(255,255,255,0)')
        shade.addColorStop(1, 'rgba(10,10,40,0.24)')
        ctx.fillStyle = shade
        ctx.fillRect(c.x - basis.r, c.y - basis.r, 2 * basis.r, 2 * basis.r)
        this.drawSheen(ctx, c.x, c.y, this.TILE.sheen)
        ctx.restore()
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
            const angle = best ? Math.atan2(pos.y - best.y, pos.x - best.x) : (this.KEY_ANGLE + 180) * Math.PI / 180
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
    // Lights the board surface cache once, when it is built (world transform, cache scale):
    // the same multiply and color-dodge as draw(), clipped to the lit cells (the map is
    // neutral and the gain empty everywhere else), then the lamp bloom, so cached frames
    // skip the full-screen composite and the per-lamp overlays (units still come after).
    // The light map resolution follows the cache scale, not the zoom.
    bake(ctx, board, scale) {
        if (!otherSettings.atmosphericVisuals) return false
        const map = this.lightMap(board, scale)
        if (!map) return false
        const bounds = mapDepth.surfaceBounds
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        ctx.save()
        this.hexPath(ctx, this.collect(board, false).cells)
        ctx.clip()
        ctx.globalCompositeOperation = 'multiply'
        ctx.drawImage(map, bounds.left, bounds.top, w, h)
        ctx.globalCompositeOperation = 'color-dodge'
        ctx.drawImage(this.gain, bounds.left, bounds.top, w, h)
        ctx.restore()
        this.bloom(ctx, board)
        return true
    },
    // Multiplies the light map over the already drawn terrain and buildings
    // (world transform) and adds the lamp bloom, unless both come from a lit cache.
    draw(ctx, board, baked = false) {
        if (!otherSettings.atmosphericVisuals || baked) return
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
    // Bloom: the lamp sprite is shaded (its silhouette multiplied by a light warm tint, the
    // doorway gold), then a white-hot core clipped to the doorway and a warm halo that also
    // lights the arch are added with 'screen'. Both overlays are built once per sprite
    // raster; the old round sprite is the fallback for a missing raster.
    BLOOM: {
        radius: 0.9,
        stops: [[0, '255,244,190', 1], [0.1, '255,214,100', 1], [0.22, '255,165,40', 0.9],
            [0.4, '250,125,25', 0.4], [0.65, '240,110,25', 0.1], [1, '230,100,30', 0]],
        // Sprite tint about the doorway: lit warm on the arch beside it, dark stone on the rim.
        shadeStops: [[0, '255,200,130'], [0.3, '236,166,112'], [0.55, '168,128,124'], [1, '124,100,114']],
        shadeReach: 0.6,
        door: '255,168,70',
        halo: 1,
        haloStops: [[0, '255,210,130', 0.9], [0.25, '252,184,96', 0.6], [0.55, '245,152,72', 0.24],
            [1, '235,130,60', 0]],
        flareStops: [[0, '255,252,230', 1], [0.25, '255,220,130', 0.85], [0.55, '255,160,55', 0.45],
            [1, '240,120,40', 0]],
        flareReach: 3,
        coreStops: [[0, '255,255,240', 1], [0.18, '255,240,170', 1], [0.4, '255,196,80', 1],
            [0.72, '252,146,36', 1], [1, '224,104,28', 1]],
        coreReach: 1.6,
        // The halo kept on the sprite (none: the arch keeps its dark stone contrast).
        haloOnSprite: 0
    },
    // Doorway of each lamp sprite as fractions of its raster: centre, half width, half height.
    DOOR: {
        goldmine: {x: 0.495, y: 0.65, w: 0.1, h: 0.155},
        // A town keeps its warm lit walls: a lighter tint than the cave's dark stone.
        town: {x: 0.44, y: 0.83, w: 0.045, h: 0.085,
            shadeStops: [[0, '255,222,170'], [0.4, '250,206,160'], [1, '214,180,160']]},
        demonPortal: {x: 0.49, y: 0.66, w: 0.13, h: 0.2}
    },
    bloomSprite: null,
    bloomSpriteBuilds: 0,
    lampOverlays: new WeakMap(),
    lampOverlayBuilds: 0,
    bloomImage() {
        if (this.bloomSprite) return this.bloomSprite
        const size = 256, sprite = document.createElement('canvas')
        sprite.width = sprite.height = size
        const g = sprite.getContext('2d'), c = size / 2
        const glow = g.createRadialGradient(c, c, 0, c, c, c)
        for (const [t, color, alpha] of this.BLOOM.stops)
            glow.addColorStop(t, `rgba(${color},${alpha})`)
        g.fillStyle = glow
        g.fillRect(0, 0, size, size)
        ++this.bloomSpriteBuilds
        return this.bloomSprite = sprite
    },
    // Round-topped doorway path in raster pixels, offset by (ox, oy).
    doorPath(g, door, image, ox = 0, oy = 0) {
        const cx = ox + door.x * image.width, rw = door.w * image.width
        const top = oy + (door.y - door.h) * image.height, bottom = oy + (door.y + door.h) * image.height
        g.beginPath()
        g.moveTo(cx - rw, bottom)
        g.lineTo(cx - rw, top + rw)
        g.arc(cx, top + rw, rw, Math.PI, 0)
        g.lineTo(cx + rw, bottom)
        g.closePath()
    },
    lampOverlay(image, name) {
        let overlay = this.lampOverlays.get(image)
        if (overlay && overlay.radius === basis.r && overlay.name === name) return overlay
        const door = this.DOOR[name] || this.DOOR.goldmine
        // Shade: the sprite's silhouette in the stone tint, the doorway gold (a white doorway
        // under the screen core reads pale cream; gold leaves it a flame of white in amber).
        const shade = document.createElement('canvas')
        shade.width = image.width
        shade.height = image.height
        let g = shade.getContext('2d')
        g.drawImage(image, 0, 0)
        g.globalCompositeOperation = 'source-in'
        const dx = door.x * image.width, dy = (door.y + 0.4 * door.h) * image.height
        const tint = g.createRadialGradient(dx, dy, 0, dx, dy, this.BLOOM.shadeReach * image.width)
        for (const [t, color] of door.shadeStops || this.BLOOM.shadeStops)
            tint.addColorStop(t, `rgb(${color})`)
        g.fillStyle = tint
        g.fillRect(0, 0, shade.width, shade.height)
        g.globalCompositeOperation = 'source-atop'
        g.fillStyle = `rgb(${this.BLOOM.door})`
        this.doorPath(g, door, image)
        g.fill()
        // Glow: the halo around the doorway with the stone cut out, then the hot core in the doorway.
        const pad = Math.ceil(this.BLOOM.halo * basis.r)
        const glow = document.createElement('canvas')
        glow.width = image.width + 2 * pad
        glow.height = image.height + 2 * pad
        g = glow.getContext('2d')
        const cx = pad + door.x * image.width, cy = pad + (door.y + 0.4 * door.h) * image.height
        const halo = g.createRadialGradient(cx, cy, 0, cx, cy, pad)
        for (const [t, color, alpha] of this.BLOOM.haloStops)
            halo.addColorStop(t, `rgba(${color},${alpha})`)
        g.fillStyle = halo
        g.fillRect(0, 0, glow.width, glow.height)
        g.globalCompositeOperation = 'destination-out'
        g.globalAlpha = 1 - this.BLOOM.haloOnSprite
        g.drawImage(image, pad, pad)
        g.globalAlpha = 1
        g.globalCompositeOperation = 'source-over'
        // Flare: the doorway's light spilling over its rim onto the arch.
        const flareReach = this.BLOOM.flareReach * door.w * image.width
        const flare = g.createRadialGradient(cx, cy, 0, cx, cy, flareReach)
        for (const [t, color, alpha] of this.BLOOM.flareStops)
            flare.addColorStop(t, `rgba(${color},${alpha})`)
        g.fillStyle = flare
        g.fillRect(cx - flareReach, cy - flareReach, 2 * flareReach, 2 * flareReach)
        this.doorPath(g, door, image, pad, pad)
        g.save()
        g.clip()
        // A flame: white near the top of the opening, deepening to orange at its foot and sides.
        const reach = this.BLOOM.coreReach * door.w * image.width, fy = pad + (door.y - 0.15 * door.h) * image.height
        const core = g.createRadialGradient(cx, fy, 0, cx, fy, reach)
        for (const [t, color, alpha] of this.BLOOM.coreStops)
            core.addColorStop(t, `rgba(${color},${alpha})`)
        g.fillStyle = core
        g.fillRect(0, 0, glow.width, glow.height)
        g.restore()
        overlay = {radius: basis.r, name, shade, glow, pad}
        this.lampOverlays.set(image, overlay)
        ++this.lampOverlayBuilds
        return overlay
    },
    // The lamp building's sprite as drawn (an observed building's last seen sprite).
    lampBuilding(board, {x, y}) {
        const cell = board.arr[x][y]
        return board.observedBuilding(cell) ? onlineObservation.buildings.get(x + ',' + y)?.sprite : cell.building
    },
    bloom(ctx, board) {
        const r = basis.r * this.BLOOM.radius
        const sources = this.visibleSources(ctx, this.collect(board, false, false).sources, r, basis.r * 0.23)
        if (!sources.length) return
        ctx.save()
        for (const source of sources) {
            const building = this.lampBuilding(board, source)
            const image = building && cachedImages[board.getEntityBodyImageName(building)]
            if (!image || !image.width || !building.pos) {
                const c = this.core(source)
                ctx.globalCompositeOperation = 'screen'
                ctx.drawImage(this.bloomImage(), c.x - r, c.y - r, 2 * r, 2 * r)
                continue
            }
            const {shade, glow, pad} = this.lampOverlay(image, source.name)
            ctx.globalCompositeOperation = 'multiply'
            ctx.drawImage(shade, building.pos.x, building.pos.y)
            ctx.globalCompositeOperation = 'screen'
            ctx.drawImage(glow, building.pos.x - pad, building.pos.y - pad)
        }
        ctx.restore()
    }
}
