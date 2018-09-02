class Text
{
    constructor(x, y, offset)
    {
        this.offset = offset || {x: 0.5, y: 0.5}
        this.pos = 
        {
            x: x, 
            y: y
        }
    }
    createObject(text, fontSize, color, fontFamily)
    {
        text = (text === '')?'':(text || ('error'))
        fontSize = fontSize || Math.floor(basis.r * 0.5)
        fontFamily = fontFamily || 'Times New Roman'
        color = color || 'white'
        
        this.object = new Konva.Text({
            x: this.pos.x,
            y: this.pos.y,
            text: text,
            fontSize: fontSize,
            fontFamily: fontFamily,
            fill: color
        })

        
        this.object.setOffset(
        {
            x: this.object.getWidth() * this.offset.x,
            y: this.object.getHeight() * this.offset.y
        })
        return this.object
    }
    change(text)
    {
        this.object.text(text)
        //this.object.draw()
    }
}