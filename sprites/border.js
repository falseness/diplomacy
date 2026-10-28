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
        // Compute only the requested edge; every call still owns its endpoints.
        // Read the live radius so resizing does not leave stale geometry.
        const halfRadius = basis.r / 2
        const height = halfRadius * Math.sqrt(3)
        let beginX, beginY, endX, endY
        switch (String(side)) {
            case '0':
                beginX = -halfRadius; beginY = -height
                endX = halfRadius; endY = -height
                break
            case '1':
                beginX = halfRadius; beginY = -height
                endX = basis.r; endY = 0
                break
            case '2':
                beginX = basis.r; beginY = 0
                endX = halfRadius; endY = height
                break
            case '3':
                beginX = halfRadius; beginY = height
                endX = -halfRadius; endY = height
                break
            case '4':
                beginX = -halfRadius; beginY = height
                endX = -basis.r; endY = 0
                break
            case '5':
                beginX = -basis.r; beginY = 0
                endX = -halfRadius; endY = -height
                break
            default:
                throw new TypeError('Invalid hexagon side: ' + side)
        }
        let line = {
            begin: {x: beginX + pos.x, y: beginY + pos.y},
            end: {x: endX + pos.x, y: endY + pos.y}
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
    // Atmospheric slab sides: grey stone faces [lit top edge, face, foot] by side (2 lower right,
    // away from the upper-left key light; 3 bottom; 4 lower left, towards it), the faces away from
    // the key cooled by the blue sky's fill (atmosphericLighting.RIM); a bottom face in a
    // notch between protruding cells is shaded by them. The lit edge fades into the face over
    // ATMOSPHERIC_FACE_EDGE of the face's height.
    static ATMOSPHERIC_FACES = {
        2: ['#7f8496', '#3c4256', '#262b3a'],
        3: ['#a6a6b8', '#4e5468', '#3a3e50'],
        4: ['#c8b4a8', '#706260', '#54484a'],
        notch: ['#70758a', '#3e4458', '#20252f']
    }
    static ATMOSPHERIC_FACE_EDGE = 0.16
    // Atmospheric drop shadow: the slab (top face and sides) casts a soft shadow onto the sky away
    // from the upper-left key light, only below and right of it: a broad layer and a near one (blur
    // and offset in hex radii; each offset exceeds the blur reach so nothing spills left or above).
    // A small cached raster (raster pixels per hex radius), drawn scaled under the board.
    static ATMOSPHERIC_SHADOW = {
        color: 'rgba(4, 8, 20, 0.8)',
        layers: [{blur: 0.6, x: 0.9, y: 1.2}, {blur: 0.2, x: 0.35, y: 0.45}],
        raster: 4
    }
    constructor() {
        this.faces = []
        this.edges = []
        this.outline = undefined
        this.rim = undefined
        this.underlayCache = undefined
        this.cacheBounds = undefined
        this.cacheRegions = []
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
            this.outlineLoop = undefined
            this.rim = undefined
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
        // The outline's points, as the path above (closed back to the first).
        this.outlineLoop = [orderedEdges[0].begin, ...orderedEdges.map(edge => edge.end)]

        this.rim = new Path2D()
        for (let i = 0; i < this.edges.length; ++i) {
            this.rim.moveTo(this.edges[i].begin.x, this.edges[i].begin.y)
            this.rim.lineTo(this.edges[i].end.x, this.edges[i].end.y)
        }
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
                if (_grid.arr[x][y].building.isMapEdge)
                    continue
                const pos = _grid.arr[x][y].hexagon.calcPos()
                const vertices = this.getVertices(pos)
                const parity = x & 1
                const cellFaces = []

                for (let i = 0; i < vertices.length; ++i) {
                    minX = Math.min(minX, vertices[i].x)
                    maxX = Math.max(maxX, vertices[i].x)
                    minY = Math.min(minY, vertices[i].y)
                    maxY = Math.max(maxY, vertices[i].y)

                    const neighbour = {
                        x: x + neighborhood[parity][i][0],
                        y: y + neighborhood[parity][i][1]
                    }
                    if (!isCoordNotOnMap(neighbour, this.gridWidth, this.gridHeight) &&
                        !_grid.arr[neighbour.x][neighbour.y].building.isMapEdge)
                        continue

                    const edge = {
                        begin: vertices[i],
                        end: vertices[(i + 1) % vertices.length],
                        side: i
                    }
                    this.edges.push(edge)
                    const face = {
                        begin: edge.begin,
                        end: edge.end,
                        bottomBegin: {x: edge.begin.x, y: edge.begin.y + this.depth},
                        bottomEnd: {x: edge.end.x, y: edge.end.y + this.depth},
                        side: i,
                        sortY: Math.max(edge.begin.y, edge.end.y) + this.depth
                    }
                    this.faces.push(face)
                    cellFaces.push(face)
                }
                // A bottom face whose cell has no slanted lower face sits in a notch between the
                // protruding neighbours, which shade it (atmospheric sides).
                const bottom = cellFaces.find(face => face.side == 3)
                if (bottom && !cellFaces.some(face => face.side == 2 || face.side == 4))
                    bottom.notch = true
            }
        }

        this.faces.sort((a, b) => a.sortY - b.sortY)
        this.createOutline()
        this.releaseAtmosphericShadow()

        const shadowPadding = this.shadowBlur * 2
        this.bounds = {
            left: minX - shadowPadding,
            right: maxX + shadowPadding,
            top: minY - shadowPadding,
            bottom: maxY + this.depth + this.shadowOffset + shadowPadding
        }
        this.surfaceBounds = {left: minX, right: maxX, top: minY, bottom: maxY}
        this.createUnderlayCache()
    }
    ensureGeometry(_grid) {
        if (this.gridWidth != _grid.arr.length ||
            this.gridHeight != _grid.arr[0].length || !this.outline)
            this.rebuild(_grid)
        else if (this.underlayAtmospheric !== otherSettings.atmosphericVisuals)
            this.createUnderlayCache()
    }
    getFaceColors(side) {
        if (side == 3)
            return ['#969994', '#5c605f']
        if (side == 2 || side == 4)
            return ['#7d817e', '#484c4c']
        return ['#696d6b', '#383c3d']
    }
    renderUnderlay(ctx, cacheScale = 1) {
        ctx.save()
        ctx.fillStyle = '#4d5150'
        ctx.shadowColor = 'rgba(4, 12, 18, 0.72)'
        // Canvas shadow dimensions are device-space values and do not follow the
        // current transform, so account for a downscaled render cache explicitly.
        ctx.shadowBlur = this.shadowBlur * cacheScale
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = this.shadowOffset * cacheScale
        ctx.fill(this.outline)
        ctx.restore()

        for (let i = 0; i < this.faces.length; ++i) {
            const face = this.faces[i]
            if (this.outsideClipWindow(face.begin, face.end, face.bottomEnd, face.bottomBegin))
                continue
            // One gradient a face and context, as renderAtmosphericSides: a rebuild of the surface cache or
            // its patch (Grid.patchSurfaceCache) draws with the gradients the first build made.
            face.underlayGradients ||= new WeakMap()
            let gradient = face.underlayGradients.get(gradientContext(ctx))
            if (!gradient) {
                const colors = this.getFaceColors(face.side)
                gradient = ctx.createLinearGradient(0, face.begin.y, 0, face.sortY)
                gradient.addColorStop(0, colors[0])
                gradient.addColorStop(1, colors[1])
                face.underlayGradients.set(gradientContext(ctx), gradient)
            }

            ctx.beginPath()
            ctx.moveTo(face.begin.x, face.begin.y)
            ctx.lineTo(face.end.x, face.end.y)
            ctx.lineTo(face.bottomEnd.x, face.bottomEnd.y)
            ctx.lineTo(face.bottomBegin.x, face.bottomBegin.y)
            ctx.closePath()
            ctx.fillStyle = gradient
            ctx.fill()
            // Atmospheric faces are repainted without outlines (renderAtmosphericSides).
            if (otherSettings.atmosphericVisuals)
                continue
            ctx.strokeStyle = 'rgba(25, 29, 30, 0.78)'
            ctx.lineWidth = 0.025 * basis.r
            ctx.stroke()
        }
    }
    createUnderlayCache() {
        this.underlayAtmospheric = otherSettings.atmosphericVisuals
        this.underlayCache = undefined
        this.cacheBounds = undefined
        this.cacheRegions = []
        if (!this.outline)
            return

        const cacheWidth = this.bounds.right - this.bounds.left
        const cacheHeight = this.bounds.bottom - this.bounds.top
        if (cacheWidth <= 0 || cacheHeight <= 0)
            return

        // Keep the cache useful on high-DPI displays without allowing a large map
        // to allocate an unbounded full-resolution canvas.
        const maxCacheDimension = 4096
        const maxCachePixels = 8 * 1024 * 1024
        const cacheScale = Math.min(
            1,
            maxCacheDimension / cacheWidth,
            maxCacheDimension / cacheHeight,
            Math.sqrt(maxCachePixels / (cacheWidth * cacheHeight))
        )
        const rasterWidth = Math.max(1, Math.ceil(cacheWidth * cacheScale))
        const rasterHeight = Math.max(1, Math.ceil(cacheHeight * cacheScale))

        const cache = document.createElement('canvas')
        cache.width = rasterWidth
        cache.height = rasterHeight
        const cacheCtx = cache.getContext('2d')
        cacheCtx.scale(cacheScale, cacheScale)
        cacheCtx.translate(-this.bounds.left, -this.bounds.top)
        this.renderUnderlay(cacheCtx, cacheScale)

        this.underlayCache = cache
        this.cacheBounds = {
            left: this.bounds.left,
            top: this.bounds.top,
            width: cacheWidth,
            height: cacheHeight
        }
        const bandSize = basis.r + this.depth + this.shadowBlur * 2
        const topEdge = Math.min(this.bounds.bottom, this.surfaceBounds.top + bandSize)
        const bottomEdge = Math.max(topEdge, this.surfaceBounds.bottom - bandSize)
        const leftEdge = Math.min(this.bounds.right, this.surfaceBounds.left + bandSize)
        const rightEdge = Math.max(leftEdge, this.surfaceBounds.right - bandSize)
        this.cacheRegions = [
            {
                left: this.bounds.left, top: this.bounds.top,
                right: this.bounds.right, bottom: topEdge
            },
            {
                left: this.bounds.left, top: bottomEdge,
                right: this.bounds.right, bottom: this.bounds.bottom
            },
            {
                left: this.bounds.left, top: topEdge,
                right: leftEdge, bottom: bottomEdge
            },
            {
                left: rightEdge, top: topEdge,
                right: this.bounds.right, bottom: bottomEdge
            }
        ]
    }
    // view: the world rectangle drawn ({left, top, right, bottom}), the camera's view by default.
    drawCacheRegion(ctx, region, view) {
        const visibleLeft = Math.max(region.left, view ? view.left : canvas.offset.x)
        const visibleTop = Math.max(region.top, view ? view.top : canvas.offset.y)
        const visibleRight = Math.min(
            region.right,
            view ? view.right : canvas.offset.x + width
        )
        const visibleBottom = Math.min(
            region.bottom,
            view ? view.bottom : canvas.offset.y + height
        )
        if (visibleLeft >= visibleRight || visibleTop >= visibleBottom)
            return

        const sourceScaleX = this.underlayCache.width / this.cacheBounds.width
        const sourceScaleY = this.underlayCache.height / this.cacheBounds.height
        ctx.drawImage(
            this.underlayCache,
            (visibleLeft - this.cacheBounds.left) * sourceScaleX,
            (visibleTop - this.cacheBounds.top) * sourceScaleY,
            (visibleRight - visibleLeft) * sourceScaleX,
            (visibleBottom - visibleTop) * sourceScaleY,
            visibleLeft,
            visibleTop,
            visibleRight - visibleLeft,
            visibleBottom - visibleTop
        )
    }
    // view: as drawCacheRegion (a lit tile's part of the world, Grid.buildLitTile).
    drawUnderlay(ctx, _grid, view) {
        this.ensureGeometry(_grid)
        if (!this.underlayCache)
            return

        // The solid map backing is cheap to draw as a vector and prevents seams
        // between textured hexagons. Only the expensive shadow/faces use the cache.
        ctx.save()
        ctx.fillStyle = '#4d5150'
        ctx.fill(this.outline)
        ctx.restore()

        for (let region of this.cacheRegions)
            this.drawCacheRegion(ctx, region, view)
    }
    // Whether the box of points (world) misses the clip window of a patch's clipped redraw (atmosphericLighting.clipWindow,
    // Grid.patchSurfaceCache), so a face there draws nothing into the clip and is skipped.
    outsideClipWindow(...points) {
        const w = atmosphericLighting.clipWindow
        if (!w)
            return false
        const xs = points.map(p => p.x), ys = points.map(p => p.y)
        return Math.max(...xs) < w.x0 || Math.min(...xs) > w.x1 || Math.max(...ys) < w.y0 || Math.min(...ys) > w.y1
    }
    renderAtmosphericSides(ctx) {
        if (!otherSettings.atmosphericVisuals) return
        // Only exposed edges have faces. Paint before terrain/fog so no face can
        // cover a foreground neighbour. Keep existing depth, bounds and hit areas.
        ctx.save()
        const t = ctx.getTransform()
        const axisAligned = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0
        for (const face of this.faces) {
            if (face.side < 2 || face.side > 4) continue
            const depth = this.depth
            if (axisAligned && (
                    Math.max(face.begin.x, face.end.x) * t.a + t.e < -1 ||
                    Math.min(face.begin.x, face.end.x) * t.a + t.e > ctx.canvas.width + 1 ||
                    (Math.max(face.begin.y, face.end.y) + depth) * t.d + t.f < -1 ||
                    Math.min(face.begin.y, face.end.y) * t.d + t.f > ctx.canvas.height + 1) ||
                    this.outsideClipWindow(face.begin, face.end, {x: face.end.x, y: face.end.y + depth}, {x: face.begin.x, y: face.begin.y + depth}))
                continue
            // Face geometry is replaced on rebuild; context keys do not retain
            // discarded canvases. Camera transforms need no new gradient.
            face.atmosphericGradients ||= new WeakMap()
            let shade = face.atmosphericGradients.get(gradientContext(ctx))
            if (!shade) {
                const colors = MapDepth.ATMOSPHERIC_FACES[face.notch ? 'notch' : face.side]
                shade = ctx.createLinearGradient(0, Math.min(face.begin.y, face.end.y), 0, Math.max(face.begin.y, face.end.y) + depth)
                shade.addColorStop(0, colors[0])
                shade.addColorStop(MapDepth.ATMOSPHERIC_FACE_EDGE, colors[1])
                shade.addColorStop(1, colors[2])
                face.atmosphericGradients.set(gradientContext(ctx), shade)
            }
            ctx.fillStyle = shade
            ctx.beginPath()
            ctx.moveTo(face.begin.x, face.begin.y)
            ctx.lineTo(face.end.x, face.end.y)
            ctx.lineTo(face.end.x, face.end.y + depth)
            ctx.lineTo(face.begin.x, face.begin.y + depth)
            ctx.closePath()
            ctx.fill()
        }
        ctx.restore()
    }
    releaseAtmosphericShadow() {
        if (this.atmosphericShadow) this.atmosphericShadow.canvas.width = this.atmosphericShadow.canvas.height = 0
        this.atmosphericShadow = undefined
    }
    createAtmosphericShadow() {
        const config = MapDepth.ATMOSPHERIC_SHADOW
        const b = this.surfaceBounds
        const pad = Math.max(...config.layers.map(layer => layer.blur * 1.5 + Math.max(layer.x, layer.y))) * basis.r
        const left = b.left - pad, top = b.top - pad
        const w = b.right - b.left + 2 * pad, h = b.bottom - b.top + this.depth + 2 * pad
        const k = config.raster / basis.r
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(w * k))
        canvas.height = Math.max(1, Math.ceil(h * k))
        const ctx = canvas.getContext('2d')
        ctx.setTransform(k, 0, 0, k, -left * k, -top * k)
        // Canvas shadow sizes are in raster pixels. The slab is its top face and that face moved
        // down by the side depth; the board covers the slab itself.
        ctx.fillStyle = ctx.shadowColor = config.color
        for (const layer of config.layers) {
            ctx.shadowBlur = 2 * layer.blur * config.raster
            ctx.shadowOffsetX = layer.x * config.raster
            ctx.shadowOffsetY = layer.y * config.raster
            ctx.fill(this.outline)
            ctx.translate(0, this.depth)
            ctx.fill(this.outline)
            ctx.translate(0, -this.depth)
        }
        this.atmosphericShadow = {canvas, left, top, width: w, height: h}
        ++MapDepth.atmosphericShadowBuilds
    }
    static atmosphericShadowBuilds = 0
    drawAtmosphericShadow(ctx, _grid) {
        if (!otherSettings.atmosphericVisuals) return
        this.ensureGeometry(_grid)
        if (!this.outline) return
        if (!this.atmosphericShadow) this.createAtmosphericShadow()
        const shadow = this.atmosphericShadow
        ctx.drawImage(shadow.canvas, shadow.left, shadow.top, shadow.width, shadow.height)
    }
    renderRim(ctx) {
        // Atmospheric tiles end in their own light grout: no black board outline.
        if (!this.rim || otherSettings.atmosphericVisuals)
            return

        ctx.save()
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = 'black'
        ctx.lineWidth = basis.strokeWidth
        ctx.stroke(this.rim)
        ctx.restore()
    }
    drawRim(ctx, _grid) {
        this.ensureGeometry(_grid)
        this.renderRim(ctx)
    }
}

