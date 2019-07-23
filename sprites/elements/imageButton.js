class ImageButton extends Button {
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true) {
        super(rect, text, clickFunc, parameters, canClick)
        this.img = image

        this.img.setPos(this.rect.getCenter())
    }
    setColor(color) {
        this.img.setColor(color)
    }
    draw(ctx) {
        if (this.canClick) {
            if (debug)
                this.rect.draw(ctx)
            //drawImage(ctx, this.img, this.rect.getCenter(), this.rect.getWidth(), this.rect.getHeight())
            this.img.draw(ctx)
            this.text.draw(ctx)
        }
    }
}