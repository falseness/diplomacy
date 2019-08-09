class Border {
    constructor() {
        this.lines = []
        this.visible = true
    }
    clean() {
        this.lines = []
    }
    isCleaned() {
        return !this.lines.length
    }
    createLine(pos, side) {
        const hexagonLine = [
            [
                [-basis.r / 2, -basis.r / 2 * Math.sqrt(3)],
                [basis.r / 2, -basis.r / 2 * Math.sqrt(3)]
            ],
            [
                [basis.r / 2, -basis.r / 2 * Math.sqrt(3)],
                [basis.r, 0]
            ],
            [
                [basis.r, 0],
                [basis.r / 2, basis.r / 2 * Math.sqrt(3)]
            ],
            [
                [basis.r / 2, basis.r / 2 * Math.sqrt(3)],
                [-basis.r / 2, basis.r / 2 * Math.sqrt(3)]
            ],
            [
                [-basis.r / 2, basis.r / 2 * Math.sqrt(3)],
                [-basis.r, 0]
            ],
            [
                [-basis.r, 0],
                [-basis.r / 2, -basis.r / 2 * Math.sqrt(3)]
            ]
        ]
        let line = {
            begin: {
                x: hexagonLine[side][0][0] + pos.x,
                y: hexagonLine[side][0][1] + pos.y
            },
            end: {
                x: hexagonLine[side][1][0] + pos.x,
                y: hexagonLine[side][1][1] + pos.y
            }
        }
        this.lines.push(line)
    }
    newBrokenLine(color = 'white', strokeWidth = 0.05 * basis.r, 
        extraColor = false, extraStrokeWidth = 0.03 * basis.r) {
        this.clean()
        this.visible = true
        this.color = color
        this.strokeWidth = strokeWidth

        this.extraStrokeWidth = extraStrokeWidth
        this.extraColor = extraColor
    }
    draw(ctx) {
        if (!this.visible)
            return
        ctx.beginPath()
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        
        ctx.strokeStyle = this.color
        ctx.lineWidth = this.strokeWidth
        
        for (let i = 0; i < this.lines.length; ++i) {
            ctx.moveTo(this.lines[i].begin.x, this.lines[i].begin.y)
            ctx.lineTo(this.lines[i].end.x, this.lines[i].end.y)
        }
        ctx.stroke()
        ctx.closePath()

        
        if (this.extraColor && this.extraStrokeWidth) {
            ctx.beginPath()

            ctx.strokeStyle = this.extraColor
            ctx.lineWidth = this.extraStrokeWidth
            for (let i = 0; i < this.lines.length; ++i) {
                ctx.moveTo(this.lines[i].begin.x, this.lines[i].begin.y)
                ctx.lineTo(this.lines[i].end.x, this.lines[i].end.y)
            }

            ctx.stroke()
            ctx.closePath()
        }
    }
}