class Rect {
    constructor(x, y, width, height, cornerRadius = [0, 0, 0, 0], strokeWidth = 0.001 * WIDTH,
         color = '#78a85d', strokeColor = 'black', light = false) {
        this.x = x
        this.y = y

        this.light = light

        this.width = width
        this.height = height

        this.cornerRadius = cornerRadius
            /*  
            12
            43
            */
        this.strokeWidth = strokeWidth
        this.color = color
        this.strokeColor = strokeColor
    }
    static getSelectedRect(rect, ratio = 1.2) {
        const rectCornersCount = 4
        let selectedCornerRadius = Array(rectCornersCount)
        for (let i = 0; i < rectCornersCount; ++i) {
            selectedCornerRadius[i] = rect.cornerRadius[i] * ratio
        }
        let res = new Rect(rect.x - rect.width * (ratio - 1) / 2, 
            rect.y - rect.height * (ratio - 1) / 2, 
            rect.width * ratio, rect.height * ratio,
            selectedCornerRadius, rect.strokeWidth * ratio, rect.color, 
            rect.strokeColor, rect.light)
        
        return res
    }
    set pos(pos) {
        this.x = pos.x
        this.y = pos.y
    }
    get pos() {
        return {x: this.x, y: this.y}
    }
    get centerX() {
        return this.x + this.width / 2
    }
    set centerX(x) {
        this.x = x - this.width / 2
    }
    get centerY() {
        return this.y + this.height / 2
    }
    set centerY(y) {
        this.y = y - this.height / 2
    }
    get right() {
        return this.x + this.width
    }
    get bottom() {
        return this.y + this.height
    }
    get center() {
        let center = {
            x: this.centerX,
            y: this.y + this.height / 2
        }
        return center
    }
    set center(pos) {
        this.x = pos.x - this.width / 2
        this.y = pos.y - this.height / 2
    }
    get rectPoints() {
        let points = [
            { x: this.x, y: this.y },
            { x: this.x + this.width, y: this.y },
            { x: this.x + this.width, y: this.y + this.height },
            { x: this.x, y: this.y + this.height }
        ]
        return points
    }
    // The rectPoints corners, without allocating them (bars draw many rects every frame).
    drawShape(ctx) {
        const x0 = this.x, y0 = this.y, x1 = this.x + this.width, y1 = this.y + this.height
        const c = this.cornerRadius

        ctx.moveTo(x0 + c[0], y0)
        ctx.lineTo(x1 - c[1], y0)
        ctx.arcTo(x1, y0, x1, y0 + c[1], c[1])
        ctx.lineTo(x1, y1 - c[2])
        ctx.arcTo(x1, y1, x1 - c[2], y1, c[2])
        ctx.lineTo(x0 + c[3], y1)
        ctx.arcTo(x0, y1, x0, y1 - c[3], c[3])
        ctx.lineTo(x0, y0 + c[0])
        ctx.arcTo(x0, y0, x0 + c[0], y0, c[0])
    }
    // A menu theme plaque (MENU_THEME.plain, primary or disabled) in this rect's shape: translucent fill, thin rim.
    // Corners are at most half the shorter side, so low plaques stay pills.
    drawPlaque(ctx, style, lineWidth = Math.max(1, this.strokeWidth * MENU_THEME.rimRatio)) {
        const radius = this.cornerRadius, limit = Math.min(this.width, this.height) / 2
        ctx.save()
        ctx.beginPath()
        this.cornerRadius = radius.map(r => Math.min(r, limit))
        this.drawShape(ctx)
        this.cornerRadius = radius
        ctx.closePath()
        ctx.globalAlpha = style.alpha
        ctx.fillStyle = style.fill
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = style.rim
        ctx.lineWidth = lineWidth
        if (style.dash) ctx.setLineDash([lineWidth * 3, lineWidth * 2])
        ctx.stroke()
        ctx.restore()
    }
    isInside(point) {
        return (this.x <= point.x && point.x <= this.x + this.width &&
            this.y <= point.y && point.y <= this.y + this.height)
    }
    draw(ctx) {
        ctx.beginPath()

        ctx.fillStyle = this.color
        ctx.strokeStyle = this.strokeColor
        ctx.lineWidth = this.strokeWidth

        this.drawShape(ctx)

        if (this.color)
            ctx.fill()
        if (!this.light && this.strokeWidth)
            ctx.stroke()

        ctx.closePath()

        if (this.light) {
            ctx.beginPath()

            ctx.fillStyle = 'white'
            this.drawShape(ctx)
            
            ctx.globalAlpha = this.light

            ctx.fill()

            ctx.globalAlpha = 1.0

            ctx.closePath()

            if (this.strokeWidth) {
                ctx.beginPath()
                this.drawShape(ctx)
                ctx.stroke()
                ctx.closePath()
            }
        }
    }
}
// TASK-1513: bars (HealthBar, Bar) and outlined CoordTexts drawn on the main canvas from small cached rasters ('sprites')
// instead of their paths and texts every frame: one drawImage per bar or text, where a bar drew a fill and a stroke per
// box (and a clipped heart per pending box) and an outlined text a strokeText and a fillText, each with its state set.
// A sprite is the shape's drawing (shape: what it draws, by key; anchor: the world point it is drawn at) rasterized at
// the context's scale with its anchor at a sub-pixel phase, and blitted at whole device pixels with the same phase.
// - Exact at rest: while the camera does not move (the main canvas's transform at drawMain repeats the frame before's),
//   a sprite is the shape at the anchor's exact phase, so it is the direct drawing's pixels (but for rounding of the
//   composite of its fill and stroke). While the camera moves, sprites are made at the phase rounded to 1/MOTION_STEPS
//   of a device pixel (at most 1/16 px off, frames that are replaced by the next one), so a pan reuses them.
// - Built before the next frame: a missing sprite is drawn directly this frame and queued (at most BUILDS_PER_FRAME a
//   frame); beginFrame (drawMain) draws the queue before the frame draws anything.
// - One small canvas per sprite, never drawn into again once built: recorded calls (CanvasCallRecorder: level-of-detail,
//   still and composite frames replay or compare them later) stay valid, and a frame's drawImage calls hold only the
//   sprites' own bytes (Chromium rasterizes a frame early once the images drawn into it pass ~32 MB: an atlas page
//   counted whole per draw did that every few dozen draws). At most MAX_BYTES (16 MiB) of sprites: the least recently
//   drawn are dropped first.
// - Only on the main canvas, with an axis-aligned transform, alpha 1, source-over, no shadow or filter and no line dash
//   (else the caller draws directly, as do layers, effects and every other canvas); a stroked shape's sprites are kept
//   per line join, cap and miter limit of the context.
class SpriteCache {
    static enabled = true
    static MAX_BYTES = 16 * 1024 * 1024
    static MAX_SPRITE = 256
    static BUILDS_PER_FRAME = 256
    static MOTION_STEPS = 8
    static MAX_SHAPES = 20000
    static MAX_SCALES = 8
    static MAX_EXACT_PHASES = 4096
    static PENDING = {pending: true}
    static shapes = new Map()
    static sprites = []
    static bytes = 0
    static queue = []
    static frame = 0
    static camera = null
    static moving = true
    static measure = null
    static stats = {hits: 0, built: 0, queued: 0, direct: 0, dropped: 0, evicted: 0}
    static get memoryBound() {
        return SpriteCache.MAX_BYTES
    }
    static get memoryUsed() {
        return SpriteCache.bytes
    }
    static reset() {
        for (const shape of SpriteCache.shapes.values())
            shape.dead = true
        SpriteCache.shapes.clear()
        SpriteCache.sprites.length = 0
        SpriteCache.bytes = 0
        SpriteCache.queue.length = 0
        SpriteCache.camera = null
        SpriteCache.moving = true
    }
    // drawMain, before the frame draws: whether the camera moved since the frame before, and the queued builds.
    static beginFrame(ctx) {
        ++SpriteCache.frame
        const t = ctx.getTransform(), c = SpriteCache.camera
        SpriteCache.moving = !c || c.a !== t.a || c.d !== t.d || c.e !== t.e || c.f !== t.f || c.b !== t.b || c.c !== t.c
        SpriteCache.camera = {a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f}
        const queue = SpriteCache.queue
        if (!queue.length)
            return
        SpriteCache.queue = []
        for (const job of queue)
            SpriteCache.build(job)
    }
    // The shape of key: {key, bounds (world units around the anchor: x0, y0, x1, y1), stroke, text, scales}; halfStroke:
    // half the width of a stroke the bounds leave out (a text's outline), whose miter joins reach further.
    static shape(key, bounds, stroke, text, halfStroke = 0) {
        let shape = SpriteCache.shapes.get(key)
        if (shape)
            return shape
        const b = bounds()
        // Not laid out yet (a bar before its position is set): no shape, drawn directly.
        if (!(Number.isFinite(b.x0) && Number.isFinite(b.y0) && Number.isFinite(b.x1) && Number.isFinite(b.y1) &&
                Number.isFinite(halfStroke)))
            return null
        if (SpriteCache.shapes.size >= SpriteCache.MAX_SHAPES)
            SpriteCache.reset()
        shape = {key, bounds: b, stroke, text, halfStroke, scales: new Map()}
        SpriteCache.shapes.set(key, shape)
        return shape
    }
    // Draws owner's shape with its anchor at world (x, y) on ctx from a sprite; false: the caller draws it directly
    // (and a sprite for it is queued when it can be made). owner.paintSprite(g) draws it on g; owner.spriteShape()
    // and owner.spriteAnchor() are read again when the queued sprite is built.
    static draw(ctx, shape, x, y, owner) {
        if (!SpriteCache.enabled || typeof mainCanvas === 'undefined' || ctx.canvas !== mainCanvas || !shape || shape.dead)
            return false
        if (ctx.globalAlpha !== 1 || ctx.globalCompositeOperation !== 'source-over' || ctx.filter !== 'none' ||
                ctx.shadowBlur !== 0 || ctx.shadowOffsetX !== 0 || ctx.shadowOffsetY !== 0)
            return false
        // A stroke's joins and caps are the context's (Rect.draw strokes its box before closing it): part of the key.
        let lines = ''
        if (shape.stroke) {
            if (ctx.getLineDash().length !== 0)
                return false
            lines = ctx.lineJoin + '|' + ctx.lineCap + '|' + ctx.miterLimit
        }
        if (shape.text && (ctx.letterSpacing !== undefined && ctx.letterSpacing !== '0px' ||
                ctx.wordSpacing !== undefined && ctx.wordSpacing !== '0px'))
            return false
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || !(t.a > 0) || !(t.d > 0))
            return false
        let scales = shape.scales.get(lines)
        if (!scales)
            shape.scales.set(lines, scales = new Map())
        let scale = scales.get(t.a)
        if (!scale) {
            // A zoom draws at many scales on its way: the sprites of a shape are kept for its last few.
            if (scales.size >= SpriteCache.MAX_SCALES)
                scales.clear()
            const b = shape.bounds, pad = shape.halfStroke * (ctx.lineJoin === 'miter' ? Math.max(1, ctx.miterLimit) : 1)
            const ox = Math.ceil(-t.a * (b.x0 - pad)) + 2, oy = Math.ceil(-t.d * (b.y0 - pad)) + 2
            const w = ox + Math.ceil(t.a * (b.x1 + pad)) + 3, h = oy + Math.ceil(t.d * (b.y1 + pad)) + 3
            scale = {d: t.d, ox, oy, w, h, fits: w > 0 && h > 0 && w <= SpriteCache.MAX_SPRITE && h <= SpriteCache.MAX_SPRITE,
                exact: new Map(), motion: new Map()}
            scales.set(t.a, scale)
        }
        if (scale.d !== t.d || !scale.fits)
            return false
        const X = t.a * x + t.e, Y = t.d * y + t.f
        let ix = Math.floor(X), iy = Math.floor(Y), px = X - ix, py = Y - iy
        if (!(Number.isFinite(px) && Number.isFinite(py)))
            return false
        let map, key, sprite
        if (SpriteCache.moving) {
            const n = SpriteCache.MOTION_STEPS
            let bx = Math.round(px * n), by = Math.round(py * n)
            if (bx === n) { bx = 0; ++ix }
            if (by === n) { by = 0; ++iy }
            px = bx / n
            py = by / n
            map = scale.motion
            key = bx * (n + 1) + by
            sprite = map.get(key)
        }
        else {
            map = scale.exact.get(px)
            key = py
            sprite = map && map.get(key)
        }
        if (sprite && sprite !== SpriteCache.PENDING) {
            sprite.used = SpriteCache.frame
            ++SpriteCache.stats.hits
            ctx.drawImage(sprite.canvas, (ix - scale.ox - t.e) / t.a, (iy - scale.oy - t.f) / t.d, scale.w / t.a, scale.h / t.d)
            return true
        }
        ++SpriteCache.stats.direct
        if (!sprite && SpriteCache.queue.length < SpriteCache.BUILDS_PER_FRAME && typeof document !== 'undefined' &&
                scale.w * scale.h * 4 <= SpriteCache.MAX_BYTES / 64) {
            if (!map) {
                // A shape drawn at ever new phases (a moving unit under a still camera): its exact sprites start over.
                if (scale.exact.size >= SpriteCache.MAX_EXACT_PHASES)
                    scale.exact.clear()
                scale.exact.set(px, map = new Map())
            }
            map.set(key, SpriteCache.PENDING)
            // An owner whose drawn state is reset after drawing (a cell's info text) queues a copy (spriteCopy).
            SpriteCache.queue.push({shape, scale, map, key, px, py, a: t.a, d: t.d, owner: owner.spriteCopy ? owner.spriteCopy() : owner,
                lineJoin: ctx.lineJoin, lineCap: ctx.lineCap, miterLimit: ctx.miterLimit})
            ++SpriteCache.stats.queued
        }
        return false
    }
    // Draws a queued sprite into the atlas (beginFrame), if its owner still draws the shape.
    static build(job) {
        const {shape, scale, map, key, owner} = job
        if (map.get(key) !== SpriteCache.PENDING)
            return
        if (shape.dead || owner.spriteShape() !== shape) {
            map.delete(key)
            ++SpriteCache.stats.dropped
            return
        }
        const bytes = scale.w * scale.h * 4
        SpriteCache.makeRoom(bytes)
        const canvas = document.createElement('canvas')
        canvas.width = scale.w
        canvas.height = scale.h
        const g = canvas.getContext('2d'), anchor = owner.spriteAnchor()
        g.lineJoin = job.lineJoin
        g.lineCap = job.lineCap
        g.miterLimit = job.miterLimit
        g.setTransform(job.a, 0, 0, job.d, scale.ox + job.px - job.a * anchor.x, scale.oy + job.py - job.d * anchor.y)
        owner.paintSprite(g)
        const sprite = {canvas, bytes, used: SpriteCache.frame, map, key}
        map.set(key, sprite)
        SpriteCache.sprites.push(sprite)
        SpriteCache.bytes += bytes
        ++SpriteCache.stats.built
    }
    // Drops the least recently drawn sprites (a quarter of the bound's worth) when bytes more would exceed MAX_BYTES.
    static makeRoom(bytes) {
        if (SpriteCache.bytes + bytes <= SpriteCache.MAX_BYTES)
            return
        const sprites = SpriteCache.sprites.sort((p, q) => p.used - q.used)
        let k = 0, freed = 0
        while (k < sprites.length && (SpriteCache.bytes - freed + bytes > SpriteCache.MAX_BYTES * 0.75)) {
            const sprite = sprites[k++]
            freed += sprite.bytes
            if (sprite.map.get(sprite.key) === sprite)
                sprite.map.delete(sprite.key)
        }
        sprites.splice(0, k)
        SpriteCache.bytes -= freed
        SpriteCache.stats.evicted += k
    }
    // A context to measure texts with (CoordText bounds).
    static measureContext() {
        if (!SpriteCache.measure)
            SpriteCache.measure = document.createElement('canvas').getContext('2d')
        return SpriteCache.measure
    }
}
