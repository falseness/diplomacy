class ImageButton extends Button
{
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true)
    {
        super(rect, text, clickFunc, parameters, canClick)
        this.img = image
    }
    draw()
    {
        if (this.canClick)
        {
            //this.rect.draw()
            drawImage(this.img, this.rect.getCenter(), this.rect.getWidth(), this.rect.getHeight())
            this.text.draw()
        }
    }
}