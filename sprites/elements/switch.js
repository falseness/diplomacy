class Switch {
    constructor(x, y, w, h, cornerRadius, strokeWidth, color, 
                 textOne, textTwo, clickFunc, parameters, canClick = true) {
        this.cornerRadius = cornerRadius
        this.buttonOne = new Button(
            new Rect(x, y, w / 2, h, 
                     [cornerRadius, 0, 0, cornerRadius],
                strokeWidth, color),
            textOne,
            clickFunc, parameters
        )
        this.buttonOne.trimText()
        this.buttonTwo = new Button(
            new Rect(x + w / 2, y, w / 2, h, 
                     [0, cornerRadius, cornerRadius, 0],
                strokeWidth, color),
            textTwo,
            clickFunc, parameters
        )
        this.buttonTwo.trimText()
        
        this.color = this.buttonOne.text.getColor()
        this.selected = 1
    }
    getHeight() {
        return this.buttonOne.getHeight()
    }
    setSelectedColor(selectColor) {
        if (this.selected == 2) {
            this.buttonTwo.setTextColor(selectColor)
        }
        else if (this.selected == 1) {
            this.buttonOne.setTextColor(selectColor)
        }
    }
    toggleSelect() {
        if (this.selected == 1) {
            this.selected = 2
            
            this.buttonOne.setTextColor(this.color)
        }
        else if (this.selected == 2) {
            this.selected = 1
            
            this.buttonTwo.setTextColor(this.color)
        }
    }
    getSelectedText() {
        if (this.selected == 1) {
            return this.buttonOne.getText()
        }
        if (this.selected == 2) {
            return this.buttonTwo.getText()
        }
    }
    click(pos) {
        if (this.buttonOne.click(pos))
            return 1
        if (this.buttonTwo.click(pos))
            return 2
        return false
    }
    draw(ctx) {
        this.buttonOne.draw(ctx)
        this.buttonTwo.draw(ctx)
    }
}