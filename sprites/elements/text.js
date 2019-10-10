class Text {
    constructor(x, y, fontSize = Math.round(basis.r * 9.8625 * 0.05), text = 'error', color = 'white',
        textAlign = 'center', textBaseline = 'middle') {
        this.pos = {
            x: x,
            y: y
        }
        this.text = text

        this.color = color
        this.fontSize = fontSize
        this.textAlign = textAlign
        this.textBaseline = textBaseline
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

        mainCtx.font = this.fontSize + 'px Times New Roman'
        for (let i = 0; i < lines.length; ++i) {
            if (mainCtx.measureText(lines[i]).width > max)
                max = mainCtx.measureText(lines[i]).width
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
    get y() {
        return this.pos.y
    }
    draw(ctx) {
        ctx.font = this.fontSize + 'px Times New Roman'
        ctx.fillStyle = this.color
        ctx.textAlign = this.textAlign
        ctx.textBaseline = this.textBaseline

        let lines = this.text.split('\n')
        for (let i = 0; i < lines.length; ++i)
            ctx.fillText(lines[i], this.pos.x, this.pos.y + (i * this.height))
    }
}
class CoordText extends Sprite {
    constructor(x, y, text, color = 'white', fontSize = Math.round(basis.r * 9.8625 * 0.05)) {
        super(x, y)
        this.color = color
        this.fontSize = fontSize
        this.text = text
    }
    draw(ctx) {
            let pos = this.pos
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