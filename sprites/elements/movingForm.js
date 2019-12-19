class MovingForm {
    constructor(elements, offsetLimitation) {
        this.elements = elements
        this.offsetX = 0
        this.offsetLimitation = offsetLimitation
    }
    correctOffsetX() {
        if (this.offsetX > this.offsetLimitation.max)
            this.offsetX = this.offsetLimitation.max
        if (this.offsetX < this.offsetLimitation.min)
            this.offsetX = this.offsetLimitation.min
    }
    touchstart(pos) {
        this.posTouchStart = pos
    }
    touchmove(pos) {
        let offsetTouch = (pos.x - this.posTouchStart.x)

        let oldOffsetX = this.offsetX
        this.offsetX += offsetTouch
        this.correctOffsetX()

        let offset = this.offsetX - oldOffsetX
        
        for (let i = 0; i < this.elements.length; ++i) {
            this.elements[i].x += offset
        }

        this.posTouchStart = pos
    }
    select(pos) {
        for (let i = 0; i < this.elements.length; ++i) {
            this.elements[i].select(pos)
        }
    }
    removeSelect() {
        for (let i = 0; i < this.elements.length; ++i) {
            this.elements[i].removeSelect()
        }
    }
    click(pos) {
        for (let i = 0; i < this.elements.length; ++i) {
            let isClicked = this.elements[i].click(pos)
            if (isClicked)
                return true
        }
        return false
    }
    draw(ctx) {
        for (let i = 0; i < this.elements.length; ++i) {
            this.elements[i].draw(ctx)
        }
    }
}