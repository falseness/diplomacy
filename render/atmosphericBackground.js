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
        // Narrow orange beams fan out from a point above the upper left of the viewport towards
        // the board (in fractions of w, h: origin, angle and half width), [angle, half width, alpha].
        origin: [0.05, -0.3],
        beams: [[44, 0.025, 0.25], [51, 0.02, 0.3], [57, 0.03, 0.22], [62, 0.02, 0.26]],
        beamColor: '255,150,70',
        stars: 130,
        embers: 60,
        // Grade towards the concept's night: the clouds sink under a deep navy veil (alphas evenly
        // spaced from the top to the bottom of the viewport, so the lower cloud bank keeps more of
        // its light); warm glows where the key light breaks in at the upper left and catches the
        // lower cloud bank ('screen'; [x, y] and radius in viewport fractions, stretched along
        // angle into a band); a gentle vignette (multiply, darkening up to vignette from 0.55 of
        // the half diagonal to the corners).
        navy: [10, 22, 46],
        veil: [0.9, 0.85, 0.6, 0.3],
        glows: [{at: [0.3, 0.06], radius: 0.07, stretch: 2.5, angle: 70, color: [180, 90, 32]},
            {at: [0.18, 0.8], radius: 0.08, stretch: 2.5, angle: -15, color: [38, 26, 18]}],
        vignette: 0.3
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
    decorate(g, w, h) {
        const sky = this.SKY, px = window.devicePixelRatio || 1
        const random = this.random(sky.seed)
        const ox = sky.origin[0] * w, oy = sky.origin[1] * h, reach = 1.25 * Math.hypot(w, h)
        g.save()
        const veil = g.createLinearGradient(0, 0, 0, h)
        sky.veil.forEach((alpha, i) => veil.addColorStop(i / (sky.veil.length - 1), `rgba(${sky.navy},${alpha})`))
        g.fillStyle = veil
        g.fillRect(0, 0, w, h)
        g.restore()
        // Beams: bands across their width, faded with the distance from the origin.
        const beams = document.createElement('canvas')
        beams.width = w
        beams.height = h
        const b = beams.getContext('2d')
        b.globalCompositeOperation = 'lighter'
        // In viewport fractions (angle and width too), like the glows.
        for (const [angle, half, alpha] of sky.beams) {
            b.save()
            b.translate(ox, oy)
            b.scale(w, h)
            b.rotate(angle * Math.PI / 180)
            const band = b.createLinearGradient(0, -half, 0, half)
            band.addColorStop(0, `rgba(${sky.beamColor},0)`)
            band.addColorStop(0.5, `rgba(${sky.beamColor},${alpha})`)
            band.addColorStop(1, `rgba(${sky.beamColor},0)`)
            b.fillStyle = band
            b.fillRect(0, -half, 3, 2 * half)
            b.restore()
        }
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
        for (let i = 0; i < sky.embers; i++) {
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
        for (const {at, radius, stretch, angle, color} of sky.glows) {
            const r = 3 * radius
            const glow = g.createRadialGradient(0, 0, 0, 0, 0, r)
            for (let i = 0; i <= 6; i++)
                glow.addColorStop(i / 6, `rgba(${color},${Math.exp(-((i / 2) ** 2) / 2)})`)
            g.save()
            g.translate(at[0] * w, at[1] * h)
            g.scale(w, h)
            g.rotate(angle * Math.PI / 180)
            g.scale(stretch, 1)
            g.fillStyle = glow
            g.fillRect(-r, -r, 2 * r, 2 * r)
            g.restore()
        }
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
