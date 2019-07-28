class ImageButton extends Button {
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true, callThis) {
        super(rect, text, clickFunc, parameters, canClick, callThis)
        this.img = image

        this.img.pos = this.rect.center
    }
    setColor(color) {
        this.img.color = color
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