class Rect
{
    constructor(x, y, width, height, cornerRadius = [0, 0, 0, 0], strokeWidth = 0.002 * width, color = '#78a85d', strokeColor = 'black')
    {
        this.x = x
        this.y = y
        
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
    setPos(pos)
    {
        this.x = pos.x
        this.y = pos.y
    }
    setWidth(width)
    {
        this.width = width
    }
    setHeight(height)
    {
        this.height = height
    }
    getWidth()
    {
        return this.width
    }
    getHeight()
    {
        return this.height
    }
    setColor(color)
    {
        this.color = color
    }
    getCenter()
    {
        let center = 
        {
            x: this.x + this.width / 2, 
            y: this.y + this.height / 2
        }
        return center
    }
    getRectPoints()
    {
        let points =
        [
            {x: this.x, y: this.y},
            {x: this.x + this.width, y: this.y},
            {x: this.x + this.width, y: this.y + this.height},
            {x: this.x, y: this.y + this.height}
        ]
        return points
    }
    drawShape()
    {
        let p = this.getRectPoints()
        
        ctx.moveTo(p[0].x + this.cornerRadius[0], p[0].y)
        ctx.lineTo(p[1].x - this.cornerRadius[1], p[1].y)
        ctx.arcTo(p[1].x, p[1].y, p[1].x, p[1].y + this.cornerRadius[1], this.cornerRadius[1])
        ctx.lineTo(p[2].x, p[2].y - this.cornerRadius[2])
        ctx.arcTo(p[2].x, p[2].y, p[2].x - this.cornerRadius[2], p[2].y, this.cornerRadius[2])
        ctx.lineTo(p[3].x + this.cornerRadius[3], p[3].y)
        ctx.arcTo(p[3].x, p[3].y, p[3].x, p[3].y - this.cornerRadius[3], this.cornerRadius[3])
        ctx.lineTo(p[0].x, p[0].y + this.cornerRadius[0])
        ctx.arcTo(p[0].x, p[0].y, p[0].x + this.cornerRadius[0], p[0].y, this.cornerRadius[0])
    }
    isInside(point)
    {
        return (this.x <= point.x && point.x <= this.x + this.width &&
                this.y <= point.y && point.y <= this.y + this.height)
    }
    draw()
    {  
        ctx.beginPath() 
        
        ctx.fillStyle   = this.color
        ctx.strokeStyle = this.strokeColor
        ctx.lineWidth   = this.strokeWidth
        
        this.drawShape()
        ctx.stroke()
        ctx.fill()
        
        ctx.closePath()
    }
}