// The data of the selection overlay (S6 borders): what a selected unit can reach and hit, read from the
// interaction's own searches after unit.select() (its way and range way). Movement is never changed here:
// only the step searches of targetsAfterStep are new searches, made with the classes the game itself uses.
// Cells are keyed 'x,y'. Targets are listed only on cells the viewer sees (grid.fogOfWar), so fog never
// reveals anything. An enemy unit selected gives the danger preview (its targets are the viewer's units).
class SelectionOverlay {
    constructor() {
        this.cache = undefined
    }
    static key(coord) {
        return coord.x + ',' + coord.y
    }
    static coordOf(key) {
        const [x, y] = key.split(',')
        return {x: +x, y: +y}
    }
    // The radius select() searches the moves with (the full speed for a unit that is not on its turn).
    static moveRadius(unit) {
        return unit.isMyTurn ? unit.interaction.moves : unit.interaction.speed
    }
    static isRanged(interaction) {
        return !!interaction.rangeWay
    }
    static isSiege(interaction) {
        return typeof InteractionWithCatapult != 'undefined' && interaction instanceof InteractionWithCatapult
    }
    static seen(coord) {
        return !isFogOfWar || !grid.fogOfWar || !!grid.fogOfWar[coord.x][coord.y]
    }
    // The fog bits of the cells the overlay can reach (offset coords: no hex distance exceeds |dx| or |dy|).
    static fogKey(unit, reach) {
        if (!isFogOfWar || !grid.fogOfWar)
            return ''
        let key = ''
        const x0 = Math.max(0, unit.coord.x - reach), x1 = Math.min(grid.arr.length - 1, unit.coord.x + reach)
        const y0 = Math.max(0, unit.coord.y - reach), y1 = Math.min(grid.arr[0].length - 1, unit.coord.y + reach)
        for (let x = x0; x <= x1; ++x)
            for (let y = y0; y <= y1; ++y)
                key += grid.fogOfWar[x][y] ? 1 : 0
        return key
    }
    // The cells a finished search reached with a distance up to radius (the start cell left out).
    static reached(way, from, radius) {
        const cells = []
        for (const key of way.distanceOf.keys()) {
            const coord = {x: Math.floor(key / WAY_KEY_STRIDE), y: key % WAY_KEY_STRIDE}
            if (!coordsEqually(coord, from) && way.isUsed(coord) && way.distanceAt(coord) <= radius)
                cells.push(coord)
        }
        return cells
    }
    // A search made only for the overlay: it must not reset or show the logic texts of the selection.
    static quietSearch(fn) {
        const drawLogicText = grid.drawLogicText, own = Object.prototype.hasOwnProperty.call(grid, 'newLogicText')
        const newLogicText = grid.newLogicText
        grid.newLogicText = () => {}
        try {
            return fn()
        } finally {
            if (own)
                grid.newLogicText = newLogicText
            else
                delete grid.newLogicText
            grid.drawLogicText = drawLogicText
        }
    }
    // The range search a ranged unit would make standing on coord: the archer's range and way depend on the
    // cell (InteractionWithArcher.updateRange); other ranged units keep theirs.
    static rangeSearchFrom(interaction, unit, coord) {
        let way, range = interaction.range
        if (interaction.standartRangeWay) {
            const increase = grid.getBuilding(coord).rangeIncrease
            range = interaction.standartRange + (increase || 0)
            way = increase ? new RangeWay() : new ArcherRangeWay()
        } else
            way = new (interaction.rangeWay.constructor)()
        way.create(coord, range, grid.arr, unit.playerColor, SelectionOverlay.noBorder)
        return SelectionOverlay.reached(way, coord, range)
    }
    static noBorder = {createLine() {}}
    // The overlay data of the selected unit, or undefined when it is not on the board. Cached per
    // (unit, coord, moves, fog state); any change recomputes.
    compute(unit) {
        const interaction = unit && unit.interaction
        if (!interaction || !unit.coord || grid.getUnit(unit.coord) !== unit || !interaction.way)
            return undefined
        const radius = SelectionOverlay.moveRadius(unit), ranged = SelectionOverlay.isRanged(interaction)
        const id = [SelectionOverlay.key(unit.coord), interaction.moves, radius, interaction.range, whooseTurn,
            SelectionOverlay.fogKey(unit, radius + (ranged ? interaction.range + 2 : 1))].join('|')
        if (this.cache && this.cache.unit === unit && this.cache.id === id)
            return this.cache
        const data = this.build(unit, interaction, radius, ranged)
        data.unit = unit
        data.id = id
        ++SelectionOverlay.builds
        return this.cache = data
    }
    static builds = 0
    build(unit, interaction, radius, ranged) {
        const key = SelectionOverlay.key, player = unit.playerColor
        const siege = SelectionOverlay.isSiege(interaction)
        // Ranged select() makes no range search once the unit's own turn is done.
        const rangeShown = ranged && !(interaction.isTurnFinished && interaction.isTurnFinished(unit))
        const moveCells = new Map()
        for (const coord of SelectionOverlay.reached(interaction.way, unit.coord, radius)) {
            const cell = grid.arr[coord.x][coord.y]
            if (!interaction.way.cellHasEnemyEntity(cell, player))
                moveCells.set(key(coord), interaction.way.distanceAt(coord))
        }
        const rangeCells = new Set(), rangeExcluded = new Set()
        const candidates = new Map(SelectionOverlay.reached(interaction.way, unit.coord, radius).map(c => [key(c), c]))
        if (rangeShown) {
            for (const coord of SelectionOverlay.reached(interaction.rangeWay, unit.coord, interaction.range)) {
                candidates.set(key(coord), coord)
                if (grid.getBuilding(coord).isStaticNature)
                    rangeExcluded.add(key(coord))
                else
                    rangeCells.add(key(coord))
            }
        }
        // Hit now: the game's own answer on every cell its searches reached.
        const targetsNow = new Set()
        if (!ranged || rangeShown) {
            for (const [k, coord] of candidates) {
                if (SelectionOverlay.seen(coord) &&
                        interaction.canHitSomethingOnCell(grid.arr[coord.x][coord.y], unit))
                    targetsNow.add(k)
            }
        }
        // Hit after a step (ranged, not siege): enemy units in range of a move cell reached with a move left.
        const targetsAfterStep = new Map()
        if (rangeShown && !siege) {
            SelectionOverlay.quietSearch(() => {
                for (const [k, distance] of moveCells) {
                    if (distance >= radius)
                        continue
                    const from = SelectionOverlay.coordOf(k)
                    for (const coord of SelectionOverlay.rangeSearchFrom(interaction, unit, from)) {
                        const target = key(coord), cell = grid.arr[coord.x][coord.y]
                        if (targetsAfterStep.has(target) || !SelectionOverlay.seen(coord) ||
                                !interaction.cellHasEnemyUnit(cell, unit))
                            continue
                        targetsAfterStep.set(target, from)
                    }
                }
            })
        }
        const moveSet = new Set([...moveCells.keys(), key(unit.coord)])
        const rangeSet = new Set([...rangeCells, key(unit.coord)])
        return {
            coord: {x: unit.coord.x, y: unit.coord.y}, moves: interaction.moves, radius, ranged: rangeShown, siege,
            range: interaction.range, moveCells, rangeCells, rangeExcluded, targetsNow, targetsAfterStep,
            moveLoops: SelectionOverlay.edgeLoops(moveSet),
            rangeLoops: rangeShown ? SelectionOverlay.edgeLoops(rangeSet) : []
        }
    }
    clean() {
        this.cache = undefined
    }
    // The boundary edges of a set of cells (side i: vertex i to i + 1, as Border.createLine), chained into
    // closed loops (outer loops clockwise on screen, holes counter-clockwise). Each loop: its points P, edge
    // normals N (outward), corner normals M (k: the stretch keeping an offset edge parallel) and convexity.
    static edgeLoops(set) {
        const round = p => Math.round(p[0] * 10) + ':' + Math.round(p[1] * 10)
        const edges = new Map()
        for (const k of set) {
            const coord = SelectionOverlay.coordOf(k), cell = grid.arr[coord.x][coord.y]
            const vertices = SelectionOverlay.vertices(cell.hexagon.calcPos())
            cell.hexagon.neighbours.forEach((n, i) => {
                const inside = !isCoordNotOnMap(n, grid.arr.length, grid.arr[0].length) &&
                    set.has(SelectionOverlay.key(n))
                if (!inside)
                    edges.set(round(vertices[i]), [vertices[i], vertices[(i + 1) % 6]])
            })
        }
        const loops = [], seen = new Set()
        for (const [start] of edges) {
            if (seen.has(start))
                continue
            const P = []
            for (let k = start; edges.has(k) && !seen.has(k);) {
                seen.add(k)
                const [a, b] = edges.get(k)
                P.push(a)
                k = round(b)
            }
            if (P.length > 2)
                loops.push(SelectionOverlay.loopNormals(P))
        }
        return loops
    }
    static vertices(p) {
        const r = basis.r, h = r * Math.sqrt(3) / 2
        return [[p.x - r / 2, p.y - h], [p.x + r / 2, p.y - h], [p.x + r, p.y],
            [p.x + r / 2, p.y + h], [p.x - r / 2, p.y + h], [p.x - r, p.y]]
    }
    static loopNormals(P) {
        const n = P.length, N = []
        for (let i = 0; i < n; ++i) {
            const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy)
            N.push({x: dy / l, y: -dx / l})
        }
        const M = P.map((_, i) => {
            const a = N[(i - 1 + n) % n], b = N[i], x = a.x + b.x, y = a.y + b.y, l = Math.hypot(x, y) || 1
            const m = {x: x / l, y: y / l}
            m.k = 1 / Math.max(0.35, m.x * b.x + m.y * b.y)
            return m
        })
        const convex = P.map((_, i) => {
            const a = N[(i - 1 + n) % n], b = N[i]
            return a.x * b.y - a.y * b.x > 0
        })
        return {P, N, M, convex}
    }
    // The loop's points moved along the corner normals by offset hex radii (negative: inward).
    static offsetPoints(loop, offset) {
        return loop.P.map((p, i) => [p[0] + loop.M[i].x * offset * basis.r * loop.M[i].k,
            p[1] + loop.M[i].y * offset * basis.r * loop.M[i].k])
    }
    // Adds the loops, offset and with corners rounded by rad hex radii, to the context's current path.
    static roundedOffset(ctx, loops, offset = 0, rad = 0.3) {
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        for (const loop of loops) {
            const Q = SelectionOverlay.offsetPoints(loop, offset), n = Q.length, m0 = mid(Q[n - 1], Q[0])
            ctx.moveTo(m0[0], m0[1])
            for (let i = 0; i < n; ++i) {
                const m = mid(Q[i], Q[(i + 1) % n])
                ctx.arcTo(Q[i][0], Q[i][1], m[0], m[1], basis.r * rad)
            }
            ctx.closePath()
        }
    }
}
