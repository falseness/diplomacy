// Optional decoration never participates in the required sprite startup counter.
const atmosphericBackground = {
    state: 'idle', image: null, raster: null, rasterizations: 0,
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
        if (!otherSettings.atmosphericVisuals) return
        this.load()
        if (this.state !== 'ready') return
        const w = ctx.canvas.width, h = ctx.canvas.height
        if (!w || !h) return
        if (!this.raster || this.raster.width !== w || this.raster.height !== h) {
            try {
                const raster = document.createElement('canvas')
                raster.width = w
                raster.height = h
                const scale = Math.max(w / this.image.naturalWidth, h / this.image.naturalHeight)
                const dw = this.image.naturalWidth * scale, dh = this.image.naturalHeight * scale
                raster.getContext('2d').drawImage(this.image, (w - dw) / 2, (h - dh) / 2, dw, dh)
                this.raster = raster
                ++this.rasterizations
            } catch (_) {
                this.state = 'failed'
                this.raster = null
                return
            }
        }
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(this.raster, 0, 0)
        ctx.restore()
    }
}
