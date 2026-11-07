// TASK-1563 (SECTORS 7/11): the worker-safe sector renderer. Every sector picture (a lit tile's quarters: the ground,
// buildings, light and fog; a unit sector: its ground, the units pass with the bars and the cell texts) is drawn by
// SectorDraw from a SECTOR SNAPSHOT, on the main thread now (Grid.sectorModule) and in a Worker later (TASK-1564): one
// code path. This file reads no global state of the page: no DOM, no board, no Grid; only the 2D context it is given,
// Path2D, ImageData and DOMMatrix-like dicts, all of which a Worker with OffscreenCanvas has. It is loaded as a classic
// script (the page's script tag, or importScripts in a Worker).
//
// A snapshot (serializable: structuredClone / postMessage keep it whole; images are in the sprite map, by key):
//   {v: 1, kind: 'lit' | 'unit', level, u, v, size,
//    range: {i0, i1, j0, j1}: the sector's cells and the pad of cells whose drawing reaches it,
//    cells: [[i, j, flags, unit, building, owner], ...]: the board snapshot of those cells (flags: SECTOR_CELL_*),
//    targets: [{k, x, y, w, h, segs}]: the canvases the sector is drawn into (a lit tile's quarters, a unit sector's one),
//    opaque: the values that could not be serialized (0 for a snapshot a Worker can draw)}
// segs: the target's drawing in order, as runs of operations: {c: the index in cells of the cell the operations draw
// (-1: the sector's own, such as the underlay, grout or light), l: the visualsPerf layer label or null, o: [op, ...]}.
// An op is [name, ...args] (a call on the context) or ['=', property, value] (a property set). Values are numbers,
// strings, booleans, null, arrays of numbers, or one of:
//   {s: key}                      an image: sprites.get(key) (canvas, ImageBitmap, image)
//   {sg: 1, t, a, stops}          a gradient: 'linear' | 'radial' | 'conic', its arguments and [offset, colour] stops
//   {sp: 1, s: key, rep}          a pattern of sprite key
//   {path: [[cmd, ...args], ...]} a Path2D's commands (SectorPath)
//   {m: [a, b, c, d, e, f]}       a matrix (setTransform's DOMMatrix argument)
//   {id: [w, h, data]}            ImageData
//   {o: key}                      a value that is not serializable (sprites.get(key)); counted in opaque
const SECTOR_CELL_FOG = 1, SECTOR_CELL_EDGE = 2, SECTOR_CELL_OBSERVED = 4, SECTOR_CELL_TEXT = 8

// A Path2D that keeps its commands (cmds), so a path the drawing code builds can be put in a snapshot. Built from cmds
// when given (the module's replay of a {path} value).
// (A context without Path2D, such as a test's stand-in, gets a SectorPath keeping its commands only.)
const SectorPathBase = typeof Path2D === 'function' ? Path2D : class {}
class SectorPath extends SectorPathBase {
    constructor(cmds) {
        super()
        this.cmds = []
        if (cmds)
            for (const c of cmds)
                this[c[0]](...c.slice(1))
    }
}
for (const name of ['moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse', 'rect',
    'roundRect', 'closePath'])
    SectorPath.prototype[name] = function(...args) {
        this.cmds.push([name, ...args])
        // Looked up at the call: a wrapper installed on Path2D later (render/visualsPerf.js's path bounds) applies.
        const base = SectorPathBase.prototype[name]
        return typeof base === 'function' ? base.apply(this, args) : undefined
    }

// A gradient made by a recording (SectorRecorder): its kind, arguments and stops; drawn as a real one by SectorDraw.
class SectorGradient {
    constructor(t, a) {
        this.sg = 1
        this.t = t
        this.a = a
        this.stops = []
    }
    addColorStop(offset, color) {
        this.stops.push([offset, color])
    }
}

const SectorDraw = {
    // The context's 2D gradients, patterns and paths made from snapshot values, per context (a WeakMap from the value).
    made: new WeakMap(),
    madeOf(ctx) {
        let m = this.made.get(ctx)
        if (!m)
            this.made.set(ctx, m = new WeakMap())
        return m
    },
    // The value v of an op's argument or property on ctx, sprites the snapshot's images by key.
    value(ctx, v, sprites) {
        if (typeof v !== 'object' || v === null || Array.isArray(v))
            return v
        if (v.s !== undefined && v.sp === undefined)
            return sprites.get(v.s)
        if (v.o !== undefined)
            return sprites.get(v.o)
        if (v.m)
            return {a: v.m[0], b: v.m[1], c: v.m[2], d: v.m[3], e: v.m[4], f: v.m[5]}
        const made = this.madeOf(ctx)
        let out = made.get(v)
        if (out)
            return out
        if (v.sg) {
            out = v.t === 'linear' ? ctx.createLinearGradient(...v.a) : v.t === 'radial' ? ctx.createRadialGradient(...v.a) :
                ctx.createConicGradient(...v.a)
            for (const [offset, color] of v.stops)
                out.addColorStop(offset, color)
        }
        else if (v.sp)
            out = ctx.createPattern(sprites.get(v.s), v.rep)
        else if (v.path) {
            out = new Path2D()
            for (const c of v.path)
                out[c[0]](...c.slice(1))
        }
        else if (v.id)
            out = new ImageData(new Uint8ClampedArray(v.id[2]), v.id[0], v.id[1])
        else
            throw new Error('SectorDraw: unknown value ' + Object.keys(v).join())
        made.set(v, out)
        return out
    },
    // The ops of a run on ctx.
    drawOps(ctx, ops, sprites) {
        for (let k = 0; k < ops.length; ++k) {
            const op = ops[k], name = op[0]
            if (name === '=') {
                ctx[op[1]] = this.value(ctx, op[2], sprites)
                continue
            }
            switch (op.length) {
            case 1: ctx[name](); break
            case 2: ctx[name](this.value(ctx, op[1], sprites)); break
            case 3: ctx[name](this.value(ctx, op[1], sprites), this.value(ctx, op[2], sprites)); break
            default: {
                const args = new Array(op.length - 1)
                for (let a = 1; a < op.length; ++a)
                    args[a - 1] = this.value(ctx, op[a], sprites)
                ctx[name](...args)
            }
            }
        }
    },
    // The runs segs[from..to) of a target on ctx; within(label, fn), when given, runs fn in the run's visualsPerf layer
    // (the main thread's counters; a Worker gives none).
    drawSegs(ctx, segs, sprites, within = null, from = 0, to = segs.length) {
        for (let k = from; k < to; ++k) {
            const seg = segs[k]
            if (within && seg.l !== null && seg.l !== undefined)
                within(seg.l, () => this.drawOps(ctx, seg.o, sprites))
            else
                this.drawOps(ctx, seg.o, sprites)
        }
    },
    // A whole snapshot: target k drawn on contexts[k] (null: left out).
    drawSector(contexts, snapshot, sprites, within = null) {
        for (const target of snapshot.targets) {
            const ctx = contexts[target.k]
            if (ctx)
                this.drawSegs(ctx, target.segs, sprites, within)
        }
    },
    // The cells of a snapshot drawing anything in target k (their indices in snapshot.cells, -1 for the sector's own runs).
    drawnCells(snapshot) {
        const out = new Set()
        for (const target of snapshot.targets)
            for (const seg of target.segs)
                if (seg.o.length)
                    out.add(seg.c)
        return out
    }
}
