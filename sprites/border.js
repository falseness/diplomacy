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
    // The board's solid backing under the cells (drawUnderlay, renderUnderlay); TASK-1571: the plain ground fill of a lit
    // square without its tile (Grid.drawGroundFill).
    static GROUND_FILL = '#4d5150'
    // TASK-1583: atmospheric slab sides are fractured rock (the concept's base under the board outline): a skirt below
    // each exposed lower edge (sides 2 lower right, 3 bottom, 4 lower left; a bottom face in a notch between protruding
    // cells, notch) down to a rocky foot, deeper than the slab (depth, which the camera frames; the skirt runs into the
    // sky margin; sideDepth = ROCK.depth hex radii). The rock is one field in the board's lattice frame (a cell's place by
    // its column and row, the same at any screen size), periodic over period (columns, rows in half hex heights): every face draws the part
    // of the same field under it, so neighbouring faces join without a seam and a face's sprite depends only on its side
    // and its cell's place in the period (rockSprite, built once per hex radius, MapDepth.rockBuilds, at ROCK.raster
    // pixels per world unit). The field: dense rounded boulders (a jittered grid of chunk x by chunk y hex radii, each a
    // dome around its seed (chunk.dome) of its own tone: the boulder's face is the lit golden-grey surface, brightest on
    // its crown (chunk.face: the level at its edge relative to the crown), with a soft key-light glow on slopes facing the
    // upper left and a faint shade away (chunk.slope, capped at lightMax; not over the plain stone at a vertex, which sits
    // at the mean boulder level chunk.plain), thin dark gaps between boulders, a little wider and darker towards the foot:
    // crease), grey stone turning cool grey and slightly darker towards the foot (top, bottom), each face its own tone by its turn from the key
    // (tone, blended to the mean of both faces within corner hex radii of a vertex), a shade under the rim's overhang and a
    // lit ledge (tiers), the rim's warm light below the rim (rimLight: a glow of alpha falling off over falloff hex radii
    // right under the rim plus a faint tail down to reach, on crowns and creases alike from base up), teal light leaking from the creases near some crack
    // centres in the lower stone (crack: a continuous vein along the crack's path (crack.path), brighter on the gaps it
    // crosses, in a soft halo and a cool cast on the stone around), and a foot level
    // with the board: scallop.depth hex radii below the outline's upper level, deeper by up to scallop.amplitude under a
    // protruding cell, each block of the foot hanging its own way (scallop.jag) with a dark underside (lip).
    static ROCK = {
        depth: 2.3,
        period: {columns: 10, rows: 4},
        scallop: {depth: 1.5, amplitude: 0.35, flat: 0.35, ramp: 0.55, jag: 0.12, knot: 0.3},
        pad: 0.12,
        corner: 0.3,
        // (the outline's smoothing for depths below it, hex radii either side)
        smooth: 0.25,
        // Plain stone near every outline vertex (no crease, bevel, block tilt or tone, crack line) within plain[0] hex
        // radii, fading to the full field by plain[1]: both faces draw the same pixels down the vertex column.
        plain: [0.13, 0.2],
        raster: 1.25,
        stone: [128, 118, 102],
        // (the lower stone's cool grey, blended in towards the foot)
        stoneLow: [112, 114, 118],
        top: 0.27,
        bottom: 0.77,
        tiers: [{at: 0.3, width: 0.08, gain: -0.04}, {at: 0.65, width: 0.15, gain: -0.05}],
        tone: {2: 0.72, 3: 1.0, 4: 1.35, notch: 0.82},
        chunk: {x: 0.7, y: 0.55, tone: 0.14, tilt: 0.3, grain: 0.03, bevel: 0.35, dome: 0.85, slope: 0.05, face: 0.5, plain: 0.7, lightMax: 0.22, shadow: 0.1,
            glow: [236, 172, 110], shade: [70, 68, 68]},
        rim: {width: 0.15, steps: 8, colors: ['#ffe2a0', '#fff4d4', '#ffcc70', '#eea448', '#c88032'], groove: 'rgba(30, 16, 6, 0.25)', grooveWidth: 0.03,
            // TASK-1661: the upper rim (upperRuns): its width (of the lower rim's) and colours from its outer side to the outline,
            // sampled off the concept's top rim (a yellow highlight, then saturated gold)
            upper: 0.82,
            // TASK-1663: the side walls' rim (over the slab faces) side times the lower rim's width (the concept's heavy frame)
            side: 1.6, sideColors: {left: ['#ffd36a', '#faba4a', '#fa9521', '#f4790f', '#c85a14'], right: ['#f0c070', '#d99d5a', '#c2954f', '#bf7439', '#8a5a30']},
            upperEdge: {width: 0.024, color: '#4a3418'},
            upperColors: ['#ffd25a', '#f6b938', '#eb9a30', '#d07a30', '#a85a24']},
        crack: {spacing: 0.6, share: 0.45, at: [0.5, 0.75], steps: [5, 8], step: 0.14, branch: 0.5, line: 0.035, halo: 0.08, snap: 0.09,
            path: 0.03, seed: 20, color: [20, 200, 235], alpha: {line: 1.5, halo: 0.06, path: 1.3}, cast: {reach: 0.5, amount: 0.04}},
        // A warm highlight down the protruding corners of the outline (flat within flat of the corner, so the vertex
        // column is no thin line, then falling off over width; reach hex radii, alpha).
        edge: {flat: 0.15, width: 0.1, reach: 1.0, alpha: 0.3},
        crease: {width: [0.012, 0.03], dark: [0.05, 0.25], band: 0.012},
        lip: {solid: 0.13, width: 0.1, dark: 1.0},
        rimLight: {color: [255, 175, 95], alpha: 2.3, falloff: 0.15, tail: 0.12, base: 0.5, reach: 1.0, tint: [1.05, 1.0, 0.92], tintReach: 1.4},
        // TASK-1662: the board's left and right walls (an open face's rock past its open vertex, rockPixelSteps sideOutline):
        // solid rock just past the side vertices as the concept's, out hex radii (the left wall's past an open face's end
        // vertex, the right wall's past its begin vertex: the concept's right wall is the thicker, 0.071 vs 0.060 hex
        // widths, TASK-1660 targets.json), with a rounded stone per boulder row stepping out by stones[row % 3] more (row 0
        // right under a side vertex: the rock under the corners, row 1 at the notch; an uneven stone wall, not a clipped
        // line, at 27 px hexes too)
        wall: {out: {left: 0.015, right: 0.05}, stones: [0.06, 0.3, 0.0]},
        // TASK-1663: the side walls as the concept's (artifacts/TASK-1663/diag-concept-left.png, -right.png): under each lower
        // side edge (markOpenFaces 's') the hex prism's side face, hanging from the edge down to depth hex heights below its
        // outer vertex (a level bottom), its outer side from that vertex leaning out by lean per unit of drop (the face seen
        // from above the board), sky below it down to the next cell's vertex and none past the side otherwise. The left face
        // lit warm gold, the right one shaded blue-grey (colours from the face's top, under the rim, to its foot), with
        // vertical streaks (streak hex radii wide, +- amount), a lit outer corner (left) and a dark lip at the foot. (The left
        // face's gold keeps green at ~0.7 of red: the sky's orange nebulae behind the board's sides are ~0.52.)
        slab: {depth: 1.2, lean: {left: 0.35, right: 0.4}, lip: 0.06, round: 0.12,
            streak: {width: 0.11, amount: 0.12}, corner: {width: 0.05, gain: {left: 0.35, right: 0.12}},
            colors: {left: [[246, 178, 84], [214, 150, 64], [188, 132, 56], [140, 96, 42]], right: [[104, 110, 116], [74, 78, 82], [56, 58, 60], [36, 37, 40]]}}
    }
    static rockSprites = null
    static rockBuilds = 0
    // Atmospheric drop shadow: the slab (top face and sides) casts a soft shadow onto the sky away
    // from the upper-left key light, only below and right of it: a broad layer and a near one (blur
    // and offset in hex radii; each offset exceeds the blur reach so nothing spills left or above).
    // A small cached raster (raster pixels per hex radius), drawn scaled under the board.
    // TASK-1585: and a near-black void under the board (a layer's own color): the concept's board floats over a dark
    // background, the night sky showing only further off.
    static ATMOSPHERIC_SHADOW = {
        color: 'rgba(8, 8, 11, 0.66)',
        layers: [{blur: 0.6, x: 0.9, y: 1.2}, {blur: 0.2, x: 0.35, y: 0.45}, {blur: 1, x: 0, y: 3.6, color: 'rgb(12, 12, 12)'}],
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
        // TASK-1583: the atmospheric rock skirt's reach below the edges (sideDepth).
        this.rockDepth = MapDepth.ROCK.depth * basis.r
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
            this.lowerRuns = []
            this.upperRuns = []
            this.rimRibbons = undefined
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

        // TASK-1563: SectorPaths, so the sector snapshots of lit tiles (SectorRecorder) keep the outline and rim they draw.
        this.outline = typeof SectorPath === 'function' ? new SectorPath() : new Path2D()
        this.outline.moveTo(orderedEdges[0].begin.x, orderedEdges[0].begin.y)
        for (let i = 0; i < orderedEdges.length; ++i)
            this.outline.lineTo(orderedEdges[i].end.x, orderedEdges[i].end.y)
        this.outline.closePath()
        // The outline's points, as the path above (closed back to the first).
        this.outlineLoop = [orderedEdges[0].begin, ...orderedEdges.map(edge => edge.end)]

        this.rim = typeof SectorPath === 'function' ? new SectorPath() : new Path2D()
        for (let i = 0; i < this.edges.length; ++i) {
            this.rim.moveTo(this.edges[i].begin.x, this.edges[i].begin.y)
            this.rim.lineTo(this.edges[i].end.x, this.edges[i].end.y)
        }
        // TASK-1583: the lower edges (the rock skirt's sides 2-4) as runs along the outline, from an edge that is not one
        // (so no run is split at the loop's start), and the brass rim on them (rimRibbons).
        // TASK-1661: and the upper edges (sides 5, 0, 1: the top and the side columns' upper edges) as runs of their own
        // (upperRuns), for the rim along the whole outline as the concept's.
        const lower = edge => edge.side >= 2 && edge.side <= 4
        const runsOf = (inRun) => {
            const start = Math.max(0, orderedEdges.findIndex(edge => !inRun(edge))), runs = []
            let run = null
            for (let i = 0; i < orderedEdges.length; ++i) {
                const edge = orderedEdges[(start + i) % orderedEdges.length]
                if (!inRun(edge)) {
                    run = null
                    continue
                }
                if (!run) {
                    runs.push(run = [edge.begin])
                    run.before = orderedEdges[(start + i - 1 + orderedEdges.length) % orderedEdges.length]
                    run.first = edge
                }
                run.push(edge.end)
                run.after = orderedEdges[(start + i + 1) % orderedEdges.length]
                run.last = edge
            }
            return runs
        }
        this.lowerRuns = runsOf(lower)
        this.upperRuns = runsOf(edge => !lower(edge))
        // (TASK-1663: an upper run's end at a side wall's slab edge (a lower run of one slanted edge) of the same cell (a side
        // vertex, not a notch) turns round that vertex (upperRimPoint's mitre with that edge): the rim wraps the vertex as the
        // concept's)
        const slabEdge = edge => edge && lower(edge) && edge.side !== 3 && this.lowerRuns.some(run => run.length === 2 &&
            this.pointKey(run[0]) === this.pointKey(edge.begin) && this.pointKey(run[1]) === this.pointKey(edge.end))
        for (const run of this.upperRuns) {
            if (slabEdge(run.before) && run.before.cell === run.first.cell) run.from = run.before.begin
            if (slabEdge(run.after) && run.after.cell === run.last.cell) run.to = run.after.end
        }
        this.rimRibbons = this.createRimRibbons()
    }
    // TASK-1612: a lower face at an end of a lower run (lowerRuns) where the outline turns up round its own cell's corner
    // (the next or previous edge is an upper edge of the same cell: a convex corner, the board's left or right side), with no
    // rock face beyond that vertex, is open there: 'b' past its begin vertex (a right end: side 2 under the right corner), 'e'
    // past its end vertex (a left end: side 4 under the left corner). Its rock reaches past that vertex to the rock's own
    // outline (buildRockSprite), not to the sprite's box. (A run's end in a notch, where another cell's upper edge meets the
    // face, is hidden under that cell's top face: not open.)
    markOpenFaces() {
        const lower = edge => edge.side >= 2 && edge.side <= 4
        const byBegin = new Map(), byEnd = new Map()
        for (const edge of this.edges) {
            byBegin.set(this.pointKey(edge.begin), edge)
            byEnd.set(this.pointKey(edge.end), edge)
        }
        for (const face of this.faces) {
            const prev = byEnd.get(this.pointKey(face.begin)), next = byBegin.get(this.pointKey(face.end))
            const corner = edge => edge && !lower(edge) && edge.cell === face.cell
            face.open = (corner(prev) ? 'b' : '') + (corner(next) ? 'e' : '')
            // TASK-1663: a slanted lower face that is a lower run of its own between two upper edges (a side cell's lower
            // left / lower right edge: the board's left and right walls) is a slab face ('s', slabPixelSteps)
            if ((face.side === 2 || face.side === 4) && face.open && prev && next && !lower(prev) && !lower(next))
                face.open += 's'
        }
    }
    // TASK-1583: the brass rim under the lower edges as ribbons of the runs (lowerRuns), each the run and the run moved down
    // by its thickness (a vertical thickness on every edge, so at a corner both edges' bands cover the same rows): the
    // groove under the rim (rim width + groove), then ROCK.rim.steps ribbons from the rim's whole width (its foot colour)
    // to the narrowest (the edge's colour), filled widest first (renderAtmosphericSides). [{path, color}]
    // TASK-1661: and the rim over the upper edges (upperRuns), the runs moved up (outside the outline, over the sky), lit
    // from above: ROCK.rim.upperColors, the bright highlight at the rim's outer (upper) side, the gold's foot along the
    // outline (the concept's top rim); ROCK.rim.upper of the lower rim's width, no groove.
    createRimRibbons() {
        const R = MapDepth.ROCK.rim, rw = R.width * basis.r, ribbons = []
        const ribbon = (runs, thickness, color, offset = (points, i) => ({x: points[i].x, y: points[i].y + thickness})) => {
            const path = typeof SectorPath === 'function' ? new SectorPath() : new Path2D()
            for (const points of runs) {
                path.moveTo(points[0].x, points[0].y)
                for (let i = 1; i < points.length; ++i) path.lineTo(points[i].x, points[i].y)
                for (let i = points.length - 1; i >= 0; --i) {
                    const point = offset(points, i, thickness)
                    path.lineTo(point.x, point.y)
                }
                path.closePath()
            }
            ribbons.push({path, color})
        }
        // (TASK-1663: a run of one slanted edge between upper edges, a side wall's slab face (markOpenFaces 's'), has the
        // heavier side rim: ROCK.rim.side of the width)
        const slab = points => points.length === 2 && points[0].x !== points[1].x && points[0].y !== points[1].y
        // (its colours: ROCK.rim.sideColors, the concept's lit left / shaded right side rim; left = a run rising to the left)
        const leftward = points => (points[1].x - points[0].x) * (points[1].y - points[0].y) > 0
        const groups = [[this.lowerRuns.filter(points => !slab(points)), rw, R.colors],
            [this.lowerRuns.filter(points => slab(points) && leftward(points)), R.side * rw, R.sideColors.left],
            [this.lowerRuns.filter(points => slab(points) && !leftward(points)), R.side * rw, R.sideColors.right]]
        for (const [runs, width, colors] of groups) {
            if (!runs.length) continue
            ribbon(runs, width + R.grooveWidth * basis.r, R.groove)
            for (let i = R.steps - 1; i >= 0; --i) ribbon(runs, width * (i + 1) / R.steps, MapDepth.rimColor(i / (R.steps - 1), colors))
        }
        const uw = R.upper * rw
        // (TASK-1663: a thin dark bronze line outside it, the concept's rim edge against the sky: ROCK.rim.upperEdge)
        if (this.upperRuns?.length)
            ribbon(this.upperRuns, uw + R.upperEdge.width * basis.r, R.upperEdge.color, MapDepth.upperRimPoint)
        if (this.upperRuns?.length)
            for (let i = R.steps - 1; i >= 0; --i)
                ribbon(this.upperRuns, uw * (i + 1) / R.steps, MapDepth.rimColor(1 - i / (R.steps - 1), R.upperColors), MapDepth.upperRimPoint)
        return ribbons
    }
    // TASK-1661: a point of an upper run (points, i) moved out by thickness at right angles to its edges (the rim as wide
    // on the slanted upper edges as on the top ones): at a joint the meeting point of both edges' moved lines (mitre), at a
    // run's end where its moved edge line crosses the vertical through the end (a lower run's rim hangs straight down from it).
    static upperRimPoint(points, i, thickness) {
        // (the outward normal of the edge a -> b: the outline runs clockwise on screen, outside on the left of its way)
        const normal = (a, b) => {
            const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
            return {x: dy / length, y: -dx / length}
        }
        const p = points[i]
        // (TASK-1663: a run's end turning round a side vertex, run.from / run.to: a joint with that edge)
        const turn = i === 0 ? points.from : i === points.length - 1 ? points.to : undefined
        if (turn) {
            const n1 = i === 0 ? normal(turn, p) : normal(points[i - 1], p), n2 = i === 0 ? normal(p, points[1]) : normal(p, turn)
            const mx = n1.x + n2.x, my = n1.y + n2.y, dot = (mx * n1.x + my * n1.y) || 1
            return {x: p.x + mx * thickness / dot, y: p.y + my * thickness / dot}
        }
        if (i === 0 || i === points.length - 1) {
            const n = i === 0 ? normal(p, points[1]) : normal(points[i - 1], p)
            // (on the vertical through p: the moved line n.(q - p) = thickness)
            return {x: p.x, y: p.y + thickness / (n.y || -1)}
        }
        const n1 = normal(points[i - 1], p), n2 = normal(p, points[i + 1])
        const mx = n1.x + n2.x, my = n1.y + n2.y, dot = (mx * n1.x + my * n1.y) || 1
        return {x: p.x + mx * thickness / dot, y: p.y + my * thickness / dot}
    }
    rebuild(_grid) {
        // TASK-1633: a second rebuild of the same board with the same map edge (GameManager.start's map.start, then its
        // clearBasisValues: updateCameraBorders twice, 30-70 ms each) keeps the geometry, underlay and rock sprites it has.
        const sig = MapDepth.rebuildSkips ? this.geometrySig(_grid) : null
        if (sig !== null && this.outline && this.builtFor === _grid && this.builtSig === sig && this.builtR === basis.r &&
                this.underlayAtmospheric === otherSettings.atmosphericVisuals) {
            ++MapDepth.rebuildsSkipped
            return
        }
        this.builtFor = _grid
        this.builtSig = sig
        this.builtR = basis.r
        this.buildFaces(_grid)
        this.createOutline()
        this.markOpenFaces()
        this.releaseAtmosphericShadow()
        // TASK-1615: the board's rock sprites asked of the workers now, before its first lit tiles draw them.
        if (typeof otherSettings !== 'undefined' && otherSettings.atmosphericVisuals)
            MapDepth.requestRockSprites(this.rockKeys())

        Object.assign(this, this.boundsOf(_grid))
        // TASK-1633: its raster made by the underlay worker (createUnderlayCache's async path).
        this.createUnderlayCache(true)
    }
    // TASK-1633: what rebuild draws from a board: its size and which cells are map edge (the cells' positions follow from
    // their indices and the radius).
    geometrySig(_grid) {
        const arr = _grid.arr, rows = []
        for (let x = 0; x < arr.length; ++x) {
            let row = ''
            for (let y = 0; y < arr[x].length; ++y)
                row += arr[x][y].building.isMapEdge ? '1' : '0'
            rows.push(row)
        }
        return arr.length + 'x' + (arr[0]?.length || 0) + ':' + rows.join('|')
    }
    // TASK-1616: the slab's faces and edges of a board (rebuild's first part; _grid needs only arr[x][y].hexagon.calcPos()
    // and .building.isMapEdge, as boundsOf: MapDepth.rockKeysOf takes them for a board not yet made).
    buildFaces(_grid) {
        this.faces = []
        this.edges = []
        this.gridWidth = _grid.arr.length
        this.gridHeight = _grid.arr[0].length
        // TASK-1583: cells' rows in half hex heights from the first cell's (MapDepth.rockPlace).
        const origin = _grid.arr[0][0].hexagon.calcPos(), halfHex = basis.r * Math.sqrt(3) / 2

        for (let x = 0; x < this.gridWidth; ++x) {
            for (let y = 0; y < this.gridHeight; ++y) {
                if (_grid.arr[x][y].building.isMapEdge)
                    continue
                const pos = _grid.arr[x][y].hexagon.calcPos()
                const vertices = this.getVertices(pos)
                const parity = x & 1
                const cellFaces = [], cell = {x, y}
                const rockPlace = MapDepth.rockPlace(x, Math.round((pos.y - origin.y) / halfHex))

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
                        side: i,
                        cell
                    }
                    this.edges.push(edge)
                    const face = {
                        begin: edge.begin,
                        end: edge.end,
                        bottomBegin: {x: edge.begin.x, y: edge.begin.y + this.depth},
                        bottomEnd: {x: edge.end.x, y: edge.end.y + this.depth},
                        side: i,
                        sortY: Math.max(edge.begin.y, edge.end.y) + this.depth,
                        rockPlace,
                        cell
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
        // (TASK-1612: sideways, also the rock's reach past the board's side vertices, MapDepth.rockSideReach)
        const side = Math.max(shadowPadding, MapDepth.rockSideReach() + 1 / MapDepth.ROCK.raster)
        return {
            bounds: {
                left: minX - side,
                right: maxX + side,
                top: minY - shadowPadding,
                bottom: maxY + Math.max(this.depth, this.rockDepth) + this.shadowOffset + shadowPadding
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
        return MapDepth.faceColors(side)
    }
    static faceColors(side) {
        if (side == 3)
            return ['#969994', '#5c605f']
        if (side == 2 || side == 4)
            return ['#7d817e', '#484c4c']
        return ['#696d6b', '#383c3d']
    }
    renderUnderlay(ctx, cacheScale = 1) {
        MapDepth.paintUnderlay(ctx, this.outline, this.faces, this.shadowBlur, this.shadowOffset, cacheScale,
            otherSettings.atmosphericVisuals, face => this.outsideClipWindow(face.begin, face.end, face.bottomEnd, face.bottomBegin))
    }
    // TASK-1633: renderUnderlay's drawing, shared with the underlay worker (createUnderlayCache): the outline's shadowed fill,
    // then each face (skip: a face outside a patch's clip window) with its gradient, outlined without atmospheric visuals.
    static paintUnderlay(ctx, outline, faces, shadowBlur, shadowOffset, cacheScale, atmospheric, skip = null) {
        ctx.save()
        ctx.fillStyle = MapDepth.GROUND_FILL
        ctx.shadowColor = 'rgba(4, 12, 18, 0.72)'
        // Canvas shadow dimensions are device-space values and do not follow the
        // current transform, so account for a downscaled render cache explicitly.
        ctx.shadowBlur = shadowBlur * cacheScale
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = shadowOffset * cacheScale
        ctx.fill(outline)
        ctx.restore()

        for (let i = 0; i < faces.length; ++i) {
            const face = faces[i]
            if (skip && skip(face))
                continue
            // One gradient a face and context, as renderAtmosphericSides: a rebuild of the surface cache or
            // its patch (Grid.patchSurfaceCache) draws with the gradients the first build made.
            // (In the underlay worker no gradientContext: its context's own.)
            const gctx = typeof gradientContext === 'function' ? gradientContext(ctx) : ctx
            face.underlayGradients ||= new WeakMap()
            let gradient = face.underlayGradients.get(gctx)
            if (!gradient) {
                const colors = MapDepth.faceColors(face.side)
                gradient = ctx.createLinearGradient(0, face.begin.y, 0, face.sortY)
                gradient.addColorStop(0, colors[0])
                gradient.addColorStop(1, colors[1])
                face.underlayGradients.set(gctx, gradient)
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
            if (atmospheric)
                continue
            ctx.strokeStyle = 'rgba(25, 29, 30, 0.78)'
            ctx.lineWidth = 0.025 * basis.r
            ctx.stroke()
        }
    }
    // TASK-1633: the cache's raster (the board's shadowed fill and faces, MapDepth.paintUnderlay) made by the underlay worker
    // when async (MapDepth.rebuild, with atmospheric visuals and workers): the cache's bounds and regions are set at once, its
    // canvas comes back as an ImageBitmap (underlayWorkerDone); meanwhile underlayJob is set and the first read of
    // underlayCache makes it here (the getter: what draws it never waits), the worker's then dropped. The start hold waits
    // for it (Grid.startBuildSteps' 'underlay' pieces) before its lit tiles draw it: ~100-200 ms of a level's start (in
    // GameManager.start's first task) off the main thread. The pixels are the same code's on a canvas of the same size.
    get underlayCache() {
        if (this.underlayJob) {
            this.underlayJob = undefined
            ++MapDepth.underlayCounters.sync
            this.createUnderlayCache()
        }
        return this.underlayRaster
    }
    set underlayCache(value) {
        this.underlayRaster = value
    }
    createUnderlayCache(async = false) {
        this.underlayAtmospheric = otherSettings.atmosphericVisuals
        this.underlayJob = undefined
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

        const worker = async && otherSettings.atmosphericVisuals && this.outlineLoop ? MapDepth.underlayWorkerOn() : null
        if (worker) {
            const token = ++MapDepth.underlaySerial
            this.underlayJob = {token}
            MapDepth.underlayOwner = this
            const point = p => [p.x, p.y]
            worker.postMessage({underlay: token, w: rasterWidth, h: rasterHeight, scale: cacheScale, left: this.bounds.left,
                top: this.bounds.top, loop: this.outlineLoop.map(point), shadowBlur: this.shadowBlur, shadowOffset: this.shadowOffset,
                faces: this.faces.map(f => ({side: f.side, sortY: f.sortY, begin: f.begin, end: f.end, bottomEnd: f.bottomEnd,
                    bottomBegin: f.bottomBegin}))})
            ++MapDepth.underlayCounters.posted
        }
        else {
            const cache = document.createElement('canvas')
            cache.width = rasterWidth
            cache.height = rasterHeight
            const cacheCtx = cache.getContext('2d')
            cacheCtx.scale(cacheScale, cacheScale)
            cacheCtx.translate(-this.bounds.left, -this.bounds.top)
            this.renderUnderlay(cacheCtx, cacheScale)
            this.underlayCache = cache
        }
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
        ctx.fillStyle = MapDepth.GROUND_FILL
        // TASK-1552: a lit tile's quarter wholly within the outline (view.inside, Grid.litSquareOpaque) is the fill's all over.
        if (view && view.inside) {
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        }
        else
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
    // The depth the slab's sides reach below its edges: the rock skirt with atmospheric visuals, else the slab's.
    get sideDepth() {
        return typeof otherSettings !== 'undefined' && otherSettings.atmosphericVisuals ? Math.max(this.depth, this.rockDepth) : this.depth
    }
    renderAtmosphericSides(ctx) {
        if (!otherSettings.atmosphericVisuals) return
        // Only exposed edges have faces. Paint before terrain/fog so no face can
        // cover a foreground neighbour. Keep existing depth, bounds and hit areas.
        ctx.save()
        const t = ctx.getTransform()
        const axisAligned = t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0
        const depth = this.sideDepth, pad = MapDepth.ROCK.pad * basis.r, reach = MapDepth.rockSideReach()
        for (const face of this.faces) {
            if (face.side < 2 || face.side > 4) continue
            // (TASK-1612: an open face's rock reaches past its open vertex, rockSideReach)
            const open = face.open || '', right = open.includes('b') ? reach : 0, left = open.includes('e') ? reach : 0
            const points = [face.begin, face.end, {x: face.end.x, y: face.end.y + depth}, {x: face.begin.x, y: face.begin.y + depth}]
            if (right) points.push({x: Math.max(face.begin.x, face.end.x) + right, y: face.begin.y})
            if (left) points.push({x: Math.min(face.begin.x, face.end.x) - left, y: face.end.y})
            if (axisAligned && (
                    (Math.max(face.begin.x, face.end.x) + pad + right) * t.a + t.e < -1 ||
                    (Math.min(face.begin.x, face.end.x) - pad - left) * t.a + t.e > ctx.canvas.width + 1 ||
                    (Math.max(face.begin.y, face.end.y) + depth) * t.d + t.f < -1 ||
                    Math.min(face.begin.y, face.end.y) * t.d + t.f > ctx.canvas.height + 1) ||
                    this.outsideClipWindow(...points))
                continue
            const place = face.rockPlace || {kx: 0, ky: 0}
            const sprite = MapDepth.rockSprite(face.notch ? 'notch' : face.side, place.kx, place.ky, open)
            ctx.drawImage(sprite.canvas, face.begin.x + sprite.x, face.begin.y + sprite.y, sprite.width, sprite.height)
        }
        // The brass rim (rimRibbons), over the faces.
        for (const {path, color} of this.rimRibbons || []) {
            ctx.fillStyle = color
            ctx.fill(path)
        }
        ctx.restore()
    }
    // The rim's colour at t (0 at the edge .. 1 at its foot), between ROCK.rim.colors (or the colours given).
    static rimColor(t, colors = MapDepth.ROCK.rim.colors) {
        const x = t * (colors.length - 1), i = Math.min(colors.length - 2, Math.floor(x)), f = x - i
        const rgb = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)), a = rgb(colors[i]), b = rgb(colors[i + 1])
        return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(', ') + ')'
    }
    // TASK-1583: the rock sprite of a face (side 2, 3, 4 or 'notch') of the cell at place (kx, ky) of the field's period
    // (rockPlace), open at its ends as the face is (TASK-1612: '', 'b', 'e' or 'be', markOpenFaces), its world box relative
    // to the face's begin vertex ({canvas, x, y, width, height}); kept per hex radius.
    static rockSprite(side, kx, ky, open = '') {
        const sprites = MapDepth.rockCache()
        const key = side + ':' + kx + ':' + ky + ':' + open
        let sprite = sprites.get(key)
        if (!sprite) {
            sprite = MapDepth.buildRockSprite(side, kx, ky, open)
            sprites.set(key, sprite)
            ++MapDepth.rockBuilds
        }
        return sprite
    }
    // The rock sprites made at the current hex radius (a Map by rockSprite's key).
    static rockCache() {
        if (!MapDepth.rockSprites || MapDepth.rockSprites.radius !== basis.r)
            MapDepth.rockSprites = {radius: basis.r, sprites: new Map()}
        return MapDepth.rockSprites.sprites
    }
    // TASK-1616: rockKeys of a board not yet made (_grid as buildFaces takes it: Grid.prebuildBoardOf), for its sprites to be
    // asked of the workers ahead (a tutorial's result screen, for the next tutorial: TutorialManager.prebuildNext).
    static rockKeysOf(_grid) {
        const depth = Object.create(MapDepth.prototype)
        depth.depth = typeof mapDepth !== 'undefined' ? mapDepth.depth : 0
        depth.buildFaces(_grid)
        depth.markOpenFaces()
        return depth.rockKeys()
    }
    // TASK-1615: the rock sprites the board's faces draw (renderAtmosphericSides), once each: [{key, side, kx, ky, open}].
    rockKeys() {
        const keys = new Map()
        for (const face of this.faces) {
            if (face.side < 2 || face.side > 4) continue
            const side = face.notch ? 'notch' : face.side, place = face.rockPlace || {kx: 0, ky: 0}, open = face.open || ''
            const key = side + ':' + place.kx + ':' + place.ky + ':' + open
            if (!keys.has(key)) keys.set(key, {key, side, kx: place.kx, ky: place.ky, open})
        }
        return [...keys.values()]
    }
    // TASK-1615 (TUTORIAL PERF 2/7): ROCK SPRITES IN WORKERS. A rock sprite is ~0.3-1 s of per-pixel JS (rockPixelSteps), and
    // a new board's first lit tiles made its rock sprites inside the frame, a whole sprite at a time (the tutorial's load
    // freeze: 1-1.7 s frames, artifacts/TASK-1614/causes.md). Now the board's sprites (rockKeys) are asked of a few Workers
    // (this file, loaded as a worker: the message handler at its end) as soon as the board is known (rebuild, Grid's start
    // hold), which post the pixels back; the start hold waits for them with short frames (rockSpriteSteps). Without workers
    // (no Worker, MapDepth.rockWorkers false, the page's ?rockWorker=0, a worker error) the sprites are made on the main
    // thread a pixel row a step in the start hold, and whole at their first draw elsewhere (rockSprite, as before). The
    // pixels are the same either way (the same code). rockWorker.counters: posted, built (sprites from a worker), dropped
    // (arrived for another radius or already made), failed.
    static rockWorkers = true
    static rockWorker = {state: 'off', workers: [], next: 0, pending: new Map(), reason: undefined,
        counters: {posted: 0, built: 0, dropped: 0, failed: 0, mainSteps: 0}}
    static rockWorkersOn() {
        const W = MapDepth.rockWorker
        if (W.state === 'on')
            return true
        if (W.state === 'failed' || !MapDepth.rockWorkers || typeof Worker !== 'function' || typeof document === 'undefined' ||
                typeof location !== 'undefined' && typeof URLSearchParams !== 'undefined' &&
                new URLSearchParams(location.search).get('rockWorker') === '0')
            return false
        const own = [...document.scripts].find(script => /sprites\/border\.js(\?|$)/.test(script.src))
        const count = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency || 2) - 1))
        try {
            for (let n = 0; n < count; ++n) {
                const worker = new Worker(own ? own.src : 'sprites/border.js')
                worker.onmessage = e => MapDepth.rockWorkerDone(e.data)
                worker.onerror = e => {
                    e.preventDefault?.()
                    MapDepth.rockWorkerFail('worker: ' + (e.message || 'error'))
                }
                W.workers.push(worker)
            }
        } catch (error) {
            MapDepth.rockWorkerFail('start: ' + error)
            return false
        }
        W.state = 'on'
        return true
    }
    // TASK-1633: the underlay worker (this file loaded as a worker, its own: never behind a rock sprite), made with the rock
    // workers' conditions; null without it (createUnderlayCache draws on the main thread). underlayCounters: posted, built
    // (from the worker), sync (made on the main thread at a read before the worker's came), dropped (came stale), failed.
    // TASK-1633: rebuild skips a board it has already built (the same object, map edge and radius); the skips counted.
    static rebuildSkips = true
    static rebuildsSkipped = 0
    static underlayWorkers = true
    static underlayWorker = null
    static underlayState = 'off'
    static underlaySerial = 0
    static underlayOwner = null
    static underlayCounters = {posted: 0, built: 0, sync: 0, dropped: 0, failed: 0}
    static underlayWorkerOn() {
        if (MapDepth.underlayState === 'on')
            return MapDepth.underlayWorker
        if (MapDepth.underlayState === 'failed' || !MapDepth.underlayWorkers || typeof OffscreenCanvas !== 'function' ||
                typeof createImageBitmap !== 'function' || !MapDepth.rockWorkersOn())
            return null
        const own = [...document.scripts].find(script => /sprites\/border\.js(\?|$)/.test(script.src))
        try {
            const worker = new Worker(own ? own.src : 'sprites/border.js')
            worker.onmessage = e => MapDepth.underlayWorkerDone(e.data)
            worker.onerror = e => {
                e.preventDefault?.()
                MapDepth.underlayFail()
            }
            MapDepth.underlayWorker = worker
        } catch (error) {
            MapDepth.underlayFail()
            return null
        }
        MapDepth.underlayState = 'on'
        return MapDepth.underlayWorker
    }
    static underlayFail() {
        MapDepth.underlayState = 'failed'
        try {
            MapDepth.underlayWorker?.terminate()
        } catch (e) {}
        MapDepth.underlayWorker = null
        // (a job under way: its first read makes it, the getter)
        ++MapDepth.underlayCounters.failed
    }
    static underlayWorkerDone(m) {
        const owner = MapDepth.underlayOwner
        if (m.error || !m.bitmap) {
            ++MapDepth.underlayCounters.failed
            return
        }
        if (!owner || !owner.underlayJob || owner.underlayJob.token !== m.underlay) {
            ++MapDepth.underlayCounters.dropped
            m.bitmap.close?.()
            return
        }
        owner.underlayJob = undefined
        owner.underlayCache = m.bitmap
        ++MapDepth.underlayCounters.built
    }
    static rockWorkerFail(reason) {
        const W = MapDepth.rockWorker
        W.state = 'failed'
        W.reason = reason
        for (const worker of W.workers)
            try {
                worker.terminate()
            } catch (e) {}
        W.workers = []
        W.counters.failed += W.pending.size
        W.pending.clear()
        MapDepth.rockAhead.inFlight = 0
    }
    // Asks the workers for the sprites of keys (rockKeys) not made or asked for yet at this radius; false without workers.
    static requestRockSprites(keys) {
        if (!keys.length || !MapDepth.rockWorkersOn())
            return false
        const W = MapDepth.rockWorker, sprites = MapDepth.rockCache(), r = basis.r
        for (const {key, side, kx, ky, open} of keys) {
            if (sprites.has(key) || W.pending.get(key) === r)
                continue
            W.pending.set(key, r)
            W.workers[W.next++ % W.workers.length].postMessage({key, side, kx, ky, open, r})
            ++W.counters.posted
        }
        return true
    }
    static rockWorkerDone(m) {
        const W = MapDepth.rockWorker
        if (W.pending.get(m.key) === m.r)
            W.pending.delete(m.key)
        if (m.ahead) {
            --MapDepth.rockAhead.inFlight
            MapDepth.rockAheadPump()
        }
        if (m.error) {
            ++W.counters.failed
            return
        }
        const sprites = MapDepth.rockCache()
        if (m.r !== basis.r || sprites.has(m.key)) {
            ++W.counters.dropped
            return
        }
        sprites.set(m.key, MapDepth.rockSpriteOf(m))
        ++MapDepth.rockBuilds
        ++W.counters.built
        if (m.ahead)
            ++MapDepth.rockAhead.counters.built
    }
    // TASK-1632 (LEVEL LOAD 2/5): ROCK SPRITES MADE AHEAD WHILE THE MENU SHOWS. A rock sprite depends only on its key and the
    // hex radius (rockCache: kept across boards), but a fresh page made every sprite of its first board inside that board's
    // start hold (tutorial-0: 21 sprites, ~1 s of worker time each, the hold waiting ~120 frames for them; a loaded save's
    // stand-in made them on the main thread: a 3-4 s task). While the menu shows, the sprites of the boards it can start
    // (menuPrebuild.rockMaps: the next boards first, then every tutorial, hot seat map and co-op radius) are asked of the rock
    // workers, at most one a worker at a time (inFlight; a game's own requests, requestRockSprites, never wait behind more than
    // that), the queue paused while a game runs (rockAheadOn: the menu hidden) and taken up again when the menu shows. The
    // same keys, workers and pixels as a board's own request. counters: queued, posted, built (from that queue).
    static rockAhead = {queue: [], queued: new Set(), inFlight: 0, counters: {queued: 0, posted: 0, built: 0}}
    static rockAheadOn() {
        return typeof menu !== 'undefined' && !!menu.visible && typeof otherSettings !== 'undefined' && !!otherSettings.atmosphericVisuals
    }
    // Queues keys (rockKeys) not made, asked or queued yet (first: ahead of the queue, the next boards'); false without
    // workers (the menu then makes none ahead).
    static rockAheadAdd(keys, first = false) {
        if (!MapDepth.rockWorkersOn())
            return false
        const A = MapDepth.rockAhead, sprites = MapDepth.rockCache(), W = MapDepth.rockWorker
        if (A.radius !== basis.r) {
            A.radius = basis.r
            A.queue = []
            A.queued.clear()
        }
        const add = []
        for (const key of keys)
            if (!sprites.has(key.key) && W.pending.get(key.key) !== basis.r) {
                if (A.queued.has(key.key)) {
                    if (!first)
                        continue
                    A.queue = A.queue.filter(k => k.key !== key.key)
                }
                else
                    ++A.counters.queued
                A.queued.add(key.key)
                add.push(key)
            }
        if (first)
            A.queue.unshift(...add)
        else
            A.queue.push(...add)
        MapDepth.rockAheadPump()
        return true
    }
    static rockAheadPump() {
        const A = MapDepth.rockAhead, W = MapDepth.rockWorker
        while (A.queue.length && W.state === 'on' && A.inFlight < W.workers.length && A.radius === basis.r && MapDepth.rockAheadOn()) {
            const {key, side, kx, ky, open} = A.queue.shift(), r = basis.r
            A.queued.delete(key)
            if (MapDepth.rockCache().has(key) || W.pending.get(key) === r)
                continue
            W.pending.set(key, r)
            ++A.inFlight
            W.workers[W.next++ % W.workers.length].postMessage({key, side, kx, ky, open, r, ahead: true})
            ++A.counters.posted
        }
    }
    // Whether every queued sprite is made (none queued or in flight).
    static rockAheadDone() {
        return !MapDepth.rockAhead.queue.length && !MapDepth.rockAhead.inFlight
    }
    // The start hold's rock pieces (a generator, Grid.startBuildSteps): until every sprite of keys is made, yields true
    // while the workers make them (nothing to do in this frame) or false after a pixel row made here (without workers).
    static *rockSpriteSteps(keys) {
        MapDepth.requestRockSprites(keys)
        for (const {key, side, kx, ky, open} of keys)
            for (;;) {
                const sprites = MapDepth.rockCache(), r = basis.r
                if (sprites.has(key))
                    break
                if (MapDepth.rockWorker.state === 'on' && MapDepth.rockWorker.pending.get(key) === r) {
                    yield true
                    continue
                }
                const steps = MapDepth.rockPixelSteps(side, kx, ky, open, r)
                let next
                while (!(next = steps.next()).done) {
                    ++MapDepth.rockWorker.counters.mainSteps
                    yield false
                }
                if (r === basis.r && !MapDepth.rockCache().has(key)) {
                    MapDepth.rockCache().set(key, MapDepth.rockSpriteOf(next.value))
                    ++MapDepth.rockBuilds
                }
                break
            }
    }
    // TASK-1612: how far an open face's rock reaches past its open vertex (world units): the dome (chunk.dome) of a boulder
    // across the boulder grid's column (the period's width over its chunk count, buildRockSprite's sx), as far as a boulder
    // at the vertex column bulges past it; the side outline's lumps (buildRockSprite sideOutline) reach up to it.
    // (TASK-1662: the side walls (ROCK.wall) reach less far; this stays the bound the slab's box and the faces' culling take.)
    static rockSideReach(r = basis.r) {
        const R = MapDepth.ROCK, PX = R.period.columns * 1.5 * r, nx = Math.max(1, Math.round(PX / (R.chunk.x * r)))
        return R.chunk.dome * PX / nx
    }
    // A cell's place in the rock field's period: its column mod period.columns and its height in half hex heights (row)
    // mod period.rows (both even).
    static rockPlace(column, row) {
        const P = MapDepth.ROCK.period, mod = (a, n) => ((a % n) + n) % n
        return {kx: mod(column, P.columns), ky: mod(row, P.rows)}
    }
    // A unit-interval hash of a whole number and a salt.
    static rockHash(n, salt) {
        let v = Math.imul(n * 0x27d4eb2d ^ Math.imul(salt + 1, 0x165667b1), 0x85ebca6b)
        v = Math.imul(v ^ (v >>> 15), 0xc2b2ae35)
        return ((v ^ (v >>> 13)) >>> 0) / 4294967296
    }
    static buildRockSprite(side, kx, ky, open = '') {
        return MapDepth.rockSpriteOf(MapDepth.rockPixels(side, kx, ky, open, basis.r))
    }
    // TASK-1615: a rock sprite's canvas from its pixels (rockPixels).
    static rockSpriteOf(pixels) {
        const {width: W, height: H, k} = pixels
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const g = canvas.getContext('2d'), image = g.createImageData(W, H)
        image.data.set(pixels.data)
        g.putImageData(image, 0, 0)
        return {canvas, x: pixels.x, y: pixels.y, width: W / k, height: H / k}
    }
    // TASK-1615: the rock sprite's pixels at hex radius r ({data (RGBA), width, height, x, y, k}: buildRockSprite's canvas and
    // box), made at once (rockPixelSteps run to its end): in a rock worker or on the main thread.
    static rockPixels(side, kx, ky, open, r) {
        const steps = MapDepth.rockPixelSteps(side, kx, ky, open, r)
        let next
        while (!(next = steps.next()).done);
        return next.value
    }
    // TASK-1615: rockPixels a row at a time (a generator: a step per pixel row of each pass; returns the pixels), so the
    // main thread can make a sprite over several frames (rockSpriteSteps). Pure JS (no canvas, no page globals): it runs in a
    // Worker too.
    static *rockPixelSteps(side, kx, ky, open, r) {
        if (open.includes('s')) return yield* MapDepth.slabPixelSteps(side, kx, ky, r)
        const R = MapDepth.ROCK, C = R.chunk, S = R.scallop, X = R.crack, k = R.raster, h = r * Math.sqrt(3) / 2
        const hash = MapDepth.rockHash
        // The outline around a face (getVertices; the bottom row from right to left: side 2 down to a protruding cell's
        // bottom 3, side 4 up to the upper level, a notch, the next cell's 2): each kind's end relative to its begin, its
        // begin relative to its cell's centre, the outline's upper level (local y) and the faces before and after it.
        const END = {2: {x: -r / 2, y: h}, 3: {x: -r, y: 0}, 4: {x: -r / 2, y: -h}, notch: {x: -r, y: 0}}
        const BEGIN = {2: {x: r, y: 0}, 3: {x: r / 2, y: h}, 4: {x: -r / 2, y: h}, notch: {x: r / 2, y: h}}
        const PREV = {2: 'notch', 3: 2, 4: 3, notch: 4}, NEXT = {2: 3, 3: 4, 4: 'notch', notch: 2}
        const slope = kind => END[kind].y / END[kind].x
        const end = END[side], upper = side == 3 || side == 4 ? -h : 0
        // TASK-1612: an open end (markOpenFaces: past the begin vertex, 'b', x > 0, or the end vertex, 'e', x < end.x) has no
        // face beyond it: there the field runs on past the vertex column, below the vertex, out to the rock's own side
        // outline (sideOutline: rounded chunks stacked down the side), not to the sprite's box. The face keeps its own tone
        // and has no plain stone at an open vertex (no neighbouring face to match).
        const openB = open.includes('b'), openE = open.includes('e')
        const outside = x => openB && x > 0 || openE && x < end.x
        // (a protruding cell's centre, local x: the foot is deepest under it)
        const low = side == 2 ? -r : side == 3 ? -r / 2 : side == 4 ? r / 2 : r
        // The outline's y at local x: this face's edge, its neighbours' past its ends.
        const edgeY = x => x > 0 ? slope(PREV[side]) * x : x < end.x ? end.y + slope(NEXT[side]) * (x - end.x) : end.y * x / end.x
        // (the outline averaged over smooth hex radii either side: the depth below it that the rim light, tiers and foot
        // gradient follow has no cusp at a vertex, so no thin ridge runs down the vertex column)
        const edgeSmooth = x => {
            let sum = 0
            for (let j = -4; j <= 4; ++j) sum += edgeY(x + j * R.smooth * r / 4)
            return sum / 9
        }
        // The foot's depth below the upper level (no jag): scallop.depth, deeper under a protruding cell.
        const footBase = x => {
            // (distance from the nearest protruding cell's centre, hex radii: flat under it, ramping up over ramp)
            const dx = Math.abs(((x - low) / r % 3 + 4.5) % 3 - 1.5), t = Math.max(0, Math.min(1, (dx - S.flat) / S.ramp))
            return (S.depth + S.amplitude * (1 - t * t * (3 - 2 * t))) * r
        }
        // (the foot's breakup: knots every scallop.knot hex radii along the period, each hanging +- jag)
        const nk = Math.round(R.period.columns * 1.5 / S.knot), kw = R.period.columns * 1.5 * r / nk
        const jagAt = x => {
            const t = (kx * 1.5 * r + BEGIN[side].x + x) / kw, j = Math.floor(t), f = t - j
            const v = j => S.jag * r * (2 * hash(((j % nk) + nk) % nk, 3) - 1)
            return v(j) + (v(j + 1) - v(j)) * f
        }
        // The field's frame: the cell's place in the period plus the face's begin.
        const PX = R.period.columns * 1.5 * r, PY = R.period.rows * h
        const ox = kx * 1.5 * r + BEGIN[side].x, oy = ky * h + BEGIN[side].y
        // Chunks: a jittered grid of seeds dividing the period, each with its tone and its foot's hang.
        const nx = Math.max(1, Math.round(PX / (C.x * r))), ny = Math.max(1, Math.round(PY / (C.y * r))), sx = PX / nx, sy = PY / ny
        const unit = Math.min(sx, sy), bevel = C.bevel * unit
        // TASK-1662: an open end's rock reaches past its vertex to the wall's outline (sideOutline), at most this far
        const WL = R.wall, pad = R.pad * r, sideReach = openB || openE ? (Math.max(WL.out.left, WL.out.right) + Math.max(...WL.stones)) * r + 1 / k : 0
        // (the side outline's reach past the vertex at field height wy (world units): a rounded stone per boulder row (sy, the
        // field's period rows; three a cell's height), counted from the side's vertices (the field's rows ky * h, 2h apart
        // down a side), stepping out by wall.stones[row % 3] past the wall's flush face (wall.out, left or right); in the field's frame, so the
        // faces down a side agree. TASK-1612 had lumps of 0.45, 1 and 0.7 of rockSideReach: a fringe, not the concept's wall)
        const sideOutline = (wy, out) => {
            const u = wy - (((ky % 2) + 2) % 2) * h, j0 = Math.floor(u / sy)
            let e = 0
            for (let j = j0 - 1; j <= j0 + 1; ++j) {
                const t = (u - (j + 0.5) * sy) / (0.5 * sy)
                if (Math.abs(t) < 1) e = Math.max(e, WL.stones[((j % 3) + 3) % 3] * Math.sqrt(1 - t * t))
            }
            return (out + e) * r
        }
        const x0 = Math.min(0, end.x) - pad - (openE ? sideReach : 0), x1 = Math.max(0, end.x) + pad + (openB ? sideReach : 0)
        const y0 = Math.min(0, end.y) - 2 * pad, y1 = upper + (S.depth + S.amplitude + S.jag) * r + 2 / k
        const W = Math.ceil((x1 - x0) * k), H = Math.ceil((y1 - y0) * k)
        // (TASK-1615: the seeds' hashes looked up from tables, not hashed again at every pixel; the same values. sample's
        // result in sGap, sN1, sTilt, sD1)
        const seeds = nx * ny, seedX = new Float64Array(seeds), seedY = new Float64Array(seeds), seedCos = new Float64Array(seeds), seedSin = new Float64Array(seeds)
        for (let n = 0; n < seeds; ++n) {
            const a = 2 * Math.PI * hash(n, 5)
            seedX[n] = 0.9 * hash(n, 1)
            seedY[n] = 0.8 * hash(n, 2)
            seedCos[n] = Math.cos(a)
            seedSin[n] = Math.sin(a)
        }
        let sGap = 0, sN1 = 0, sTilt = 0, sD1 = 0
        const sample = (wx, wy) => {
            const ci = Math.floor(wx / sx), cj = Math.floor(wy / sy)
            let d1 = Infinity, d2 = Infinity, n1 = 0, tilt = 0
            for (let j = cj - 1; j <= cj + 1; ++j) {
                const row = (((j % ny) + ny) % ny) * nx
                for (let i = ci - 1; i <= ci + 1; ++i) {
                    const n = row + (((i % nx) + nx) % nx)
                    const qx = (i + 0.05 + seedX[n]) * sx, qy = (j + 0.1 + seedY[n]) * sy
                    const dist = Math.hypot((qx - wx) / sx, (qy - wy) / sy) * unit
                    if (dist < d1) {
                        d2 = d1
                        d1 = dist
                        n1 = n
                        tilt = C.tilt * ((wx - qx) / sx * seedCos[n] + (wy - qy) / sy * seedSin[n])
                    } else if (dist < d2)
                        d2 = dist
                }
            }
            sGap = d2 - d1
            sN1 = n1
            sTilt = tilt
            sD1 = d1
        }
        // The face's tone at local x: its own, blended to the mean with its neighbour's within corner of a vertex (the
        // same on both faces there).
        const T = R.tone, Z = R.corner * r, smooth = t => t * t * (3 - 2 * t)
        const plainAt = x => {
            const dist = Math.min(openB ? Infinity : Math.abs(x), openE ? Infinity : Math.abs(x - end.x)) / r, t = Math.max(0, Math.min(1, (dist - R.plain[0]) / (R.plain[1] - R.plain[0])))
            return 1 - smooth(t)
        }
        const toneAt = x => {
            const own = T[side], prev = openB ? own : T[PREV[side]], next = openE ? own : T[NEXT[side]], a = (own + prev) / 2, b = (own + next) / 2
            if (x > 0) return a + (prev - a) * smooth(Math.min(1, x / Z))
            if (x < end.x) return b + (next - b) * smooth(Math.min(1, (end.x - x) / Z))
            if (-x < Z) return a + (own - a) * smooth(-x / Z)
            if (x - end.x < Z) return b + (own - b) * smooth((x - end.x) / Z)
            return own
        }
        // Cracks: slots of crack.spacing along the period, share of them cracked: a jagged line of crack.steps steps
        // (crack.step hex radii) up and down from a centre low in the stone, sometimes a branch (crack.branch), fading
        // towards its ends.
        const ns = Math.max(1, Math.round(PX / (X.spacing * r))), cs = PX / ns, segments = []
        const reach = (X.steps[1] + 2) * X.step * r
        for (let s = Math.floor((ox + x0 - reach) / cs); s <= Math.floor((ox + x1 + reach) / cs); ++s) {
            // (crack.seed picks the cracked slots and their shapes)
            const m = ((s % ns) + ns) % ns + X.seed * 1000
            if (hash(m, 11) >= X.share) continue
            const cx = (s + 0.2 + 0.6 * hash(m, 12)) * cs - ox
            const centre = {x: cx, y: upper + footBase(cx) * (X.at[0] + (X.at[1] - X.at[0]) * hash(m, 13))}
            const n = X.steps[0] + Math.floor(hash(m, 14) * (X.steps[1] - X.steps[0] + 1)), salt = 20
            const walk = (from, count, heading, spread, fade0, key) => {
                let q = from
                for (let i = 0; i < count; ++i) {
                    const angle = heading + (hash(m, key + 2 * i) * 2 - 1) * spread, len = X.step * r * (0.6 + 0.8 * hash(m, key + 2 * i + 1))
                    const next = {x: q.x + Math.cos(angle) * len, y: q.y + Math.sin(angle) * len}
                    segments.push({a: q, b: next, fade: fade0 * (1 - 0.7 * (i + 1) / (count + 1))})
                    q = next
                }
                return q
            }
            const lean = (hash(m, 15) * 2 - 1) * 0.7
            walk(centre, Math.ceil(n / 2), Math.PI / 2 + lean, 0.6, 1, salt)
            walk(centre, Math.floor(n / 2), -Math.PI / 2 + lean, 0.6, 1, salt + 40)
            if (hash(m, 16) < X.branch)
                walk(centre, 2, Math.PI / 2 + lean + (hash(m, 17) < 0.5 ? -1 : 1) * 1.1, 0.5, 0.8, salt + 80)
        }
        // (a crack's light: its line on the creases within crack.snap of its path, a vein along the path itself outside the
        // plain stone at a vertex, a soft halo around the path)
        // (TASK-1615: only the segments and crack centres within reach of the pixel's row (rowSegments, rowCentres) and
        // column box are tried: a pixel further from a segment's box than its reach is further from the segment, and the
        // max over the rest is the same)
        const segReach = 3 * X.snap * r, castReach = X.cast.reach * r, margin = 1e-6 * r
        const segBox = segments.map(q => [Math.min(q.a.x, q.b.x) - segReach - margin, Math.max(q.a.x, q.b.x) + segReach + margin,
            Math.min(q.a.y, q.b.y) - segReach - margin, Math.max(q.a.y, q.b.y) + segReach + margin])
        let rowSegments = segments
        const segmentGlow = (x, y, gap, plain) => {
            let best = 0
            for (const q of rowSegments) {
                const box = q.box
                if (x < box[0] || x > box[1]) continue
                const vx = q.b.x - q.a.x, vy = q.b.y - q.a.y, t = Math.max(0, Math.min(1, ((x - q.a.x) * vx + (y - q.a.y) * vy) / (vx * vx + vy * vy)))
                const dist = Math.hypot(x - q.a.x - vx * t, y - q.a.y - vy * t)
                if (dist > 3 * X.snap * r) continue
                best = Math.max(best, q.fade * (X.alpha.line * Math.exp(-((gap / (X.line * r)) ** 2)) * Math.exp(-((dist / (X.snap * r)) ** 2)) +
                    (1 - plain) * X.alpha.path * Math.exp(-((dist / (X.path * r)) ** 2)) + X.alpha.halo * Math.exp(-((dist / (X.halo * r)) ** 2))))
            }
            return best
        }
        const segItems = segments.map((q, j) => ({a: q.a, b: q.b, fade: q.fade, box: segBox[j]}))
        const centres = segments.map(q => q.a)
        // (the protruding corners: a cell's lower vertices, local x)
        const corners = side == 2 ? [end.x] : side == 3 ? [0, end.x] : side == 4 ? [0] : []
        const d = new Uint8ClampedArray(W * H * 4)
        const height = new Float32Array(W * H), level = new Float32Array(W * H), alpha = new Float32Array(W * H)
        const glow = new Float32Array(W * H), cast = new Float32Array(W * H), tone = new Float32Array(W * H)
        const lowF = new Float32Array(W * H), raw = new Float32Array(W * H), plain = new Float32Array(W * H)
        // (TASK-1615: the terms that depend on the column only (or the row only) made once per column (row), the same
        // expressions as per pixel before)
        const colX = new Float64Array(W), colTop = new Float64Array(W), colFoot = new Float64Array(W), colPlain = new Float64Array(W)
        const colSoft = new Float64Array(W), colTone = new Float64Array(W), colWX = new Float64Array(W), colGX = new Int32Array(W)
        const colOut = new Uint8Array(W), colOutX = new Float64Array(W)
        for (let px = 0; px < W; ++px) {
            const x = colX[px] = x0 + (px + 0.5) / k
            colTop[px] = edgeY(x)
            colFoot[px] = upper + footBase(x) + jagAt(x)
            colPlain[px] = plainAt(x)
            colSoft[px] = edgeSmooth(x)
            colTone[px] = toneAt(x)
            colWX[px] = ox + x
            colGX[px] = Math.floor((ox + x) * k)
            colOut[px] = outside(x) ? 1 : 0
            colOutX[px] = x > 0 ? x : end.x - x
        }
        const seedTone = new Float64Array(seeds)
        for (let n = 0; n < seeds; ++n) seedTone[n] = 2 * hash(n, 4) - 1
        for (let py = 0; py < H; ++py) {
            const y = y0 + (py + 0.5) / k, wy = oy + y, gy = Math.floor((oy + y) * k)
            const band = Math.abs((((oy + y) % sy) + sy) % sy - sy / 2), rowLeft = openE ? sideOutline(oy + y, WL.out.left) : 0, rowRight = openB ? sideOutline(oy + y, WL.out.right) : 0
            rowSegments = segItems.filter(q => y >= q.box[2] && y <= q.box[3])
            for (let px = 0; px < W; ++px) {
                const i = py * W + px, x = colX[px]
                const top = colTop[px]
                if (y < top - 1 / k) continue
                const foot = colFoot[px]
                if (y > foot + 1 / k) continue
                const w = colPlain[px]
                sample(colWX[px], wy)
                const gap = sGap, n1 = sN1, tilt = sTilt, d1 = sD1
                alpha[i] = Math.max(0, Math.min(1, (y - top) * k + 0.5, (foot - y) * k + 0.5))
                // (TASK-1612: past an open vertex, within the side outline)
                if (colOut[px] && !((alpha[i] = Math.max(0, Math.min(alpha[i], ((colX[px] > 0 ? rowRight : rowLeft) - colOutX[px]) * k + 0.5))) > 0))
                    continue
                // (a rounded boulder: a dome around its seed (chunk.dome of the cell size), falling into the gap at its edge)
                const e = Math.min(1, gap / bevel), dome = Math.sqrt(Math.max(0, 1 - (d1 / (C.dome * unit)) ** 2))
                raw[i] = dome * (1 - (1 - e) * (1 - e))
                plain[i] = w
                height[i] = raw[i] * (1 - w) + C.plain * w
                const soft = colSoft[px], below = Math.max(0, y - soft) / r, f = Math.max(0, Math.min(1, (y - soft) / Math.max(1e-6, foot - soft)))
                let tier = 1
                for (const L of R.tiers) tier += L.gain * Math.exp(-(((below - L.at) / L.width) ** 2))
                let gh = Math.imul(colGX[px] * 0x27d4eb2d ^ gy * 0x165667b1, 0x85ebca6b)
                gh = ((gh ^ (gh >>> 13)) >>> 0) / 4294967296
                // (creases wider and darker towards the foot; level bands across the plain stone at a vertex, the same in
                // both faces' sprites)
                const cw = R.crease.width[0] + (R.crease.width[1] - R.crease.width[0]) * f
                const creased = ((1 - w) * Math.exp(-((gap / (cw * r)) ** 2)) + w * Math.exp(-(((band - sy / 2) / (R.crease.band * r)) ** 2))) *
                    (R.crease.dark[0] + (R.crease.dark[1] - R.crease.dark[0]) * f) / R.crease.dark[1]
                const lip = Math.max(0, Math.min(1, 1 - (foot - y - R.lip.solid * r) / (R.lip.width * r)))
                tone[i] = colTone[px]
                lowF[i] = f
                level[i] = tone[i] * (R.top + (R.bottom - R.top) * f ** 1.2) * (1 + (1 - w) * (seedTone[n1] * C.tone + tilt) + (2 * gh - 1) * C.grain) *
                    (C.face + (1 - C.face) * height[i]) * tier * (1 - R.crease.dark[1] * creased) * (1 - R.lip.dark * lip)
                glow[i] = segmentGlow(x, y, gap + w * 4 * X.line * r, w)
            }
            // (the crack centres' cool cast, by centre over the columns within its reach: read only where alpha > 0)
            for (const c of centres) {
                if (!(Math.abs(y - c.y) < castReach + margin)) continue
                const p0 = Math.max(0, Math.floor((c.x - castReach - margin - x0) * k - 0.5)), p1 = Math.min(W - 1, Math.ceil((c.x + castReach + margin - x0) * k - 0.5))
                for (let px = p0; px <= p1; ++px) {
                    const x = colX[px], i = py * W + px
                    const qc = Math.hypot(x - c.x, y - c.y) / (X.cast.reach * r)
                    if (qc < 1) cast[i] = Math.max(cast[i], X.cast.amount * (1 - qc) ** 2)
                }
            }
            yield
        }
        // Light: the height's slope per hex radius against the upper-left key.
        const lx = -Math.SQRT1_2, ly = -Math.SQRT1_2, per = k * r
        for (let py = 0; py < H; ++py, yield)
            for (let px = 0; px < W; ++px) {
                const i = py * W + px, p = 4 * i
                if (!alpha[i]) continue
                const x = colX[px], y = y0 + (py + 0.5) / k
                const at = j => alpha[j] ? raw[j] : raw[i]
                const gx = px > 0 && px < W - 1 ? (at(i + 1) - at(i - 1)) / 2 * per : 0
                const gy = py > 0 && py < H - 1 ? (at(i + W) - at(i - W)) / 2 * per : 0
                // (the boulders' slope light, faded out over the plain stone at a vertex: no shaded strip beside it)
                const lit = -(gx * lx + gy * ly) * C.slope * (1 - plain[i])
                const below = Math.max(0, (y - colSoft[px]) / r), q = below / R.rimLight.reach
                let warm = (R.rimLight.alpha * Math.exp(-q / R.rimLight.falloff) + R.rimLight.tail) * Math.max(0, 1 - q)
                for (const vx of corners)
                    warm = Math.max(warm, R.edge.alpha * Math.exp(-((Math.max(0, Math.abs(x - vx) - R.edge.flat * r) / (R.edge.width * r)) ** 2)) * Math.max(0, 1 - below / R.edge.reach))
                const gain = Math.min(1.1, tone[i] / T[3]), tq = Math.min(1, below / R.rimLight.tintReach), tintAt = 1 - tq * tq * (3 - 2 * tq)
                const rgb = [0, 0, 0]
                for (let c = 0; c < 3; ++c) {
                    let v = (R.stone[c] + (R.stoneLow[c] - R.stone[c]) * lowF[i]) * level[i]
                    v += lit > 0 ? (C.glow[c] * gain - v) * Math.min(C.lightMax, lit) : (C.shade[c] - v) * Math.min(1, -lit * C.shadow)
                    v += R.rimLight.color[c] * warm * (R.rimLight.base + (1 - R.rimLight.base) * height[i])
                    // (the rim's warm cast on the upper stone: a tint towards orange at about the same luminance)
                    v *= 1 + (R.rimLight.tint[c] - 1) * tintAt
                    v += (X.color[c] * 0.45 - v) * cast[i]
                    rgb[c] = v + glow[i] * X.color[c]
                }
                d[p] = rgb[0]
                d[p + 1] = rgb[1]
                d[p + 2] = rgb[2]
                d[p + 3] = 255 * alpha[i]
            }
        return {data: d, width: W, height: H, x: x0, y: y0, k}
    }
    // TASK-1663: a side wall's slab face (ROCK.slab; markOpenFaces 's'), rockPixelSteps' pixels for a lower left (side 4, the
    // board's left side) or lower right (side 2, its right side) edge between upper edges; local to the face's begin as
    // rockPixelSteps'. Pure JS (a worker runs it too).
    static *slabPixelSteps(side, kx, ky, r) {
        const R = MapDepth.ROCK, S = R.slab, k = R.raster, h = r * Math.sqrt(3) / 2, hash = MapDepth.rockHash
        const left = side == 4, which = left ? 'left' : 'right'
        // (the outer vertex v, the inner one (the notch) n, local x growing outward d(x) = distance past v)
        const v = left ? {x: -r / 2, y: -h} : {x: 0, y: 0}, n = left ? {x: 0, y: 0} : {x: -r / 2, y: h}, out = left ? -1 : 1
        const lean = S.lean[which], depth = S.depth * h, bottom = v.y + depth, round = S.round * r
        const edgeY = x => v.y + (n.y - v.y) * (x - v.x) / (n.x - v.x)
        const reach = lean * depth + 1 / k, pad = 2 / k
        const x0 = Math.min(v.x, n.x) - (left ? reach : pad), x1 = Math.max(v.x, n.x) + (left ? pad : reach)
        const y0 = v.y - pad, y1 = bottom + pad
        const W = Math.ceil((x1 - x0) * k), H = Math.ceil((y1 - y0) * k), d = new Uint8ClampedArray(W * H * 4)
        const C = S.colors[which], colorAt = (t, c) => {
            const q = Math.max(0, Math.min(1, t)) * (C.length - 1), i = Math.min(C.length - 2, Math.floor(q))
            return C[i][c] + (C[i + 1][c] - C[i][c]) * (q - i)
        }
        // (streaks: value noise along the face, in the field's frame so the side's faces differ)
        const sw = S.streak.width * r, base = kx * 1.5 * r + ky * 7.3 * r
        const streak = x => {
            const t = (base + x) / sw, j = Math.floor(t), f = t - j, g = f * f * (3 - 2 * f)
            const a = hash(j & 1023, 31), b = hash((j + 1) & 1023, 31)
            return (2 * (a + (b - a) * g) - 1) * S.streak.amount
        }
        const clamp = t => Math.max(0, Math.min(1, t))
        for (let py = 0; py < H; ++py, yield) {
            const y = y0 + (py + 0.5) / k, drop = y - v.y
            if (drop < -pad) continue
            // (the outer side: from v, leaning out; rounded into the level bottom over round)
            const below = Math.max(0, y - (bottom - round)), cut = round - Math.sqrt(Math.max(0, round * round - below * below))
            const outer = v.x + out * (lean * Math.max(0, drop) - cut)
            for (let px = 0; px < W; ++px) {
                const x = x0 + (px + 0.5) / k
                const past = (x - outer) * out
                const a = clamp(Math.min((y - edgeY(x)) * k + 0.5, (bottom - y) * k + 0.5, -past * k + 0.5, (left ? -x : x - n.x) * k + 1.5))
                if (!(a > 0)) continue
                // (t: 0 under the edge .. 1 at the foot, over the face's height at this column)
                const top = edgeY(x), t = clamp((y - top) / Math.max(1e-6, bottom - top))
                const lip = clamp(1 - (bottom - y) / (S.lip * r)), lit = Math.exp(-(((-past) / (S.corner.width * r)) ** 2)) * S.corner.gain[which]
                const gain = (1 + streak(x)) * (1 - 0.5 * lip)
                const p = 4 * (py * W + px)
                for (let c = 0; c < 3; ++c) {
                    const col = colorAt(t, c) * gain
                    d[p + c] = col + (255 - col) * lit * (1 - t)
                }
                d[p + 3] = 255 * a
            }
        }
        return {data: d, width: W, height: H, x: x0, y: y0, k}
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
        // TASK-1583: cast by the rock skirt's foot with atmospheric visuals (sideDepth, the foot's mean depth).
        const depth = otherSettings.atmosphericVisuals ? (MapDepth.ROCK.scallop.depth + MapDepth.ROCK.scallop.amplitude / 2 - Math.sqrt(3) / 4) * basis.r : this.depth
        const w = b.right - b.left + 2 * pad, h = b.bottom - b.top + depth + 2 * pad
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
            ctx.fillStyle = ctx.shadowColor = layer.color || config.color
            ctx.shadowBlur = 2 * layer.blur * config.raster
            ctx.shadowOffsetX = layer.x * config.raster
            ctx.shadowOffsetY = layer.y * config.raster
            ctx.fill(this.outline)
            ctx.translate(0, depth)
            ctx.fill(this.outline)
            ctx.translate(0, -depth)
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
        // TASK-1638: what the attack on each hit-now cell would hit (the interaction's own attackTarget).
        const targetKinds = new Map()
        for (const k of targetsNow) {
            const coord = SelectionOverlay.coordOf(k)
            targetKinds.set(k, interaction.attackTarget(grid.arr[coord.x][coord.y], unit))
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
            range: interaction.range, moveCells, rangeCells, rangeExcluded, targetsNow, targetKinds, targetsAfterStep,
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
    // TASK-1638: the siege icon on a target the attack would hit as a building, the unit type's icon on a unit.
    static targetIcon(data, k) {
        if (data.siege || data.targetKinds.get(k) === 'building')
            return 'statBuildingDmg'
        return SelectionOverlay.isRanged(data.unit.interaction) ? 'statRange' : 'statDmg'
    }
    drawTargets(ctx, data) {
        for (const k of data.targetsAfterStep.keys())
            if (!data.targetsNow.has(k))
                this.stepRing(ctx, SelectionOverlay.targetPos(k))
        for (const k of data.targetsNow)
            this.emblem(ctx, SelectionOverlay.targetPos(k), SelectionOverlay.targetIcon(data, k))
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

// TASK-1615: this file loaded as a rock worker (MapDepth.rockWorkersOn): each message asks for a rock sprite's pixels.
if (typeof document === 'undefined' && typeof importScripts === 'function' && typeof self !== 'undefined')
    self.onmessage = e => {
        const q = e.data
        // TASK-1633: an underlay's raster (MapDepth.createUnderlayCache's async path), drawn as on the main thread.
        if (q.underlay) {
            try {
                const canvas = new OffscreenCanvas(q.w, q.h), g = canvas.getContext('2d')
                g.scale(q.scale, q.scale)
                g.translate(-q.left, -q.top)
                const outline = new Path2D()
                outline.moveTo(q.loop[0][0], q.loop[0][1])
                for (let k = 1; k < q.loop.length; ++k)
                    outline.lineTo(q.loop[k][0], q.loop[k][1])
                outline.closePath()
                MapDepth.paintUnderlay(g, outline, q.faces, q.shadowBlur, q.shadowOffset, q.scale, true)
                const bitmap = canvas.transferToImageBitmap()
                self.postMessage({underlay: q.underlay, bitmap}, [bitmap])
            } catch (error) {
                self.postMessage({underlay: q.underlay, error: String(error)})
            }
            return
        }
        try {
            const pixels = MapDepth.rockPixels(q.side, q.kx, q.ky, q.open, q.r)
            self.postMessage({key: q.key, r: q.r, ahead: !!q.ahead, ...pixels}, [pixels.data.buffer])
        } catch (error) {
            self.postMessage({key: q.key, r: q.r, ahead: !!q.ahead, error: String(error)})
        }
    }
