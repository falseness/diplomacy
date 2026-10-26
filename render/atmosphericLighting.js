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
    // peach-cream near the key light, then a light neutral cream, then a pale grey-cream on the far side.
    // The ambient is warm on the near half (red kept, blue held back) with a bright golden gain in the
    // upper-left corner; across the middle of the board a peach-cream (a little red added to ambient and gain,
    // green and blue held back, so the stone keeps its warmth instead of reading grey), then a neutral warm grey-cream
    // and on the far side (the cool light there is the blue territory's spill, TERRITORY.cool),
    // turning a light grey-blue only along the far edge.
    KEY: [
        [0, [216, 200, 191], [112, 80, 26]],
        [0.15, [216, 200, 191], [104, 74, 24]],
        [0.26, [216, 200, 191], [92, 64, 34]],
        [0.38, [207, 199, 195], [86, 59, 38]],
        [0.5, [200, 197, 194], [72, 53, 42]],
        [0.62, [205, 199, 199], [46, 35, 32]],
        [0.75, [201, 197, 199], [36, 35, 38]],
        [0.85, [206, 200, 196], [32, 33, 38]],
        [1, [196, 196, 204], [28, 34, 44]]
    ],
    // Key light axis (x, y); y per unit of x.
    DIRECTION: [1, 0.3],
    // Three broad soft golden (yellow, not orange) shafts of the key light, continuing the sky's swath: each a group of
    // three soft streaks (Gaussian across) fanning from a point left of the board's top
    // (fractions of the board bounds), each streak [angle in degrees, half width in fractions of the
    // longer side, gain], all fading out late with the distance from that point (fade: fraction of the
    // bounds diagonal), so distinct bands sweep across the board past its centre into its right and lower half.
    // Added to the gain map, so they lift the visible stone only. Baked once per board size into a
    // small raster (raster: pixels per longer side).
    BEAMS: {
        origin: [-0.25, -0.2],
        beams: [25, 34, 43].flatMap(angle => [[-1.3, 0.024], [0, 0.034], [1.3, 0.024]]
            .map(([offset, half]) => [angle + offset, half, 0.32])),
        color: [100, 92, 48],
        // Shade between the shafts: soft multiply bands [angle, half width, alpha] of shade colour on the
        // light map, so light and shadow alternate gently across the board; a warm neutral, so no lilac stripes.
        shades: [20.5, 29.5, 38.5, 47.5].map(angle => [angle, 0.045, 0.3]),
        shade: [206, 196, 176],
        fade: 2.6,
        raster: 256
    },
    beamRaster: null,
    beamShade: null,
    beamBuilds: 0,
    // Lamps: power weighs each lamp for shadow direction; spill scales its SPILL below (a
    // town's small doorway lights a softer pool than a cave mouth). A lamp like another lamp kind
    // takes that kind's pool, scaled by reach about its foot (the lamp hex's lower edge, where the
    // pool meets the stone below; scaled about the centre it would fall inside the lamp's own unlit
    // hex): the like kind's light on the stone (its map and gain at its own spill over the far side's
    // key light, on stone of colour stone), cast on the light map only (lift colour added where it
    // lights, shade colour multiplied where it shades), so the pool keeps the like kind's shape at any
    // strength and on any side of the board. A demon portal is no lamp: the town's soft pool at about 40% of a cave's
    // reach and strength, dim red-violet.
    LAMP: {
        town: {power: 1, spill: 0.95},
        goldmine: {power: 1, spill: 1},
        demonPortal: {power: 0.4, spill: 1, like: 'town', reach: 0.37, foot: Math.sqrt(3) / 2,
            lift: [255, 238, 253], shade: [150, 150, 150], stone: [173, 165, 144]}
    },
    // Lamp spill: mostly warmth, little lift. A broad map-only wash (blue held back) warms the
    // stone evenly round the source; two narrow warm layers from the doorway's foot down (so
    // no halo wraps the sides of the lamp's hex); a cream pool filling the hex below; a yellow-gold
    // threshold band under a compact near-white cream hot spot; and a soft shade on the side
    // away from the upper-left key light (map only), where the source's body blocks it. Each layer is an ellipse [offset
    // from the cell centre, half width, half height] (hex radii); lamps: only those lamp kinds.
    // map: multiply colour, blended over the key light (source-over). gain: color-dodge
    // lift, blended with 'lighten' over the key light's, so a lamp lights its pool the same on
    // the cool far side of the board as on the key-lit side (no gain: map only). Alpha per part
    // (gainAlpha) where the lift should be lower than the warmth.
    SPILL: [
        {dy: 0.4, rx: 2.6, ry: 2.3, alpha: 0.8, map: [218, 200, 160]},
        {dy: 0.8, rx: 0.8, ry: 1.0, alpha: 0.85, map: [250, 214, 150], gain: [30, 14, 0], gainAlpha: 0.6},
        {dy: 0.9, rx: 0.85, ry: 1.1, alpha: 0.7, map: [250, 220, 166], gain: [90, 66, 22], gainAlpha: 0.6},
        {dy: 1.5, rx: 1.2, ry: 1.2, alpha: 0.7, map: [255, 222, 168], gain: [112, 90, 36], gainAlpha: 0.75},
        {dy: 1.05, rx: 1.0, ry: 0.75, alpha: 0.9, map: [255, 214, 142], gain: [120, 84, 22]},
        {dy: 0.95, rx: 0.8, ry: 0.6, alpha: 1, map: [255, 226, 160], gain: [138, 100, 38]},
        {dx: 1.0, dy: 0.45, rx: 0.6, ry: 0.75, alpha: 0.55, map: [172, 152, 158]},
        {dx: 1.5, dy: 0.3, rx: 0.8, ry: 0.85, alpha: 0.45, map: [192, 180, 178]},
        {lamps: ['town'], dx: -0.75, dy: 0.25, rx: 1.0, ry: 0.9, alpha: 0.85, map: [255, 222, 164], gain: [112, 80, 30]}
    ],
    // Smooth (near-Gaussian) radial falloff of every spill layer, so no rim or hex edge shows.
    SPILL_STOPS: [[0, 1], [0.1, 0.985], [0.2, 0.94], [0.3, 0.87], [0.4, 0.77], [0.5, 0.64], [0.6, 0.49],
        [0.7, 0.33], [0.8, 0.18], [0.9, 0.06], [1, 0]],
    // Glow of owned tiles on the stone next to them: reach in hex radii, colour mixed towards white.
    // Owned tiles: colour gamma (deeper), a stone mix [r, g, b, amount]. A cool colour shows far
    // over the warm stone, so it also spills as cool light (cool: a blue multiply and a blue lift, at
    // alpha times how much bluer than red the owner is, over reach with stops [t, alpha]): the stone
    // next to the blue territory glows a luminous blue that fades out over about three cells and
    // joins the cool rim (RIM), while the board's interior keeps no blue haze.
    TERRITORY: {reach: 2.2, mix: 0.5, depth: 2.1, stone: [215, 200, 190, 0.12],
        cool: {reach: 5, alpha: 0.75, stops: [[0, 1], [0.3, 0.75], [0.6, 0.35], [1, 0]],
            map: [170, 200, 250], gain: [0, 35, 85]}},
    // Cool sky fill on the side away from the key light: the sky's blue lights the board's right
    // edge (its full height) and its bottom edge, fading out along the bottom towards the key side
    // (from fade[1] to fade[0], fractions of the board width), the right edge fading out towards the
    // key-lit top (from rightFade[1] to rightFade[0], fractions of the height). Full strength over inner (hex radii)
    // from the edge, then a Gaussian falloff over fall, times sides ([right, bottom]); a multiply colour on the light map and a
    // lift on the gain map, so only the visible stone takes it. Baked once per board size into a
    // small raster (raster: pixels per longer side).
    RIM: {inner: 0.9, fall: 1.6, sides: [0.7, 1], alpha: 0.75, gainAlpha: 0.6, fade: [0.1, 0.65], rightFade: [0, 0.45],
        map: [180, 205, 250], gain: [0, 30, 80], raster: 256},
    rimRaster: null,
    rimGain: null,
    // boardLayers' rasters (undefined: not built).
    layerShade: undefined,
    layerLift: undefined,
    layerKey: '',
    rimBuilds: 0,
    // Upper-left key light direction (degrees, screen space, y down) for shadows.
    KEY_ANGLE: -120,
    // Tile look: pale cream marble tiles set in crisp dark grout. Each visible cell is
    // inset by half the grout width over a grout fill of the visible cells, so there
    // are no outlines or seams. Neutral tiles draw one of a few procedurally generated,
    // cached marble variants; owned tiles their colour with the same marble pattern, under a faint sheen.
    TILE: {
        variants: 8,
        rasterScale: 1.5,
        // Near neutral before the light map, which warms it on the key side (about 1.5 red)
        // and leaves it a pale neutral grey on the far side (about 0.94 red, 1 blue). A dark warm grey grout
        // that reads as crisp lines between the polished tiles.
        grout: '#57535b',
        groutWidth: 0.055,
        stone: [153, 147, 155],
        sheen: 0.1,
        // Owned tiles carry the marble too: the variant's luminance about its mean, times owned, added to the colour.
        owned: 1.4,
        // Polished slab sheen: a soft highlight towards the upper left of each neutral tile.
        polish: 0.3
    },
    tileVariants: null,
    tileVariantBuilds: 0,
    tileDetails: null,
    tileDetailBuilds: 0,
    ownedTiles: null,
    ownedTileBuilds: 0,
    // Fogged cells: the same marble variants (TILE) in their grout, darkened and cooled to a
    // blue-grey by a multiply (tint, times a per-variant shade) and veiled by a soft mist (drifting wisps of colour mist at
    // up to mistAlpha, times a per-variant density). The light map leaves fogged cells unlit, so the variant is the cell.
    // Its index comes from the cell's coordinates only, never from what the fog hides.
    FOG: {
        tint: [86, 96, 116],
        grout: '#2c2c36',
        mist: '150,162,184',
        mistAlpha: 0.2,
        shade: [0.86, 1.14],
        density: [0.3, 1.9],
        wisps: 9
    },
    fogVariants: null,
    fogVariantBuilds: 0,
    tileFills: new Map(),
    // Soft object shadows: a darkened, blurred silhouette of the board object's own sprite,
    // turned about the object's base to point away from its strongest visible light (a lamp
    // within reach, else the upper-left key) and fading towards its tip.
    SHADOW: {
        color: '52,36,30',
        keyAlpha: 0.5,
        lampAlpha: 0.3,
        length: 1.5,
        width: 0.9,
        blur: 0.05,
        tipAlpha: 0.15,
        reachRadii: 9,
        // Contact shade under every shadow caster's base: a soft dark ellipse, radius in hex
        // radii, flattened to flat of its width, alpha at its core, in color.
        contact: {radius: 0.55, flat: 0.5, alpha: 0.7, color: '30,22,22'}
    },
    // The last shadow pass's casters: {x, y, by: 'key' | 'lamp', angle (degrees), lampRadii, strength, alpha}.
    shadowLog: [],
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
        if (this.beamRaster) this.beamRaster.width = this.beamRaster.height = 0
        if (this.beamShade) this.beamShade.width = this.beamShade.height = 0
        if (this.rimRaster) this.rimRaster.width = this.rimRaster.height = 0
        if (this.rimGain) this.rimGain.width = this.rimGain.height = 0
        if (this.layerShade) this.layerShade.width = this.layerShade.height = 0
        if (this.layerLift) this.layerLift.width = this.layerLift.height = 0
        this.map = this.gain = this.beamRaster = this.beamShade = this.rimRaster = this.rimGain = null
        this.layerShade = this.layerLift = undefined
        this.layerKey = ''
        this.mapKey = ''
        this.mapState = null
        this.mapOwners = null
        this.staged = null
    },
    // range (board.drawRange) limits the walk to those cells.
    collect(board, includeKey = true, includeCells = true, range = null) {
        const cells = [], sources = []
        if (!otherSettings.atmosphericVisuals) return {cells, sources, key: ''}
        // The key lists the collected cells and sources by coordinate (positions follow from
        // the coordinates and the hex radius); a plain string, cheap to compare every frame.
        let key = includeKey ? basis.r + '|' : ''
        const {i0, i1, j0, j1} = range || {i0: 0, i1: board.arr.length, j0: 0, j1: board.arr.length ? board.arr[0].length : 0}
        for (let i = i0; i < i1; ++i) for (let j = j0; j < j1; ++j) {
            const cell = board.arr[i][j]
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
    // The information of collect(board).key as numbers, in a reused array: basis.r, then per cell
    // (in collect's order) 0 when not collected, else 1 + 2 * lamp kind + 8 * (owner colour + 1)
    // for an owned tile. The per-frame cache checks compare it (sameLightState) instead of
    // building and comparing a string of every cell, which loaded every frame with garbage.
    LAMP_KINDS: ['', 'town', 'goldmine', 'demonPortal'],
    lightState(board) {
        const w = board.arr.length, h = w ? board.arr[0].length : 0
        let state = this.lightStateScratch
        if (!state || state.length !== w * h + 1) state = this.lightStateScratch = new Float64Array(w * h + 1)
        state[0] = otherSettings.atmosphericVisuals ? basis.r : 0
        const free = this.ownerFree(board)
        let k = 0
        for (let i = 0; i < w; ++i) for (let j = 0; j < h; ++j) state[++k] = this.lightValue(board, board.arr[i][j], true, free)
        return state
    },
    // One cell's lightState entry (grid.surfaceStateMatches compares them in its own cell pass).
    // observing: false when board.isObserving() is (nothing observed then). free: ownerFree(board).
    lightValue(board, cell, observing = true, free = this.ownerFree(board)) {
        if (!otherSettings.atmosphericVisuals) return 0
        const {x, y} = cell.coord
        // As collect: never inspect a hidden building, including public fog landmarks.
        if (isFogOfWar && !board.fogOfWar[x][y]) return 0
        const hex = (observing && board.observedHexagon(cell)) || cell.hexagon
        if (hex.unknown) return 0
        const observation = observing && board.observedBuilding(cell)
        const building = observation ? onlineObservation.buildings.get(x + ',' + y)?.sprite : cell.building
        return this.shownLightValue(hex, building, free)
    },
    // lightValue of a cell in view (not fogged) whose shown hexagon hex is known, with building.
    shownLightValue(hex, building, free = this.ownerFree()) {
        if (building?.isMapEdge) return 0
        const emitsLight = building && !building.killed && this.emitsLight(building)
        const kind = emitsLight ? this.LAMP_KINDS.indexOf(building.isDemonPortal ? 'demonPortal' : building.name) : 0
        return 1 + 2 * kind + this.ownerLight(hex, free)
    },
    // The owner's part of shownLightValue (hex known): none with the cell layer (free, ownerFree), whose sprites hold the
    // owner colour and the territory glow (Grid.cellLayerKey), so a capture leaves the light state as it is.
    ownerLight(hex, free = this.ownerFree()) {
        return !free && hex.playerColor && hex.player?.color ? 8 * (hex.playerColor + 1) : 0
    },
    // TASK-1314: whether board (the game's) is drawn with the cell layer (Grid.liveCellLayer, Grid.cellLayerOn). Then the
    // light state holds no owner: the light map is not rebuilt or patched for a capture; the per-cell sprites of the cell
    // layer hold each cell's owner colour and the territory glow on it (their key: the owners whose glow reaches the cell,
    // Grid.cellLayerKey), rendered with a light map brought up to the owners now (syncOwners) when a variant is new.
    ownerFree(board = typeof grid !== 'undefined' ? grid : null) {
        return typeof Grid !== 'undefined' && Grid.liveCellLayer === true && !!board?.cellLayerOn?.()
    },
    // The owners the light map draws (collect's cells' owner: the territory glow and the stone clip): per cell (lightState's
    // order, after basis.r) 0, or the owner colour of an owned cell collect lists, in a reused array.
    ownerState(board) {
        const w = board.arr.length, h = w ? board.arr[0].length : 0
        let state = this.ownerStateScratch
        if (!state || state.length !== w * h + 1) state = this.ownerStateScratch = new Float64Array(w * h + 1)
        state[0] = otherSettings.atmosphericVisuals ? basis.r : 0
        let k = 0
        for (let i = 0; i < w; ++i) for (let j = 0; j < h; ++j) state[++k] = this.ownerValue(board, board.arr[i][j])
        return state
    },
    // A cell's ownerState entry (as collect: in view, known, no map edge; the board's own hexagon, the cell layer being off
    // for an observed board).
    ownerValue(board, cell) {
        if (!otherSettings.atmosphericVisuals) return 0
        const {x, y} = cell.coord, hex = cell.hexagon
        if (isFogOfWar && !board.fogOfWar[x][y] || hex.unknown || cell.building?.isMapEdge) return 0
        return hex.playerColor && hex.player?.color ? hex.playerColor : 0
    },
    // The reach (world units) of the territory glow of an owner colour (0: none): TERRITORY's, the cool spill's for an owner
    // bluer than red (territoryGlow).
    glowReach(colour) {
        if (!colour) return 0
        const owner = typeof players !== 'undefined' ? players[colour]?.color : null, {reach, cool} = this.TERRITORY
        return Math.max(reach, !owner || cool && (cool.map || cool.gain) && owner.b > owner.r ? cool.reach : 0) * basis.r
    },
    // With the cell layer (ownerFree): the world rectangles where the light map's owners (mapOwners) differ from the
    // board's, each cell's hexagon or its glow's reach then and now (as Grid.surfaceCacheChangeRects finds a light change).
    ownerRects(board) {
        const now = this.ownerState(board), was = this.mapOwners, rects = [], h = board.arr.length ? board.arr[0].length : 0
        if (!was || was.length !== now.length) return null
        for (let k = 1; k < now.length; ++k) {
            if (was[k] === now[k]) continue
            const i = Math.floor((k - 1) / h), c = board.arr[i][k - 1 - i * h].hexagon.calcPos()
            const reach = Math.max(1.1 * basis.r, this.glowReach(was[k]), this.glowReach(now[k]))
            rects.push({x0: c.x - reach, y0: c.y - reach, x1: c.x + reach, y1: c.y + reach})
        }
        return rects
    },
    // With the cell layer: the light map brought up to the board's owners by redrawing their rectangles (updateMapRegion,
    // ownerRects) when they differ; its light state already the board's. Returns whether it has the board's owners.
    // quiet (lightMap's, as a cell layer variant is rendered): not counted as a rebuild (rebuilds), so a lit view whose
    // rest snapshot's cells come from its cell layer holds (Grid.litViewHolds); a patch's (Grid.patchLightMap) counts as
    // updateMapRegion's own. ownerSyncs counts them.
    ownerSyncs: 0,
    syncOwners(board, cap, quiet = false) {
        if (!this.ownerFree(board) || !this.map) return true
        const rects = this.ownerRects(board)
        if (rects && !rects.length) return true
        const rebuilds = this.rebuilds, synced = !!rects && this.updateMapRegion(board, cap, [], this.mapState)
        if (synced) {
            ++this.ownerSyncs
            if (quiet) this.rebuilds = rebuilds
        }
        return synced
    },
    // Whether the board's light state equals stored (a lightState copy).
    sameLightState(board, stored) {
        const state = this.lightState(board)
        if (!stored || stored.length !== state.length) return false
        for (let k = 0; k < state.length; ++k) if (stored[k] !== state[k]) return false
        return true
    },
    emitsLight(building) {
        return building.name === 'town' || building.name === 'goldmine' || building.isDemonPortal || building.name === 'demonPortal'
    },
    // The cells whose hexagon (radius basis.r, plus 2 device pixels of antialiasing) reaches the
    // rows of ctx's canvas under its axis-aligned transform (all of them otherwise): a grout fill
    // or a clip built from these covers exactly the canvas pixels of the whole board's, without
    // tracing thousands of off-screen hexagons every frame when a large board is zoomed in.
    // Whole rows: the hexagons left and right of the canvas still shape the antialiasing of
    // its edge columns, while edges above and below it play no part.
    onCanvas(ctx, cells, center = cell => cell.pos) {
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) return cells
        // A lit tile's window (Grid.drawRange): the camera canvas's rows.
        const w = ctx.canvas.litWindow
        const ry = basis.r * t.d + 2, top = w ? w.top : 0, h = w ? w.bottom : ctx.canvas.height
        return cells.filter(cell => {
            const y = center(cell).y * t.d + t.f
            return y + ry >= top && y - ry <= h
        })
    },
    // While a region is redrawn clipped (Grid.patchSurfaceCache, updateMapRegion), the world rectangle {x0, y0, x1, y1}
    // (clipWindowOf) the centres of the hexagons of its clip paths (the cells drawShadows and bake clip to, the stone the
    // light map clips to) lie in: those reaching the clip rectangle, so a path of the whole board's hexagons is not traced
    // for a small region. null: all.
    clipWindow: null,
    inClipWindow(cells) {
        const w = this.clipWindow
        return w ? cells.filter(({pos}) => pos.x >= w.x0 && pos.x <= w.x1 && pos.y >= w.y0 && pos.y <= w.y1) : cells
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
    // Gradients made once per context and key (the same geometry and stops draw the same pixels), so a
    // rebuild of the light map or the surface cache, or a frame, draws again with the gradients it made
    // before instead of making new ones; at most GRADIENT_CACHE a context (the oldest dropped first).
    GRADIENT_CACHE: 4096,
    gradients: new WeakMap(),
    gradient(ctx, key, make) {
        const owner = gradientContext(ctx)
        let made = this.gradients.get(owner)
        if (!made) this.gradients.set(owner, made = new Map())
        let gradient = made.get(key)
        if (!gradient) {
            if (made.size >= this.GRADIENT_CACHE) made.delete(made.keys().next().value)
            made.set(key, gradient = make())
        }
        return gradient
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
        const key = JSON.stringify(bounds)
        const scale = this.resolution(bounds, cap)
        const zooming = gameEvent.screen.surfaceZooming
        // With the cell layer (ownerFree) the map is brought up to the owners now where they differ (syncOwners) before it is
        // drawn from, the light state holding none.
        if (this.map && this.mapKey === key && this.sameLightState(board, this.mapState) &&
                (this.mapScale === scale || zooming) && (this.mapScale !== scale || this.syncOwners(board, cap, true)))
            return this.map
        // A staged build of this very map is finished at once, another is dropped (canvasFor resets its canvases).
        const staged = this.staged && this.stagedFor(board, key, scale) ? this.staged : null
        this.staged = null
        const owners = staged ? staged.owners : this.ownerState(board).slice()
        if (staged)
            while (!staged.steps.next().done);
        else
            this.build(this.collect(board), bounds, scale)
        this.finishLightMap(board, key, scale, owners)
        return this.map
    },
    // owners: the ownerState the map was drawn with (mapOwners).
    finishLightMap(board, key, scale, owners) {
        this.prewarmGlows(board)
        this.mapState = this.lightState(board).slice()
        this.mapOwners = owners
        this.mapKey = key
        this.mapScale = scale
        ++this.rebuilds
    },
    // Whether lightMap(board, cap) returns the map it has (no rebuild), outside a zoom gesture.
    lightMapReady(board, cap) {
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds
        if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return false
        return !!this.map && this.mapKey === JSON.stringify(bounds) && this.mapScale === this.resolution(bounds, cap) &&
            this.sameLightState(board, this.mapState)
    },
    // A staged build (stepLightMap): {key, scale, state, steps}.
    staged: null,
    stagedFor(board, key, scale) {
        const job = this.staged
        if (!job || job.key !== key || job.scale !== scale || job.state.length !== this.lightState(board).length) return false
        const state = this.lightState(board)
        for (let k = 0; k < state.length; ++k) if (state[k] !== job.state[k]) return false
        return true
    },
    // One step of lightMap(board, cap)'s rebuild (Grid.queueLitTiles, a task between frames: the camera's light map after a
    // zoom is built over frames, buildSteps): the first starts it, dropping the map (nothing draws from it meanwhile; a
    // lightMap call finishes it at once); the last makes it the map as lightMap would. Returns whether the map is ready.
    stepLightMap(board, cap) {
        if (this.lightMapReady(board, cap)) return true
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds
        if (!bounds || bounds.right <= bounds.left || bounds.bottom <= bounds.top) return false
        const key = JSON.stringify(bounds), scale = this.resolution(bounds, cap)
        if (!this.stagedFor(board, key, scale)) {
            this.mapKey = ''
            this.mapState = null
            this.staged = {key, scale, state: this.lightState(board).slice(), owners: this.ownerState(board).slice(),
                steps: this.buildSteps(this.collect(board), bounds, scale)}
        }
        if (!this.staged.steps.next().done) return false
        const owners = this.staged.owners
        this.staged = null
        this.finishLightMap(board, key, scale, owners)
        return true
    },
    // The light map at cap's resolution (as lightMap(board, cap)) brought up to the board's light state by redrawing
    // only the map pixels the world rectangles rects ({x0, y0, x1, y1}, where the cells whose light changed draw)
    // cover, grown by MAP_REGION_GROW pixels (Grid.patchSurfaceCache): the rectangles' pixel boxes merged into
    // clusters (mapRegionClusters: those whose boxes grown by MAP_REGION_MARGIN overlap made one box), so a move's
    // cells far apart redraw their own boxes, not one box holding them all; then build's own drawing on the map's
    // canvases, at their transform, clipped to the clusters' boxes grown by MAP_REGION_MARGIN pixels, its clip paths the
    // hexagons reaching them (clipWindow); then each margin's pixels are put back from a copy taken first, so the clip's
    // edge stays off the region. Pixels outside the rectangles were drawn for the old state as for the new one. False
    // (nothing drawn) unless the map is that of stored, the state the rectangles were found against, at this resolution.
    // A clip rectangle crossing a hexagon side redraws the side's antialiasing a little unlike a whole build some pixels
    // into the box (Chromium software raster), which the grow keeps within tolerance: with 2 or 8 pixels the patched
    // frames differ from a whole build in more than 0.05% of their pixels (server tests/client/test-move-work.js
    // --tolerance, TASK-1289), with 24 in at most 0.04%.
    MAP_REGION_GROW: 24,
    MAP_REGION_MARGIN: 8,
    // Reused canvases holding a region's ring while it is redrawn (updateMapRegion), by canvas name.
    regionScratch: {},
    updateMapRegion(board, cap, rects, stored) {
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds
        if (!bounds || !this.map || !this.gain || this.mapKey !== JSON.stringify(bounds) ||
                this.mapScale !== this.resolution(bounds, cap) || !this.mapState || !stored || this.mapState.length !== stored.length)
            return false
        for (let k = 0; k < stored.length; ++k) if (this.mapState[k] !== stored[k]) return false
        // With the cell layer also where the map's owners differ from the board's (ownerRects), so it then has them all.
        const free = this.ownerFree(board), owners = free && this.ownerRects(board)
        if (free && !owners) return false
        if (owners) rects = rects.concat(owners)
        const scale = this.mapScale, W = this.map.width, H = this.map.height, grow = this.MAP_REGION_GROW
        const m = this.MAP_REGION_MARGIN
        const inners = rects.map(r => pixelRect(Math.floor((r.x0 - bounds.left) * scale) - grow,
            Math.floor((r.y0 - bounds.top) * scale) - grow, Math.ceil((r.x1 - bounds.left) * scale) + grow,
            Math.ceil((r.y1 - bounds.top) * scale) + grow, W, H)).filter(Boolean)
        if (!inners.length) {
            if (free) {
                this.mapState = this.lightState(board).slice()
                this.mapOwners = this.ownerState(board).slice()
            }
            return true
        }
        const regions = mapRegionClusters(inners, m, W, H)
        this.lastMapRegion = {regions}
        const kept = ['map', 'gain'].map(name =>
            regions.map(({inner, outer}, k) => copyCanvasRing(this[name], outer, inner, this.regionScratch, name + k)))
        const g = this.map.getContext('2d'), k = this.gain.getContext('2d')
        for (const c of [g, k]) {
            c.save()
            c.setTransform(1, 0, 0, 1, 0, 0)
            c.beginPath()
            for (const {outer} of regions) c.rect(outer.x, outer.y, outer.w, outer.h)
            c.clip()
            c.beginPath()
        }
        const span = pixelRect(Math.min(...regions.map(r => r.outer.x)), Math.min(...regions.map(r => r.outer.y)),
            Math.max(...regions.map(r => r.outer.x + r.outer.w)), Math.max(...regions.map(r => r.outer.y + r.outer.h)), W, H)
        // The caller's clip window kept (a cell layer variant's render brings the map up within a patch stage, syncOwners).
        const clip = this.clipWindow
        this.clipWindow = clipWindowOf(span, W, H, bounds.left, bounds.top, scale, 1.05 * basis.r)
        try {
            this.build(this.collect(board), bounds, scale, true)
        } finally {
            this.clipWindow = clip
            g.restore()
            k.restore()
        }
        for (const ring of kept[0]) restoreCanvasRing(this.map, ring)
        for (const ring of kept[1]) restoreCanvasRing(this.gain, ring)
        ++this.rebuilds
        this.mapState = this.lightState(board).slice()
        this.mapOwners = this.ownerState(board).slice()
        return true
    },
    // The light map's pixels over the world rectangles rects ({x0, y0, x1, y1}, each grown by MAP_GROW pixels) for the
    // board's light state now, without touching the map: build's drawing clipped to them (its hexagons and glows those
    // reaching their span, clipWindow) on two small canvases (the span) kept per slot, on the map's pixel grid at its
    // resolution, with its canvases' gradients (gradientSource). The frames drawing a patch's changed cells
    // (Grid.drawPatchCells) light them with these from the first, while the patch brings the map up in a later frame
    // (updateMapRegion) and only its own steps draw from it, so no frame draws from a light map canvas changed in it.
    // Returns {map, gain, left, top, w, h, scale} (w, h: the part used, in pixels), or null without a light map or for a
    // part over REGION_LIGHT_MAX pixels a side.
    REGION_LIGHT_MAX: 1024,
    regionCanvases: {},
    regionLight(board, rects, slot) {
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds, scale = this.mapScale, grow = this.MAP_GROW
        if (!bounds || !this.map || !this.gain || !scale || !rects.length) return null
        const rect = {x0: Math.min(...rects.map(r => r.x0)), y0: Math.min(...rects.map(r => r.y0)),
            x1: Math.max(...rects.map(r => r.x1)), y1: Math.max(...rects.map(r => r.y1))}
        const px0 = Math.max(0, Math.floor((rect.x0 - bounds.left) * scale) - grow)
        const py0 = Math.max(0, Math.floor((rect.y0 - bounds.top) * scale) - grow)
        const px1 = Math.min(this.map.width, Math.ceil((rect.x1 - bounds.left) * scale) + grow)
        const py1 = Math.min(this.map.height, Math.ceil((rect.y1 - bounds.top) * scale) + grow)
        const w = px1 - px0, h = py1 - py0
        if (w <= 0 || h <= 0 || w > this.REGION_LIGHT_MAX || h > this.REGION_LIGHT_MAX) return null
        const target = {left: bounds.left + px0 / scale, top: bounds.top + py0 / scale}
        const kept = this.regionCanvases[slot] ||= {}
        for (const name of ['map', 'gain']) {
            const c = kept[name] ||= document.createElement('canvas')
            if (c.width < w || c.height < h) {
                c.width = Math.max(c.width, w)
                c.height = Math.max(c.height, h)
            }
            c.gradientSource = this[name].getContext('2d')
            target[name] = c
        }
        for (const name of ['map', 'gain']) {
            const g = target[name].getContext('2d')
            g.save()
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.beginPath()
            for (const r of rects) {
                const x0 = Math.floor((r.x0 - target.left) * scale) - grow, y0 = Math.floor((r.y0 - target.top) * scale) - grow
                g.rect(x0, y0, Math.ceil((r.x1 - target.left) * scale) + grow - x0,
                    Math.ceil((r.y1 - target.top) * scale) + grow - y0)
            }
            g.clip()
            g.beginPath()
        }
        const clip = this.clipWindow
        this.clipWindow = {x0: target.left - 1.05 * basis.r, y0: target.top - 1.05 * basis.r,
            x1: target.left + w / scale + 1.05 * basis.r, y1: target.top + h / scale + 1.05 * basis.r}
        try {
            this.build(this.collect(board), bounds, scale, target)
        } finally {
            this.clipWindow = clip
            target.map.getContext('2d').restore()
            target.gain.getContext('2d').restore()
        }
        return {map: target.map, gain: target.gain, left: target.left, top: target.top, w, h, scale}
    },
    // Whether updateMapRegion(board, cap, rects, stored) can bring the light map to the board's light state, or the map
    // has it already (a patch's check before its steps, Grid.patchSurfaceCache).
    canUpdateMapRegion(board, cap, stored) {
        if (this.map && this.gain && this.sameLightState(board, this.mapState))
            return true
        mapDepth.ensureGeometry(board)
        const bounds = mapDepth.surfaceBounds
        if (!bounds || !this.map || !this.gain || this.mapKey !== JSON.stringify(bounds) ||
                this.mapScale !== this.resolution(bounds, cap) || !this.mapState || !stored || this.mapState.length !== stored.length)
            return false
        for (let k = 0; k < stored.length; ++k) if (this.mapState[k] !== stored[k]) return false
        return true
    },
    // The world size of one light map pixel at cap's resolution.
    mapPixel(cap) {
        const bounds = mapDepth.surfaceBounds
        return bounds ? 1 / this.resolution(bounds, cap) : 0
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
    // canvasFor's context without resizing its canvas (its clip kept): the state a resized canvas starts with, the
    // transform canvasFor sets.
    // target (regionLight): its canvases, their origin {left, top} the world point of their first pixel.
    redrawContext(name, bounds, scale, target = null) {
        const g = (target ? target[name] : this[name]).getContext('2d')
        g.globalAlpha = 1
        g.globalCompositeOperation = 'source-over'
        g.filter = 'none'
        g.shadowBlur = g.shadowOffsetX = g.shadowOffsetY = 0
        g.shadowColor = 'rgba(0,0,0,0)'
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'low'
        g.fillStyle = g.strokeStyle = '#000'
        g.lineWidth = 1
        const left = target ? target.left : bounds.left, top = target ? target.top : bounds.top
        g.setTransform(scale, 0, 0, scale, -left * scale, -top * scale)
        return g
    },
    // One spill layer of a lamp: an elliptical radial gradient of colour, alpha by SPILL_STOPS.
    spill(g, source, layer, color, alpha = layer.alpha) {
        g.save()
        g.translate(source.pos.x + (layer.dx || 0) * basis.r, source.pos.y + layer.dy * basis.r)
        g.scale(layer.rx * basis.r, layer.ry * basis.r)
        const gradient = g.createRadialGradient(0, 0, 0, 0, 0, 1)
        for (const [t, a] of this.SPILL_STOPS)
            gradient.addColorStop(t, `rgba(${color},${(a * alpha).toFixed(3)})`)
        g.fillStyle = gradient
        g.fillRect(-1, -1, 2, 2)
        g.restore()
    },
    // Every lamp's spill layers, composited once into a sprite per lamp kind, then one image
    // per lamp, scaled by the lamp's LAMP spill.
    spillSprites: new Map(),
    spillSpriteBuilds: 0,
    // A lamp like another kind lights the light map only: its lift added ('lighter') and its shade
    // 'multiply' (liftSprite), so the pool adds the same light over a territory's tint as over
    // neutral stone, where it is the like kind's light times spill.
    drawSpill(g, sources, part) {
        const op = g.globalCompositeOperation
        for (const {pos, name} of sources) {
            const lamp = this.LAMP[name] || this.LAMP.goldmine
            if (lamp.like && part === 'gain') continue
            for (const [p, o] of lamp.like ? [['map', 'lighter'], ['gain', 'multiply']] : [[part, op]]) {
                const sprite = this.spillSprite(p, name)
                g.globalAlpha = lamp.spill
                g.globalCompositeOperation = o
                g.drawImage(sprite.surface, pos.x + sprite.left, pos.y + sprite.top, sprite.width, sprite.height)
            }
        }
        g.globalAlpha = 1
        g.globalCompositeOperation = op
    },
    // The composited spill of one lamp kind (layers with a lamps list are only that kind's), at
    // a fixed SPILL_RASTER pixels per hex radius: the layers are smooth, so the light map scales
    // the sprite and a zoom never rebuilds it.
    SPILL_RASTER: 24,
    spillSprite(part, name) {
        const lamp = this.LAMP[name], own = lamp?.like || this.SPILL.some(l => l.lamps?.includes(name)), r = basis.r
        // A lamp like another kind keeps that kind's pixels per pool (its sprite as sharp).
        const id = part + ',' + (own ? name : ''), key = id + ',' + r, scale = this.SPILL_RASTER / r / (lamp?.like ? lamp.reach : 1)
        let sprite = this.spillSprites.get(id)
        if (sprite && sprite.key === key) return sprite
        const layers = this.spillLayers(name)
        const left = Math.min(...layers.map(l => (l.dx || 0) - l.rx)) * r, right = Math.max(...layers.map(l => (l.dx || 0) + l.rx)) * r
        const top = Math.min(...layers.map(l => l.dy - l.ry)) * r, bottom = Math.max(...layers.map(l => l.dy + l.ry)) * r
        const surface = sprite ? sprite.surface : document.createElement('canvas')
        surface.width = Math.max(1, Math.ceil((right - left) * scale))
        surface.height = Math.max(1, Math.ceil((bottom - top) * scale))
        const s = surface.getContext('2d')
        const paint = (g, part) => {
            g.setTransform(scale, 0, 0, scale, -left * scale, -top * scale)
            for (const layer of layers)
                if (layer[part]) this.spill(g, {pos: {x: 0, y: 0}}, layer, layer[part], layer[part + 'Alpha'] ?? layer.alpha)
        }
        if (!lamp?.like) paint(s, part)
        else this.liftSprite(s, lamp, paint, part)
        sprite = {key, surface, left, top, width: surface.width / scale, height: surface.height / scale}
        this.spillSprites.set(id, sprite)
        ++this.spillSpriteBuilds
        return sprite
    },
    // The sprites of a lamp like another kind, both drawn on the light map (drawSpill): the like
    // kind's layers (already scaled) painted as its map and gain parts, composited at its spill over
    // the ambient and the far side's key gain, as the light map does; per pixel the luminance of the
    // light on stone less the key light's alone, normalised to its peak, v. The map sprite lifts
    // where v > 0: alpha v, colour the lift colour less the ambient (added to the map); the gain
    // sprite shades where v < 0: the multiply that takes the ambient to the shade colour, at the
    // alpha that darkens the luminance as much. At the lamp's spill over the ambient the pool is
    // the like kind's light times spill, with no gain floor or dodge to bend it.
    liftSprite(s, {like, lift, shade, stone = this.TILE.stone}, paint, sprite) {
        const {width, height} = s.canvas, part = name => {
            const c = document.createElement('canvas')
            c.width = width
            c.height = height
            paint(c.getContext('2d'), name)
            return c.getContext('2d').getImageData(0, 0, width, height).data
        }
        const map = part('map'), gain = part('gain'), a = (this.LAMP[like] || this.LAMP.goldmine).spill
        const ambient = this.KEY[this.KEY.length - 1][1], key = this.KEY[this.KEY.length - 1][2], W = [0.2126, 0.7152, 0.0722]
        const lum = m => W.reduce((sum, w, c) => sum + w * Math.min(255, stone[c] * m[c] / (255 - key[c])), 0)
        const base = lum(ambient)
        const light = new Float32Array(width * height)
        let peak = 0
        for (let i = 0; i < light.length; ++i) {
            const am = a * map[4 * i + 3] / 255, ag = a * gain[4 * i + 3] / 255
            light[i] = W.reduce((sum, w, c) => sum + w * Math.min(255, stone[c] * (ambient[c] + am * (map[4 * i + c] - ambient[c])) /
                (255 - key[c] - ag * Math.max(0, gain[4 * i + c] - key[c]))), 0) - base
            peak = Math.max(peak, light[i])
        }
        const up = lum(lift) - base, down = base - lum(shade), image = s.createImageData(width, height), d = image.data
        const color = sprite === 'map' ? lift.map((c, n) => Math.max(0, c - ambient[n]))
            : shade.map((c, n) => Math.round(Math.min(255, 255 * c / ambient[n])))
        for (let i = 0; i < light.length; ++i) {
            const v = light[i] / peak
            d.set(color, 4 * i)
            d[4 * i + 3] = Math.round(255 * Math.min(1, sprite === 'map' ? Math.max(0, v) : Math.max(0, -v * up / down)))
        }
        s.putImageData(image, 0, 0)
    },
    // A lamp kind's spill layers: SPILL's (layers with a lamps list are only that kind's), or
    // for a lamp like another kind, that kind's layers scaled by reach about the foot.
    spillLayers(name) {
        const lamp = this.LAMP[name]
        if (!lamp?.like) return this.SPILL.filter(l => !l.lamps || l.lamps.includes(name))
        const {reach, foot} = lamp
        return this.spillLayers(lamp.like).map(l => ({...l, dx: (l.dx || 0) * reach, dy: foot + (l.dy - foot) * reach,
            rx: l.rx * reach, ry: l.ry * reach}))
    },
    // inPlace: redraw the canvases as they are (their size and the caller's clip; updateMapRegion), in the state a
    // resized canvas starts with; an object {map, gain, left, top}: regionLight's canvases instead.
    build(collected, bounds, scale, inPlace = false) {
        for (const _ of this.buildSteps(collected, bounds, scale, inPlace));
    },
    // build's drawing in steps (a generator; each yield ends one): the same calls in the same order on the same canvases, so
    // a light map built a step a task between frames (stepLightMap) has a whole build's pixels. A step draws at most about
    // two of the map's (at most maxPixels) rasters over it, one of them blended.
    MAP_STEP_PIXELS: 1.25e6,
    *buildSteps({cells, sources}, bounds, scale, inPlace = false) {
        const target = inPlace && inPlace !== true ? inPlace : null
        // (1) Light map, multiplied over the board: neutral (unchanged) everywhere except
        // the authorized visible cells, which get the cool ambient plus warm lamps.
        const g = inPlace ? this.redrawContext('map', bounds, scale, target) : this.canvasFor('map', bounds, scale)
        g.fillStyle = '#fff'
        g.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        const stone = cells.filter(cell => !cell.owner)
        this.hexPath(g, this.inClipWindow(stone))
        g.save()
        g.clip()
        g.fillStyle = this.keyGradient(g, bounds, 'ambient')
        g.fill()
        yield
        // Territory glow: each owned tile tints the stone around it with its colour.
        g.globalCompositeOperation = 'multiply'
        // A step ends after MAP_STEP_PIXELS of glow squares.
        const glowPixels = spill => (2 * spill.reach * basis.r * scale) ** 2
        let pixels = 0
        for (const {pos, owner} of cells) {
            if (!owner) continue
            if (this.territoryGlow(g, pos, this.TERRITORY, owner)) pixels += glowPixels(this.TERRITORY)
            // A cool colour shows far over the warm stone, so it also spills wide (TERRITORY.cool).
            if (this.TERRITORY.cool?.map && this.territoryGlow(g, pos, this.TERRITORY.cool, owner, 'map'))
                pixels += glowPixels(this.TERRITORY.cool)
            if (pixels >= this.MAP_STEP_PIXELS) {
                yield
                pixels = 0
            }
        }
        yield
        // The cool sky fill along the far edges and the shade between the key light's shafts, in one raster (boardLayers).
        const layers = this.boardLayers(bounds)
        if (layers.shade)
            g.drawImage(layers.shade, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        yield
        // Lamp spill (multiply part): the blue is held back towards amber.
        g.globalCompositeOperation = 'source-over'
        this.drawSpill(g, sources, 'map')
        g.restore()
        yield
        // (2) Gain map, 'color-dodge' after the multiply: base / (1 - gain) is a
        // multiplicative lift, so lit stone keeps its grain and dark joints. The gain is
        // a low, near-neutral cream-gold so no channel saturates into flat paint.
        const k = inPlace ? this.redrawContext('gain', bounds, scale, target) : this.canvasFor('gain', bounds, scale)
        k.clearRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        this.hexPath(k, this.inClipWindow(stone))
        k.save()
        k.clip()
        // The key light's lift, then each lamp's spill: the lighter of the two per channel.
        k.fillStyle = this.keyGradient(k, bounds, 'gain')
        k.fill()
        yield
        // The key light's shafts and the rim's lift, in one raster (boardLayers), and the cool territories' lift: added.
        k.globalCompositeOperation = 'lighter'
        k.drawImage(layers.lift, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        yield
        if (this.TERRITORY.cool?.gain) {
            pixels = 0
            for (const {pos, owner} of cells) {
                if (!owner) continue
                if (this.territoryGlow(k, pos, this.TERRITORY.cool, owner, 'gain') &&
                        (pixels += glowPixels(this.TERRITORY.cool)) >= this.MAP_STEP_PIXELS) {
                    yield
                    pixels = 0
                }
            }
        }
        yield
        k.globalCompositeOperation = 'lighten'
        this.drawSpill(k, sources, 'gain')
        k.restore()
    },
    // An owned tile's glow on the stone round it, a radial gradient over reach (hex radii) with stops
    // [t, alpha]: its colour mixed towards white (mix), or for a cool spill part (map: multiply colour,
    // gain: lift colour) that colour at alpha times how much bluer than red the owner is.
    // fill false only makes its gradient (prewarmGlows). Returns whether it filled.
    territoryGlow(g, pos, {reach: radii, mix: amount, alpha = 1, stops = [[0, 1], [0.45, 0.55], [1, 0]], ...spill}, owner, part, fill = true) {
        const strength = part ? alpha * Math.max(0, owner.b - owner.r) / 255 : alpha
        if (!strength) return false
        const mix = c => Math.round(c + (255 - c) * amount), reach = radii * basis.r
        // A clipped redraw (updateMapRegion) skips the glows that do not reach its clip window.
        const w = fill && this.clipWindow
        if (w && (pos.x + reach < w.x0 || pos.x - reach > w.x1 || pos.y + reach < w.y0 || pos.y - reach > w.y1)) return false
        const color = part ? spill[part].join(',') : `${mix(owner.r)},${mix(owner.g)},${mix(owner.b)}`
        const colors = stops.map(([t, a]) => t + ':' + `rgba(${color},${+(a * strength).toFixed(4)})`)
        // Centred on the origin and drawn moved to the cell: one gradient a colour and reach, not one a cell, so a patch
        // of the light map uncovering or capturing a cell makes none (Grid.patchSurfaceCache, Grid.patchLitView).
        g.fillStyle = this.gradient(g, 'glow,' + reach + ',' + colors.join(';'), () => {
            const glow = g.createRadialGradient(0, 0, 0, 0, 0, reach)
            for (const [t, a] of stops) glow.addColorStop(t, `rgba(${color},${+(a * strength).toFixed(4)})`)
            return glow
        })
        if (!fill) return false
        g.save()
        g.translate(pos.x, pos.y)
        g.fillRect(-reach, -reach, 2 * reach, 2 * reach)
        g.restore()
        return true
    },
    // The territory glow gradients in every player's colour (one a colour, part and reach: territoryGlow), made with the
    // light map's whole build (its canvases' contexts), so a capture later reuses them instead of making one.
    prewarmGlows(board) {
        const owners = (typeof players !== 'undefined' ? players : []).slice(1).map(p => p?.color).filter(Boolean)
        if (!this.map || !this.gain || !owners.length || !board.arr.length) return
        const cool = this.TERRITORY.cool, key = basis.r + '|' + owners.map(o => o.r + ',' + o.g + ',' + o.b).join(';')
        if (this.prewarmed && this.prewarmed.map === this.map && this.prewarmed.key === key) return
        const g = this.map.getContext('2d'), k = this.gain.getContext('2d'), pos = {x: 0, y: 0}
        for (const owner of owners) {
            this.territoryGlow(g, pos, this.TERRITORY, owner, undefined, false)
            if (cool?.map) this.territoryGlow(g, pos, cool, owner, 'map', false)
            if (cool?.gain) this.territoryGlow(k, pos, cool, owner, 'gain', false)
        }
        this.prewarmed = {map: this.map, key}
    },
    // The BEAMS gain over the board bounds, in a small raster built once per bounds size, with the
    // shade between the shafts (beamShade, its multiply colour) built alongside.
    beams(bounds) {
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        const key = w + 'x' + h
        if (this.beamRaster && this.beamKey === key) return this.beamRaster
        const {beams, color, shades, shade} = this.BEAMS
        this.beamRaster = this.beamBands(this.beamRaster, w, h, beams, color)
        this.beamShade = shades.length ? this.beamBands(this.beamShade, w, h, shades, shade) : null
        this.beamKey = key
        ++this.beamBuilds
        return this.beamRaster
    },
    beamBands(surface, w, h, bands, color) {
        const {origin, fade, raster} = this.BEAMS
        const s = raster / Math.max(w, h)
        surface = surface || document.createElement('canvas')
        surface.width = Math.max(1, Math.ceil(w * s))
        surface.height = Math.max(1, Math.ceil(h * s))
        const g = surface.getContext('2d')
        const W = surface.width, H = surface.height, side = Math.max(W, H)
        const ox = origin[0] * W, oy = origin[1] * H, reach = fade * Math.hypot(W, H) + Math.hypot(ox, oy)
        g.globalCompositeOperation = 'lighter'
        for (const [angle, width, alpha] of bands) {
            const half = width * side
            g.save()
            g.translate(ox, oy)
            g.rotate(angle * Math.PI / 180)
            g.fillStyle = atmosphericBackground.softBand(g.createLinearGradient(0, -half, 0, half), color, alpha)
            g.fillRect(0, -half, reach, 2 * half)
            g.restore()
        }
        g.globalCompositeOperation = 'destination-in'
        const falloff = g.createRadialGradient(ox, oy, 0, ox, oy, reach)
        falloff.addColorStop(0, 'rgba(0,0,0,1)')
        falloff.addColorStop(0.4, 'rgba(0,0,0,0.85)')
        falloff.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = falloff
        g.fillRect(0, 0, W, H)
        atmosphericBackground.watch(surface)
        return surface
    },
    // The light map's layers that follow from the board bounds alone, each one raster (RIM.raster pixels on the long
    // side, as the rim and the beams): shade, the rim's multiply colour times the shade between the shafts (each
    // 'multiply' over an opaque map multiplies it by 1 - alpha + colour, so one opaque raster of their product, drawn
    // 'multiply', is both; null when neither draws) and lift, the shafts' gain plus the rim's lift (both 'lighter',
    // added); so a light map region redraw (updateMapRegion) draws two layers fewer. Built once per bounds size and hex
    // radius.
    boardLayers(bounds) {
        const beams = this.beams(bounds)
        this.rim(bounds)
        const key = this.beamKey + '|' + this.rimKey
        if (this.layerShade !== undefined && this.layerKey === key) return {shade: this.layerShade, lift: this.layerLift}
        const W = this.rimRaster.width, H = this.rimRaster.height
        const layer = (surface, draw) => {
            surface = surface || document.createElement('canvas')
            surface.width = W
            surface.height = H
            draw(surface.getContext('2d'))
            atmosphericBackground.watch(surface)
            return surface
        }
        const shades = [this.RIM.alpha > 0 && this.rimRaster, this.BEAMS.shades.length && this.beamShade].filter(Boolean)
        this.layerShade = shades.length ? layer(this.layerShade, g => {
            g.fillStyle = '#fff'
            g.fillRect(0, 0, W, H)
            g.globalCompositeOperation = 'multiply'
            for (const shade of shades) g.drawImage(shade, 0, 0, W, H)
        }) : null
        this.layerLift = layer(this.layerLift, g => {
            g.drawImage(beams, 0, 0, W, H)
            g.globalCompositeOperation = 'lighter'
            if (this.RIM.gainAlpha > 0) g.drawImage(this.rimGain, 0, 0, W, H)
        })
        this.layerKey = key
        return {shade: this.layerShade, lift: this.layerLift}
    },
    // The RIM fill over the board bounds: its multiply colour (rimRaster, the default) or its lift
    // (rimGain), both built once per bounds size and hex radius.
    rim(bounds, name = 'rimRaster') {
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        const key = w + 'x' + h + ',' + basis.r
        if (!this.rimRaster || this.rimKey !== key) {
            const {inner, fall, sides: [right, bottom], alpha, gainAlpha, fade: [f0, f1], rightFade: [r0, r1], map, gain, raster} = this.RIM
            const smooth = t => (t = Math.min(1, Math.max(0, t))) * t * (3 - 2 * t)
            const s = raster / Math.max(w, h), W = Math.max(1, Math.ceil(w * s)), H = Math.max(1, Math.ceil(h * s))
            const r = basis.r * s
            const strength = d => d <= inner * r ? 1 : Math.exp(-(((d - inner * r) / (fall * r)) ** 2))
            for (const [name, color, a] of [['rimRaster', map, alpha], ['rimGain', gain, gainAlpha]]) {
                const surface = this[name] || document.createElement('canvas')
                surface.width = W
                surface.height = H
                const g = surface.getContext('2d'), image = g.createImageData(W, H), d = image.data
                for (let y = 0; y < H; ++y) for (let x = 0; x < W; ++x) {
                    const v = Math.max(right * strength(W - x - 0.5) * smooth(((y + 0.5) / H - r0) / (r1 - r0)),
                        bottom * strength(H - y - 0.5) * smooth(((x + 0.5) / W - f0) / (f1 - f0)))
                    const i = 4 * (y * W + x)
                    d.set(color, i)
                    d[i + 3] = Math.round(255 * a * v)
                }
                g.putImageData(image, 0, 0)
                atmosphericBackground.watch(surface)
                this[name] = surface
            }
            this.rimKey = key
            ++this.rimBuilds
        }
        return this[name]
    },
    // World-space gradient along DIRECTION, from the top left corner to the farthest corner,
    // so panning never changes the light.
    keyGradient(g, bounds, part) {
        const [dx, dy] = this.DIRECTION
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        const k = (w * dx + h * dy) / (dx * dx + dy * dy)
        return this.gradient(g, 'key,' + part + ',' + bounds.left + ',' + bounds.top + ',' + w + ',' + h, () => {
            const gradient = g.createLinearGradient(bounds.left, bounds.top, bounds.left + k * dx, bounds.top + k * dy)
            for (const [t, ambient, gain] of this.KEY)
                gradient.addColorStop(t, `rgb(${part === 'ambient' ? ambient : gain})`)
            return gradient
        })
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
    // Fog variants, built once per hex radius from the marble variant of the same index: the
    // cell in dark grout, the inset marble over it, both multiplied by FOG.tint, then the mist
    // wisps on top.
    fogVariant(index) {
        if (!this.fogVariants || this.fogVariants.radius !== basis.r)
            this.fogVariants = Object.assign(new Array(this.TILE.variants), {radius: basis.r})
        if (this.fogVariants[index]) return this.fogVariants[index]
        const r = basis.r, s = this.TILE.rasterScale, tile = this.tileVariant(index)
        const size = Math.ceil(2 * r * s) + 4
        const surface = document.createElement('canvas')
        surface.width = surface.height = size
        const g = surface.getContext('2d')
        g.setTransform(s, 0, 0, s, size / 2, size / 2)
        g.beginPath()
        this.hexagonPath(g, 0, 0, r)
        g.fillStyle = this.FOG.grout
        g.fill()
        g.clip()
        const tileSize = tile.width / s
        g.drawImage(tile, -tileSize / 2, -tileSize / 2, tileSize, tileSize)
        // Each fogged slab a little lighter or darker than its neighbours (shade), and its mist
        // thicker over some cells than others (density), so the fog drifts in patches.
        const rand = this.random(0x85ebca6b * (index + 1))
        const shade = this.FOG.shade[0] + (this.FOG.shade[1] - this.FOG.shade[0]) * rand()
        g.globalCompositeOperation = 'multiply'
        g.fillStyle = `rgb(${this.FOG.tint.map(v => Math.round(v * shade)).join(',')})`
        g.fillRect(-r, -r, 2 * r, 2 * r)
        g.globalCompositeOperation = 'source-over'
        // Mist: soft elongated wisps, a little lighter than the darkened stone.
        const density = this.FOG.density[0] + (this.FOG.density[1] - this.FOG.density[0]) * rand()
        for (let i = 0; i < this.FOG.wisps; i++) {
            const x = (rand() * 2 - 1) * r, y = (rand() * 2 - 1) * r
            const length = (0.5 + 0.7 * rand()) * r, depth = (0.2 + 0.2 * rand()) * r
            g.save()
            g.translate(x, y)
            g.rotate((rand() - 0.5) * 0.6)
            g.scale(length, depth)
            const wisp = g.createRadialGradient(0, 0, 0, 0, 0, 1)
            const alpha = this.FOG.mistAlpha * density * (0.5 + 0.5 * rand())
            wisp.addColorStop(0, `rgba(${this.FOG.mist},${alpha.toFixed(3)})`)
            wisp.addColorStop(0.5, `rgba(${this.FOG.mist},${(alpha * 0.45).toFixed(3)})`)
            wisp.addColorStop(1, `rgba(${this.FOG.mist},0)`)
            g.fillStyle = wisp
            g.fillRect(-1, -1, 2, 2)
            g.restore()
        }
        ++this.fogVariantBuilds
        return this.fogVariants[index] = surface
    },
    // Fogged cells (hexagons with coord): one dark grout fill of them all a hair past their edges, so
    // no seam between them shows what lies under, then each cell's variant. Under an axis-aligned
    // transform every variant is drawn at the same device size on whole device pixels, so two cells
    // of one variant look exactly alike.
    drawFog(ctx, hexagons) {
        const t = ctx.getTransform(), r = basis.r
        ctx.save()
        ctx.beginPath()
        for (const hexagon of this.onCanvas(ctx, hexagons, hexagon => hexagon.calcPos())) {
            const c = hexagon.calcPos()
            this.hexagonPath(ctx, c.x, c.y, 1.02 * r)
        }
        ctx.fillStyle = this.FOG.grout
        ctx.fill()
        const snap = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0
        if (snap) ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (const hexagon of hexagons) {
            const c = hexagon.calcPos()
            const variant = this.fogVariant(hexagon.tileHash % this.TILE.variants)
            const size = variant.width / this.TILE.rasterScale
            if (!snap) {
                ctx.drawImage(variant, c.x - size / 2, c.y - size / 2, size, size)
                continue
            }
            const w = Math.round(size * t.a), h = Math.round(size * t.d)
            const x = Math.round(c.x * t.a + t.e - w / 2), y = Math.round(c.y * t.d + t.f - h / 2)
            if (x + w < 0 || y + h < 0 || x > ctx.canvas.width || y > ctx.canvas.height) continue
            ctx.drawImage(variant, x, y, w, h)
        }
        ctx.restore()
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
        return this.colourFill(hexagon.player.color, hexagon.isSuburb)
    },
    colourFill({r, g, b}, suburb) {
        const key = r + ',' + g + ',' + b + (suburb ? ',s' : '')
        let fill = this.tileFills.get(key)
        if (!fill) {
            const {depth, stone} = this.TERRITORY
            const deep = (c, i) => 255 * (c / 255) ** depth * (1 - stone[3]) + stone[i] * stone[3]
            const mix = (c, i) => Math.round(suburb ? deep(c, i) : deep(c, i) + (255 - deep(c, i)) * 0.4)
            fill = `rgb(${mix(r, 0)},${mix(g, 1)},${mix(b, 2)})`
            this.tileFills.set(key, fill)
        }
        return fill
    },
    // The grout: one fill of the drawn, known cells, before their inset tiles.
    drawGrout(ctx, hexagons) {
        ctx.save()
        ctx.beginPath()
        for (const hexagon of this.onCanvas(ctx, hexagons, hexagon => hexagon.calcPos())) {
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
        const marble = this.ownedTile(hexagon.tileHash % this.TILE.variants, this.tileFill(hexagon))
        const size = marble.width / this.TILE.rasterScale
        ctx.drawImage(marble, c.x - size / 2, c.y - size / 2, size, size)
    },
    // Marble detail, built once per hex radius from the variant of the same index: each pixel's luminance
    // minus the tile's mean (alpha weighted), so the pattern adds nothing on average.
    tileDetail(index) {
        if (!this.tileDetails || this.tileDetails.radius !== basis.r) {
            this.tileDetails = Object.assign(new Array(this.TILE.variants), {radius: basis.r})
            ++this.tileDetailBuilds
        }
        if (this.tileDetails[index]) return this.tileDetails[index]
        const tile = this.tileVariant(index)
        const {data} = tile.getContext('2d').getImageData(0, 0, tile.width, tile.height)
        const offset = new Float32Array(data.length / 4)
        let sum = 0, weight = 0
        for (let i = 0; i < offset.length; i++) {
            const a = data[4 * i + 3]
            offset[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2]
            sum += offset[i] * a
            weight += a
        }
        const mean = sum / weight
        // Alpha-weighted histogram of the offsets (half-level bins), for the clipping check in buildOwnedTile.
        const histogram = new Map()
        for (let i = 0; i < offset.length; i++) {
            offset[i] -= mean
            const a = data[4 * i + 3]
            if (!a) continue
            const bin = Math.round(offset[i] * 2) / 2
            histogram.set(bin, (histogram.get(bin) || 0) + a / weight)
        }
        return this.tileDetails[index] = {size: tile.width, offset, alpha: data, histogram: [...histogram]}
    },
    // Owned marble, built once per hex radius and tile colour, all variants at once: the colour plus the
    // variant's detail, with the variant's alpha (the inset tile), under the sheen; an owned cell is one
    // drawImage, as a neutral one. The first colour built for a radius builds every colour the board can
    // show (ownedFills), so a move (a capture, a new suburb) never builds one inside its frames.
    ownedTile(index, fill) {
        if (!this.ownedTiles || this.ownedTiles.radius !== basis.r) {
            this.ownedTiles = Object.assign(new Map(), {radius: basis.r})
            ++this.ownedTileBuilds
        }
        let tiles = this.ownedTiles.get(fill)
        if (!tiles) {
            for (const f of [fill, ...this.ownedFills()]) {
                if (!this.ownedTiles.has(f))
                    this.ownedTiles.set(f, Array.from({length: this.TILE.variants}, (_, i) => this.buildOwnedTile(i, f)))
            }
            tiles = this.ownedTiles.get(fill)
        }
        return tiles[index]
    },
    // The owned tile colours of every player holding a cell on the board, suburb and not: only a
    // player on the board can own a cell later (captures and suburbs come from its own units and towns).
    ownedFills() {
        const fills = []
        if (typeof grid === 'undefined' || !grid || !grid.arr || typeof players === 'undefined')
            return fills
        const owners = new Set()
        for (const row of grid.arr)
            for (const cell of row)
                if (cell.hexagon.playerColor) owners.add(cell.hexagon.playerColor)
        for (const owner of owners) {
            const color = players[owner]?.color
            if (color) fills.push(this.colourFill(color, false), this.colourFill(color, true))
        }
        return fills
    },
    buildOwnedTile(index, fill) {
        const {size, offset, alpha, histogram} = this.tileDetail(index)
        const color = fill.match(/\d+/g).map(Number)
        // A channel near 0 or 255 would clip and shift the colour's mean: each channel takes the largest gain up to
        // its target that keeps its mean within half a level, and the channels with room make up the luminance.
        const bias = (c, gain) => {
            let sum = 0
            for (const [bin, share] of histogram) sum += (Math.min(255, Math.max(0, c + gain * bin)) - c) * share
            return Math.abs(sum)
        }
        const fit = (c, target) => {
            if (bias(c, target) <= 0.5) return target
            let low = 0, high = target
            for (let k = 0; k < 12; k++) {
                const mid = (low + high) / 2
                if (bias(c, mid) <= 0.5) low = mid
                else high = mid
            }
            return low
        }
        const owned = this.TILE.owned, weights = [0.299, 0.587, 0.114]
        let gains = color.map(c => fit(c, owned))
        const boost = owned / gains.reduce((sum, gain, i) => sum + weights[i] * gain, 0)
        if (boost > 1) gains = gains.map((gain, i) => gain < owned ? gain : fit(color[i], owned * boost))
        const surface = document.createElement('canvas')
        surface.width = surface.height = size
        const g = surface.getContext('2d'), image = g.createImageData(size, size), data = image.data
        for (let i = 0; i < offset.length; i++) {
            data[4 * i] = color[0] + gains[0] * offset[i]
            data[4 * i + 1] = color[1] + gains[1] * offset[i]
            data[4 * i + 2] = color[2] + gains[2] * offset[i]
            data[4 * i + 3] = alpha[4 * i + 3]
        }
        g.putImageData(image, 0, 0)
        g.setTransform(this.TILE.rasterScale, 0, 0, this.TILE.rasterScale, size / 2, size / 2)
        g.globalCompositeOperation = 'source-atop'
        this.drawSheen(g, 0, 0, this.TILE.sheen)
        return surface
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
    // Whether drawShadows lets building on the cell (x, y) cast a shadow (casters on screen aside). cached: building as a
    // surface cache drew it, so one killed since (a tower a catapult destroyed) still cast its shadow there.
    castsShadow(board, x, y, building, cached = false) {
        return building.notEmpty() && (cached || !building.killed) && !building.isInvisible && !building.isMapEdge &&
            !building.isBuildingProduction() && !board.observedBuilding(board.arr[x][y]) &&
            !this.flatObjects.includes(building.name) && !this.emitsLight(building)
    },
    // The world rectangle {x0, y0, x1, y1} drawShadows can draw on for a caster with sprite image at building.pos on
    // the cell centred at pos: its contact shade and its cast silhouette turned away from the strongest of the lamps
    // sources (collect's). A silhouette not built yet is bounded by the whole sprite (its base at the image's foot).
    shadowBounds(building, image, pos, sources) {
        const silhouette = this.shadowSilhouettes.get(image)
        const pad = silhouette ? silhouette.pad : Math.ceil(this.SHADOW.blur * basis.r * 2) + 2
        const bases = silhouette ? [silhouette.base] : [0, image.height]
        const {best} = this.strongestLamp(pos, sources, this.SHADOW.reachRadii)
        const angle = best ? Math.atan2(pos.y - best.y, pos.x - best.x) : (this.KEY_ANGLE + 180) * Math.PI / 180
        const dx = Math.cos(angle), dy = Math.sin(angle), L = this.SHADOW.length, W = this.SHADOW.width
        const rx = this.SHADOW.contact.radius * basis.r, flat = this.SHADOW.contact.flat
        const ox = building.pos.x + image.width / 2
        const box = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity}
        const grow = (x, y) => {
            box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y)
        }
        for (const base of bases) {
            const oy = building.pos.y + base
            grow(ox - rx, oy - rx * flat); grow(ox + rx, oy + rx * flat)
            const u0 = -image.width / 2 - pad, u1 = u0 + image.width + 2 * pad, v0 = -base - pad, v1 = v0 + image.height + 2 * pad
            for (const u of [u0, u1]) for (const v of [v0, v1]) grow(ox - W * dy * u - L * dx * v, oy + W * dx * u - L * dy * v)
        }
        return box
    },
    // Board objects (not units or lamps) on authorized visible cells cast their shadows, clipped to
    // the visible cells, under the fog and before any sprite is drawn.
    drawShadows(ctx, board) {
        if (!otherSettings.atmosphericVisuals) return
        // The clip's cells from the canvas rows (onCanvas), the casters from the drawn range; lamps
        // from the whole board, as an off-screen lamp still turns an on-screen shadow.
        const {cells} = this.collect(board, false, true, board.drawRange(ctx, true))
        const range = board.drawRange(ctx)
        const {sources} = this.collect(board, false, false)
        const t = ctx.getTransform()
        const axisAligned = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0
        const casters = []
        for (const {x, y, pos} of cells) {
            if (x < range.i0 || x >= range.i1 || y < range.j0 || y >= range.j1) continue
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
            if (!image || !image.width) continue
            // While Grid.drawPatchCells draws, only the shadows reaching its window.
            const w = board.patchCellsWindow
            if (w) {
                const b = this.shadowBounds(building, image, pos, sources)
                if (b.x1 < w.x0 || b.x0 > w.x1 || b.y1 < w.y0 || b.y0 > w.y1) continue
            }
            casters.push({x, y, building, image, pos})
        }
        if (!casters.length) return
        ctx.save()
        this.hexPath(ctx, this.inClipWindow(this.onCanvas(ctx, cells)))
        ctx.clip()
        const log = this.shadowLog = []
        // Contact shade first, under the cast shadows.
        const {radius, flat, alpha, color} = this.SHADOW.contact
        if (alpha > 0) for (const {building, image} of casters) {
            const {base} = this.shadowSilhouette(image), rx = radius * basis.r
            ctx.save()
            ctx.translate(building.pos.x + image.width / 2, building.pos.y + base)
            ctx.scale(1, flat)
            ctx.fillStyle = this.gradient(ctx, 'contact,' + rx, () => {
                const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
                shade.addColorStop(0, `rgba(${color},${alpha})`)
                shade.addColorStop(0.5, `rgba(${color},${(alpha * 0.55).toFixed(3)})`)
                shade.addColorStop(1, `rgba(${color},0)`)
                return shade
            })
            ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx)
            ctx.restore()
        }
        for (const {x, y, building, image, pos} of casters) {
            const {best, strength} = this.strongestLamp(pos, sources, this.SHADOW.reachRadii)
            // Direction from the light to the object: the shadow points away from the light.
            const angle = best ? Math.atan2(pos.y - best.y, pos.x - best.x) : (this.KEY_ANGLE + 180) * Math.PI / 180
            const shadowAlpha = this.SHADOW.keyAlpha + this.SHADOW.lampAlpha * strength
            log.push({x, y, by: best ? 'lamp' : 'key', angle: Math.round(angle * 180 / Math.PI),
                lampRadii: best ? +(Math.hypot(pos.x - best.x, pos.y - best.y) / basis.r).toFixed(2) : null,
                strength: +strength.toFixed(4), alpha: +shadowAlpha.toFixed(4)})
            const dir = {x: Math.cos(angle), y: Math.sin(angle)}
            const {surface, pad, base} = this.shadowSilhouette(image)
            const L = this.SHADOW.length, W = this.SHADOW.width
            // Sprite up (-y) -> L * dir, sprite right (+x) -> W * perpendicular, about the base.
            const ox = building.pos.x + image.width / 2, oy = building.pos.y + base
            ctx.save()
            ctx.globalAlpha = shadowAlpha
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
        this.hexPath(ctx, this.inClipWindow(this.collect(board, false).cells))
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
        this.drawMapPart(ctx, map, left, top, right, bottom)
        this.bloom(ctx, board)
    },
    // The multiply and color-dodge of the light map over the world rectangle left..right x
    // top..bottom (cut to the map's bounds), each sampled through the same world-to-map mapping
    // whatever the rectangle; only: 'map' or 'gain' draws that one alone (a lit view patch draws
    // them in two steps, Grid.startLitPatch).
    drawMapPart(ctx, map, left, top, right, bottom, only) {
        const bounds = mapDepth.surfaceBounds
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top
        left = Math.max(left, bounds.left)
        top = Math.max(top, bounds.top)
        right = Math.min(right, bounds.right)
        bottom = Math.min(bottom, bounds.bottom)
        if (left >= right || top >= bottom) return
        const sx = map.width / w, sy = map.height / h
        ctx.save()
        if (only !== 'gain') {
            ctx.globalCompositeOperation = 'multiply'
            ctx.drawImage(map, (left - bounds.left) * sx, (top - bounds.top) * sy,
                (right - left) * sx, (bottom - top) * sy, left, top, right - left, bottom - top)
        }
        if (only !== 'map') {
            ctx.globalCompositeOperation = 'color-dodge'
            ctx.drawImage(this.gain, (left - bounds.left) * sx, (top - bounds.top) * sy,
                (right - left) * sx, (bottom - top) * sy, left, top, right - left, bottom - top)
        }
        ctx.restore()
    },
    // Lights a lit tile (Grid.buildLitTile, the camera's transform moved to the tile): draw()'s
    // multiply and color-dodge clipped to outline, the lit cells' outlines (Grid.litEdges; off
    // the board the tile is transparent, where the neutral map would paint), the map's part grown
    // by MAP_GROW of its pixels so the tile's edge pixels sample the map as one draw over the
    // canvas does; then the bloom of every lamp within BLOOM_TILE_REACH of the tile. Where the
    // clip's edge or the map's spill past the lit cells shows, the tile is unlit again and the
    // frame lights it (drawEdges).
    MAP_GROW: 2,
    BLOOM_TILE_REACH: 3,
    lightTile(ctx, board, outline) {
        if (!otherSettings.atmosphericVisuals || !outline.length) return
        const map = this.lightMap(board)
        if (!map) return
        const t = ctx.getTransform(), grow = this.MAP_GROW / this.mapScale
        const left = -t.e / t.a, top = -t.f / t.d
        const right = (ctx.canvas.width - t.e) / t.a, bottom = (ctx.canvas.height - t.f) / t.d
        ctx.save()
        ctx.beginPath()
        for (const loop of outline) {
            ctx.moveTo(loop[0].x, loop[0].y)
            for (let k = 1; k < loop.length; ++k) ctx.lineTo(loop[k].x, loop[k].y)
            ctx.closePath()
        }
        ctx.clip('evenodd')
        this.drawMapPart(ctx, map, left - grow, top - grow, right + grow, bottom + grow)
        ctx.restore()
        this.bloom(ctx, board, {reach: this.BLOOM_TILE_REACH * basis.r})
    },
    // draw() for a band of the rest snapshot (Grid.buildLitRestBand; its clip keeps the band's
    // rows y0..y1): the same on-screen part of the map as draw(), so its pixels are draw()'s,
    // then the bloom of the lamps reaching the band.
    // part: 'map' draws only the multiply, 'gain' the color-dodge and the bloom (a lit view patch's two steps).
    drawRows(ctx, board, y0, y1, part) {
        if (!otherSettings.atmosphericVisuals) return
        const map = this.lightMap(board)
        if (!map) return
        const bounds = mapDepth.surfaceBounds, t = ctx.getTransform()
        const left = Math.max(bounds.left, -t.e / t.a), right = Math.min(bounds.right, (ctx.canvas.width - t.e) / t.a)
        const top = Math.max(bounds.top, -t.f / t.d), bottom = Math.min(bounds.bottom, (ctx.canvas.height - t.f) / t.d)
        if (left >= right || top >= bottom) return
        this.drawMapPart(ctx, map, left, top, right, bottom, part)
        if (part !== 'map')
            this.bloom(ctx, board, {runs: [{x: 0, y: y0, w: ctx.canvas.width, h: y1 - y0}]})
    },
    // The light of the lit tiles' edge blocks (Grid.drawLitEdges): runs, whole device-pixel
    // rectangles of ctx's canvas, get draw()'s multiply and color-dodge, each clipped to its run
    // (its map part grown as in lightTile, but within draw()'s on-screen part, whose edge draw()'s
    // sampling clamps at), then the bloom of the lamps reaching them clipped to all the runs, over
    // the frame's own pixels (the sky under the board's edge), as draw() lights them.
    drawEdges(ctx, board, runs) {
        if (!otherSettings.atmosphericVisuals || !runs.length) return
        const map = this.lightMap(board)
        if (!map) return
        const t = ctx.getTransform(), grow = this.MAP_GROW / this.mapScale
        const viewLeft = -t.e / t.a, viewTop = -t.f / t.d
        const viewRight = (ctx.canvas.width - t.e) / t.a, viewBottom = (ctx.canvas.height - t.f) / t.d
        const clip = list => {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.beginPath()
            for (const run of list) ctx.rect(run.x, run.y, run.w, run.h)
            ctx.setTransform(t)
            ctx.clip()
        }
        for (const run of runs) {
            ctx.save()
            clip([run])
            this.drawMapPart(ctx, map,
                Math.max(viewLeft, (run.x - t.e) / t.a - grow), Math.max(viewTop, (run.y - t.f) / t.d - grow),
                Math.min(viewRight, (run.x + run.w - t.e) / t.a + grow), Math.min(viewBottom, (run.y + run.h - t.f) / t.d + grow))
            ctx.restore()
        }
        ctx.save()
        clip(runs)
        this.bloom(ctx, board, {runs})
        ctx.restore()
    },
    // Bloom: a cave is graded per pixel (grade below) to grey-beige stone, darker towards its
    // far side, round one glowing doorway and its flame, its carved arch traced by dark grooves and a lit crest. Other lamp sprites are shaded
    // (multiply) light warm near the doorway and grey-tan towards the rim, with a soft dark
    // edge away from the key light, a gold band on the arch and the doorway a deep orange
    // recess. Then 'screen' adds the cave grade's lift (or the band as a rim light), a flare
    // over the rim, a white-gold flame in the opening (a cave's is in its grade), lit windows and a faint amber
    // halo on the stone. Both overlays are built once per sprite raster; the old round sprite
    // is the fallback for a missing raster.
    BLOOM: {
        radius: 0.9,
        stops: [[0, '255,244,190', 1], [0.1, '255,214,100', 1], [0.22, '255,165,40', 0.9],
            [0.4, '250,125,25', 0.4], [0.65, '240,110,25', 0.1], [1, '230,100,30', 0]],
        // Sprite shade about the doorway: light warm near it, grey-tan at the rim (no darker
        // than about 0.7, so the dome stays light stone).
        shadeStops: [[0, '255,248,230'], [0.3, '244,218,184'], [0.65, '208,186,168'], [1, '176,158,146']],
        shadeReach: 0.6,
        // Edge: a soft dark band inside the silhouette, thicker away from the key light
        // (band width and the shrink centre's shift up-left in raster widths; steps are
        // [fraction of the width, alpha] of each shrunk copy taken out).
        edge: {color: '124,104,92', width: 0.12, shift: 0.02, steps: [[0.35, 0.5], [0.6, 0.6], [1, 1]]},
        // Doorway recess: deep orange at the sides, orange-gold in the middle.
        recessStops: [[0, '150,66,22'], [0.25, '218,124,40'], [0.5, '248,176,60'], [0.75, '218,124,40'],
            [1, '150,66,22']],
        halo: 1,
        haloStops: [[0, '255,214,140', 0.3], [0.25, '252,190,104', 0.2], [0.55, '245,160,80', 0.08],
            [1, '235,130,60', 0]],
        // Rim light: a soft gold ring on the arch just outside the opening (width and offset
        // in door half widths; strokes are [fraction of the width, alpha], wide to narrow).
        ring: {color: '255,190,80', shade: '255,158,48', width: 1.3, offset: 0.6,
            strokes: [[1.5, 0.3], [1.2, 0.5], [0.9, 0.8], [0.6, 1]]},
        flareStops: [[0, '255,252,230', 0.9], [0.3, '255,220,130', 0.6], [0.6, '255,160,55', 0.25],
            [1, '240,120,40', 0]],
        flareReach: 2.4,
        // A lit window: white-gold in the middle, gold at its frame, a faint amber glow past it
        // (radii in window half sizes).
        window: {reach: 1.8, stops: [[0, '255,250,220', 1], [0.35, '255,226,130', 0.95], [0.55, '255,180,70', 0.55],
            [1, '245,140,50', 0]]},
        // Flame (sprites without a cave grade): an upright ellipse in the middle of the opening
        // (half width x half height in door half sizes), white-gold in the middle, gold to orange
        // at its edge, leaving the orange recess at the sides and foot.
        flame: {rx: 0.82, ry: 0.78, dy: -0.06},
        coreStops: [[0, '255,255,240', 1], [0.7, '255,250,214', 1], [0.86, '255,222,110', 0.65],
            [1, '255,196,70', 0]],
        // The halo kept on the sprite (none: the arch keeps its stone contrast).
        haloOnSprite: 0,
        // Cave grade, per pixel of the sprite raster: stone from the sprite's own luminance
        // (stone: channel factors, a low-chroma grey-beige), shaded for its form (form: lit on the
        // upper left facing the key light, falling to dark on the lower right) and warmed by the
        // doorway (warm, toned by the sprite's luminance with weight warmJoint, by up to warmLift,
        // falling off over warmReach raster widths from the doorway). The doorway is one lit
        // region: the asset's opening plus the inner share of its carved arch ring, lit by its
        // own light (frame and interior below), the ring's voussoir joints kept at low contrast
        // (joint: share of the sprite's luminance), a thin cream-gold lip (lip raster widths) on
        // its outer edge and a small warm-white teardrop flame at a point anchor of the opening's
        // height below its top (flame: half width and height in opening half widths, low: its
        // height below the anchor as a share of that); mask edges feathered (raster widths).
        // Reached by the shade multiply plus a 'screen' lift in the glow, so the same two draws per lamp.
        grade: {stone: [0.68, 0.56, 0.44], form: {lit: 1.35, dark: 0.72, slope: [0.6, 0.3], power: 1.6},
            warm: [240, 186, 134], warmJoint: 0.5, warmLift: 0.25, warmReach: 0.22,
            near: [250, 190, 110], nearLift: 0.7, nearReach: 0.11, nearOut: 0.35, ringTone: [232, 176, 124], ringLift: 0.4,
            share: 0.12, joint: 0.18, anchor: 0.28,
            // The doorway as a lit frame round a dark interior: the gold inner arch face (frame:
            // width and feather in opening half widths from the shaft's edge, colours at its outer
            // edge and its inner face) round a deep amber interior (interior: stops down from the
            // anchor to the foot), the flame and its glow at the top of the interior.
            frame: {width: 0.34, soft: 0.1, outer: [214, 120, 24], inner: [248, 168, 40]},
            interior: [[0, '250,172,52'], [0.2, '222,120,26'], [0.45, '176,88,16'], [1, '130,62,12']], flameGlow: {reach: 2.8, below: 0.4, color: [255, 196, 70]},
            // The upper doorway filled with gold light across its whole width, frame and interior
            // (upperGlow: full down to 'to' and fading over 'soft', in shares of the opening's height
            // from its top, the frame's gold jambs only down to 'frame'), so the glow still reads when the board is drawn small.
            upperGlow: {to: 0.36, frame: 0.16, soft: 0.24, amount: 1, color: [255, 222, 90]},
            // Warm colours darkened by the sprite's luminance turn orange-brown, not olive
            // (per-channel exponents of the luminance tone).
            toneBias: [1, 1.3, 1.6],
            // The stone held to a warm tan hue (green at most ringHue of the red), so the board's
            // gold light over the dome and the carved ring never turns them olive.
            ringHue: 0.75,
            lip: 0, lipColor: [255, 232, 170], flame: {rx: 0.6, ry: 1.1, low: 0.55, color: [255, 250, 208]},
            feather: 0.01, flareReach: 1.3, flareAlpha: 0.3,
            // The carved arch's form picked out by light along its own outlines: a thin dark
            // dark brown groove where the ring meets the dome (groove: blend, width in raster widths, colour), a
            // warm crest on the ring's upper inner face on the lit side (crest: colour, lift,
            // width; bevel: the same light just inside the ring's outer edge, over the groove) and a dark contact contour inside the silhouette, strongest on its far side and foot
            // (contour: darkening, width, share on the lit side); never a pale outline.
            groove: {depth: 0.6, width: 0.016, color: [92, 60, 38]}, crest: {color: [250, 206, 162], lift: 0.6, width: 0.01, bevel: 0.45},
            contour: {depth: 0.4, width: 0.012, lit: 0.4}}
    },
    // Doorway of each lamp sprite as fractions of its raster: centre, half width, half height.
    DOOR: {
        // The cave's own carved stone arch (a horseshoe round the opening) and its recessed
        // opening (the reveal jambs plus the lit cave), outlines in the asset's 512-unit space,
        // and the ring's outer edge (arch); the grade lights the opening and the ring's inner part.
        goldmine: {x: 0.5, y: 0.645, w: 0.125, h: 0.165, grade: true,
            ring: 'M123 423 L128 337 Q130 257 169 211 Q200 173 245 170 Q291 170 325 211 Q359 254 365 328 L371 422 ' +
                'L348 436 L311 439 L307 331 Q305 286 285 260 Q269 237 245 237 Q221 237 202 261 Q179 291 178 336 L176 439 L149 441 Z',
            arch: 'M123 423 L128 337 Q130 257 169 211 Q200 173 245 170 Q291 170 325 211 Q359 254 365 328 L371 422 L348 436 L311 439 L272 447 L212 447 L176 439 L149 441 Z',
            opening: 'M171 436 L174 325 Q178 252 207 234 Q223 222 243 223 Q276 223 296 257 Q314 288 314 340 L315 438 L272 447 L212 447 Z',
            // The opening without its foot (sides carried down past the raster), for the frame's distance.
            shaft: 'M171 640 L174 325 Q178 252 207 234 Q223 222 243 223 Q276 223 296 257 Q314 288 314 340 L315 640 Z'},
        // A town keeps its warm lit walls: a lighter tint than the cave's grey-tan rim, no
        // arch band or dark edge.
        town: {x: 0.44, y: 0.83, w: 0.045, h: 0.085, ring: null, edge: null,
            shadeStops: [[0, '255,240,214'], [0.4, '250,232,206'], [1, '226,212,202']],
            // Lit windows (centre, half width, half height), glowing onto the wall round them.
            windows: [{x: 0.43, y: 0.572, w: 0.042, h: 0.038}, {x: 0.733, y: 0.719, w: 0.026, h: 0.042}]},
        // A portal keeps its own violet stone and rift (a faint tint, no recess, edge, rim
        // light or flame), under a dim red-violet glow at its foot and over its rift.
        demonPortal: {x: 0.49, y: 0.66, w: 0.13, h: 0.2, ring: null, edge: null, recessStops: null, flame: null,
            shadeStops: [[0, '255,240,250'], [0.5, '250,242,250'], [1, '242,236,244']],
            haloReach: 0.6, haloStops: [[0, '200,60,150', 0.3], [0.4, '170,40,140', 0.16], [1, '120,20,110', 0]],
            lift: {color: '112,64,112', alpha: 0.25},
            flareReach: 1.4, flareAlpha: 0.5, flareStops: [[0, '210,70,160', 0.4], [0.5, '160,40,130', 0.15], [1, '120,20,110', 0]]}
    },
    bloomSprite: null,
    bloomSpriteBuilds: 0,
    lampOverlays: new WeakMap(),
    gradedImages: new WeakMap(),
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
    // The edge band: the silhouette in the edge colour, less copies of it shrunk about a
    // point up-left of its centre in a few soft steps (no canvas filter: a filtered canvas
    // slows every later frame that draws the overlays).
    edgeCanvas(image, edge) {
        const band = document.createElement('canvas')
        band.width = image.width
        band.height = image.height
        const b = band.getContext('2d'), W = image.width, H = image.height
        b.drawImage(image, 0, 0)
        b.globalCompositeOperation = 'source-in'
        b.fillStyle = `rgb(${edge.color})`
        b.fillRect(0, 0, W, H)
        b.globalCompositeOperation = 'destination-out'
        for (const [inset, alpha] of edge.steps) {
            const k = 1 - inset * edge.width, ox = (W - k * W) / 2 - edge.shift * W, oy = (H - k * H) / 2 - edge.shift * H
            b.globalAlpha = alpha
            b.drawImage(image, ox, oy, k * W, k * H)
        }
        return band
    },
    // The rim-light ring: a soft arch just outside the opening (open at its foot), stacked
    // strokes from wide and faint to narrow and full, on the sprite only, in a canvas the
    // sprite's size plus pad on every side.
    ringCanvas(image, door, ring, pad, color) {
        const rw = door.w * image.width, off = ring.offset * rw, cx = pad + door.x * image.width
        const top = pad + (door.y - door.h) * image.height, bottom = pad + (door.y + door.h) * image.height
        const arc = document.createElement('canvas')
        arc.width = image.width + 2 * pad
        arc.height = image.height + 2 * pad
        const a = arc.getContext('2d')
        a.lineCap = 'round'
        a.beginPath()
        a.moveTo(cx - rw - off, bottom)
        a.lineTo(cx - rw - off, top + rw)
        a.arc(cx, top + rw, rw + off, Math.PI, 0)
        a.lineTo(cx + rw + off, bottom)
        for (const [width, alpha] of ring.strokes) {
            a.strokeStyle = `rgba(${color},${alpha})`
            a.lineWidth = width * ring.width * rw
            a.stroke()
        }
        a.globalCompositeOperation = 'destination-in'
        a.drawImage(image, pad, pad)
        return arc
    },
    // An outline (SVG path of M, L, Q and Z in the asset's 512-unit space) as a polygon in
    // raster pixels, curves flattened, with its bounds.
    outline(path, W, H) {
        const n = path.match(/[MLQZ]|-?[\d.]+/g), points = []
        let i = 0, cmd, x = 0, y = 0
        const num = () => +n[i++]
        while (i < n.length) {
            if (/[MLQZ]/.test(n[i])) cmd = n[i++]
            if (cmd === 'Z') continue
            if (cmd === 'Q') {
                const qx = num(), qy = num(), ex = num(), ey = num()
                for (let k = 1; k <= 8; k++) {
                    const t = k / 8, u = 1 - t
                    points.push([u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey])
                }
                x = ex
                y = ey
            } else points.push([x = num(), y = num()])
        }
        const poly = points.map(([px, py]) => [px * W / 512, py * H / 512])
        const xs = poly.map(q => q[0]), ys = poly.map(q => q[1])
        return {poly, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys)}
    },
    // Signed distance in pixels from an outline (positive inside), capped at reach outside its bounds.
    outlineDistance({poly, left, right, top, bottom}, px, py, reach) {
        if (px < left - reach || px > right + reach || py < top - reach || py > bottom + reach) return -reach
        let inside = false, best = Infinity
        for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
            const [ax, ay] = poly[j], [bx, by] = poly[k]
            if ((ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay)) inside = !inside
            const ex = bx - ax, ey = by - ay, t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)))
            best = Math.min(best, (px - ax - t * ex) ** 2 + (py - ay - t * ey) ** 2)
        }
        return (inside ? 1 : -1) * Math.sqrt(best)
    },
    // The cave grade's shade (multiply factors) and lift ('screen') canvases, or null when
    // the raster's pixels can't be read.
    gradeCanvases(image, door) {
        const W = image.width, H = image.height
        const {stone, form, warm, warmJoint, warmLift, warmReach, near, nearLift, nearReach, nearOut, ringTone, ringLift, share, joint, anchor, lip, lipColor, flame, feather, groove, crest, contour, frame, interior, flameGlow, toneBias, upperGlow, ringHue} = this.BLOOM.grade
        const ring = this.outline(door.ring, W, H), opening = this.outline(door.opening, W, H), arch = this.outline(door.arch, W, H)
        const shaft = this.outline(door.shaft, W, H)
        const cx = door.x * W, bottom = opening.bottom, soft = Math.max(0.5, feather * W), warmth = warmReach * W
        const lipWidth = Math.max(0.75, lip * W)
        // The flame's anchor and the opening's half width.
        const ox = (opening.left + opening.right) / 2, oy = opening.top + anchor * (opening.bottom - opening.top)
        const halfOpen = (opening.right - opening.left) / 2
        const shade = document.createElement('canvas'), lift = document.createElement('canvas')
        shade.width = lift.width = W
        shade.height = lift.height = H
        const g = shade.getContext('2d')
        g.drawImage(image, 0, 0)
        let pixels
        try {
            pixels = g.getImageData(0, 0, W, H)
        } catch (_) {
            return null
        }
        // Distance inside the silhouette (the sprite's solid pixels) to its edge, on a grid padded
        // by a pixel so the raster's border counts as outside.
        const PW = W + 2, PH = H + 2, solid = new Uint8Array(PW * PH)
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
            solid[(y + 1) * PW + x + 1] = pixels.data[4 * (y * W + x) + 3] >= 128 ? 1 : 0
        const inner = this.chamfer(solid, PW, PH, 1)
        const grooveWidth = Math.max(0.75, groove.width * W), crestWidth = Math.max(0.75, crest.width * W)
        const contourWidth = Math.max(0.75, contour.width * W)
        const l = lift.getContext('2d'), raised = l.createImageData(W, H)
        const src = pixels.data, up = raised.data, stops = interior.map(([t, c]) => [t, c.split(',').map(Number)])
        // A warm colour darkened by the luminance tone, towards orange-brown.
        const toned = (color, c, tone) => color[c] * tone ** toneBias[c]
        const target = [0, 0, 0], hole = [0, 0, 0]
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            // Faint pixels (the contact shadow on the ground) keep their look, so the grade
            // never reaches the stone beside the sprite; faint green moss is graded anyway, so no
            // mossy fringe shows round the dome.
            const i = 4 * (y * W + x), moss = src[i + 1] > src[i] && src[i + 1] > src[i + 2] + 25
            const a = moss ? Math.min(255, Math.round(1.6 * src[i + 3])) : Math.round(src[i + 3] * Math.min(1, Math.max(0, (src[i + 3] / 255 - 0.6) / 0.3)))
            src[i + 3] = a
            if (!a) continue
            const px = x + 0.5, py = y + 0.5
            const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]
            // The doorway region: the opening plus the inner share of the ring, by a distance
            // that is zero where the share of the way from the opening to the arch's outer edge is reached.
            const dOpen = this.outlineDistance(opening, px, py, 6 * warmth), dArch = this.outlineDistance(arch, px, py, 6 * warmth)
            const reach = dOpen >= 0 ? dArch + dOpen : share * dArch + (1 - share) * dOpen
            const inDoor = Math.min(1, Math.max(0, 0.5 + reach / (2 * soft)))
            const onLip = lip ? Math.max(0, 1 - Math.abs(reach) / lipWidth) : 0
            const dRing = this.outlineDistance(ring, px, py, 4 * grooveWidth)
            const inRing = Math.min(1, Math.max(0, 0.5 + dRing / (2 * soft))) * (dOpen < 0 ? 1 : 0)
            // The doorway: the gold inner arch face (frame) by the distance inside the shaft, round
            // a deep amber interior graded down from the anchor to the foot; the flame a small
            // teardrop (narrowing upwards) at the anchor in a gold glow.
            const q = this.outlineDistance(shaft, px, py, 6 * warmth) / halfOpen
            const within = Math.min(1, Math.max(0, (q - frame.width + frame.soft) / (2 * frame.soft)))
            const face = Math.min(1, Math.max(0, (q + frame.soft) / frame.width))
            const t = Math.min(1, Math.max(0, (py - oy) / (bottom - oy)))
            let k = 1
            while (k < stops.length - 1 && stops[k][0] < t) k++
            const [t0, c0] = stops[k - 1], [t1, c1] = stops[k], f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)))
            const narrow = 1 + 0.6 * Math.max(0, oy - py) / (flame.ry * halfOpen)
            const tear = Math.hypot(narrow * (px - ox) / (flame.rx * halfOpen), (py - oy) / ((py > oy ? flame.low : 1) * flame.ry * halfOpen))
            const flare = Math.min(1, 1.6 * Math.max(0, 1 - tear)), light = 1 - joint * inRing * (1 - lum / 160)
            const glowing = (py > oy ? flameGlow.below : 1) * Math.max(0, 1 - (tear - 1) / (flameGlow.reach - 1)) ** 2
            const fill = to => {
                const u = Math.min(1, Math.max(0, (to + upperGlow.soft - (py - opening.top) / (bottom - opening.top)) / upperGlow.soft))
                return upperGlow.amount * u * u * (3 - 2 * u)
            }
            const filled = fill(upperGlow.frame) + (fill(upperGlow.to) - fill(upperGlow.frame)) * within
            for (let c = 0; c < 3; c++) {
                const faceLit = (frame.outer[c] + (frame.inner[c] - frame.outer[c]) * face) * light
                const deep = c0[c] + (c1[c] - c0[c]) * f, room = deep + (flameGlow.color[c] - deep) * glowing
                const framed = faceLit + (room - faceLit) * within, base = framed + (upperGlow.color[c] - framed) * filled
                hole[c] = base + (flame.color[c] - base) * flare
            }
            // Form shading: the stone is lit on the upper-left side facing the key light and
            // shaded across the dome to its lower right.
            const side = Math.min(1, Math.max(0, 0.5 + form.slope[0] * (px - cx) / (0.45 * W) + form.slope[1] * (2 * py / bottom - 1)))
            const lit = form.lit + (form.dark - form.lit) * side ** form.power
            // The doorway's warm light on the stone round it, falling off with the distance
            // from the doorway, so the top and the far side stay grey stone.
            const glow = warmLift * (reach < 0 ? Math.exp(reach / warmth) : 1), tone = 1 - warmJoint + warmJoint * lum / 255
            // Kept to the ring's inner shell: past the ring's outer edge (the groove) only nearOut of it.
            const shell = nearOut + (1 - nearOut) * Math.min(1, Math.max(0, 0.5 + dRing / (2 * grooveWidth)))
            const close = nearLift * (reach < 0 ? shell * Math.exp(reach / (nearReach * W)) : 1)
            // The groove: a thin shadow on the dome just outside the ring's outer edge (away from
            // the opening). The crest: the ring's upper inner face lit next to the opening, on the
            // lit side. The contour: shadow just inside the silhouette, on its far side and foot.
            const grooved = dOpen < -crestWidth ? groove.depth * Math.exp(-(((dRing + 0.6 * grooveWidth) / grooveWidth) ** 2)) : 0
            const upper = py < bottom - 0.3 * (bottom - opening.top) ? 1 - side : 0
            const crested = dOpen < 0 ? upper * Math.max(crest.lift * Math.exp(-(((dOpen + crestWidth) / crestWidth) ** 2)),
                crest.bevel * Math.exp(-(((dRing - crestWidth) / crestWidth) ** 2))) : 0
            const contact = Math.min(1, contour.lit + Math.max(0, (side - 0.45) / 0.35) + Math.max(0, (py - bottom) / (0.04 * H)))
            const contoured = contour.depth * contact * Math.exp(-inner[(y + 1) * PW + x + 1] / contourWidth)
            const darken = 1 - contoured
            for (let c = 0; c < 3; c++) {
                const rock = lum * stone[c] * lit, broad = rock + (toned(warm, c, tone) - rock) * glow
                const carved = broad + (toned(ringTone, c, tone) - broad) * ringLift * inRing
                const warmed = carved + (toned(near, c, tone) - carved) * close
                const outside = warmed + (lipColor[c] - warmed) * onLip
                const crestLit = outside + (toned(crest.color, c, tone) - outside) * crested
                const cut = crestLit + (groove.color[c] - crestLit) * grooved
                target[c] = hole[c] * inDoor + cut * darken * (1 - inDoor)
            }
            target[1] -= (1 - inDoor) * Math.max(0, target[1] - ringHue * target[0])
            // The doorway gives its own light: there the shade goes to black and the lift is the
            // colour itself, so neither the sprite's pixels nor the light on the board tint it.
            for (let c = 0; c < 3; c++) {
                const o = src[i + c], t = Math.min(255, target[c])
                const shaded = t >= o ? 255 : 255 * t / o, raised = t > o ? 255 * (t - o) / (255 - o) : 0
                src[i + c] = Math.round(shaded * (1 - inDoor))
                up[i + c] = Math.round(raised + (t - raised) * inDoor)
            }
            up[i + 3] = a
        }
        g.putImageData(pixels, 0, 0)
        l.putImageData(raised, 0, 0)
        // Copies that are never read back: a canvas read with getImageData may be kept in
        // software, which slows every frame that draws it.
        return {shade: this.copyCanvas(shade), lift: this.copyCanvas(lift)}
    },
    // Chamfer distance (in pixels, 3-4 weights) from every pixel to the nearest one whose
    // mask value is not 'from' (0 where the pixel itself isn't 'from').
    chamfer(mask, W, H, from) {
        const big = 1e6, d = new Float32Array(W * H)
        for (let k = 0; k < W * H; k++) d[k] = mask[k] === from ? big : 0
        const pass = (y0, y1, dy, x0, x1, dx) => {
            for (let y = y0; y !== y1; y += dy) for (let x = x0; x !== x1; x += dx) {
                const k = y * W + x
                if (!d[k]) continue
                let best = d[k]
                const py = y - dy, px = x - dx
                if (px >= 0 && px < W) best = Math.min(best, d[k - dx] + 3)
                if (py >= 0 && py < H) {
                    best = Math.min(best, d[k - dy * W] + 3)
                    if (px >= 0 && px < W) best = Math.min(best, d[k - dy * W - dx] + 4)
                    if (x + dx >= 0 && x + dx < W) best = Math.min(best, d[k - dy * W + dx] + 4)
                }
                d[k] = best
            }
        }
        pass(0, H, 1, 0, W, 1)
        pass(H - 1, -1, -1, W - 1, -1, -1)
        for (let k = 0; k < W * H; k++) d[k] /= 3
        return d
    },
    // The sprite's silhouette in one colour at an alpha (a 'screen' lift of the whole sprite).
    silhouette(image, {color, alpha}) {
        const s = document.createElement('canvas')
        s.width = image.width
        s.height = image.height
        const g = s.getContext('2d')
        g.drawImage(image, 0, 0)
        g.globalCompositeOperation = 'source-in'
        g.fillStyle = `rgba(${color},${alpha})`
        g.fillRect(0, 0, s.width, s.height)
        return s
    },
    copyCanvas(source) {
        const copy = document.createElement('canvas')
        copy.width = source.width
        copy.height = source.height
        copy.getContext('2d').drawImage(source, 0, 0)
        source.width = source.height = 0
        return copy
    },
    lampOverlay(image, name) {
        let overlay = this.lampOverlays.get(image)
        if (overlay && overlay.radius === basis.r && overlay.name === name) return overlay
        const door = this.DOOR[name] || this.DOOR.goldmine
        const W = image.width, H = image.height, rw = door.w * W
        const dx = door.x * W, dy = (door.y + 0.4 * door.h) * H
        // Shade (multiply): the sprite's silhouette in a light tint about the doorway, the
        // doorway a recess, deep orange at its sides and foot.
        // The grade doesn't depend on the radius: built once per sprite image.
        let graded = door.grade && this.gradedImages.get(image)
        if (door.grade && graded === undefined) this.gradedImages.set(image, graded = this.gradeCanvases(image, door))
        let shade, g
        if (graded) shade = graded.shade
        else {
            shade = document.createElement('canvas')
            shade.width = W
            shade.height = H
            g = shade.getContext('2d')
            g.drawImage(image, 0, 0)
            g.globalCompositeOperation = 'source-in'
            const tint = g.createRadialGradient(dx, dy, 0, dx, dy, this.BLOOM.shadeReach * W)
            for (const [t, color] of door.shadeStops || this.BLOOM.shadeStops)
                tint.addColorStop(t, `rgb(${color})`)
            g.fillStyle = tint
            g.fillRect(0, 0, W, H)
            if (door.recessStops !== null) {
                g.globalCompositeOperation = 'source-atop'
                const recess = g.createLinearGradient(dx - rw, 0, dx + rw, 0)
                for (const [t, color] of door.recessStops || this.BLOOM.recessStops)
                    recess.addColorStop(t, `rgb(${color})`)
                g.fillStyle = recess
                this.doorPath(g, door, image)
                g.fill()
            }
        }
        // A door wanting the cave grade whose pixels can't be read (a tainted canvas, as under
        // file://) gets the default edge and rim light: its own ring is the grade's outline path.
        const edge = graded ? null : door.grade || door.edge === undefined ? this.BLOOM.edge : door.edge
        if (edge) g.drawImage(this.edgeCanvas(image, edge), 0, 0)
        const ring = graded ? null : door.grade || door.ring === undefined ? this.BLOOM.ring : door.ring
        if (ring) g.drawImage(this.ringCanvas(image, door, ring, 0, ring.shade), 0, 0)
        // Glow ('screen'): the halo around the doorway with the stone cut out, the rim-light
        // ring on the arch, the flare over the rim, and the flame in the opening.
        const pad = Math.ceil(this.BLOOM.halo * basis.r)
        const glow = document.createElement('canvas')
        glow.width = W + 2 * pad
        glow.height = H + 2 * pad
        g = glow.getContext('2d')
        const cx = pad + dx, cy = pad + dy
        const halo = g.createRadialGradient(cx, cy, 0, cx, cy, (door.haloReach || 1) * pad)
        for (const [t, color, alpha] of door.haloStops || this.BLOOM.haloStops)
            halo.addColorStop(t, `rgba(${color},${alpha})`)
        g.fillStyle = halo
        g.fillRect(0, 0, glow.width, glow.height)
        g.globalCompositeOperation = 'destination-out'
        g.globalAlpha = 1 - this.BLOOM.haloOnSprite
        g.drawImage(image, pad, pad)
        g.globalAlpha = 1
        g.globalCompositeOperation = 'source-over'
        if (graded) g.drawImage(graded.lift, pad, pad)
        if (door.lift) g.drawImage(this.silhouette(image, door.lift), pad, pad)
        if (ring) g.drawImage(this.ringCanvas(image, door, ring, pad, ring.color), 0, 0)
        // Flare: the doorway's light spilling over its rim onto the arch.
        const flareReach = (graded ? this.BLOOM.grade.flareReach : door.flareReach || this.BLOOM.flareReach) * rw
        const flare = g.createRadialGradient(cx, cy, 0, cx, cy, flareReach)
        for (const [t, color, alpha] of door.flareStops || this.BLOOM.flareStops)
            flare.addColorStop(t, `rgba(${color},${alpha})`)
        g.fillStyle = flare
        g.globalAlpha = graded ? this.BLOOM.grade.flareAlpha : door.flareAlpha ?? 1
        g.fillRect(cx - flareReach, cy - flareReach, 2 * flareReach, 2 * flareReach)
        g.globalAlpha = 1
        for (const lit of door.windows || []) {
            const {reach, stops} = this.BLOOM.window
            g.save()
            g.translate(pad + lit.x * W, pad + lit.y * H)
            g.scale(reach * lit.w * W, reach * lit.h * H)
            const light = g.createRadialGradient(0, 0, 0, 0, 0, 1)
            for (const [t, color, alpha] of stops) light.addColorStop(t, `rgba(${color},${alpha})`)
            g.fillStyle = light
            g.fillRect(-1, -1, 2, 2)
            g.restore()
        }
        if (!graded && door.flame !== null) {
            // The flame: an upright white-gold ellipse in the doorway, leaving the recess at
            // the sides and foot.
            this.doorPath(g, door, image, pad, pad)
            g.save()
            g.clip()
            const {rx, ry, dy: fdy} = this.BLOOM.flame
            g.translate(pad + door.x * W, pad + (door.y + fdy * door.h) * H)
            g.scale(rx * door.w * W, ry * door.h * H)
            const core = g.createRadialGradient(0, 0, 0, 0, 0, 1)
            for (const [t, color, alpha] of this.BLOOM.coreStops)
                core.addColorStop(t, `rgba(${color},${alpha})`)
            g.fillStyle = core
            g.fillRect(-1, -1, 2, 2)
            g.restore()
        }
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
    // reach: the radius a lamp is drawn within of the canvas (the bloom's own by default); runs:
    // only the lamps within BLOOM_TILE_REACH of one of these device rectangles (drawEdges).
    bloom(ctx, board, {reach, runs} = {}) {
        const r = basis.r * this.BLOOM.radius
        let sources = this.visibleSources(ctx, this.collect(board, false, false).sources, reach || r, basis.r * 0.23)
        if (runs) {
            const t = ctx.getTransform(), far = this.BLOOM_TILE_REACH * basis.r
            sources = sources.filter(({pos}) => runs.some(run =>
                (pos.x + far) * t.a + t.e >= run.x && (pos.x - far) * t.a + t.e <= run.x + run.w &&
                (pos.y + far) * t.d + t.f >= run.y && (pos.y - far) * t.d + t.f <= run.y + run.h))
        }
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

// The context whose gradients ctx draws with (the gradient caches are kept per context): a patch's buffer canvas
// (Grid.patchSurfaceCache, Grid.startLitPatch) draws with those of the canvas it patches (its gradientSource), so a patch
// makes none. A gradient is defined in user space and draws the same on any context.
function gradientContext(ctx) {
    return ctx.canvas && ctx.canvas.gradientSource || ctx
}
// The world rectangle of atmosphericLighting.clipWindow for a redraw clipped to the pixel rectangle rect of a W x H
// canvas (origin left, top at scale): rect grown by r (a hexagon's reach) on each side, so every hexagon drawing into rect
// is in the clip paths; unbounded on a side rect shares with the canvas.
function clipWindowOf(rect, W, H, left, top, scale, r) {
    return {x0: rect.x > 0 ? left + rect.x / scale - r : -Infinity, y0: rect.y > 0 ? top + rect.y / scale - r : -Infinity,
        x1: rect.x + rect.w < W ? left + (rect.x + rect.w) / scale + r : Infinity,
        y1: rect.y + rect.h < H ? top + (rect.y + rect.h) / scale + r : Infinity}
}
// The pixel boxes inners (of a W x H canvas) merged into regions {inner, outer}: inner the box spanning a cluster's boxes,
// outer it grown by margin pixels (cut to the canvas); boxes are merged until no two regions' outer boxes overlap, so
// every region's ring (outer outside inner) lies outside every other region's outer box.
function mapRegionClusters(inners, margin, W, H) {
    const region = inner => ({inner, outer: pixelRect(inner.x - margin, inner.y - margin, inner.x + inner.w + margin,
        inner.y + inner.h + margin, W, H)})
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const regions = inners.map(region)
    for (let merged = true; merged;) {
        merged = false
        for (let i = 0; i < regions.length && !merged; ++i)
            for (let j = i + 1; j < regions.length; ++j) {
                if (!overlap(regions[i].outer, regions[j].outer)) continue
                const a = regions[i].inner, b = regions[j].inner
                regions[i] = region(pixelRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x + a.w, b.x + b.w),
                    Math.max(a.y + a.h, b.y + b.h), W, H))
                regions.splice(j, 1)
                merged = true
                break
            }
    }
    return regions
}
// The whole pixel rectangle {x, y, w, h} spanning x0..x1 x y0..y1 (whole pixels) cut to a W x H canvas; null when empty.
function pixelRect(x0, y0, x1, y1, W, H) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1)
    return x0 < x1 && y0 < y1 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null
}
// The pixels of canvas's rectangle outer outside the rectangle inner (its ring: the strips above, below, left and right
// of inner) copied into the reused canvas holder[name] (made, or grown to fit) in tiles of at most RING_TILE pixels a
// side packed in a near-square grid, so the copy is about the ring's own size. Returns {copy, tiles}, each tile
// [x, y, w, h, copy x, copy y].
const RING_TILE = 128
function copyCanvasRing(canvas, outer, inner, holder, name) {
    const ix1 = inner.x + inner.w, iy1 = inner.y + inner.h, ox1 = outer.x + outer.w, oy1 = outer.y + outer.h
    const strips = [[outer.x, outer.y, outer.w, inner.y - outer.y], [outer.x, iy1, outer.w, oy1 - iy1],
        [outer.x, inner.y, inner.x - outer.x, inner.h], [ix1, inner.y, ox1 - ix1, inner.h]]
    const pieces = []
    for (const [x, y, w, h] of strips)
        for (let v = 0; v < h; v += RING_TILE)
            for (let u = 0; u < w; u += RING_TILE)
                pieces.push([x + u, y + v, Math.min(RING_TILE, w - u), Math.min(RING_TILE, h - v)])
    const cols = Math.max(1, Math.ceil(Math.sqrt(pieces.length))), rows = Math.max(1, Math.ceil(pieces.length / cols))
    let copy = holder[name]
    if (!copy || copy.width < cols * RING_TILE || copy.height < rows * RING_TILE) {
        copy = holder[name] = document.createElement('canvas')
        copy.width = Math.max(cols * RING_TILE, copy.width || 0)
        copy.height = Math.max(rows * RING_TILE, copy.height || 0)
    }
    const g = copy.getContext('2d')
    g.setTransform(1, 0, 0, 1, 0, 0)
    const tiles = pieces.map(([x, y, w, h], k) => [x, y, w, h, (k % cols) * RING_TILE, Math.floor(k / cols) * RING_TILE])
    for (const [x, y, w, h, cx, cy] of tiles) {
        g.clearRect(cx, cy, w, h)
        g.drawImage(canvas, x, y, w, h, cx, cy, w, h)
    }
    return {copy, tiles}
}
// Copies the pixel rectangle r of canvas source into the same place of canvas target, cleared first (its pixels become
// source's, transparency included): a patch's region from its buffer (Grid.finishSurfacePatch, Grid.finishLitPatch).
function copyCanvasRect(source, target, r) {
    const g = target.getContext('2d')
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.filter = 'none'
    g.shadowBlur = g.shadowOffsetX = g.shadowOffsetY = 0
    g.shadowColor = 'rgba(0,0,0,0)'
    g.clearRect(r.x, r.y, r.w, r.h)
    g.drawImage(source, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    g.restore()
}
// Puts back canvas's ring pixels from kept (copyCanvasRing): each tile cleared, then drawn from the copy pixel for pixel.
function restoreCanvasRing(canvas, kept) {
    const g = canvas.getContext('2d')
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.filter = 'none'
    g.shadowBlur = g.shadowOffsetX = g.shadowOffsetY = 0
    g.shadowColor = 'rgba(0,0,0,0)'
    for (const [x, y, w, h, cx, cy] of kept.tiles) {
        g.clearRect(x, y, w, h)
        g.drawImage(kept.copy, cx, cy, w, h, x, y, w, h)
    }
    g.restore()
}
