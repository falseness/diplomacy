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
        text = (text === '')?'':((text === 0)?'0':(text || ('error')))
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

        
        this.changeOffset()
        
        this.object.listening(false)
        
        return this.object
    }
    change(text)
    {
        this.object.text(text)
        
        /*
        Похоже, что эта штука не нужна
        
        this.changeOffset()
        
        */
        //this.object.draw()
    }
    changeOffset()
    {
        this.object.setOffset(
        {
            x: this.object.getWidth() * this.offset.x,
            y: this.object.getHeight() * this.offset.y
        })
    }
}
class CoordText extends Sprite
{
    constructor(x, y, text)
    {
        super(x, y)
        this.text = text
    }
    createObject(fontSize, color, fontFamily)
    {
        fontSize = fontSize || Math.floor(basis.r * 0.5)
        fontFamily = fontFamily || 'Times New Roman'
        color = color || 'white'
        
        let pos = this.getPos()
        this.object = new Konva.Text({
            x: pos.x,
            y: pos.y,
            text: this.text,
            fontSize: fontSize,
            fontFamily: fontFamily,
            fill: color
        })

        this.object.setOffset(
        {
            x: this.object.getWidth() * 0.5,
            y: this.object.getHeight() * 0.5
        })
        return this.object
    }
}