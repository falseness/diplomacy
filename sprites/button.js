class Button
{
    constructor(rect, text, clickFunc, parameters, canClick = true)
    {
        this.rect = rect
        this.text = text
        
        this.canClick = canClick
        this.clickFunc = clickFunc
        
        this.parameters = parameters
        
        this.text.setTextAlign('center')
    }
    trimText()
    {
        this.text.setPos(this.rect.getCenter())
    }
    setPos(pos)
    {
        this.rect.setPos(pos)
        this.trimText()
    }
    setText(text)
    {
        this.text.setText(text)
    }
    setCanClick(boolean)
    {
        this.canClick = boolean
    }
    enableClick()
    {
        this.canClick = true
    }
    disableClick()
    {
        this.canClick = false
    }
    isInside(point)
    {
        return this.rect.isInside(point)
    }
    setFunction(func)
    {
        this.clickFunc = func
    }
    click(pos)
    {
        if (this.canClick && this.isInside(pos))
        {
            this.clickFunc(this.parameters)
            return true
        }
        return false
    }
    draw()
    {
        if (this.canClick)
        {
            this.rect.draw()
            this.text.draw()
        }
    }
    /*constructor(model, text, name)
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
    hide()
    {
        this.object.visible(false)
        this.text.object.visible(false)
        
        this.deleteFunction()
    }
    draw()
    {
        this.object.visible(true)
        this.text.object.visible(true)
    }*/
}