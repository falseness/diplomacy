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
        
        this.color = this.buttonOne.text.color
        this.selected = 1
    }
    get height() {
        return this.buttonOne.height
    }
    setSelectedColor(selectColor) {
        if (this.selected == 2) {
            this.buttonTwo.textColor = selectColor
        }
        else if (this.selected == 1) {
            this.buttonOne.textColor = selectColor
        }
    }
    toggleSelect() {
        if (this.selected == 1) {
            this.selected = 2
            
            this.buttonOne.textColor = this.color
        }
        else if (this.selected == 2) {
            this.selected = 1
            
            this.buttonTwo.textColor = this.color
        }
    }
    getSelectedText() {
        if (this.selected == 1) {
            return this.buttonOne.textString
        }
        if (this.selected == 2) {
            return this.buttonTwo.textString
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