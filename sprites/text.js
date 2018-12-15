class Text
{
    constructor(model)
    {
        this.object = createTextByModel(model)
    }
    getObject()
    {
        return this.object
    }
    change(text)
    {
        this.object.text(text)
    }
    changeOffset()
    {
        this.object.setOffset(
        {
            x: this.object.getWidth() * this.offset.x,
            y: this.object.getHeight() * this.offset.y
        })
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
    }
}
class CoordText extends Sprite
{
    constructor(x, y, text)
    {
        super(x, y)
        this.text = text
    }
    createObject(model)
    {
        let pos = this.getPos()
        model.x         =   model.x         || pos.x
        model.y         =   model.y         || pos.y
        model.fontSize  =   model.fontSize  || Math.floor(basis.r * 0.5)
        model.text      =   model.text      || this.text
        model.offset    =   model.offset    || {x: 0.5, y: 0.5}
        this.object = createTextByModel(model)
        return this.object
    }
}