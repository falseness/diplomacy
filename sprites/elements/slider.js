class Slider {
constructor(minimumValue, maximumValue, textByValue, parameters, startValue = 0, 
            marginX, text, leftButton, rightButton) {
        this.value = startValue

        this.parameters = parameters

        this.minimumValue = minimumValue
        this.maximumValue = maximumValue

        this.textByValue = textByValue

        this.text = text

        this.leftButton = leftButton
        this.rightButton = rightButton

        this.leftButton.clickFunc = this.changeValue
        this.leftButton.parameters = -1
        this.leftButton.callThis = this

        this.rightButton.clickFunc = this.changeValue
        this.rightButton.parameters = 1
        this.rightButton.callThis = this

        this.marginX = marginX

        this.update()
        //this.text.text = this.textByValue(this.value)

        this.trim()
    }
    update() {
        this.changeValue(0)
    }
    trim() {
        let x = this.text.x
        let y = this.text.y
        this.leftButton.centerX = x - this.marginX
        this.rightButton.centerX = x + this.marginX
        this.leftButton.centerY = this.rightButton.centerY = y
    }
    get realValue() {
        return this.textByValue(this.value).toString()
    }
    changeValue(tmp) {
        this.value += tmp
        if (this.value > this.maximumValue(this.parameters))
            this.value = this.maximumValue(this.parameters)
        if (this.value < this.minimumValue(this.parameters))
            this.value = this.minimumValue(this.parameters)
        
        this.leftButton.canClick = this.value != this.minimumValue(this.parameters)
        this.rightButton.canClick = this.value != this.maximumValue(this.parameters)

        this.text.text = this.realValue
    }
    select(pos) {
        this.leftButton.select(pos)
        this.rightButton.select(pos)
    }
    removeSelect(pos) {
        this.leftButton.removeSelect()
        this.rightButton.removeSelect()
    }
    click(pos) {
        return this.leftButton.click(pos) || this.rightButton.click(pos)
    }
    draw(ctx) {
        this.leftButton.draw(ctx)
        this.rightButton.draw(ctx)
        this.text.draw(ctx)
    }
}