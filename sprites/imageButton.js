class ImageButton extends Button {
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true) {
        super(rect, text, clickFunc, parameters, canClick)
        this.img = image
    }
    draw() {
        if (this.canClick) {
            //this.rect.draw()
            drawImage(this.img, this.rect.getCenter(), this.rect.getWidth(), this.rect.getHeight())
            this.text.draw()
        }
    }
}
class StaticImageButton extends ImageButton {
    constructor(image, marginX, marginY, w, h, clickFunc, parameters) {
        super(image, new Rect(-canvasOffset.x + marginX, -canvasOffset.y + marginY, w, h), clickFunc, parameters)

        this.marginX = marginX
        this.marginY = marginY
    }
    updatePos() {
        this.rect.setPos({ x: -canvasOffset.x + this.marginX, y: -canvasOffset.y + this.marginY })
    }
}