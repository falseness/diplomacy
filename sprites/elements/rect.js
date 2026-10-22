class Rect {
    constructor(x, y, width, height, cornerRadius = [0, 0, 0, 0], strokeWidth = 0.001 * WIDTH,
         color = '#78a85d', strokeColor = 'black', light = false) {
        this.x = x
        this.y = y

        this.light = light

        this.width = width
        this.height = height

        this.cornerRadius = cornerRadius
            /*  
            12
            43
            */
        this.strokeWidth = strokeWidth
        this.color = color
        this.strokeColor = strokeColor
    }
    static getSelectedRect(rect, ratio = 1.2) {
        const rectCornersCount = 4
        let selectedCornerRadius = Array(rectCornersCount)
        for (let i = 0; i < rectCornersCount; ++i) {
            selectedCornerRadius[i] = rect.cornerRadius[i] * ratio
        }
        let res = new Rect(rect.x - rect.width * (ratio - 1) / 2, 
            rect.y - rect.height * (ratio - 1) / 2, 
            rect.width * ratio, rect.height * ratio,
            selectedCornerRadius, rect.strokeWidth * ratio, rect.color, 
            rect.strokeColor, rect.light)
        
        return res
    }
    set pos(pos) {
        this.x = pos.x
        this.y = pos.y
    }
    get pos() {
        return {x: this.x, y: this.y}
    }
    get centerX() {
        return this.x + this.width / 2
    }
    set centerX(x) {
        this.x = x - this.width / 2
    }
    get centerY() {
        return this.y + this.height / 2
    }
    set centerY(y) {
        this.y = y - this.height / 2
    }
    get right() {
        return this.x + this.width
    }
    get bottom() {
        return this.y + this.height
    }
    get center() {
        let center = {
            x: this.centerX,
            y: this.y + this.height / 2
        }
        return center
    }
    set center(pos) {
        this.x = pos.x - this.width / 2
        this.y = pos.y - this.height / 2
    }
    get rectPoints() {
        let points = [
            { x: this.x, y: this.y },
            { x: this.x + this.width, y: this.y },
            { x: this.x + this.width, y: this.y + this.height },
            { x: this.x, y: this.y + this.height }
        ]
        return points
    }
    // The rectPoints corners, without allocating them (bars draw many rects every frame).
    drawShape(ctx) {
        const x0 = this.x, y0 = this.y, x1 = this.x + this.width, y1 = this.y + this.height
        const c = this.cornerRadius

        ctx.moveTo(x0 + c[0], y0)
        ctx.lineTo(x1 - c[1], y0)
        ctx.arcTo(x1, y0, x1, y0 + c[1], c[1])
        ctx.lineTo(x1, y1 - c[2])
        ctx.arcTo(x1, y1, x1 - c[2], y1, c[2])
        ctx.lineTo(x0 + c[3], y1)
        ctx.arcTo(x0, y1, x0, y1 - c[3], c[3])
        ctx.lineTo(x0, y0 + c[0])
        ctx.arcTo(x0, y0, x0 + c[0], y0, c[0])
    }
    // A menu theme plaque (MENU_THEME.plain, primary or disabled) in this rect's shape: translucent fill, thin rim.
    // Corners are at most half the shorter side, so low plaques stay pills.
    drawPlaque(ctx, style, lineWidth = Math.max(1, this.strokeWidth * MENU_THEME.rimRatio)) {
        const radius = this.cornerRadius, limit = Math.min(this.width, this.height) / 2
        ctx.save()
        ctx.beginPath()
        this.cornerRadius = radius.map(r => Math.min(r, limit))
        this.drawShape(ctx)
        this.cornerRadius = radius
        ctx.closePath()
        ctx.globalAlpha = style.alpha
        ctx.fillStyle = style.fill
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = style.rim
        ctx.lineWidth = lineWidth
        if (style.dash) ctx.setLineDash([lineWidth * 3, lineWidth * 2])
        ctx.stroke()
        ctx.restore()
    }
    isInside(point) {
        return (this.x <= point.x && point.x <= this.x + this.width &&
            this.y <= point.y && point.y <= this.y + this.height)
    }
    draw(ctx) {
        ctx.beginPath()

        ctx.fillStyle = this.color
        ctx.strokeStyle = this.strokeColor
        ctx.lineWidth = this.strokeWidth

        this.drawShape(ctx)

        if (this.color)
            ctx.fill()
        if (!this.light && this.strokeWidth)
            ctx.stroke()

        ctx.closePath()

        if (this.light) {
            ctx.beginPath()

            ctx.fillStyle = 'white'
            this.drawShape(ctx)
            
            ctx.globalAlpha = this.light

            ctx.fill()

            ctx.globalAlpha = 1.0

            ctx.closePath()

            if (this.strokeWidth) {
                ctx.beginPath()
                this.drawShape(ctx)
                ctx.stroke()
                ctx.closePath()
            }
        }
    }
}