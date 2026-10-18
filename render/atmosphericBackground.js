// Optional decoration never participates in the required sprite startup counter.
const atmosphericBackground = {
    state: 'idle', image: null, raster: null, rasterizations: 0,
    // Only the viewport raster and the two 128x128 spill textures are additional
    // atmospheric backing stores. Terrain, buildings and spill share the
    // pre-existing grid/sprite caches.
    maxBytes: 33554432, lightBytes: 2 * 128 * 128 * 4, fallbacks: 0,
    releaseRaster() {
        if (this.raster) this.raster.width = this.raster.height = 0
        this.raster = null
    },
    invalidate() {
        this.releaseRaster()
        for (const texture of Object.values(atmosphericLighting.textures))
            texture.width = texture.height = 0
        atmosphericLighting.textures = {}
    },
    bytes() {
        const bytes = c => c ? c.width * c.height * 4 : 0
        return Object.values(atmosphericLighting.textures).reduce(
            (sum, texture) => sum + bytes(texture), bytes(this.raster))
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
            // Decoded static image: no per-frame gradient or blur regeneration.
            paint(ctx)
            ++this.fallbacks
        }
        ctx.restore()
    }
}
