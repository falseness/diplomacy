class ImageWithLabel {
    #pos
    constructor(image, text, pos = {x: NaN, y: NaN}) {
        text.textAlign = 'left'

        this.image = image
        this.text = text

        this.pos = pos
    }
    get width() {
        return this.image.width + this.text.width
    }
    get textString() {
        return this.text.text
    }
    set textString(str) {
        this.text.text = str
    }
    set pos(pos) {
        this.#pos = pos

        let w = this.width

        this.image.left = pos.x - w / 2
        this.image.pos.y = pos.y

        this.text.pos.x = pos.x
        this.text.pos.y = pos.y
    }
    trim() {
        this.pos = this.#pos
    }
    draw(ctx) {
        this.image.draw(ctx)
        this.text.draw(ctx)
    }
}