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

class MapDepth {
    constructor() {
        this.faces = []
        this.edges = []
        this.outline = undefined
        this.gridWidth = 0
        this.gridHeight = 0
        this.depth = 0.55 * basis.r
        this.shadowBlur = 0.38 * basis.r
        this.shadowOffset = 0.18 * basis.r
        this.bounds = {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0
        }
    }
    getVertices(pos) {
        const halfHeight = basis.r * Math.sqrt(3) / 2
        return [
            {x: pos.x - basis.r / 2, y: pos.y - halfHeight},
            {x: pos.x + basis.r / 2, y: pos.y - halfHeight},
            {x: pos.x + basis.r, y: pos.y},
            {x: pos.x + basis.r / 2, y: pos.y + halfHeight},
            {x: pos.x - basis.r / 2, y: pos.y + halfHeight},
            {x: pos.x - basis.r, y: pos.y}
        ]
    }
    pointKey(point) {
        // Neighboring hexes calculate shared vertices independently. Rounding keeps
        // those vertices stable as keys despite floating point noise.
        return point.x.toFixed(4) + ':' + point.y.toFixed(4)
    }
    createOutline() {
        if (!this.edges.length) {
            this.outline = undefined
            return
        }

        const edgesByStart = new Map()
        for (let i = 0; i < this.edges.length; ++i)
            edgesByStart.set(this.pointKey(this.edges[i].begin), this.edges[i])

        const orderedEdges = []
        let edge = this.edges[0]
        for (let i = 0; i < this.edges.length; ++i) {
            orderedEdges.push(edge)
            edge = edgesByStart.get(this.pointKey(edge.end))
            if (!edge)
                break
        }

        this.outline = new Path2D()
        this.outline.moveTo(orderedEdges[0].begin.x, orderedEdges[0].begin.y)
        for (let i = 0; i < orderedEdges.length; ++i)
            this.outline.lineTo(orderedEdges[i].end.x, orderedEdges[i].end.y)
        this.outline.closePath()
    }
    rebuild(_grid) {
        this.faces = []
        this.edges = []
        this.gridWidth = _grid.arr.length
        this.gridHeight = _grid.arr[0].length

        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity

        for (let x = 0; x < this.gridWidth; ++x) {
            for (let y = 0; y < this.gridHeight; ++y) {
                const pos = _grid.arr[x][y].hexagon.calcPos()
                const vertices = this.getVertices(pos)
                const parity = x & 1

                for (let i = 0; i < vertices.length; ++i) {
                    minX = Math.min(minX, vertices[i].x)
                    maxX = Math.max(maxX, vertices[i].x)
                    minY = Math.min(minY, vertices[i].y)
                    maxY = Math.max(maxY, vertices[i].y)

                    const neighbour = {
                        x: x + neighborhood[parity][i][0],
                        y: y + neighborhood[parity][i][1]
                    }
                    if (!isCoordNotOnMap(neighbour, this.gridWidth, this.gridHeight))
                        continue

                    const edge = {
                        begin: vertices[i],
                        end: vertices[(i + 1) % vertices.length],
                        side: i
                    }
                    this.edges.push(edge)
                    this.faces.push({
                        begin: edge.begin,
                        end: edge.end,
                        bottomBegin: {x: edge.begin.x, y: edge.begin.y + this.depth},
                        bottomEnd: {x: edge.end.x, y: edge.end.y + this.depth},
                        side: i,
                        sortY: Math.max(edge.begin.y, edge.end.y) + this.depth
                    })
                }
            }
        }

        this.faces.sort((a, b) => a.sortY - b.sortY)
        this.createOutline()

        const shadowPadding = this.shadowBlur * 2
        this.bounds = {
            left: minX - shadowPadding,
            right: maxX + shadowPadding,
            top: minY - shadowPadding,
            bottom: maxY + this.depth + this.shadowOffset + shadowPadding
        }
    }
    ensureGeometry(_grid) {
        if (this.gridWidth != _grid.arr.length ||
            this.gridHeight != _grid.arr[0].length || !this.outline)
            this.rebuild(_grid)
    }
    getFaceColors(side) {
        if (side == 3)
            return ['#969994', '#5c605f']
        if (side == 2 || side == 4)
            return ['#7d817e', '#484c4c']
        return ['#696d6b', '#383c3d']
    }
    drawUnderlay(ctx, _grid) {
        this.ensureGeometry(_grid)
        if (!this.outline)
            return

        ctx.save()
        ctx.fillStyle = '#4d5150'
        ctx.shadowColor = 'rgba(4, 12, 18, 0.72)'
        ctx.shadowBlur = this.shadowBlur
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = this.shadowOffset
        ctx.fill(this.outline)
        ctx.restore()

        for (let i = 0; i < this.faces.length; ++i) {
            const face = this.faces[i]
            const colors = this.getFaceColors(face.side)
            const gradient = ctx.createLinearGradient(0, face.begin.y, 0, face.sortY)
            gradient.addColorStop(0, colors[0])
            gradient.addColorStop(1, colors[1])

            ctx.beginPath()
            ctx.moveTo(face.begin.x, face.begin.y)
            ctx.lineTo(face.end.x, face.end.y)
            ctx.lineTo(face.bottomEnd.x, face.bottomEnd.y)
            ctx.lineTo(face.bottomBegin.x, face.bottomBegin.y)
            ctx.closePath()
            ctx.fillStyle = gradient
            ctx.fill()
            ctx.strokeStyle = 'rgba(25, 29, 30, 0.78)'
            ctx.lineWidth = 0.025 * basis.r
            ctx.stroke()
        }
    }
    drawRim(ctx, _grid) {
        this.ensureGeometry(_grid)
        if (!this.edges.length)
            return

        ctx.save()
        ctx.beginPath()
        for (let i = 0; i < this.edges.length; ++i) {
            ctx.moveTo(this.edges[i].begin.x, this.edges[i].begin.y)
            ctx.lineTo(this.edges[i].end.x, this.edges[i].end.y)
        }
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = 'black'
        ctx.lineWidth = basis.strokeWidth
        ctx.stroke()
        ctx.restore()
    }
}
