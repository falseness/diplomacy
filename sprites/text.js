class Text
{
    constructor(x, y, fontSize = Math.round(basis.r * 9.8625 * 0.05), text = 'error', color = 'white',
                 textAlign = 'center', textBaseLine = 'middle')
    {
        this.pos = 
        {
            x: x, 
            y: y
        }
        this.text = text
        
        this.color = color
        this.fontSize = fontSize
        this.textAlign = textAlign
        this.textBaseline = textBaseLine
    }
    setText(text)
    {
        this.text = text
    }
    setPos(pos)
    {
        this.pos = pos
    }
    setTextAlign(textAlign)
    {
        this.textAlign = textAlign
    }
    draw()
    {
        ctx.font = this.fontSize + 'px Times New Roman'
        ctx.fillStyle = this.color
        ctx.textAlign = this.textAlign
        ctx.textBaseline = this.textBaseline
        
        ctx.fillText(this.text, this.pos.x, this.pos.y)
    }
    /*getObject()
    {
        return this.object
    }
    changeOffset()
    {
        this.object.setOffset(
        {
            x: this.object.getWidth() * this.offset.x,
            y: this.object.getHeight() * this.offset.y
        })
    }
    change(text)
    {
        this.object.text(text)
        this.changeOffset()
    }
    changePos(x, y)
    {
        if (x)
        {
            this.object.x(x)
        }
        if (y)
        {
            this.object.y(y)
        }
    }
    x()
    {
        return this.object.x()
    }
    y()
    {
        return this.object.y()
    }
    getWidth()
    {
        return this.object.getWidth()
    }
    getHeight()
    {
        return this.object.getHeight()
    }
    fontSize()
    {
        return this.object.textHeight
    }*/
}
class CoordText extends Sprite
{
    constructor(x, y, text, color = 'white', fontSize = Math.round(basis.r * 9.8625 * 0.05))
    {
        super(x, y)
        this.color = color
        this.fontSize = fontSize
        this.text = text
    }
    setColor(color)
    {
        this.color = color
    }
    setText(text)
    {
        this.text = text
    }
    draw()
    {
        let pos = this.getPos()
        ctx.font = this.fontSize + 'px Times New Roman'
        ctx.fillStyle = this.color
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(this.text, pos.x, pos.y)
    }
    /*createObject(model)
    {
        let pos = this.getPos()
        model.x         =   model.x         || pos.x
        model.y         =   model.y         || pos.y
        model.fontSize  =   model.fontSize  || Math.floor(basis.r * 0.5)
        model.text      =   model.text      || this.text
        model.offset    =   model.offset    || {x: 0.5, y: 0.5}
        this.object = createTextByModel(model)
        return this.object
    }*/
}