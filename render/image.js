function drawImage(ctx, img, pos, w = assets.size, h = assets.size) {
    ctx.drawImage(assets[img], pos.x - w / 2, pos.y - h / 2, w, h)
}

function drawImageWithOpacity(ctx, img, pos, opactity, w = assets.size, h = assets.size) {
    ctx.globalAlpha = opactity
    drawImage(ctx, img, pos, w, h)
    ctx.globalAlpha = 1.0
}
class JustImage {
    constructor(img, pos, w, h) {
        this.img = img
        this.pos = pos

        this.w = w
        this.h = h
    }
    setPos(pos) {
        this.pos.x = pos.x
        this.pos.y = pos.y
    }
    setImage(image) {
        this.img = image
    }
    getWidth() {
        return this.w
    }
    getHeight() {
        return this.h
    }
    draw(ctx) {
        if (!this.img)
            return

        drawImage(ctx, this.img, this.pos, this.w, this.h)
    }
    getX() {
        return this.pos.x
    }
    getY() {
        return this.pos.y
    }
}
class ShapeImage {
    constructor(pos, color, strokeColor, strokeWidth) {
        this.pos = pos

        this.color = color
        this.strokeColor = strokeColor
        this.strokeWidth = strokeWidth
    }
    setPos(pos) {
        this.pos = pos
    }
    setColor(color) {
        this.color = color
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
        ctx.fill()
    }
}
class SuburbImage extends ShapeImage {
    constructor(pos, r, strokeWidth = 0, strokeColor = 'black') {
        const suburbAlpha = 0.4
        const maxRGBInt = 255
        let color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${suburbAlpha})`

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
    constructor(pos, color, side, strokeColor, strokeWidth) {
        super(pos, color, strokeColor, strokeWidth)
            // pos is center of triangle
        this.side = side
    }
    drawShape(ctx) {
        ctx.lineJoin = 'round'

        let pos = { x: this.pos.x, y: this.pos.y }
        let side = this.side
        ctx.moveTo(pos.x - side * Math.sin(Math.PI / 3) * (1 / 3), pos.y - side / 2)
        ctx.lineTo(pos.x + side * Math.sin(Math.PI / 3) * (2 / 3), pos.y)
        ctx.lineTo(pos.x - side * Math.sin(Math.PI / 3) * (1 / 3), pos.y + side / 2)
        ctx.lineTo(pos.x - side * Math.sin(Math.PI / 3) * (1 / 3), pos.y - side / 2)
    }
    draw(ctx) {
        super.draw(ctx)

        let oldColor = this.color
        let oldStrokeWidth = this.strokeWidth

        const suburbAlpha = 0.4
        const maxRGBInt = 255
        this.color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${suburbAlpha})`
        this.strokeWidth = 0

        super.draw(ctx)

        this.color = oldColor
        this.strokeWidth = oldStrokeWidth
    }
}