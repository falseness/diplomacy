class Button {
    constructor(rect, text, clickFunc, parameters, canClick = true, callThis) {
        this.rect = rect
        this.text = text

        this.canClick = canClick
        this.clickFunc = clickFunc

        this.parameters = parameters
        
        this.callThis = callThis
        
        this.text.textAlign = 'center'
    }
    trimText() {
        this.text.pos = this.rect.center
    }
    get pos() {
        return this.rect.pos
    }
    set pos(pos) {
        this.rect.pos = pos
        this.trimText()
    }
    get textString() {
        return this.text.text
    }
    get height() {
        return this.rect.height
    }
    set textString(text) {
        this.text.text = text
    }
    set textColor(color) {
        this.text.color = color
    }
    get textColor() {
        return this.text.color
    }
    enableClick() {
        this.canClick = true
    }
    disableClick() {
        this.canClick = false
    }
    isInside(point) {
        return this.rect.isInside(point)
    }
    setFunction(func) {
        this.clickFunc = func
    }
    click(pos) {
        if (this.canClick && this.isInside(pos)) {
            if (this.callThis) {
                this.clickFunc.call(this.callThis, this.parameters)
            }
            else {
                this.clickFunc(this.parameters)
            }
            return true
        }
        return false
    }
    draw(ctx) {
            if (this.canClick) {
                this.rect.draw(ctx)
                this.text.draw(ctx)
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