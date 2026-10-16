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
        // Beams fan out from a point above-left of the viewport (fractions of w, h).
        origin: [-0.16, -0.26],
        beams: [[38, 0.07, 0.2], [47, 0.05, 0.26], [55, 0.08, 0.2], [63, 0.045, 0.24], [71, 0.07, 0.16]],
        beamColor: '255,172,92',
        stars: 130,
        embers: 60
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
        // Beams: bands across their width, faded with the distance from the origin.
        const beams = document.createElement('canvas')
        beams.width = w
        beams.height = h
        const b = beams.getContext('2d')
        b.globalCompositeOperation = 'lighter'
        for (const [angle, width, alpha] of sky.beams) {
            const half = width * Math.max(w, h)
            b.save()
            b.translate(ox, oy)
            b.rotate(angle * Math.PI / 180)
            const band = b.createLinearGradient(0, -half, 0, half)
            band.addColorStop(0, `rgba(${sky.beamColor},0)`)
            band.addColorStop(0.5, `rgba(${sky.beamColor},${alpha})`)
            band.addColorStop(1, `rgba(${sky.beamColor},0)`)
            b.fillStyle = band
            b.fillRect(0, -half, reach, 2 * half)
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
