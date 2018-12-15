class Button
{
    constructor(model, text, name)
    {
        this.text = text
        this.name = name
        
        this.object = createRectByModel(model)                            
        this.text.changePos(model.x + this.object.getWidth() / 2, model.y)
    }
    getObject()
    {
        return [this.object, this.text.getObject()]
    }
    setFunction(func, parameters)
    {
        this.object.parameters = parameters
        this.object.on('click', func)
    }
    deleteFunction()
    {
        this.object.parameters = NaN
        this.object.off('click')
    }
    changeText(text)
    {
        this.text.change(text)
        this.text.object.draw()
    }
    changePos(x, y)
    {
        if (x)
        {
            this.pos.x = x
            this.object.x(x)
            this.text.changePos(x)
        }
        if (y)
        {
            this.pos.y = y
            this.object.y(y)
            this.text.changePos(NaN, y)
        }
    }
}