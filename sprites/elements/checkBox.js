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
    click(pos) {
        if (this.isInside(pos)) {
            this.mark = !this.mark
            return true
        }
        return false
    }
    draw(ctx) {
        if (this.selected)
            this.selectedRect.draw(ctx)
        else
            super.draw(ctx)
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
        if (this.mark) {
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