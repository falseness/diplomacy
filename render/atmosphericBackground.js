// Optional decoration never participates in the required sprite startup counter.
const atmosphericBackground = {
    state: 'idle', image: null, raster: null, rasterizations: 0, fallbackRasterizations: 0,
    // Only the sky raster and the light map are additional atmospheric backing
    // stores; terrain and buildings share the pre-existing grid/sprite caches.
    maxBytes: 33554432, lightBytes: 2 * 2 * 1024 * 1024 * 4, minRasterScale: 0.75, fallbacks: 0,
    releaseRaster() {
        if (this.raster) this.raster.width = this.raster.height = 0
        this.releaseBlocks()
        this.raster = this.rasterView = null
        this.dropRasterJob()
    },
    // TASK-1372 (stagedRaster): the raster built a step a frame (rasterSteps), the frames drawing the image or navy directly
    // until it is done: {raster, view, w, h, steps}.
    stagedRaster: true,
    rasterJob: null,
    dropRasterJob() {
        if (this.rasterJob) this.rasterJob.raster.width = this.rasterJob.raster.height = 0
        this.rasterJob = null
    },
    invalidate() {
        this.releaseRaster()
        atmosphericLighting.release()
    },
    bytes() {
        const bytes = c => c ? c.width * c.height * 4 : 0
        // (TASK-1572: with the light map kept aside, atmosphericLighting.mapStash)
        const kept = atmosphericLighting.mapStash
        return bytes(this.raster) + bytes(atmosphericLighting.map) + bytes(atmosphericLighting.gain) + (kept ? bytes(kept.map) + bytes(kept.gain) : 0)
    },
    watched: new WeakSet(),
    // A surface without events (a test canvas's native backing, which jsdom's main context reports once the main canvas has
    // been drawn into another canvas: Grid.captureZoomRaster) is not watched.
    watch(surface) {
        if (this.watched.has(surface) || typeof surface?.addEventListener !== 'function') return
        this.watched.add(surface)
        surface.addEventListener('contextlost', event => {
            event.preventDefault()
            this.invalidate()
            if (typeof grid !== 'undefined' && grid) grid.surfaceCacheState = undefined
        })
        surface.addEventListener('contextrestored', restoreImageCaches)
    },
    // The painted night sky (clouds, no sun light: the beams below are the game's own).
    SRC: 'assets/atmosphere/sky.webp',
    load() {
        if (this.state !== 'idle') return
        this.state = 'loading'
        const image = new Image()
        const finish = ready => {
            if (this.state !== 'loading') return
            clearTimeout(deadline)
            image.onload = image.onerror = null
            this.state = ready ? 'ready' : 'failed'
            this.image = ready ? image : null
        }
        const deadline = setTimeout(() => finish(false), 8000)
        // TASK-1518: decoded off the main thread before it is used (createImageBitmap: the same pixels), not in the frame
        // first drawing it (~30 ms on the user's desktop); paint draws the bitmap.
        image.onload = () => {
            if (!(image.naturalWidth > 0 && image.naturalHeight > 0))
                return finish(false)
            if (typeof createImageBitmap !== 'function')
                return finish(true)
            // Decoded first (decode: off the main thread), so createImageBitmap copies decoded pixels.
            const decoded = typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve()
            decoded.then(() => createImageBitmap(image)).then(bitmap => {
                if (this.state === 'loading')
                    this.bitmap = bitmap
                finish(true)
            }, () => finish(true))
        }
        image.onerror = () => finish(false)
        image.src = this.SRC
    },
    // Sky decoration baked into the sky raster over the image: soft diagonal light
    // beams from the upper left, small cool stars and warm floating embers. Placement
    // comes from a private seeded generator (never Math.random), in fractions of the
    // viewport; a fixed particle count keeps a thin strip of visible sky lively.
    SKY: {
        seed: 1109,
        // The key light breaks in at the upper left as a diverging fan of orange-gold rays from an
        // origin off screen above the upper left (no curved arcs, which read as a hard ring): three
        // broad soft underlays (so it reads as one radiant swath with rays at any aspect) under
        // nineteen fine rays, each falling down towards the board's upper-left edge and fading out
        // along its length, the top-left corner and the sky further left staying dark. Beams (in
        // viewport fractions, angle and width too): [angle, half width, alpha, origin, length] (no
        // length: to the edge); origin is the default origin and the centre of the fade of all the sky's
        // light. Two steeper underlays carry the swath down the left of the screen.
        origin: [-0.1, -0.8],
        beams: [...[[67, 0.07, 0.6], [61, 0.06, 0.3], [73, 0.06, 0.35], [78, 0.05, 0.35], [82, 0.04, 0.25], [60.87, 0.0042, 0.0645], [61.65, 0.0045, 0.0465],
                [61.96, 0.0053, 0.058], [62.67, 0.006, 0.0705], [63.57, 0.0039, 0.0805], [63.83, 0.0045, 0.094],
                [64.61, 0.005, 0.0825], [64.98, 0.005, 0.0775], [65.7, 0.0021, 0.094], [66.39, 0.0049, 0.095],
                [67.11, 0.0057, 0.066], [67.75, 0.0038, 0.098], [68.39, 0.0024, 0.0505], [68.66, 0.0059, 0.0685],
                [69.46, 0.0032, 0.0725], [69.94, 0.0034, 0.0775], [70.64, 0.0056, 0.083], [71.41, 0.0054, 0.1015],
                [71.89, 0.0027, 0.0935]].map(([angle, half, alpha]) => [angle, half, alpha, [-0.1, -0.8], 1.7]),
            // The swath continues along the top behind the board towards the upper right: a broad
            // shallow underlay and three soft rays starting inside the fan, fading out by 0.8 of the width.
            ...[[4, 0.065, 1], [2, 0.012, 0.12], [4.5, 0.016, 0.14], [7, 0.012, 0.12]]
                .map(([angle, half, alpha]) => [angle, half, alpha, [0.14, -0.035], 0.66])],
        beamColor: '255,130,40',
        stars: 15,
        // Embers on a desktop sky (1691x930 CSS pixels), scaled by the square root of the viewport's area
        // and never below minEmbers, so a phone's small sky is not crowded.
        embers: 55,
        minEmbers: 30,
        // Until the sky image has loaded, and if it fails, the beams and sparks lie on this plain deep navy
        // (near the painted sky's corners). The image carries its own clouds, their light and its darker
        // corners, so nothing here paints or lights clouds and there is no vignette (it took the corners black).
        navy: [6, 22, 54]
    },
    decorations: 0,
    random(seed) {
        return () => {
            seed = seed + 0x6D2B79F5 | 0
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
            return ((t ^ t >>> 14) >>> 0) / 4294967296
        }
    },
    // A soft band across a linear gradient: a Gaussian profile (exp(-x^2/2), x in thirds of the
    // half width, zero at the edges), so it has no hard edge or ridge.
    softBand(gradient, color, alpha) {
        for (let i = 0; i <= 12; i++) {
            const x = (i - 6) / 2
            const a = i % 12 ? alpha * Math.exp(-x * x / 2) : 0
            gradient.addColorStop(i / 12, `rgba(${color},${a.toFixed(4)})`)
        }
        return gradient
    },
    decorate(g, w, h) {
        for (const _ of this.decorateSteps(g, w, h));
    },
    // decorate's drawing in steps (a generator; each yield ends one): the same calls in the same order, SKY_STEP_BEAMS beams
    // a step, so a raster built over frames (rasterSteps) has a whole build's pixels.
    // TASK-1518: one beam a step (a step of four was ~100 ms on the user's desktop canvas), and a beam with a length is
    // cleared from and added from its own layer only within its box (beamBox: the band's rectangle through its transform,
    // grown by SKY_BEAM_BOX_PAD device pixels): the layer is transparent outside it, so the 'lighter' add of the rest of
    // the layer added nothing; the same pixels.
    SKY_STEP_BEAMS: 1,
    SKY_BEAM_BOX_PAD: 2,
    SKY_BANDS: 4,
    // The device pixel box ({x, y, w, h}, whole pixels, within the w x h canvas) of the band (0, -half)..(length, half)
    // drawn at `at` (viewport fractions) turned by angle degrees, as decorateSteps' transform places it; null when empty.
    beamBox(at, angle, half, length, w, h) {
        const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const [px, py] of [[0, -half], [length, -half], [length, half], [0, half]]) {
            const x = at[0] * w + w * (c * px - s * py), y = at[1] * h + h * (s * px + c * py)
            x0 = Math.min(x0, x)
            y0 = Math.min(y0, y)
            x1 = Math.max(x1, x)
            y1 = Math.max(y1, y)
        }
        const pad = this.SKY_BEAM_BOX_PAD
        x0 = Math.max(0, Math.floor(x0) - pad)
        y0 = Math.max(0, Math.floor(y0) - pad)
        x1 = Math.min(w, Math.ceil(x1) + pad)
        y1 = Math.min(h, Math.ceil(y1) + pad)
        return x1 > x0 && y1 > y0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null
    },
    *decorateSteps(g, w, h) {
        const sky = this.SKY, px = window.devicePixelRatio || 1
        const random = this.random(sky.seed)
        const ox = sky.origin[0] * w, oy = sky.origin[1] * h, reach = 1.25 * Math.hypot(w, h)
        // Beams: bands across their width, faded with the distance from the origin.
        const beams = document.createElement('canvas')
        beams.width = w
        beams.height = h
        const b = beams.getContext('2d')
        b.globalCompositeOperation = 'lighter'
        // In viewport fractions (angle and width too), like the glows. A beam with a length fades
        // out along it (drawn on its own layer first), so the band's lit edge curves.
        const ray = sky.beams.some(beam => beam[4]) ? document.createElement('canvas') : null
        if (ray) {
            ray.width = w
            ray.height = h
        }
        let beamsDrawn = 0
        for (const [angle, half, alpha, at = sky.origin, length] of sky.beams) {
            if (beamsDrawn && beamsDrawn % this.SKY_STEP_BEAMS === 0)
                yield
            ++beamsDrawn
            const target = length ? ray.getContext('2d') : b
            // The layer is transparent: cleared after the beam before it (below), within that beam's box.
            const box = length ? this.beamBox(at, angle, half, length, w, h) : null
            if (length && !box)
                continue
            target.save()
            // destination-in below clears all of the clip outside its rectangle: only the box can hold anything.
            if (box) {
                target.beginPath()
                target.rect(box.x, box.y, box.w, box.h)
                target.clip()
            }
            target.translate(at[0] * w, at[1] * h)
            target.scale(w, h)
            target.rotate(angle * Math.PI / 180)
            target.fillStyle = this.softBand(target.createLinearGradient(0, -half, 0, half), sky.beamColor, alpha)
            target.fillRect(0, -half, length || 3, 2 * half)
            if (length) {
                const along = target.createLinearGradient(0, 0, length, 0)
                along.addColorStop(0, 'rgba(0,0,0,1)')
                along.addColorStop(0.5, 'rgba(0,0,0,0.6)')
                along.addColorStop(1, 'rgba(0,0,0,0)')
                target.globalCompositeOperation = 'destination-in'
                target.fillStyle = along
                target.fillRect(0, -half, length, 2 * half)
            }
            target.restore()
            if (length) {
                // The layer's beam in one step, its add in the next.
                yield
                b.drawImage(ray, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h)
                target.clearRect(box.x, box.y, box.w, box.h)
            }
        }
        if (ray) ray.width = ray.height = 0
        yield
        // TASK-1518: the fade and the beams' composite a band of rows a step (SKY_BANDS): the same per-pixel blends.
        const fade = b.createRadialGradient(ox, oy, 0, ox, oy, reach)
        fade.addColorStop(0, 'rgba(0,0,0,1)')
        fade.addColorStop(0.35, 'rgba(0,0,0,0.9)')
        fade.addColorStop(1, 'rgba(0,0,0,0)')
        b.globalCompositeOperation = 'destination-in'
        b.fillStyle = fade
        for (let k = 0; k < this.SKY_BANDS; ++k) {
            const y0 = Math.floor(k * h / this.SKY_BANDS), y1 = Math.floor((k + 1) * h / this.SKY_BANDS)
            b.save()
            b.beginPath()
            b.rect(0, y0, w, y1 - y0)
            b.clip()
            b.fillRect(0, 0, w, h)
            b.restore()
            yield
        }
        g.save()
        g.globalCompositeOperation = 'screen'
        for (let k = 0; k < this.SKY_BANDS; ++k) {
            const y0 = Math.floor(k * h / this.SKY_BANDS), y1 = Math.floor((k + 1) * h / this.SKY_BANDS)
            if (y1 > y0)
                g.drawImage(beams, 0, y0, w, y1 - y0, 0, y0, w, y1 - y0)
            if (k < this.SKY_BANDS - 1)
                yield
        }
        beams.width = beams.height = 0
        yield
        // Stars: tiny cool points, about half of them bright.
        g.globalCompositeOperation = 'source-over'
        for (let i = 0; i < sky.stars; i++) {
            const x = random() * w, y = random() * h, bright = random() < 0.5
            g.fillStyle = bright ? 'rgba(226,236,255,0.95)' : 'rgba(190,206,240,0.55)'
            g.beginPath()
            g.arc(x, y, (bright ? 0.9 + 0.5 * random() : 0.6) * px, 0, 2 * Math.PI)
            g.fill()
        }
        // Embers: warm glowing points, more of them lower down where they rise from.
        g.globalCompositeOperation = 'screen'
        const embers = Math.round(Math.min(sky.embers, Math.max(sky.minEmbers, sky.embers * Math.sqrt(w * h / (px * px * 1691 * 930)))))
        for (let i = 0; i < embers; i++) {
            const x = random() * w, y = (1 - random() ** 1.6) * h
            const core = (1 + 1.1 * random()) * px, halo = 3.2 * core
            const glow = g.createRadialGradient(x, y, 0, x, y, halo)
            glow.addColorStop(0, 'rgba(255,236,170,1)')
            glow.addColorStop(0.3, 'rgba(255,196,96,0.95)')
            glow.addColorStop(0.45, 'rgba(255,150,60,0.35)')
            glow.addColorStop(1, 'rgba(240,120,40,0)')
            g.fillStyle = glow
            g.fillRect(x - halo, y - halo, 2 * halo, 2 * halo)
        }
        g.restore()
        ++this.decorations
    },
    // The page's own background (index.html), which shows wherever the canvas is transparent.
    PAGE_BACKGROUND: '#182a34',
    // Whether draw(ctx) now draws the opaque raster over all of ctx's canvas (the same key, board,
    // size and viewport as the raster's, the image raster).
    opaqueOver(ctx) {
        const w = ctx.canvas.width, h = ctx.canvas.height
        return !!this.raster && this.state === 'ready' && this.viewMatches(this.rasterView, w, h) && this.board === grid &&
            otherSettings.atmosphericVisuals && this.keyMatches()
    },
    // Whether the settings the sky depends on are still the key's (compared field by field: no string per frame).
    keyMatches() {
        return this.keyOn === otherSettings.atmosphericVisuals && this.keyPolished === otherSettings.usePolishedSprites &&
            this.keyDpr === window.devicePixelRatio
    },
    // The window size, kept from resize events: reading innerWidth/innerHeight in every frame's view check can
    // force a style and layout pass (it raised the zoom frames' 95th percentile).
    windowSize() {
        if (!this.viewport) {
            this.viewport = [window.innerWidth, window.innerHeight]
            window.addEventListener('resize', () => this.viewport = [window.innerWidth, window.innerHeight])
        }
        return this.viewport
    },
    // What the raster shows for a w x h canvas: the image (once loaded) or the navy fallback, and the window
    // size, which places the image (see layout). Compared field by field, so a frame allocates nothing.
    viewFor(w, h) {
        const size = this.windowSize()
        return {image: this.state === 'ready', w, h, vw: size[0], vh: size[1]}
    },
    viewMatches(view, w, h) {
        const size = this.windowSize()
        return !!view && view.image === (this.state === 'ready') && view.w === w && view.h === h &&
            view.vw === size[0] && view.vh === size[1]
    },
    // The image cover-fitted to the window (scaled to cover it, never stretched, centred), in the w x h canvas's
    // pixels. The canvas keeps its load-time size and its box is fitted into the window (index.html
    // fitCanvasToWindow, at the top left); after a resize the page behind it shows the same cover-fitted
    // image (syncPage), so the sky runs on seamlessly into the bars beside the canvas.
    layout(w, h) {
        const iw = this.image.naturalWidth, ih = this.image.naturalHeight
        const vw = this.windowSize()[0] || w, vh = this.windowSize()[1] || h
        const box = Math.min(vw, vh * w / h), unit = w / box
        const scale = Math.max(vw / iw, vh / ih)
        return {x: (vw - iw * scale) / 2 * unit, y: (vh - ih * scale) / 2 * unit,
            scaleX: scale * unit, scaleY: scale * unit, width: iw * scale * unit, height: ih * scale * unit}
    },
    // The page behind the canvas, set only when the view changes: the cover-fitted image while the sky shows
    // and the canvas leaves bars beside it (a page image under a covering canvas still costs the compositor
    // every frame), else the plain navy (the page background with the sky off).
    syncPage(on, w, h) {
        if (on ? this.viewMatches(this.pageView, w, h) : this.pageView === null) return
        if (typeof document === 'undefined' || !document.body) return
        const view = this.pageView = on ? this.viewFor(w, h) : null
        const style = document.body.style, vw = this.windowSize()[0], vh = this.windowSize()[1]
        const box = Math.min(vw, vh * w / h), bars = box < vw - 0.5 || box * h / w < vh - 0.5
        if (view && this.state === 'ready' && bars) {
            style.backgroundColor = `rgb(${this.SKY.navy})`
            style.backgroundImage = `url("${this.SRC}")`
            style.backgroundSize = 'cover'
            style.backgroundPosition = 'center'
            style.backgroundRepeat = 'no-repeat'
            style.backgroundAttachment = 'fixed'
        }
        else {
            style.backgroundImage = style.backgroundSize = style.backgroundPosition = style.backgroundRepeat = style.backgroundAttachment = ''
            style.backgroundColor = view ? `rgb(${this.SKY.navy})` : ''
        }
    },
    // The sky under the beams and sparks: the image placed by layout, or the plain navy fallback.
    paint(target, w, h) {
        if (this.state === 'ready') {
            const at = this.layout(w, h)
            target.drawImage(this.bitmap || this.image, at.x, at.y, at.width, at.height)
            this.drawn = at
        }
        else {
            target.fillStyle = `rgb(${this.SKY.navy})`
            target.fillRect(0, 0, w, h)
        }
    },
    // TASK-1372: one step of the raster for a w x h canvas (draw, at most one a frame): the first paints it, the others
    // decorate it (decorateSteps), the last backs it as draw's whole build does and makes it the raster.
    *rasterSteps(raster, rw, rh) {
        const g = raster.getContext('2d')
        // TASK-1518: painted a band of rows a step (clipped: the image sampled as one draw samples it).
        for (let k = 0; k < this.SKY_BANDS; ++k) {
            const y0 = Math.floor(k * rh / this.SKY_BANDS), y1 = Math.floor((k + 1) * rh / this.SKY_BANDS)
            g.save()
            g.beginPath()
            g.rect(0, y0, rw, y1 - y0)
            g.clip()
            this.paint(g, rw, rh)
            g.restore()
            yield
        }
        yield* this.decorateSteps(g, rw, rh)
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.globalAlpha = 1
        g.globalCompositeOperation = 'destination-over'
        g.fillStyle = this.PAGE_BACKGROUND
        g.fillRect(0, 0, rw, rh)
        g.restore()
    },
    rasterStep(w, h, fit) {
        let job = this.rasterJob
        if (job && !(job.w === w && job.h === h && this.viewMatches(job.view, w, h)))
            this.dropRasterJob(), job = null
        if (!job) {
            const raster = document.createElement('canvas')
            const rw = raster.width = fit < 1 ? Math.floor(w * fit) : w
            const rh = raster.height = fit < 1 ? Math.floor(h * fit) : h
            job = this.rasterJob = {raster, view: this.viewFor(w, h), w, h, steps: this.rasterSteps(raster, rw, rh)}
        }
        let done
        try {
            done = job.steps.next().done
        } catch (_) {
            this.dropRasterJob()
            return
        }
        if (!done) return
        this.rasterJob = null
        this.watch(job.raster)
        this.raster = job.raster
        this.rasterView = job.view
        if (this.state === 'ready') ++this.rasterizations
        else ++this.fallbackRasterizations
    },
    // blocks (TASK-1545, Grid.frameCover's sky): the sky raster's blocks to draw, not the whole raster.
    draw(ctx, blocks = null) {
        // Bind independently of the optional sprite startup counter.
        this.watch(ctx.canvas)
        this.syncKey()
        if (!otherSettings.atmosphericVisuals) {
            this.syncPage(false)
            return
        }
        this.drawSky(ctx, blocks)
    },
    // TASK-1545: the sky raster drawn in pieces: a frame on the lit tiles draws only the raster's blocks (BLOCK_W x BLOCK_H of
    // its pixels from its corner, the last column and row cut to it; BLOCK_SPLIT wide along the board's edge) the board leaves
    // open (Grid.frameCover's sky), each row's
    // run of consecutive blocks from one canvas copied whole-pixel from the raster when first drawn (kept while drawn, at
    // most BLOCK_RUNS of them, until the raster is released), at its own place: the frame's canvas records those pieces,
    // not the whole canvas-sized raster (a Chromium canvas records about 32 MB of images before it rasterizes inside the
    // frame), in a call a run.
    blocks: true,
    BLOCK_W: 128,
    BLOCK_H: 64,
    BLOCK_SPLIT: 32,
    BLOCK_RUNS: 96,
    // TASK-1552: runs drawn from whole rows of the raster kept (drawBlocks); false: each run copied on its own as before.
    blockRows: true,
    blockSet: null,
    blockBuilds: 0,
    // TASK-1550: the block runs' canvases (CanvasPool, sprites/elements/rect.js), reused as runs are let go of.
    runPool() {
        return this.blockPool ||= new CanvasPool('sky', 32 * 1024 * 1024, 16, 4)
    },
    releaseBlocks() {
        if (this.blockSet) for (const run of this.blockSet.runs.values()) this.runPool().give(run.canvas)
        this.blockSet = null
    },
    // Whether drawSky can draw blocks for a w x h canvas.
    blocksFor(w, h) {
        return this.blocks && !!otherSettings.atmosphericVisuals && !!this.raster && this.raster.width === w && this.raster.height === h &&
            this.viewMatches(this.rasterView, w, h)
    },
    drawBlocks(ctx, blocks) {
        const raster = this.raster
        if (!this.blockSet || this.blockSet.raster !== raster) {
            this.releaseBlocks()
            this.blockSet = {raster, runs: new Map(), clock: 0}
        }
        const set = this.blockSet, clock = ++set.clock
        // The blocks (in row order, each row left to right) joined into runs.
        const runs = []
        for (const block of blocks) {
            const last = runs[runs.length - 1]
            if (last && last.y === block.y && last.h === block.h && last.x + last.w === block.x)
                last.w += block.w
            else
                runs.push({x: block.x, y: block.y, w: block.w, h: block.h})
        }
        for (const {x, y, w, h} of runs) {
            // TASK-1552 (blockRows): a run drawn from its row of the raster (the raster's whole width, h high at y), copied once
            // and kept like a run: the open blocks move with the lit tiles built while the camera pans, and runs keyed by their
            // own extent were copied anew nearly every frame.
            if (this.blockRows) {
                const key = 'row:' + y + ',' + h
                let row = set.runs.get(key)
                if (!row) {
                    const canvas = this.runPool().take(raster.width, h)
                    const g = canvas.getContext('2d')
                    g.save()
                    g.globalCompositeOperation = 'copy'
                    g.drawImage(raster, 0, y, raster.width, h, 0, 0, raster.width, h)
                    g.restore()
                    set.runs.set(key, row = {canvas})
                    ++this.blockBuilds
                }
                row.used = clock
                ctx.drawImage(row.canvas, x, 0, w, h, x, y, w, h)
                continue
            }
            const key = x + ',' + y + ',' + w + ',' + h
            let run = set.runs.get(key)
            if (!run) {
                // TASK-1550: the run's canvas from runPool (at least w x h; the run is its corner), given back when let go of.
                const canvas = this.runPool().take(w, h)
                const g = canvas.getContext('2d')
                g.save()
                g.globalCompositeOperation = 'copy'
                g.drawImage(raster, x, y, w, h, 0, 0, w, h)
                g.restore()
                set.runs.set(key, run = {canvas})
                ++this.blockBuilds
            }
            run.used = clock
            ctx.drawImage(run.canvas, 0, 0, w, h, x, y, w, h)
        }
        if (set.runs.size > this.BLOCK_RUNS)
            for (const [key, run] of [...set.runs].sort((p, q) => p[1].used - q[1].used).slice(0, set.runs.size - this.BLOCK_RUNS)) {
                if (run.used === clock)
                    break
                this.runPool().give(run.canvas)
                set.runs.delete(key)
            }
    },
    // The viewport sky and the fixed light kernel are camera-scale independent.
    // Reuse them through wheel/pinch gestures; world layers use the draw transform.
    // TASK-1454: the sky raster (and a raster job under way) depends only on the key and the view (viewMatches), so a
    // new board keeps it; the board's light map is released.
    // TASK-1518: also before a new board's first frame builds its light map (Grid.startBuildSteps), so draw keeps it.
    // TASK-1519: a board that took over the surface cache of the board bound before (Grid.adoptSurfaceCache: a turn
    // playback's) keeps it, and the light map (compared with each board by value) is kept for it.
    syncKey() {
        if (!this.keyMatches() || this.board !== grid) {
            const adopted = this.keyMatches() && !!grid && !!this.board && grid.surfaceCacheAdoptedFrom === this.board
            if (grid)
                grid.surfaceCacheAdoptedFrom = undefined
            if (this.keyMatches()) {
                if (!adopted) atmosphericLighting.release()
            }
            else this.invalidate()
            this.keyOn = otherSettings.atmosphericVisuals
            this.keyPolished = otherSettings.usePolishedSprites
            this.keyDpr = window.devicePixelRatio
            this.key = [this.keyOn, this.keyPolished, this.keyDpr].join(':')
            this.board = grid
            if (grid && !adopted) grid.surfaceCacheState = undefined
        }
    },
    drawSky(ctx, blocks = null) {
        this.load()
        const w = ctx.canvas.width, h = ctx.canvas.height
        if (!w || !h) return
        // One raster per canvas size, window size and image state (the navy fallback until the image loads).
        if (this.raster && !this.viewMatches(this.rasterView, w, h))
            this.releaseRaster()
        this.syncPage(true, w, h)
        // A canvas over the budget gets a raster of up to minRasterScale less resolution, drawn scaled up
        // (the soft sky does not show it); beyond that, the image or navy is drawn directly.
        const fit = Math.min(1, Math.sqrt((this.maxBytes - this.lightBytes) / (w * h * 4)))
        // TASK-1562: a step only with the camera at rest and not after a zoom (Grid.zoomQuiet, Grid.cameraBusy): a step draws
        // 1-4 MP; the image is drawn directly meanwhile, as before the raster is done.
        if (!this.raster && fit >= this.minRasterScale && this.stagedRaster) {
            if (!(typeof Grid !== 'undefined' && Grid.cameraBusy?.()))
                this.rasterStep(w, h, fit)
        }
        else if (!this.raster && fit >= this.minRasterScale) {
            const raster = document.createElement('canvas')
            try {
                const rw = raster.width = fit < 1 ? Math.floor(w * fit) : w
                const rh = raster.height = fit < 1 ? Math.floor(h * fit) : h
                this.paint(raster.getContext('2d'), rw, rh)
                this.decorate(raster.getContext('2d'), rw, rh)
                // Opaque by construction (opaqueOver): any pixel the image leaves translucent is backed
                // with the page background it showed over on the cleared canvas.
                const g = raster.getContext('2d')
                g.save()
                g.setTransform(1, 0, 0, 1, 0, 0)
                g.globalAlpha = 1
                g.globalCompositeOperation = 'destination-over'
                g.fillStyle = this.PAGE_BACKGROUND
                g.fillRect(0, 0, rw, rh)
                g.restore()
                this.watch(raster)
                this.raster = raster
                this.rasterView = this.viewFor(w, h)
                if (this.state === 'ready') ++this.rasterizations
                else ++this.fallbackRasterizations
            } catch (_) {
                raster.width = raster.height = 0
            }
        }
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (blocks && this.blocksFor(w, h)) this.drawBlocks(ctx, blocks)
        else if (this.raster && this.raster.width === w) ctx.drawImage(this.raster, 0, 0)
        else if (this.raster) ctx.drawImage(this.raster, 0, 0, w, h)
        else {
            // Decoded static image or navy: no per-frame gradient or blur regeneration
            // (and no sky decoration, which is only baked into the raster).
            this.paint(ctx, w, h)
            ++this.fallbacks
        }
        ctx.restore()
    }
}
