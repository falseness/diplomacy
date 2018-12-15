function drawLine(pos, side, color)
{
    const hexagonLine = 
    [
        [[-basis.r / 2, -basis.r / 2 * Math.sqrt(3)], [basis.r / 2, -basis.r / 2 * Math.sqrt(3)]],
        [[basis.r / 2, -basis.r / 2 * Math.sqrt(3)], [basis.r, 0]],
        [[basis.r, 0], [basis.r / 2, basis.r / 2 * Math.sqrt(3)]],
        [[basis.r / 2, basis.r / 2 * Math.sqrt(3)], [-basis.r / 2, basis.r / 2 * Math.sqrt(3)]],
        [[-basis.r / 2, basis.r / 2 * Math.sqrt(3)], [-basis.r, 0]],
        [[-basis.r, 0], [-basis.r / 2, -basis.r / 2 * Math.sqrt(3)]]
    ]
    layers.selectUnit.add(new Konva.Line({
      points: [hexagonLine[side][0][0] + pos.x, hexagonLine[side][0][1] + pos.y, hexagonLine[side][1][0] + pos.x, hexagonLine[side][1][1] + pos.y],
      stroke: color,
      strokeWidth: 4,
    }))
}