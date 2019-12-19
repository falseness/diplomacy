class Button {
    constructor(rect, text, clickFunc, parameters, canClick = true, callThis) {
        this.rect = rect
        this.text = text

        this.canClick = canClick
        this.clickFunc = clickFunc

        this.parameters = parameters
        
        this.callThis = callThis
        
        this.text.textAlign = 'center'
    }
    trimText() {
        this.text.pos = this.rect.center
    }
    get pos() {
        return this.rect.pos
    }
    get x() {
        return this.rect.x
    }
    set x(val) {
        this.rect.x = val
        this.trimText()
    }
    set color(val) {
        this.rect.color = val
    }
    get y() {
        return this.rect.y
    }
    get bottom() {
        return this.rect.bottom
    }
    get centerX() {
        return this.rect.centerX
    }
    set centerX(val) {
        this.rect.centerX = val
        this.trimText()
    }
    get centerY() {
        return this.rect.centerY
    }
    set centerY(val) {
        this.rect.centerY = val
        this.trimText()
    }
    get width() {
        return this.rect.width
    }
    get height() {
        return this.rect.height
    }
    set pos(pos) {
        this.rect.pos = pos
        this.trimText()
    }
    get textString() {
        return this.text.text
    }
    get height() {
        return this.rect.height
    }
    set textString(text) {
        this.text.text = text
    }
    set textColor(color) {
        this.text.color = color
    }
    get textColor() {
        return this.text.color
    }
    touchmove(pos) {

    }
    enableClick() {
        this.canClick = true
    }
    disableClick() {
        this.canClick = false
    }
    isInside(point) {
        return this.rect.isInside(point)
    }
    setFunction(func) {
        this.clickFunc = func
    }
    click(pos) {
        if (this.canClick && this.isInside(pos)) {
            if (this.callThis) {
                this.clickFunc.call(this.callThis, this.parameters)
            }
            else {
                this.clickFunc(this.parameters)
            }
            return true
        }
        return false
    }
    draw(ctx) {
        if (this.canClick) {
            this.rect.draw(ctx)
            this.text.draw(ctx)
        }
    }
}