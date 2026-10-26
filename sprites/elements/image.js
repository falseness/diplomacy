class JustImage {
    constructor(image, pos, w, h) {
        this.image = image
        this.pos = pos

        this.w = w
        this.h = h
    }
    get left() {
        return this.pos.x - this.w / 2
    }
    set left(num) {
        this.pos.x = num + this.w / 2
    }
    get width() {
        return this.w
    }
    get height() {
        return this.h
    }
    set width(val) {
        this.w = val
    }
    set height(val) {
        this.h = val
    }
    get right() {
        return this.w + this.pos.x
    }
    draw(ctx) {
        if (!this.image)
            return

        drawImage(ctx, this.image, this.pos, this.w, this.h)
    }
    get x() {
        return this.pos.x
    }
    get y() {
        return this.pos.y
    }
    set x(val) {
        this.pos.x = val
    }
    set y(val) {
        this.pos.y = val
    }
}
class ShapeImage {
    constructor(pos, color, strokeColor, strokeWidth) {
        this.pos = pos

        this.color = color
        this.strokeColor = strokeColor
        this.strokeWidth = strokeWidth
    }
    notEmpty() {
        return true
    }
    isEmpty() {
        return false
    }
    drawShape() {
        console.log('trying to draw shapeImage, error')
    }
    draw(ctx) {
        ctx.beginPath()

        ctx.fillStyle = this.color
        ctx.strokeStyle = this.strokeColor
        ctx.lineWidth = this.strokeWidth

        this.drawShape(ctx)

        ctx.closePath()
        if (this.strokeWidth)
            ctx.stroke()
        if (this.color)
            ctx.fill()
    }
}
class SuburbImage extends ShapeImage {
    constructor(pos, r, strokeWidth = 0, strokeColor = 'black') {
        //const suburbAlpha = 0.4
        const maxRGBInt = 255
        //let color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${suburbAlpha})`
        let color = false
        super(pos, color, strokeColor, strokeWidth)
        this.r = r
    }
    drawShape(ctx) {
        ctx.moveTo(this.pos.x + this.r * Math.cos(0), this.pos.y + this.r * Math.sin(0))
        for (let i = 0; i < 7; ++i)
            ctx.lineTo(this.pos.x + this.r * Math.cos(i * 2 * Math.PI / 6), this.pos.y + this.r * Math.sin(i * 2 * Math.PI / 6))
    }
}
class TriangleImage extends ShapeImage {
    constructor(pos, color, side, strokeColor, strokeWidth, colorAlpha) {
        super(pos, color, strokeColor, strokeWidth)
            // pos is center of triangle
        this.side = side
        this.colorAlpha = colorAlpha
    }
    drawShape(ctx) {
        ctx.lineJoin = 'round'

        let pos = { x: this.pos.x, y: this.pos.y }
        let side = this.side
            /*ctx.moveTo(pos.x - side * Math.sin(Math.PI / 3) * (1 / 3), pos.y - side / 2)
            ctx.lineTo(pos.x + side * Math.sin(Math.PI / 3) * (2 / 3), pos.y)
            ctx.lineTo(pos.x - side * Math.sin(Math.PI / 3) * (1 / 3), pos.y + side / 2)
            ctx.lineTo(pos.x - side * Math.sin(Math.PI / 3) * (1 / 3), pos.y - side / 2)*/
        ctx.moveTo(pos.x - side / 2, pos.y - side / 2)
        ctx.lineTo(pos.x + side / 2, pos.y)
        ctx.lineTo(pos.x - side / 2, pos.y + side / 2)
        ctx.lineTo(pos.x - side / 2, pos.y - side / 2)
    }
    draw(ctx) {
        super.draw(ctx)

        let oldColor = this.color
        let oldStrokeWidth = this.strokeWidth

        const maxRGBInt = 255
        this.color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${this.colorAlpha})`
        this.strokeWidth = 0

        super.draw(ctx)

        this.color = oldColor
        this.strokeWidth = oldStrokeWidth
    }
}
class MenuIconImage {
    constructor(pos, color, side, strokeColor, cornerRadius, strokeWidth) {
        let corner = [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
        let w = side
        let h = side * 0.15
        this.rectOne = new Rect(pos.x, pos.y, w, h, corner, strokeWidth, color, strokeColor)
        this.rectTwo = new Rect(pos.x, pos.y + 2 * h, w, h, corner, strokeWidth, color, strokeColor)
        this.rectThree = new Rect(pos.x, pos.y + 4 * h, w, h, corner, strokeWidth, color, strokeColor)
        this.side = side
    }
    set pos(oldPos) {
        let w = this.side
        let h = this.side * 0.15
        let pos = {
            x: oldPos.x - 0.5 * w,
            y: oldPos.y - 2.5 * h
        }
        
        this.rectOne.pos = pos
        pos.y += 2 * h
        this.rectTwo.pos = pos
        pos.y += 2 * h
        this.rectThree.pos = pos
    }
    set color(color) {
        this.rectOne.setColor(color)
        this.rectTwo.setColor(color)
        this.rectThree.setColor(color)
    }
    set strokeWidth(strokeWidth) {
        this.rectOne.setStrokeWidth(strokeWidth)
        this.rectTwo.setStrokeWidth(strokeWidth)
        this.rectThree.setStrokeWidth(strokeWidth)
    }
    draw(ctx) {
        this.rectOne.draw(ctx)
        this.rectTwo.draw(ctx)
        this.rectThree.draw(ctx)
    }
}// A parchment square for the HUD buttons (menu, statistics, undo): straight, flush sides on the screen edges it
// touches, torn inner sides, a dark-brown ink glyph. side: -1/1 per axis for the edge it touches (x: left/right,
// y: top/bottom). Rendered once per size into an offscreen canvas; a frame only drawImages it.
class ParchmentIconImage {
    static #cache = new Map()
    static renders = 0
    constructor(glyph, pos, size, edgeX, edgeY) {
        this.glyph = glyph
        this.pos = pos
        this.size = size
        this.w = size
        this.h = size
        this.edgeX = edgeX
        this.edgeY = edgeY
    }
    get width() {
        return this.w
    }
    get height() {
        return this.h
    }
    set width(val) {
        this.w = val
    }
    set height(val) {
        this.h = val
    }
    get x() {
        return this.pos.x
    }
    get y() {
        return this.pos.y
    }
    set x(val) {
        this.pos.x = val
    }
    set y(val) {
        this.pos.y = val
    }
    // Room around the square for the drop shadow.
    static margin(size) {
        return Math.ceil(size * 0.4)
    }
    get canvas() {
        const key = [this.glyph, this.size, this.edgeX, this.edgeY].join()
        let canvas = ParchmentIconImage.#cache.get(key)
        if (!canvas) {
            ParchmentIconImage.renders++
            const margin = ParchmentIconImage.margin(this.size)
            canvas = document.createElement('canvas')
            canvas.width = canvas.height = Math.ceil(this.size) + 2 * margin
            const ctx = canvas.getContext('2d')
            ParchmentIconImage.parchment(ctx, margin, margin, this.size, this.edgeX, this.edgeY)
            ParchmentIconImage[this.glyph](ctx, margin + this.size / 2, margin + this.size / 2, this.size * 0.95,
                '#4a2e14', this.size * 0.085)
            ParchmentIconImage.#cache.set(key, canvas)
        }
        return canvas
    }
    draw(ctx) {
        const scale = this.w / this.size
        const margin = ParchmentIconImage.margin(this.size) * scale
        const side = this.canvas.width * scale
        ctx.drawImage(this.canvas, this.pos.x - this.w / 2 - margin, this.pos.y - this.h / 2 - margin, side, side)
    }
    // The outline: sides on the touched screen edges straight, the others torn.
    static path(ctx, x, y, k, edgeX, edgeY) {
        const j = k * 0.05, n = 7, top = edgeY < 0, left = edgeX < 0
        const torn = i => i % 2 ? j : -j * 0.3
        const points = []
        for (let i = 0; i <= n; i++)
            points.push([x + k * i / n, y + (top ? 0 : torn(i))])
        for (let i = 1; i <= n; i++)
            points.push([x + k + (left ? -torn(i) : 0), y + k * i / n])
        for (let i = 1; i <= n; i++)
            points.push([x + k - k * i / n, y + k + (top ? -torn(i) : 0)])
        for (let i = 1; i < n; i++)
            points.push([x + (left ? 0 : torn(i)), y + k - k * i / n])
        ctx.beginPath()
        points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))
        ctx.closePath()
    }
    static parchment(ctx, x, y, k, edgeX, edgeY) {
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = k * 0.2
        ParchmentIconImage.path(ctx, x, y, k, edgeX, edgeY)
        const gradient = ctx.createRadialGradient(x + k / 2, y + k / 2, k * 0.1, x + k / 2, y + k / 2, k * 0.8)
        gradient.addColorStop(0, '#f4e6c4')
        gradient.addColorStop(1, '#cfae78')
        ctx.fillStyle = gradient
        ctx.fill()
        ctx.restore()
        ctx.save()
        ParchmentIconImage.path(ctx, x, y, k, edgeX, edgeY)
        ctx.strokeStyle = 'rgba(110,70,30,0.6)'
        ctx.lineWidth = k * 0.025
        ctx.stroke()
        ctx.restore()
    }
    // Glyphs in a box of size k centred at (cx, cy).
    static undo(ctx, cx, cy, k, color, lineWidth) {
        ctx.save()
        ctx.strokeStyle = ctx.fillStyle = color
        ctx.lineWidth = lineWidth
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(cx, cy + 0.05 * k, 0.26 * k, Math.PI * 1.05, Math.PI * 0.35, false)
        ctx.stroke()
        const ax = cx - 0.26 * k, ay = cy
        ctx.beginPath()
        ctx.moveTo(ax - 0.13 * k, ay - 0.02 * k)
        ctx.lineTo(ax + 0.12 * k, ay - 0.04 * k)
        ctx.lineTo(ax - 0.02 * k, ay + 0.17 * k)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
    }
    static menu(ctx, cx, cy, k, color, lineWidth) {
        ctx.save()
        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth
        ctx.lineCap = 'round'
        for (const d of [-0.2, 0, 0.2]) {
            ctx.beginPath()
            ctx.moveTo(cx - 0.25 * k, cy + d * k)
            ctx.lineTo(cx + 0.25 * k, cy + d * k)
            ctx.stroke()
        }
        ctx.restore()
    }
    static statistics(ctx, cx, cy, k, color, lineWidth) {
        ctx.save()
        ctx.fillStyle = ctx.strokeStyle = color
        const barWidth = 0.13 * k, base = cy + 0.27 * k, r = barWidth * 0.25
        ;[0.25, 0.45, 0.33].forEach((h, i) => {
            const x = cx - 0.25 * k + i * 0.19 * k, height = h * k * 1.2, y = base - height
            ctx.beginPath()
            ctx.moveTo(x + r, y)
            ctx.arcTo(x + barWidth, y, x + barWidth, base, r)
            ctx.arcTo(x + barWidth, base, x, base, r)
            ctx.arcTo(x, base, x, y, r)
            ctx.arcTo(x, y, x + barWidth, y, r)
            ctx.closePath()
            ctx.fill()
        })
        ctx.lineWidth = lineWidth * 0.6
        ctx.beginPath()
        ctx.moveTo(cx - 0.32 * k, base + 0.04 * k)
        ctx.lineTo(cx + 0.32 * k, base + 0.04 * k)
        ctx.stroke()
        ctx.restore()
    }
}
