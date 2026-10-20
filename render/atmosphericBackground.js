// Optional decoration never participates in the required sprite startup counter.
const atmosphericBackground = {
    state: 'idle', image: null, raster: null, rasterizations: 0,
    // Only the cloud raster and the light map are additional atmospheric backing
    // stores; terrain and buildings share the pre-existing grid/sprite caches.
    maxBytes: 33554432, lightBytes: 2 * 2 * 1024 * 1024 * 4, fallbacks: 0,
    releaseRaster() {
        if (this.raster) this.raster.width = this.raster.height = 0
        this.raster = null
    },
    invalidate() {
        this.releaseRaster()
        atmosphericLighting.release()
    },
    bytes() {
        const bytes = c => c ? c.width * c.height * 4 : 0
        return bytes(this.raster) + bytes(atmosphericLighting.map) + bytes(atmosphericLighting.gain)
    },
    watched: new WeakSet(),
    watch(surface) {
        if (this.watched.has(surface)) return
        this.watched.add(surface)
        surface.addEventListener('contextlost', event => {
            event.preventDefault()
            this.invalidate()
            if (typeof grid !== 'undefined' && grid) grid.surfaceCacheState = undefined
        })
        surface.addEventListener('contextrestored', restoreImageCaches)
    },
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
        image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
        image.onerror = () => finish(false)
        image.src = 'assets/atmosphere/clouds.svg'
    },
    // Sky decoration baked into the cloud raster with the clouds: soft diagonal light
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
        // length: to the edge), here also two faint soft streaks crossing the sky right of the board;
        // origin is the default origin and the centre of the fade of all the sky's light. Two steeper
        // underlays carry the swath down the left of the screen.
        origin: [-0.1, -0.8],
        beams: [[50, 0.02, 0.1, [0.8, 0.02]], [48, 0.025, 0.08, [0.85, 0.15]],
            // Three faint orange streaks right of the board's top, falling with the key light,
            [35, 0.03, 0.34, [0.8, 0.1], 0.3], [33, 0.025, 0.27, [0.8, 0.2], 0.3], [37, 0.025, 0.22, [0.82, 0.32], 0.25],
            // and thin orange rays at the board's top right, under the swath's far end.
            [38, 0.03, 0.3, [0.8, 0], 0.35], [34, 0.02, 0.22, [0.86, 0.05], 0.3], [40, 0.02, 0.18, [0.9, 0.12], 0.25],
            ...[[67, 0.07, 0.6], [61, 0.06, 0.3], [73, 0.06, 0.35], [78, 0.05, 0.35], [82, 0.04, 0.25], [60.87, 0.0042, 0.0645], [61.65, 0.0045, 0.0465],
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
        // Grade towards the concept's night: a deep saturated navy veil, an ellipse about the board (at and
        // radius in viewport fractions, stops [distance, alpha]) thin over the clouds beside the
        // board and deepening smoothly to the screen edges; glows ([x, y] and radius in viewport fractions,
        // stretched along angle into a band, alpha strength; 'screen' by default), mostly 'lit' (the
        // clouds' own luminance in the glow colour, added strength times): along the swath at
        // the top left (lighting the clouds there orange along the top edge and beside the board's upper-left edge, with an orange
        // screen fill under them), a cool light on the clouds left of the board (structure, not orange), as a
        // thin diagonal orange rim along the top edge of the lower-left cloud bank (no orange blob beside the board), and a cool blue light on the lowest clouds at the
        // bottom left, a faint orange light on one cloud at the board's top right under its rays, the sky there staying deep navy (no orange cloud
        // mid-right of the board); two 'screen' glows fill the sky between the fan and the board's left edge with
        // warm light down to its middle (the upper one lies behind the board on a desktop and fills the
        // narrower gap beside it on a phone), so no dark void sits inside the swath, and a faint warm haze
        // lies on the sky right of the board under the swath's far end; a warm multiply glow takes the
        // blue out of the lit lower-left cloud bank, so its rim reads orange; a
        // vignette that keeps the corners deep navy (multiply, darkening up to vignette from 0.55 of the half diagonal to the corners).
        navy: [4, 16, 48],
        veil: {at: [0.48, 0.6], radius: [0.6, 0.9], stops: [[0, 0.1], [0.3, 0.18], [0.5, 0.38], [0.7, 0.64], [0.85, 0.8], [1, 0.92]]},
        glows: [{at: [0.27, 0.1], radius: 0.04, stretch: 4, angle: 66, color: [230, 120, 50], mode: 'lit', strength: 0.8},
            {at: [0.22, 0.33], radius: 0.09, stretch: 2.2, angle: 25, color: [120, 140, 190], mode: 'lit', strength: 0.6},
            {at: [0.22, 0.76], radius: 0.018, stretch: 8, angle: 55, color: [255, 140, 50], mode: 'lit', strength: 0.9},
            {at: [0.3, 0.88], radius: 0.015, stretch: 6, angle: 55, color: [255, 140, 50], mode: 'lit', strength: 0.7},
            {at: [0.1, 0.93], radius: 0.11, stretch: 2.5, angle: 30, color: [80, 120, 210], mode: 'lit'},
            {at: [0.345, 0.36], radius: 0.035, stretch: 3.5, angle: 82, color: [140, 70, 28], strength: 0.7},
            {at: [0.37, 0.18], radius: 0.03, stretch: 4, angle: 80, color: [140, 70, 28], strength: 0.7},
            {at: [0.83, 0.17], radius: 0.07, stretch: 1.6, angle: 90, color: [24, 16, 0]},
            {at: [0.26, 0.84], radius: 0.04, stretch: 3, angle: 20, color: [255, 185, 130], mode: 'multiply'},
            {at: [0.26, 0.05], radius: 0.05, stretch: 3.5, angle: 20, color: [255, 140, 50], mode: 'lit'},
            {at: [0.37, 0.24], radius: 0.03, stretch: 3, angle: 70, color: [255, 140, 50], mode: 'lit', strength: 0.6},
            {at: [0.27, 0.04], radius: 0.045, stretch: 3.5, angle: 20, color: [30, 12, 0]},
            {at: [0.2, 0.95], radius: 0.06, stretch: 3, angle: 30, color: [90, 130, 220], mode: 'lit', strength: 0.6},
            {at: [0.85, 0.3], radius: 0.04, stretch: 4, angle: 50, color: [255, 140, 50], mode: 'lit', strength: 0.4}],
        vignette: 0.45
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
        const sky = this.SKY, px = window.devicePixelRatio || 1
        const random = this.random(sky.seed)
        const ox = sky.origin[0] * w, oy = sky.origin[1] * h, reach = 1.25 * Math.hypot(w, h)
        // The clouds as painted, before the grade: 'lit' glows warm their own structure.
        const clouds = sky.glows.some(glow => glow.mode === 'lit') ? document.createElement('canvas') : null
        if (clouds) {
            clouds.width = w
            clouds.height = h
            clouds.getContext('2d').drawImage(g.canvas, 0, 0)
        }
        // Veil: an ellipse about the board, thin over the clouds next to it and deep at the edges.
        g.save()
        g.translate(sky.veil.at[0] * w, sky.veil.at[1] * h)
        g.scale(sky.veil.radius[0] * w, sky.veil.radius[1] * h)
        const veil = g.createRadialGradient(0, 0, 0, 0, 0, 1)
        for (const [t, alpha] of sky.veil.stops) veil.addColorStop(t, `rgba(${sky.navy},${alpha})`)
        g.fillStyle = veil
        g.fillRect(-4, -4, 8, 8)
        g.restore()
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
        for (const [angle, half, alpha, at = sky.origin, length] of sky.beams) {
            const target = length ? ray.getContext('2d') : b
            if (length) target.clearRect(0, 0, w, h)
            target.save()
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
            if (length) b.drawImage(ray, 0, 0)
        }
        if (ray) ray.width = ray.height = 0
        b.globalCompositeOperation = 'destination-in'
        const fade = b.createRadialGradient(ox, oy, 0, ox, oy, reach)
        fade.addColorStop(0, 'rgba(0,0,0,1)')
        fade.addColorStop(0.35, 'rgba(0,0,0,0.9)')
        fade.addColorStop(1, 'rgba(0,0,0,0)')
        b.fillStyle = fade
        b.fillRect(0, 0, w, h)
        g.save()
        g.globalCompositeOperation = 'screen'
        g.drawImage(beams, 0, 0)
        beams.width = beams.height = 0
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
        // Warm glows: a near-Gaussian radial falloff (exp(-d^2/2) per third of the radius).
        // In viewport fractions, so each falls on the same part of the sky at any aspect ratio.
        for (const {at, radius, stretch, angle, color, mode, strength = 1} of sky.glows) {
            const r = 3 * radius
            const glow = g.createRadialGradient(0, 0, 0, 0, 0, r)
            for (let i = 0; i <= 6; i++)
                glow.addColorStop(i / 6, `rgba(${color},${Math.exp(-((i / 2) ** 2) / 2)})`)
            const place = target => {
                target.translate(at[0] * w, at[1] * h)
                target.scale(w, h)
                target.rotate(angle * Math.PI / 180)
                target.scale(stretch, 1)
                target.fillStyle = glow
                target.fillRect(-r, -r, 2 * r, 2 * r)
            }
            g.save()
            if (mode === 'lit') {
                // The clouds' luminance tinted by the glow colour, kept only under the glow, added:
                // bright cloud edges catch the light and the gaps between them stay dark.
                const lit = document.createElement('canvas')
                lit.width = w
                lit.height = h
                const l = lit.getContext('2d')
                l.drawImage(clouds, 0, 0)
                // Grey first (the blue clouds would multiply the warm colour to grey).
                l.globalCompositeOperation = 'saturation'
                l.fillStyle = 'rgb(128,128,128)'
                l.fillRect(0, 0, w, h)
                l.globalCompositeOperation = 'multiply'
                l.fillStyle = `rgb(${color})`
                l.fillRect(0, 0, w, h)
                l.globalCompositeOperation = 'destination-in'
                place(l)
                // Added strength times (the last time at its fraction), so dim clouds can glow.
                g.globalCompositeOperation = 'lighter'
                for (let left = strength; left > 0; left--) {
                    g.globalAlpha = Math.min(1, left)
                    g.drawImage(lit, 0, 0)
                }
                lit.width = lit.height = 0
            } else {
                g.globalCompositeOperation = mode || 'screen'
                g.globalAlpha = Math.min(1, strength)
                place(g)
            }
            g.restore()
        }
        if (clouds) clouds.width = clouds.height = 0
        // Vignette: multiply grey rising towards the corners.
        g.globalCompositeOperation = 'multiply'
        const half = Math.hypot(w, h) / 2
        const vignette = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, half)
        vignette.addColorStop(0, 'rgb(255,255,255)')
        for (let i = 0; i <= 5; i++) {
            const t = 0.55 + 0.45 * i / 5, v = Math.round(255 * (1 - sky.vignette * (i / 5) ** 2))
            vignette.addColorStop(t, `rgb(${v},${v},${v})`)
        }
        g.fillStyle = vignette
        g.fillRect(0, 0, w, h)
        g.restore()
        ++this.decorations
    },
    draw(ctx) {
        // Bind independently of the optional sprite startup counter.
        this.watch(ctx.canvas)
        // Viewport clouds and the fixed light kernel are camera-scale independent.
        // Reuse them through wheel/pinch gestures; world layers use the draw transform.
        const key = [otherSettings.atmosphericVisuals, otherSettings.usePolishedSprites,
            window.devicePixelRatio].join(':')
        if (this.key !== key || this.board !== grid) {
            this.invalidate()
            this.key = key
            this.board = grid
            if (grid) grid.surfaceCacheState = undefined
        }
        if (!otherSettings.atmosphericVisuals) return
        this.load()
        if (this.state !== 'ready') return
        const w = ctx.canvas.width, h = ctx.canvas.height
        if (!w || !h) return
        const scale = Math.max(w / this.image.naturalWidth, h / this.image.naturalHeight)
        const dw = this.image.naturalWidth * scale, dh = this.image.naturalHeight * scale
        const paint = target => target.drawImage(this.image, (w - dw) / 2, (h - dh) / 2, dw, dh)
        if (this.raster && (this.raster.width !== w || this.raster.height !== h))
            this.releaseRaster()
        if (!this.raster && w * h * 4 + this.lightBytes <= this.maxBytes) {
            const raster = document.createElement('canvas')
            try {
                raster.width = w
                raster.height = h
                paint(raster.getContext('2d'))
                this.decorate(raster.getContext('2d'), w, h)
                this.watch(raster)
                this.raster = raster
                ++this.rasterizations
            } catch (_) {
                raster.width = raster.height = 0
            }
        }
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        if (this.raster) ctx.drawImage(this.raster, 0, 0)
        else {
            // Decoded static image: no per-frame gradient or blur regeneration
            // (and no sky decoration, which is only baked into the raster).
            paint(ctx)
            ++this.fallbacks
        }
        ctx.restore()
    }
}
