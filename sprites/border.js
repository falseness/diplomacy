class Border
{
    constructor()
    {
        this.lines = []
        this.visible = true
    }
    clean()
    {
        this.lines = []
    }
    isCleaned()
    {
        return !this.lines.length
    }
    createLine(pos, side, color, strokeWidth)
    {
        strokeWidth = strokeWidth   || 4
        color       = color         || 'white' 
        
        const hexagonLine = 
        [
            [[-basis.r / 2, -basis.r / 2 * Math.sqrt(3)], [basis.r / 2, -basis.r / 2 * Math.sqrt(3)]],
            [[basis.r / 2, -basis.r / 2 * Math.sqrt(3)], [basis.r, 0]],
            [[basis.r, 0], [basis.r / 2, basis.r / 2 * Math.sqrt(3)]],
            [[basis.r / 2, basis.r / 2 * Math.sqrt(3)], [-basis.r / 2, basis.r / 2 * Math.sqrt(3)]],
            [[-basis.r / 2, basis.r / 2 * Math.sqrt(3)], [-basis.r, 0]],
            [[-basis.r, 0], [-basis.r / 2, -basis.r / 2 * Math.sqrt(3)]]
        ]
        let line = 
        {
            begin:
            {
                x: hexagonLine[side][0][0] + pos.x,
                y: hexagonLine[side][0][1] + pos.y
            },
            end:
            {
                x: hexagonLine[side][1][0] + pos.x, 
                y: hexagonLine[side][1][1] + pos.y
            },
            strokeColor: color, 
            strokeWidth: strokeWidth
        }
        this.lines.push(line)
    }
    setVisible(boolean)
    {
        this.visible = boolean
    }
    draw()
    {
        if (!this.visible)
            return
        for (let i = 0; i < this.lines.length; ++i)
        {
            ctx.beginPath()
        
            ctx.strokeStyle = this.lines[i].strokeColor
            ctx.lineWidth   = this.lines[i].strokeWidth
        
        
            ctx.moveTo(this.lines[i].begin.x, this.lines[i].begin.y)
            ctx.lineTo(this.lines[i].end.x, this.lines[i].end.y)
            
            ctx.stroke()
            
            ctx.closePath()
        }
    }
}