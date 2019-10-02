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
    constructor(pos, color, side, strokeColor, strokeWidth) {
        super(pos, color, strokeColor, strokeWidth)
            // pos is center of triangle
        this.side = side
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

        const suburbAlpha = 0.4
        const maxRGBInt = 255
        this.color = `rgba(${maxRGBInt}, ${maxRGBInt}, ${maxRGBInt}, ${suburbAlpha})`
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
}