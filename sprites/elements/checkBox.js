class CheckBox extends Rect {
    constructor(text, marginLeft, x, y, width, height, cornerRadius, strokeWidth,
        color, strokeColor, light = false) {
        super(x, y - height / 2, width, height, cornerRadius, strokeWidth,
            color, strokeColor, light)
        
        this.mark = false
        this.marginLeft = marginLeft
        this.text = text
        this.trimText()
        
        this.selected = false
        this.selectedRect = Rect.getSelectedRect(this)
    }
    select(pos) {
        this.selected = this.isInside(pos)
    }
    removeSelect() {
        this.selected = false
    }
    toCenterX() {
        let w = this.text.width + this.marginLeft + this.w
        let posX = (WIDTH - w) / 2
        posX += this.text.width + this.marginLeft
        this.x = posX
        this.trimText()
    }
    trimText() {
        this.text.textAlign = 'right'
        this.text.x = this.x - this.marginLeft
        this.text.y = this.centerY
    }
    touchmove(pos) {

    }
    click(pos) {
        if (this.isInside(pos)) {
            this.mark = !this.mark
            return true
        }
        return false
    }
    // The check mark of assets/checkMark.svg (512 x 512) as a path, size wide around the centre.
    static CHECK_MARK = [[459.371, 60.6995], [242.084, 501.068], [55.304, 236.043], [120.696, 189.957],
        [229.916, 344.932], [387.629, 25.3005]]
    static drawMark(ctx, center, size, color) {
        const scale = size / 512
        ctx.save()
        ctx.fillStyle = color
        ctx.beginPath()
        for (const [x, y] of CheckBox.CHECK_MARK)
            ctx.lineTo(center.x + (x - 256) * scale, center.y + (y - 256) * scale)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
    }
    get box() {
        return this.selected ? this.selectedRect : this
    }
    draw(ctx) {
        if (Text.menuTheme)
            this.box.drawPlaque(ctx, Text.menuTheme.plain)
        else
            Rect.prototype.draw.call(this.box, ctx)
        this.text.draw(ctx)
    }
}
class ImageCheckBox extends CheckBox {
    constructor(image, text, marginLeft, x, y, width, height, cornerRadius, strokeWidth,
        color, strokeColor, light) {
            super(text, marginLeft, x, y, width, height, cornerRadius, strokeWidth,
                color, strokeColor, light)
            this.image = image
    }
    draw(ctx) {
        super.draw(ctx)
        if (this.mark && Text.menuTheme) {
            const box = this.box
            CheckBox.drawMark(ctx, box.center, box.width * 0.72, Text.menuTheme.text)
        }
        else if (this.mark) {
            const ratio = 1
            let w = this.width
            let h = this.height
            if (this.selected) {
                w = this.selectedRect.width
                h = this.selectedRect.height
            }
            drawImage(ctx, this.image, this.center, 
                w * ratio, h * ratio)
        }
    }
}