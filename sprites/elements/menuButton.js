class MenuButton extends Button {
    constructor(rect, text, clickFunc, parameters, canClick = true, callThis) {
        super(rect, text, clickFunc, parameters, canClick = true, callThis)

        this.trimText()

        this.selectedRatio = 1.2
        let selectedRatio = this.selectedRatio
        let selectedCornerRadius = [this.rect.cornerRadius[0] * selectedRatio, 
            this.rect.cornerRadius[1] * selectedRatio, this.rect.cornerRadius[2] * selectedRatio,
            this.rect.cornerRadius[3] * selectedRatio]

        this.selectedRect = new Rect(this.rect.x - this.rect.width * (selectedRatio - 1) / 2, 
            this.rect.y - this.rect.height * (selectedRatio - 1) / 2, 
            this.rect.width * selectedRatio, this.rect.height * selectedRatio,
            selectedCornerRadius, this.rect.strokeWidth * selectedRatio, this.rect.color, 
            this.rect.strokeColor, this.rect.light)
        this.selectedText = new Text(this.text.pos.x, this.text.pos.y, 
            this.text.fontSize * selectedRatio, this.text.text, this.text.color,
            this.text.textAlign, this.text.textBaseline)

        this.selected = false
    }
    get x() {
        return super.x
    }
    set x(val) {
        let dt = val - super.x
        super.x = val
        this.selectedRect.x += dt
    }
    set color(val) {
        super.color = val
        this.selectedRect.color = val
    }
    get pos() {
        return this.rect.pos
    }
    set pos(pos) {
        super.pos = pos

        let selectedRatio = this.selectedRatio
        this.selectedRect.x = this.rect.x - this.rect.width * (selectedRatio - 1) / 2
        this.selectedRect.y = this.rect.y - this.rect.height * (selectedRatio - 1) / 2

        this.selectedText.pos.x = this.selectedRect.centerX
        this.selectedText.pos.y = this.selectedRect.centerY
    }
    select(pos) {
        this.selected = this.rect.isInside(pos)
    }
    removeSelect() {
        this.selected = false
    }
    draw(ctx) {
        if (this.selected) {
            this.selectedRect.draw(ctx)
            this.selectedText.draw(ctx)
        }
        else {
            super.draw(ctx)
        }
    }
}