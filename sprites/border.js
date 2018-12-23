class Border
{
    constructor(layer)
    {
        this.layer = layer
    }
    drawLine(pos, side, color, strokeWidth)
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
        this.layer.add(new Konva.Line({
            points: [hexagonLine[side][0][0] + pos.x, hexagonLine[side][0][1] + pos.y, 
                   hexagonLine[side][1][0] + pos.x, hexagonLine[side][1][1] + pos.y],
            stroke: color,
            strokeWidth: strokeWidth,
        }))
    }
    draw()
    {
        this.layer.draw()
    }
    remove()
    {
        this.layer.destroyChildren()
        this.draw()
    }
    visible(visibleType)
    {
        this.layer.visible(visibleType)
    }
}