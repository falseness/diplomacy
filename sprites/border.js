class Border {
    constructor() {
        this.lines = []
        this.visible = true
    }
    clean() {
        this.lines = []
        ++Border.serial
    }
    // TASK-1411: bumped by every clean and new broken line (select, a reselect after a move or attack, undo, hideAll), so
    // the selection overlay's data and raster are made again for each selection state.
    static serial = 0
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
    // The selection overlay (S6) every Border shares; its draws replace the lines of a selected unit.
    static get selection() {
        return Border.overlay || (Border.overlay = new SelectionOverlay())
    }
    // The selected unit whose interaction filled border/attackBorder, or undefined (a building's
    // border, the headless stubs, nothing selected).
    static selectedUnit() {
        if (typeof gameEvent == 'undefined' || !gameEvent || !gameEvent.selected)
            return undefined
        const unit = gameEvent.selected
        return unit.isUnit && unit.interaction && unit.coord ? unit : undefined
    }
    isSelectionBorder() {
        return typeof border != 'undefined' && this === border || this.isAttackBorder()
    }
    isAttackBorder() {
        return typeof attackBorder != 'undefined' && this === attackBorder
    }
    // The selected unit's overlay state: its data (SelectionOverlay.compute) and which of the two borders show (range:
    // attackBorder, move: border; a cleaned border, as after hideAll or an inspected fogged unit, shows nothing, as its
    // lines did), or undefined.
    static selectionState() {
        const unit = typeof border != 'undefined' && Border.selectedUnit()
        if (!unit)
            return undefined
        const move = border.visible && !border.isCleaned()
        const range = typeof attackBorder != 'undefined' && attackBorder.visible && !attackBorder.isCleaned()
        const data = (move || range) && Border.selection.compute(unit)
        return data ? {data, move, range} : undefined
    }
    draw(ctx) {
        if (!this.visible)
            return
        const unit = !this.isCleaned() && this.isSelectionBorder() && Border.selectedUnit()
        const data = unit && Border.selection.compute(unit)
        if (data) {
            // TASK-1411: drawMain and the zoom gesture's frames blit the overlay's raster after the board
            // (SelectionOverlay.drawSelection), so no recorded, held or zoom raster board holds it.
            if (SelectionOverlay.deferred || typeof grid != 'undefined' && grid.zoomBoardPass)
                return
            // attackBorder's slot comes first: the range ridge lies under the move plate and the targets.
            if (this.isAttackBorder())
                Border.selection.drawRange(ctx, data)
            else
                Border.selection.drawMove(ctx, data)
            return
        }
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

        for (let x = 0; x < this.gridWidth; ++x) {
            for (let y = 0; y < this.gridHeight; ++y) {
                if (_grid.arr[x][y].building.isMapEdge)
                    continue
                const pos = _grid.arr[x][y].hexagon.calcPos()
                const vertices = this.getVertices(pos)
                const parity = x & 1
                const cellFaces = []

                for (let i = 0; i < vertices.length; ++i) {
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

        Object.assign(this, this.boundsOf(_grid))
        this.createUnderlayCache()
    }
    // The slab's bounds (shadow included) and its top face's (surfaceBounds) on a board: the vertices of its cells but the
    // map edge. _grid needs only arr[x][y].hexagon.calcPos() and .building.isMapEdge (TASK-1455: the menu's prebuild
    // takes them for a board not yet made, Grid.prebuildCellMaskSteps).
    boundsOf(_grid) {
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        for (let x = 0; x < _grid.arr.length; ++x)
            for (let y = 0; y < _grid.arr[x].length; ++y) {
                if (_grid.arr[x][y].building.isMapEdge)
                    continue
                for (const vertex of this.getVertices(_grid.arr[x][y].hexagon.calcPos())) {
                    minX = Math.min(minX, vertex.x)
                    maxX = Math.max(maxX, vertex.x)
                    minY = Math.min(minY, vertex.y)
                    maxY = Math.max(maxY, vertex.y)
                }
            }
        const shadowPadding = this.shadowBlur * 2
        return {
            bounds: {
                left: minX - shadowPadding,
                right: maxX + shadowPadding,
                top: minY - shadowPadding,
                bottom: maxY + this.depth + this.shadowOffset + shadowPadding
            },
            surfaceBounds: {left: minX, right: maxX, top: minY, bottom: maxY}
        }
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
    // TASK-1438: the static nature the range contour leaves out: an archer's range covers lakes, the catapult family's
    // (bombard, mortar) lakes and mountains; map-edge cells and other nature stay out. TASK-1451: an archer on raised
    // ground (its cell's rangeIncrease: hill, tower, town) shoots with the plain RangeWay, so its range covers mountains.
    static rangeExcludes(interaction, building, raised) {
        if (!building.isStaticNature)
            return false
        if (building.isMapEdge)
            return true
        if (typeof Lake != 'undefined' && building instanceof Lake)
            return !(interaction instanceof InteractionWithArcher || SelectionOverlay.isSiege(interaction))
        if (typeof Mountain != 'undefined' && building instanceof Mountain)
            return !(SelectionOverlay.isSiege(interaction) || raised && interaction instanceof InteractionWithArcher)
        return true
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
        const id = [Border.serial, SelectionOverlay.key(unit.coord), interaction.moves, radius, interaction.range, whooseTurn,
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
            const raised = !!grid.getBuilding(unit.coord).rangeIncrease
            for (const coord of SelectionOverlay.reached(interaction.rangeWay, unit.coord, interaction.range)) {
                candidates.set(key(coord), coord)
                if (SelectionOverlay.rangeExcludes(interaction, grid.getBuilding(coord), raised))
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
        // TASK-1437: a melee unit stands on the cell it hits when the hit leaves it standable (a last hit): that cell is
        // part of the move plate and keeps its hit-now emblem. Ranged and siege units never move onto their target.
        if (!ranged) {
            for (const k of targetsNow) {
                const coord = SelectionOverlay.coordOf(k), cell = grid.arr[coord.x][coord.y]
                if (interaction.way.cellHasEnemyEntity(cell, player) && SelectionOverlay.standsAfterHit(interaction, cell, unit))
                    moveCells.set(k, interaction.way.distanceAt(coord))
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
    // TASK-1437: whether move() would leave the melee unit on cell after its hit, predicted without side effects: the
    // target hitIfCellHasEnemy picks (an enemy building first, except a demon on its live portal), whether unit.dmg
    // kills it (a town only drops to 0 hp and stays), then cantStandOnCell on the cell as the hit would leave it.
    static standsAfterHit(interaction, cell, unit) {
        let building = cell.building, cellUnit = cell.unit
        if (interaction.cellHasEnemyBuilding(cell, unit) && !interaction.demonShieldsPortal(cell, unit) &&
                building.isHitable) {
            const hp = building.hp - unit.dmg
            if (building.isTown())
                building = Object.create(building, {hp: {value: Math.max(hp, 0)}})
            else if (hp <= 0)
                building = new Empty()
        } else if (interaction.cellHasEnemyUnit(cell, unit) && cellUnit.hp - unit.dmg <= 0)
            cellUnit = new Empty()
        const after = Object.create(cell, {building: {value: building}, unit: {value: cellUnit}})
        return !interaction.cantStandOnCell(after, unit)
    }
    clean() {
        this.cache = undefined
        this.releaseRaster()
    }
    // TASK-1411: the overlay is rendered once per selection state (its data, which borders show, the hexagon radius) and
    // camera scale into a canvas of its bounds plus the shadows' margin (renderRaster), and blitted in one drawImage a
    // frame after the board (drawMain: after a recorded, held or level-of-detail frame is made; drawZoomRaster: over the
    // zoom raster), never drawn into a recorded frame, a held frame's snapshot or the zoom raster. During a zoom gesture or
    // a camera move the raster is scaled and moved to the camera; once the camera rests it is rendered again when its scale
    // or pixel phase differs (a zoom settled). A raster bigger than RASTER_MAX_CANVASES canvases holds the view grown
    // by a quarter each side only, rendered again when the resting view leaves it.
    // TASK-1450: two such rasters, the plate and range ridge ('plate', drawSelection: under the attack and heal effects'
    // units) and the target icons ('icons', drawSelectionIcons: after those effects, with the selected unit's marks).
    static deferred = false
    static rasterBuilds = 0
    static iconBuilds = 0
    static RASTER_MAX_CANVASES = 2
    // Blits the selected unit's plate and range ridge on ctx (the main canvas, the camera's transform); releases the
    // rasters with no selection.
    static drawSelection(ctx) {
        return SelectionOverlay.blitSelection(ctx, 'plate')
    }
    // Blits the selected unit's target icons on ctx after every effect that draws units (drawMain), then its marks (a
    // catapult's blind-shot '?', TASK-1412), never into the board.
    static drawSelectionIcons(ctx) {
        const drawn = SelectionOverlay.blitSelection(ctx, 'icons')
        if (typeof gameEvent !== 'undefined')
            gameEvent.selected?.drawSelectionMarks?.(ctx)
        return drawn
    }
    static blitSelection(ctx, layer) {
        const overlay = Border.selection, state = Border.selectionState()
        if (!state) {
            overlay.releaseRaster()
            return false
        }
        const raster = overlay.rasterFor(ctx, state, layer)
        if (!raster)
            return false
        const t = ctx.getTransform()
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        ctx.shadowColor = 'rgba(0,0,0,0)'
        ctx.imageSmoothingEnabled = true
        if ('filter' in ctx)
            ctx.filter = 'none'
        const canvas = raster.canvas
        ctx.drawImage(canvas, t.a * raster.wx + t.e, t.d * raster.wy + t.f, canvas.width * t.a / raster.sx, canvas.height * t.d / raster.sy)
        ctx.restore()
        return true
    }
    // The raster for state on ctx's camera: the one made before while it stands for the frame, else a new one.
    rasterFor(ctx, state, layer) {
        const t = ctx.getTransform(), raster = this.rasters?.[layer]
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0)
            return undefined
        if (raster && raster.data === state.data && raster.move === state.move && raster.range === state.range &&
                raster.r === basis.r && !(raster.missingIcon && SelectionOverlay.whiteIcon(raster.missingIcon))) {
            const screen = typeof gameEvent != 'undefined' && gameEvent ? gameEvent.screen : undefined
            if (screen && SelectionOverlay.cameraMoving(screen))
                return raster
            const x = t.a * raster.wx + t.e, y = t.d * raster.wy + t.f
            if (raster.sx === t.a && raster.sy === t.d && Math.abs(x - Math.round(x)) < 1e-6 && Math.abs(y - Math.round(y)) < 1e-6 &&
                    (!raster.view || SelectionOverlay.contains(raster.view, SelectionOverlay.viewOf(ctx, t, 0))))
                return raster
        }
        return this.renderRaster(ctx, t, state, layer)
    }
    // A zoom gesture or a camera pan under way (not Screen.surfaceMoving's layer hold after them: settled is settled).
    static cameraMoving(screen) {
        return !!(screen.zoomGesture || screen.surfaceZooming || performance.now() < screen.surfacePanUntil || screen.surfacePanFrames > 0)
    }
    // The world rectangle ctx's canvas shows at camera t, grown by grow of its size each side.
    static viewOf(ctx, t, grow) {
        const w = ctx.canvas.width / t.a, h = ctx.canvas.height / t.d, x0 = -t.e / t.a, y0 = -t.f / t.d
        return {x0: x0 - grow * w, y0: y0 - grow * h, x1: x0 + w + grow * w, y1: y0 + h + grow * h}
    }
    static contains(a, b) {
        return a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1
    }
    // The world bounds of what state draws: its contours and target emblems, plus the shadows' and offsets' reach.
    static boundsOf(state, layer) {
        const data = state.data, r = basis.r, b = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity}
        const add = (x, y, m) => {
            b.x0 = Math.min(b.x0, x - m); b.y0 = Math.min(b.y0, y - m)
            b.x1 = Math.max(b.x1, x + m); b.y1 = Math.max(b.y1, y + m)
        }
        const loops = layer === 'icons' ? [] : [...state.move ? data.moveLoops : [], ...state.range && data.ranged ? data.rangeLoops : []]
        for (const loop of loops)
            for (const p of loop.P)
                add(p[0], p[1], 0.8 * r)
        if (state.move && layer === 'icons')
            for (const k of [...data.targetsNow, ...data.targetsAfterStep.keys()]) {
                const q = SelectionOverlay.targetPos(k)
                add(q.x, q.y, 0.9 * r)
            }
        return b.x0 < b.x1 ? b : undefined
    }
    // Renders state at camera t into the raster's canvas: the bounds (or their part near the view) at t's scale, with
    // the pixel phase of t, so a resting camera blits it at whole device pixels as the direct draws would land.
    renderRaster(ctx, t, state, layer) {
        let b = SelectionOverlay.boundsOf(state, layer), view
        if (!b) {
            this.releaseRaster(layer)
            return undefined
        }
        const sx = t.a, sy = t.d, limit = SelectionOverlay.RASTER_MAX_CANVASES * ctx.canvas.width * ctx.canvas.height
        if ((b.x1 - b.x0) * sx * (b.y1 - b.y0) * sy > limit) {
            view = SelectionOverlay.viewOf(ctx, t, 0.25)
            b = {x0: Math.max(b.x0, view.x0), y0: Math.max(b.y0, view.y0), x1: Math.min(b.x1, view.x1), y1: Math.min(b.y1, view.y1)}
            if (b.x0 >= b.x1 || b.y0 >= b.y1)
                b = {x0: view.x0, y0: view.y0, x1: view.x0 + 1 / sx, y1: view.y0 + 1 / sy}
        }
        const ix = Math.floor(sx * b.x0 + t.e), iy = Math.floor(sy * b.y0 + t.f)
        const w = Math.max(1, Math.ceil(sx * b.x1 + t.e) - ix), h = Math.max(1, Math.ceil(sy * b.y1 + t.f) - iy)
        const rasters = this.rasters || (this.rasters = {})
        const canvas = rasters[layer]?.canvas || document.createElement('canvas')
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
        }
        const g = canvas.getContext('2d')
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, w, h)
        g.save()
        // World x lands at sx x + t.e - ix: device x minus the raster's left pixel.
        g.setTransform(sx, 0, 0, sy, t.e - ix, t.f - iy)
        g.lineJoin = 'round'
        g.lineCap = 'round'
        this.missingIcon = undefined
        if (layer === 'icons') {
            this.drawTargets(g, state.data)
            ++SelectionOverlay.iconBuilds
        } else {
            if (state.range)
                this.drawRange(g, state.data)
            if (state.move)
                this.drawPlate(g, state.data)
            ++SelectionOverlay.rasterBuilds
        }
        g.restore()
        return rasters[layer] = {canvas, data: state.data, move: state.move, range: state.range, r: basis.r, sx, sy,
            wx: (ix - t.e) / sx, wy: (iy - t.f) / sy, view, missingIcon: this.missingIcon}
    }
    // The raster of layer, or both.
    releaseRaster(layer) {
        for (const name of layer ? [layer] : ['plate', 'icons']) {
            const raster = this.rasters?.[name]
            if (!raster)
                continue
            raster.canvas.width = raster.canvas.height = 0
            this.rasters[name] = undefined
        }
    }
    // The plate raster (the overlay's state before TASK-1450 split the icons out).
    get raster() {
        return this.rasters?.plate
    }
    // S6 look (concept drawS6): the range as a thin raised ridge pushed out 0.1 r; the move area as a soft
    // raised plate inset 0.1 r with no face fill, so the cells keep their own colour; neutral target emblems.
    // Light comes from the upper left; no hue carries meaning. Shadows scale with the context's transform.
    static scaleOf(ctx) {
        return ctx.getTransform ? Math.abs(ctx.getTransform().a) || 1 : 1
    }
    drawRange(ctx, data) {
        if (!data.ranged || !data.rangeLoops.length)
            return
        const r = basis.r, sc = SelectionOverlay.scaleOf(ctx)
        const path = () => SelectionOverlay.roundedOffset(ctx, data.rangeLoops, 0.1, 0.32)
        ctx.save()
        ctx.lineJoin = 'round'
        ctx.shadowColor = 'rgba(0,0,0,0.6)'
        ctx.shadowBlur = 0.08 * r * sc
        ctx.shadowOffsetX = 0.03 * r * sc
        ctx.shadowOffsetY = 0.045 * r * sc
        ctx.beginPath()
        path()
        ctx.strokeStyle = 'rgba(225,225,230,0.95)'
        ctx.lineWidth = 0.085 * r
        ctx.stroke()
        ctx.restore()
        ctx.save()
        ctx.lineJoin = 'round'
        ctx.translate(-0.012 * r, -0.016 * r)
        ctx.beginPath()
        path()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 0.035 * r
        ctx.stroke()
        ctx.restore()
    }
    drawMove(ctx, data) {
        this.drawPlate(ctx, data)
        this.drawTargets(ctx, data)
    }
    drawPlate(ctx, data) {
        if (data.moveLoops.length) {
            const frame = SelectionOverlay.frameOf(data.moveLoops)
            this.softPlate(ctx, () => SelectionOverlay.roundedOffset(ctx, data.moveLoops, -0.1, 0.32), frame)
        }
    }
    // The loops' bounds plus a margin, as a rectangle wound counter-clockwise: with the area's clockwise
    // loops the nonzero rule leaves the area a hole (cairo's shadows ignore evenodd), and a shadowed shape
    // bounded to the area keeps cairo drawing (a huge one silently stops later draws).
    static frameOf(loops) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const loop of loops)
            for (const p of loop.P) {
                x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1])
                x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1])
            }
        const m = 1.5 * basis.r
        return {x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m}
    }
    static frameRect(ctx, b) {
        ctx.moveTo(b.x0, b.y0)
        ctx.lineTo(b.x0, b.y1)
        ctx.lineTo(b.x1, b.y1)
        ctx.lineTo(b.x1, b.y0)
        ctx.closePath()
    }
    // A blurred light or shade inside the path, cast by the frame around it.
    innerShadow(ctx, path, frame, color, blur, dx, dy) {
        const r = basis.r, sc = SelectionOverlay.scaleOf(ctx)
        ctx.save()
        ctx.beginPath()
        path()
        ctx.clip()
        ctx.shadowColor = color
        ctx.shadowBlur = blur * r * sc
        ctx.shadowOffsetX = dx * r * sc
        ctx.shadowOffsetY = dy * r * sc
        ctx.beginPath()
        SelectionOverlay.frameRect(ctx, frame)
        path()
        ctx.fillStyle = '#000'
        ctx.fill()
        ctx.restore()
    }
    // The concept's softPlate with face 0 and sheen 0: drop shadow outside only, white inner light on the
    // upper-left edges, dark inner shade on the lower-right ones, a hairline rim.
    softPlate(ctx, path, frame) {
        const r = basis.r, sc = SelectionOverlay.scaleOf(ctx)
        ctx.save()
        ctx.beginPath()
        SelectionOverlay.frameRect(ctx, frame)
        path()
        ctx.clip()
        ctx.shadowColor = 'rgba(0,0,0,0.7)'
        ctx.shadowBlur = 0.3 * r * sc
        ctx.shadowOffsetX = 0.07 * r * sc
        ctx.shadowOffsetY = 0.1 * r * sc
        ctx.beginPath()
        path()
        ctx.fillStyle = '#000'
        ctx.fill()
        ctx.restore()
        for (let i = 0; i < 2; ++i)
            this.innerShadow(ctx, path, frame, 'rgba(255,255,255,0.95)', 0.06, 0.08, 0.11)
        for (let i = 0; i < 2; ++i)
            this.innerShadow(ctx, path, frame, 'rgba(0,0,0,0.6)', 0.07, -0.08, -0.11)
        ctx.save()
        ctx.beginPath()
        path()
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 0.012 * r
        ctx.stroke()
        ctx.restore()
    }
    drawTargets(ctx, data) {
        const icon = data.siege ? 'statBuildingDmg' : SelectionOverlay.isRanged(data.unit.interaction) ? 'statRange' : 'statDmg'
        for (const k of data.targetsAfterStep.keys())
            if (!data.targetsNow.has(k))
                this.stepRing(ctx, SelectionOverlay.targetPos(k))
        for (const k of data.targetsNow)
            this.emblem(ctx, SelectionOverlay.targetPos(k), icon)
    }
    static targetPos(key) {
        const coord = SelectionOverlay.coordOf(key), p = grid.arr[coord.x][coord.y].hexagon.calcPos()
        return {x: p.x, y: p.y - basis.r * 0.04}
    }
    // Hit after a step: a dashed white ring with a dark halo.
    stepRing(ctx, q) {
        const r = basis.r * 0.33
        ctx.save()
        ctx.setLineDash([r * 0.32, r * 0.24])
        ctx.lineCap = 'round'
        for (const [color, width] of [['rgba(0,0,0,0.6)', 0.3], ['#ffffff', 0.13]]) {
            ctx.beginPath()
            ctx.arc(q.x, q.y, r * 1.05, 0, 2 * Math.PI)
            ctx.strokeStyle = color
            ctx.lineWidth = r * width
            ctx.stroke()
        }
        ctx.restore()
    }
    // Hit now: a dark disc with a white rim and ticks and the white weapon icon.
    emblem(ctx, q, icon) {
        const r = basis.r * 0.33, sc = SelectionOverlay.scaleOf(ctx)
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.6)'
        ctx.shadowBlur = r * 0.7 * sc
        ctx.shadowOffsetY = r * 0.18 * sc
        const g = ctx.createRadialGradient(q.x - r * 0.3, q.y - r * 0.4, r * 0.1, q.x, q.y, r)
        g.addColorStop(0, '#3a3f4a')
        g.addColorStop(1, '#0c0e13')
        ctx.beginPath()
        ctx.arc(q.x, q.y, r, 0, 2 * Math.PI)
        ctx.fillStyle = g
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.lineWidth = r * 0.14
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.lineCap = 'round'
        ctx.beginPath()
        for (let a = 0; a < 4; ++a) {
            const dx = Math.cos(a * Math.PI / 2), dy = Math.sin(a * Math.PI / 2)
            ctx.moveTo(q.x + dx * r * 1.12, q.y + dy * r * 1.12)
            ctx.lineTo(q.x + dx * r * 1.5, q.y + dy * r * 1.5)
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.lineWidth = r * 0.26
        ctx.stroke()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = r * 0.12
        ctx.stroke()
        const image = SelectionOverlay.whiteIcon(icon)
        if (image)
            ctx.drawImage(image, q.x - r * 0.62, q.y - r * 0.62, r * 1.24, r * 1.24)
        else
            this.missingIcon = icon
        ctx.restore()
    }
    // The stat icon recoloured white (cached per icon).
    static whiteIcon(name) {
        const cache = SelectionOverlay.icons || (SelectionOverlay.icons = {})
        if (cache[name])
            return cache[name]
        const image = typeof assets != 'undefined' && assets[name]
        if (!image || !image.width || typeof document == 'undefined')
            return undefined
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 96
        const g = canvas.getContext('2d')
        g.drawImage(image, 0, 0, 96, 96)
        g.globalCompositeOperation = 'source-in'
        g.fillStyle = '#ffffff'
        g.fillRect(0, 0, 96, 96)
        return cache[name] = canvas
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
