class Text extends Sprite
{
    constructor(x, y)
    {
        super (x, y)
    }
    createObject(text, fontSize, fontFamily, color)
    {
        text = text || (this.coord.x + ' ' + this.coord.y)
        fontSize = fontSize || Math.floor(basis.r * 0.5)
        fontFamily = fontFamily || 'Times New Roman'
        color = color || 'white'
        
        let pos = this.getPos()
        this.object = new Konva.Text({
            x: pos.x,
            y: pos.y,
            text: text,
            fontSize: fontSize,
            fontFamily: fontFamily,
            fill: color
        })
        this.object.setOffset(
        {
            x: this.object.getWidth() / 2,
            y: this.object.getHeight() / 2
        })
        return this.object
    }
}