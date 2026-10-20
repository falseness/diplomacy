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

        // One closed loop through every boundary edge (no hole, no second island): its fill
        // covers every cell (uncoveredParts relies on it).
        this.outlineComplete = new Set(orderedEdges).size === this.edges.length
        this.outline = new Path2D()
        this.outline.moveTo(orderedEdges[0].begin.x, orderedEdges[0].begin.y)
        for (let i = 0; i < orderedEdges.length; ++i)
            this.outline.lineTo(orderedEdges[i].end.x, orderedEdges[i].end.y)
        this.outline.closePath()

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
        this.coveredStrips = this.outline && this.outlineComplete ? this.findCoveredStrips(_grid) : []
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
    drawCacheRegion(ctx, region) {
        const visibleLeft = Math.max(region.left, canvas.offset.x)
        const visibleTop = Math.max(region.top, canvas.offset.y)
        const visibleRight = Math.min(
            region.right,
            canvas.offset.x + width
        )
        const visibleBottom = Math.min(
            region.bottom,
            canvas.offset.y + height
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
    drawUnderlay(ctx, _grid) {
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
            this.drawCacheRegion(ctx, region)
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
                    Math.min(face.begin.y, face.end.y) * t.d + t.f > ctx.canvas.height + 1))
                continue
            // Face geometry is replaced on rebuild; context keys do not retain
            // discarded canvases. Camera transforms need no new gradient.
            face.atmosphericGradients ||= new WeakMap()
            let shade = face.atmosphericGradients.get(ctx)
            if (!shade) {
                const colors = MapDepth.ATMOSPHERIC_FACES[face.notch ? 'notch' : face.side]
                shade = ctx.createLinearGradient(0, Math.min(face.begin.y, face.end.y), 0, Math.max(face.begin.y, face.end.y) + depth)
                shade.addColorStop(0, colors[0])
                shade.addColorStop(MapDepth.ATMOSPHERIC_FACE_EDGE, colors[1])
                shade.addColorStop(1, colors[2])
                face.atmosphericGradients.set(ctx, shade)
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
    // The board's cells as contiguous vertical strips (board units, left to right; a Float64Array of
    // left, right, top, bottom per strip): each column's
    // longest run of cells holds the rectangle between its hexagons' top and bottom edges, and
    // two neighbouring columns the strip between their rectangles where both run (one half
    // hexagon height short of either end, where the columns' hexagons still tile it). A strip
    // with no such interval (top >= bottom) separates the others.
    findCoveredStrips(_grid) {
        const r = basis.r, h = r * Math.sqrt(3) / 2, eps = 1e-6 * r
        const columns = []
        for (let x = 0; x < this.gridWidth; ++x) {
            let run, best
            for (let y = 0; y < this.gridHeight; ++y) {
                if (_grid.arr[x][y].building.isMapEdge) {
                    run = undefined
                    continue
                }
                const pos = _grid.arr[x][y].hexagon.calcPos()
                if (run && Math.abs(pos.x - run.x) < eps && Math.abs(pos.y - h - run.bottom) < eps)
                    run.bottom = pos.y + h
                else
                    run = {x: pos.x, top: pos.y - h, bottom: pos.y + h}
                if (!best || run.bottom - run.top > best.bottom - best.top)
                    best = run
            }
            columns.push(best)
        }
        const strips = []
        for (let x = 0; x < columns.length; ++x) {
            const run = columns[x], next = columns[x + 1]
            if (!run)
                continue
            strips.push([run.x - r / 2, run.x + r / 2, run.top, run.bottom])
            if (next && Math.abs(next.x - run.x - 1.5 * r) < eps)
                strips.push([run.x + r / 2, next.x - r / 2, Math.max(run.top, next.top) + h, Math.min(run.bottom, next.bottom) - h])
        }
        // Per strip: left, right, top, bottom (left ascending).
        return Float64Array.from(strips.flat())
    }
    // The parts of ctx's canvas (whole device pixels, under its axis-aligned transform t) that
    // the board does not cover with opaque pixels, as rectangles: every board frame draws its
    // outline fill (drawUnderlay, which needs the underlay cache) or its surface cache (whose
    // underlay fills the outline) at full opacity over the rest. The canvas is cut into
    // BAND_COUNT horizontal bands; in each, the covered span is the widest run of contiguous
    // strips (findCoveredStrips) that all reach m device pixels above and below the band, less
    // m at each end (m: three texels of the coarser of the surface cache and the canvas, for
    // the bilinear or mipmapped sampling of the cache's antialiased edge, and two pixels),
    // snapped inward. Undefined when no band has a covered span.
    uncoveredParts(ctx, t, _grid) {
        // The transform's terms as numbers (a DOMMatrix property read is a binding call).
        const ta = t.a, td = t.d, te = t.e, tf = t.f
        const W = ctx.canvas.width, H = ctx.canvas.height, k = Math.min(ta, td)
        const m = (3 / Math.min(_grid.getSurfaceCacheGeometry().scale, k) + 2 / k) * k
        // The strips on the canvas (device x within m of it): first..last.
        const s = this.coveredStrips, n = s.length / 4
        let first = 0, last = n
        for (let hi = n; first < hi;) {
            const mid = (first + hi) >> 1
            if (s[4 * mid + 1] * ta + te > -m)
                hi = mid
            else
                first = mid + 1
        }
        while (last > first && s[4 * (last - 1)] * ta + te >= W + m)
            --last
        // One pass over the strips: per band, the run of contiguous strips reaching m pixels above
        // and below it that is open at this strip (runLeft, NaN when none) and the widest so far.
        const B = MapDepth.BAND_COUNT, scratch = MapDepth.bandScratch
        const y0s = scratch.y0, y1s = scratch.y1, tops = scratch.top, bottoms = scratch.bottom
        const runLeft = scratch.runLeft, bestLeft = scratch.bestLeft, bestRight = scratch.bestRight
        for (let band = 0; band < B; ++band) {
            y0s[band] = Math.round(H * band / B)
            y1s[band] = Math.round(H * (band + 1) / B)
            // Board rows that reach m pixels above and below the band.
            tops[band] = (y0s[band] - m - tf) / td
            bottoms[band] = (y1s[band] + m - tf) / td
            runLeft[band] = NaN
            bestLeft[band] = bestRight[band] = 0
        }
        let previousRight = NaN
        for (let i = first; i < last; ++i) {
            const stripLeft = s[4 * i] * ta + te, stripRight = s[4 * i + 1] * ta + te
            const contiguous = Math.abs(stripLeft - previousRight) <= 1e-6 * W
            for (let band = 0; band < B; ++band) {
                if (s[4 * i + 2] > tops[band] || s[4 * i + 3] < bottoms[band]) {
                    runLeft[band] = NaN
                    continue
                }
                if (!contiguous || runLeft[band] !== runLeft[band])
                    runLeft[band] = stripLeft
                const x0 = Math.max(0, Math.ceil(runLeft[band] + m)), x1 = Math.min(W, Math.floor(stripRight - m))
                if (x1 - x0 > bestRight[band] - bestLeft[band]) {
                    bestLeft[band] = x0
                    bestRight[band] = x1
                }
            }
            previousRight = stripRight
        }
        const groups = [], width = span => span && span.right > span.left ? span.right - span.left : 0
        let group
        for (let band = 0; band < B; ++band) {
            const y0 = y0s[band], y1 = y1s[band]
            if (y1 <= y0)
                continue
            // Bands group while one span (their spans' intersection) loses under MERGE_AREA of
            // the canvas' coverage: fewer clipped draws for a few more pixels. Bands without a
            // span group freely.
            const span = bestRight[band] > bestLeft[band] ? {left: bestLeft[band], right: bestRight[band]} : undefined
            if (group) {
                const both = group.span && span && {left: Math.max(group.span.left, span.left), right: Math.min(group.span.right, span.right)}
                const lost = width(group.span) * (group.y1 - group.y0) + width(span) * (y1 - y0) - width(both) * (y1 - group.y0)
                if (lost <= MapDepth.MERGE_AREA * W * H) {
                    group.y1 = y1
                    group.span = width(both) ? both : undefined
                    continue
                }
                groups.push(group)
            }
            group = {y0, y1, span}
        }
        if (group)
            groups.push(group)
        const parts = []
        let covered = false
        for (const {y0, y1, span} of groups) {
            if (span)
                covered = true
            for (const [x0, x1] of span ? [[0, span.left], [span.right, W]] : [[0, W]])
                if (x1 > x0)
                    parts.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0})
        }
        return covered ? parts : undefined
    }
    // The whole-width rows of parts (uncoveredParts): every row that holds a part, as full-width
    // rectangles (consecutive rows merged).
    partRows(parts, W) {
        const rows = []
        for (const {y, h} of parts) {
            const last = rows[rows.length - 1]
            if (last && last.y + last.h >= y)
                last.h = Math.max(last.h, y + h - last.y)
            else
                rows.push({x: 0, y, w: W, h})
        }
        return rows
    }
    static BAND_COUNT = 8
    static MERGE_AREA = 0.025
    // Per-band working arrays of uncoveredParts (reused every frame).
    static bandScratch = Object.fromEntries(['y0', 'y1', 'top', 'bottom', 'runLeft', 'bestLeft', 'bestRight']
        .map(name => [name, new Float64Array(MapDepth.BAND_COUNT)]))
    // The parts of ctx's canvas the board does not cover (uncoveredParts) this frame, or
    // undefined to draw the whole canvas: classic visuals, no underlay cache, a rotated
    // transform, or a board covering under MIN_COVERED of the canvas (the clipped draws would
    // cost more than the pixels they skip). Cached for the transform: the sky and the slab
    // shadow of one frame share them. rows: their whole-width rows (partRows), for a scaled
    // image such as the shadow: a clip that starts a row's span elsewhere can step the image's
    // sampling to a different rounding there (seen as +-1 in a column), so its clips only cut rows.
    uncoveredOf(ctx, _grid, rows = false) {
        if (!otherSettings.atmosphericVisuals || !_grid)
            return undefined
        this.ensureGeometry(_grid)
        const t = ctx.getTransform(), a = t.a, d = t.d, e = t.e, f = t.f
        if (!this.underlayCache || !this.coveredStrips?.length || t.b !== 0 || t.c !== 0 || a <= 0 || d <= 0)
            return undefined
        const W = ctx.canvas.width, H = ctx.canvas.height, scale = _grid.getSurfaceCacheGeometry().scale
        const u = this.uncovered
        if (!u || u.strips !== this.coveredStrips || u.a !== a || u.d !== d || u.e !== e || u.f !== f ||
                u.W !== W || u.H !== H || u.scale !== scale) {
            const parts = this.uncoveredParts(ctx, {a, d, e, f}, _grid), rowParts = parts && this.partRows(parts, W)
            this.uncovered = {strips: this.coveredStrips, a, d, e, f, W, H, scale,
                parts: parts && W * H - MapDepth.area(parts) >= MapDepth.MIN_COVERED * W * H ? parts : undefined,
                rows: rowParts && W * H - MapDepth.area(rowParts) >= MapDepth.MIN_COVERED * W * H ? rowParts : undefined}
        }
        return rows ? this.uncovered.rows : this.uncovered.parts
    }
    static MIN_COVERED = 0.25
    static area(rects) {
        let sum = 0
        for (let k = 0; k < rects.length; ++k)
            sum += rects[k].w * rects[k].h
        return sum
    }
    // Calls draw once for each of parts (uncoveredOf) that meets bounds (the device rectangle
    // draw can paint), clipped to it, or once unclipped when parts is undefined. The clips are
    // whole-pixel rectangles, so every pixel they keep is drawn exactly as without them; draw
    // must have no effect besides its pixels (it does not run when no part meets bounds).
    drawClipped(ctx, parts, draw, bounds) {
        if (!parts) {
            draw()
            return
        }
        const t = ctx.getTransform()
        for (const {x, y, w, h} of parts) {
            if (x >= bounds.right || x + w <= bounds.left || y >= bounds.bottom || y + h <= bounds.top)
                continue
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.beginPath()
            ctx.rect(x, y, w, h)
            ctx.clip()
            ctx.setTransform(t)
            draw()
            ctx.restore()
        }
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
    // The slab shadow (drawAtmosphericShadow) where the board does not cover it: only the canvas
    // rows that hold an uncovered part (uncoveredOf's rows) and meet the shadow's rectangle.
    drawUncoveredShadow(ctx, _grid) {
        const rows = this.uncoveredOf(ctx, _grid, true), shadow = this.atmosphericShadow
        if (!rows || !shadow) {
            this.drawAtmosphericShadow(ctx, _grid)
            return
        }
        const t = ctx.getTransform()
        const bounds = {left: shadow.left * t.a + t.e - 1, right: (shadow.left + shadow.width) * t.a + t.e + 1,
            top: shadow.top * t.d + t.f - 1, bottom: (shadow.top + shadow.height) * t.d + t.f + 1}
        this.drawClipped(ctx, rows, () => this.drawAtmosphericShadow(ctx, _grid), bounds)
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
