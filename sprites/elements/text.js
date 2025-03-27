class Text {
    constructor(x, y, fontSize = Math.round(basis.r * 9.8625 * 0.05), text = 'error', color = 'white',
        textAlign = 'center', textBaseline = 'middle', ratio = 1.2) {
        this.pos = {
            x: x,
            y: y
        }
        this.text = text

        this.color = color
        this.fontSize = fontSize
        this.textAlign = textAlign
        this.textBaseline = textBaseline
        this.selected = false
        this.ratio = ratio
    }
    get right() {
        if (this.textAlign == 'left')
            return this.pos.x + this.width
        if (this.textAlign == 'right')
            return this.pos.x
        return this.pos.x + this.width / 2
    }
    get left() {
        if (this.textAlign == 'left')
            return this.pos.x
        if (this.textAlign == 'right')
            return this.pos.x - this.width
        return this.pos.x - this.width / 2
    }
    get width() {
        let max = -1
        let lines = this.text.split('\n')
        
        let tmpCtx = mainCtx
        tmpCtx.font = this.fontSize + 'px Times New Roman'
        for (let i = 0; i < lines.length; ++i) {
            if (tmpCtx.measureText(lines[i]).width > max)
                max = tmpCtx.measureText(lines[i]).width
        }
        return max
    }
    get height() {
        mainCtx.font = this.fontSize + 'px Times New Roman'
        return parseInt(mainCtx.font.match(/\d+/), 10)
    }
    get x() {
        return this.pos.x
    }
    set x(val) {
        this.pos.x = val
    }
    get y() {
        return this.pos.y
    }
    set y(val) {
        this.pos.y = val
    }
    select() {
        this.selected = true
    }
    removeSelect() {
        this.selected = false
    }
    draw(ctx) {
        let fontSize = this.fontSize
        if (this.selected)
            fontSize *= this.ratio
        ctx.font = fontSize + 'px Times New Roman'
        ctx.fillStyle = this.color
        ctx.textAlign = this.textAlign
        ctx.textBaseline = this.textBaseline

        let lines = this.text.split('\n')
        for (let i = 0; i < lines.length; ++i)
            ctx.fillText(lines[i], this.pos.x, this.pos.y + (i * this.height))
    }
}
class CoordText extends Sprite {
    static get defaultFontSize() {
        return Math.round(basis.r * 9.8625 * 0.05)
    }
    constructor(x, y, text, color = 'white', fontSize = CoordText.defaultFontSize,
            strokeColor = 'black', strokeWidth = 0) {
        super(x, y)
        this.color = color
        this.fontSize = fontSize
        this.text = text
        this.strokeWidth = strokeWidth
        this.strokeColor = strokeColor
    }
    draw(ctx) {
            let pos = this.pos
            ctx.font = this.fontSize + 'px Times New Roman'
            ctx.fillStyle = this.color
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"

            if (this.strokeWidth) {
                ctx.strokeStyle = this.strokeColor
                ctx.lineWidth = this.strokeWidth
                ctx.strokeText(this.text, pos.x, pos.y)
            }
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