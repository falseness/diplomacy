class ImageButton extends Button {
    #selected = false
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true, callThis) {
        super(rect, text, clickFunc, parameters, canClick, callThis)
        this.img = image

        this.img.pos = this.rect.center
    }
    set color(color) {
        this.img.color = color
    }
    set pos(pos) {
        this.rect.pos = pos
        this.img.pos = this.rect.center
    }
    get center() {
        return this.rect.center
    }
    set center(pos) {
        this.rect.center = pos
        this.img.pos = pos
    }
    set centerX(val) {
        super.centerX = val
        this.img.x = val
    }
    set centerY(val) {
        super.centerY = val
        this.img.y = val
    }
    select(pos) {
        if (this.isInside(pos))
            this.#selected = true
    }
    removeSelect() {
        this.#selected = false
    }
    draw(ctx) {
        const selectedRatio = 1.2
        if (this.canClick) {
            if (debug)
                this.rect.draw(ctx)
            //drawImage(ctx, this.img, this.rect.getCenter(), this.rect.getWidth(), this.rect.getHeight())
            let w = this.width
            let h = this.height
            if (this.#selected) {
                this.img.width *= selectedRatio
                this.img.height *= selectedRatio
            }
            this.img.draw(ctx)

            this.img.width = w
            this.img.height = h

            this.text.draw(ctx)
        }
    }
}
class TwoPositionsImageButton extends ImageButton {
    #selected
    constructor(image, rect, secondPos, clickFunc, parameters, text = new Empty(), canClick = true, callThis) {
        super(image, rect, clickFunc, parameters, text = new Empty(), canClick = true, callThis)
        this.firstPos = rect.pos
        this.secondPos = secondPos

        this.#selected = 1
    }
    set selected(boolean) {
        this.#selected = boolean + 1

        if (this.#selected == 1) {
            this.pos = this.firstPos
        }
        else if (this.#selected == 2) {
            this.pos = this.secondPos
        }
    }
    get selected() {
        return this.#selected
    }
    switch() {
        this.selected = this.#selected % 2 + 1
    }
}