// Diagnostic-only instrumentation. No sampler, wrappers or listeners in ordinary play.
(() => {
    // Headless runtimes (vm contexts of the tests and tools) have no page address: nothing to instrument.
    if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined') return
    if (new URLSearchParams(location.search).get('visualsPerf') !== '1') return
    const query = new URLSearchParams(location.search)
    const sourceIdentity = Promise.all([{src:location.href},...document.scripts].filter(s=>s.src).map(async script=>{
        const bytes=await (await fetch(script.src)).arrayBuffer()
        const digest=await crypto.subtle.digest('SHA-256',bytes)
        return [new URL(script.src).pathname,[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')]
    })).then(Object.fromEntries).catch(error=>({error:String(error)}))
    const boardIdentity = () => { const state=getGameObject(); delete state.timers; return JSON.stringify(state) }
    // A capture started in the menu has no game yet (no grid, no players): its board is the game's, from its first frame.
    const liveBoard = () => typeof grid !== 'undefined' && grid && players.length ? boardIdentity() : null
    const camera = () => ({scale: canvas.scale, offset: {...canvas.offset}})
    const counters = {canvasAllocations: 0, gradients: 0, spriteLoads: 0}
    let report, active = false, segment = 'idle-before', frame, saved, cancelled = false, lastInput = null, lastInputType = null
    // Compositor-side work of a frame (and of the tasks since the previous one): blended destination
    // pixels, large canvas uploads and the board's render path. Reset after every sample.
    const freshWork = () => ({blendedMegapixels: 0, blendedDraws: 0, blendedMainMegapixels: 0, blendedByOp: {},
        pathBlends: {draws: 0, canvasMegapixels: 0}, uploads: [], uploadMegapixels: 0, renderPath: null, overlayLayer: false,
        drawnMegapixels: 0, drawCalls: 0, drawnMainMegapixels: 0, drawnByLayer: {}, unboundedDraws: 0})
    let work = freshWork()
    const originalLoop = gameLoop, originalDraw = drawAll
    gameLoop = function(timestamp) {
        if (!active) return originalLoop(timestamp)
        const start = performance.now()
        const observedSegment = saved ? segment : lastInput === null ? 'idle-before' : start-lastInput<250 ? 'zooming' : 'settled-after'
        frame = {timestamp, start, segment:observedSegment, input: lastInput !== null && start-lastInput<250 ? lastInputType : null, visible: !document.hidden, focused: document.hasFocus(), camera: camera(), renderMs: 0, ...counters,
            surfaceCacheRevision:grid.surfaceCacheRevision, surfaceCacheStages:grid.surfaceCacheStages, surfaceCacheThreshold:grid.getSurfaceCacheGeometry().scale, rasterizations: atmosphericBackground.rasterizations, cacheBytes: atmosphericBackground.bytes()}
        try { return originalLoop(timestamp) }
        finally {
            if (report.board === null && (report.board = liveBoard()) !== null) Object.assign(report, {flag: otherSettings.atmosphericVisuals, initialCamera: frame.camera})
            Object.assign(frame,counters,{surfaceCacheRevision:grid.surfaceCacheRevision,surfaceCacheStages:grid.surfaceCacheStages,rasterizations:atmosphericBackground.rasterizations,cacheBytes:atmosphericBackground.bytes()})
            frame.end = performance.now()
            frame.updateMs = Math.max(0, frame.end - start - frame.renderMs)
            const previous = report.samples.at(-1)
            frame.gapMs = previous ? timestamp - previous.timestamp : null
            // What the camera did in this frame (camera after the update against the previous frame's).
            frame.motion = !previous ? 'still' : frame.camera.scale !== previous.camera.scale ? 'zoom' :
                frame.camera.offset.x !== previous.camera.offset.x || frame.camera.offset.y !== previous.camera.offset.y ? 'pan' : 'still'
            if (!saved) frame.segment = frame.motion
            const round = v => Math.round(v * 1e4) / 1e4
            frame.work = {...work, blendedMegapixels: round(work.blendedMegapixels), blendedMainMegapixels: round(work.blendedMainMegapixels),
                blendedByOp: Object.fromEntries(Object.entries(work.blendedByOp).map(([k, v]) => [k, round(v)])),
                pathBlends: {draws: work.pathBlends.draws, canvasMegapixels: round(work.pathBlends.canvasMegapixels)}, uploadMegapixels: round(work.uploadMegapixels),
                drawnMegapixels: round(work.drawnMegapixels), drawnMainMegapixels: round(work.drawnMainMegapixels),
                drawnByLayer: Object.fromEntries(Object.entries(work.drawnByLayer).map(([k, [mp, calls]]) => [k, [round(mp), calls]]))}
            work = freshWork()
            if (frame.gapMs > 50) report.longGaps.push({timestamp, gapMs: frame.gapMs})
            report.samples.push(frame)
            if (document.hidden) report.invalidReasons.push('hidden-tab')
            frame = null
        }
    }
    drawAll = function(...args) {
        if (!frame) return originalDraw.apply(this, args)
        frame.camera = camera() // Camera after the existing update, actually used by this draw.
        const start = performance.now()
        try { return originalDraw.apply(this, args) }
        finally { frame.renderMs += performance.now() - start }
    }
    const create = document.createElement.bind(document)
    document.createElement = function(name, ...args) {
        if (active && name.toLowerCase() === 'canvas') counters.canvasAllocations++
        return create(name, ...args)
    }
    for (const name of ['createLinearGradient', 'createRadialGradient']) {
        const original = CanvasRenderingContext2D.prototype[name]
        CanvasRenderingContext2D.prototype[name] = function(...args) {
            if (active) counters.gradients++
            return original.apply(this, args)
        }
    }
    // Blends and uploads. A draw with a globalCompositeOperation other than 'source-over' adds its
    // destination rectangle (transformed bounding box, cut to the target canvas and to the context's
    // clip rectangles) to blendedMegapixels; a blended path or text draw has no rectangle and is
    // counted with its whole canvas as the bound (pathBlends). Every draw call bumps its canvas's
    // content version; drawing a canvas over 1 megapixel whose version changed since it was last
    // drawn is a large upload.
    const versions = new WeakMap(), uploaded = new WeakMap()
    // Clip rectangles per context (device pixels, kept across save and restore): a clip() of a path
    // made only of rect() calls under an axis-aligned transform cuts them to those rectangles; any
    // other clip leaves them as they were (the count stays an upper bound). None: the whole canvas.
    const clips = new WeakMap(), clipStacks = new WeakMap(), paths = new WeakMap()
    const boxArea = (g, x, y, w, h) => {
        const t = g.getTransform(), xs = [], ys = []
        for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
            xs.push(t.a * px + t.c * py + t.e); ys.push(t.b * px + t.d * py + t.f)
        }
        return deviceArea(g, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys))
    }
    // Area (megapixels) of the device rectangle x0..x1 x y0..y1 cut to g's canvas and its clip rectangles.
    const deviceArea = (g, x0, x1, y0, y1) => {
        const cw = g.canvas.width, ch = g.canvas.height
        x0 = Math.max(0, x0); x1 = Math.min(cw, x1); y0 = Math.max(0, y0); y1 = Math.min(ch, y1)
        const rects = clips.get(g)
        if (!rects) return Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / 1e6
        let area = 0
        for (const r of rects)
            area += Math.max(0, Math.min(x1, r.x1) - Math.max(x0, r.x0)) * Math.max(0, Math.min(y1, r.y1) - Math.max(y0, r.y0))
        return area / 1e6
    }
    const blend = (g, area) => {
        const op = g.globalCompositeOperation
        if (op === 'source-over') return
        if (area === null) {
            work.pathBlends.draws++
            work.pathBlends.canvasMegapixels += g.canvas.width * g.canvas.height / 1e6
            return
        }
        work.blendedDraws++
        work.blendedMegapixels += area
        work.blendedByOp[op] = (work.blendedByOp[op] || 0) + area
        if (g.canvas === mainCanvas) work.blendedMainMegapixels += area
    }
    // Drawn work (TASK-1174): every drawImage, fillRect, strokeRect, clearRect, putImageData, fill, stroke
    // and text draw, source-over included, adds its destination area (device pixels cut to the canvas and
    // its clip rectangles; paths and text by their transformed bounding box, a stroke grown by half its
    // line width) to drawnMegapixels and one to drawCalls, by layer: the drawing function the call is
    // made in (sky, shadow, surface, buildings, light, units, text, borders, interface; frame: drawMain's
    // own calls, between-frames: tasks outside a frame), offscreen/ before it when the target is not the
    // main canvas. A path or text whose bounds are unknown (a Path2D made before recording) counts its
    // whole canvas (unboundedDraws).
    let layer = 'between-frames'
    const draw = (g, area) => {
        if (area === null) { work.unboundedDraws++; area = g.canvas.width * g.canvas.height / 1e6 }
        work.drawCalls++
        work.drawnMegapixels += area
        const main = g.canvas === mainCanvas
        if (main) work.drawnMainMegapixels += area
        const key = main || g.canvas === interfaceCanvasElement() ? layer : 'offscreen/' + layer
        const entry = work.drawnByLayer[key] ||= [0, 0]
        entry[0] += area; entry[1]++
    }
    const interfaceCanvasElement = () => typeof interfaceCtx !== 'undefined' ? interfaceCtx.canvas : null
    // Path bounds: device points of the context's current path (beginPath resets), and world points of
    // each Path2D (transformed when it is filled or stroked).
    const pathBoxes = new WeakMap(), path2DBoxes = new WeakMap()
    const grow = (box, x, y) => {
        if (x < box.x0) box.x0 = x
        if (x > box.x1) box.x1 = x
        if (y < box.y0) box.y0 = y
        if (y > box.y1) box.y1 = y
    }
    const emptyBox = () => ({x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity})
    // Points (x, y pairs, the extent of each path call's geometry) of path call name with args.
    const pathPoints = (name, a) => {
        switch (name) {
        case 'arc': return [a[0] - a[2], a[1] - a[2], a[0] + a[2], a[1] + a[2]]
        case 'ellipse': { const r = Math.max(a[2], a[3]); return [a[0] - r, a[1] - r, a[0] + r, a[1] + r] }
        case 'rect': case 'roundRect': return [a[0], a[1], a[0] + a[2], a[1] + a[3]]
        default: return Array.prototype.slice.call(a, 0, name === 'arcTo' ? 4 : undefined).filter(v => typeof v === 'number')
        }
    }
    const trackPath = (g, name, args) => {
        let box = pathBoxes.get(g)
        if (!box) pathBoxes.set(g, box = emptyBox())
        const t = g.getTransform(), p = pathPoints(name, args)
        for (let k = 0; k + 1 < p.length; k += 2) {
            const x = p[k], y = p[k + 1]
            if (name === 'arc' || name === 'ellipse' || name === 'rect' || name === 'roundRect') {
                // A box: all four corners.
                for (const [px, py] of [[p[0], p[1]], [p[2], p[1]], [p[0], p[3]], [p[2], p[3]]])
                    grow(box, t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f)
                break
            }
            grow(box, t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f)
        }
    }
    // Device area of a fill or stroke of g's current path or of the Path2D path.
    const pathArea = (g, path, stroke) => {
        let box
        if (path instanceof Path2D) {
            const w = path2DBoxes.get(path)
            if (!w || w.x0 > w.x1) return null
            const t = g.getTransform()
            box = emptyBox()
            for (const [px, py] of [[w.x0, w.y0], [w.x1, w.y0], [w.x0, w.y1], [w.x1, w.y1]])
                grow(box, t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f)
        }
        else box = pathBoxes.get(g)
        if (!box || box.x0 > box.x1) return 0
        let pad = 0
        if (stroke) { const t = g.getTransform(); pad = g.lineWidth / 2 * Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) }
        return deviceArea(g, box.x0 - pad, box.x1 + pad, box.y0 - pad, box.y1 + pad)
    }
    const textArea = (g, text, x, y, stroke) => {
        const m = g.measureText(text), t = g.getTransform(), box = emptyBox()
        const pad = stroke ? g.lineWidth / 2 : 0
        const x0 = x - m.actualBoundingBoxLeft - pad, x1 = x + m.actualBoundingBoxRight + pad
        const y0 = y - m.actualBoundingBoxAscent - pad, y1 = y + m.actualBoundingBoxDescent + pad
        for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]])
            grow(box, t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f)
        return deviceArea(g, box.x0, box.x1, box.y0, box.y1)
    }
    for (const name of ['moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse', 'rect', 'roundRect']) {
        const original = Path2D.prototype[name]
        if (!original) continue
        Path2D.prototype[name] = function() {
            let box = path2DBoxes.get(this)
            if (!box) path2DBoxes.set(this, box = emptyBox())
            const p = pathPoints(name, arguments)
            for (let k = 0; k + 1 < p.length; k += 2) grow(box, p[k], p[k + 1])
            return original.apply(this, arguments)
        }
    }
    // Labels the drawing calls made inside fn's calls (label: a name, or a function of the call's arguments).
    const labelled = (fn, label) => {
        if (fn.visualsPerfLayer) return fn
        const wrapped = function(...args) {
            const outer = layer
            layer = typeof label === 'function' ? label(args) : label
            try { return fn.apply(this, args) }
            finally { layer = outer }
        }
        wrapped.visualsPerfLayer = true
        return wrapped
    }
    // A rest frame's recorded overlay calls (Grid.drawOverlayComposite) are made later in the layer they were recorded in.
    if (typeof canvasCallLabels !== 'undefined')
        canvasCallLabels = {current: () => layer, within: (label, fn) => {
            const outer = layer
            layer = label
            try { return fn() }
            finally { layer = outer }
        }}
    drawMain = labelled(drawMain, 'frame')
    drawInterface = labelled(drawInterface, 'interface')
    const drawn = g => versions.set(g.canvas, (versions.get(g.canvas) || 0) + 1)
    const isCanvas = source => source instanceof HTMLCanvasElement || typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas
    const contexts = [CanvasRenderingContext2D, typeof OffscreenCanvasRenderingContext2D !== 'undefined' && OffscreenCanvasRenderingContext2D].filter(Boolean)
    for (const Context of contexts) {
        const proto = Context.prototype, drawImage = proto.drawImage
        // Versions and uploads are followed while not recording too (a canvas drawn and then drawn
        // from before Start is not uploaded again by its first draw in the recording); only
        // recorded frames count them.
        proto.drawImage = function(source, ...args) {
            const sw = source.width, sh = source.height
            if (active) {
                const [x, y, w = sw, h = sh] = args.length === 8 ? args.slice(4) : args
                const area = boxArea(this, x, y, w, h)
                blend(this, area)
                draw(this, area)
            }
            if (isCanvas(source) && sw * sh > 1e6 && uploaded.get(source) !== (versions.get(source) || 0)) {
                uploaded.set(source, versions.get(source) || 0)
                if (active) {
                    work.uploads.push({width: sw, height: sh, target: this.canvas === mainCanvas ? 'main' : 'offscreen'})
                    work.uploadMegapixels += sw * sh / 1e6
                }
            }
            drawn(this)
            return drawImage.call(this, source, ...args)
        }
        for (const name of ['fillRect', 'strokeRect']) {
            const original = proto[name]
            proto[name] = function(x, y, w, h) {
                if (active) {
                    const area = boxArea(this, x, y, w, h)
                    blend(this, area)
                    draw(this, name === 'strokeRect' ? boxArea(this, x - this.lineWidth / 2, y - this.lineWidth / 2, w + this.lineWidth, h + this.lineWidth) : area)
                }
                drawn(this)
                return original.apply(this, arguments)
            }
        }
        for (const name of ['fill', 'stroke', 'fillText', 'strokeText']) {
            const original = proto[name]
            proto[name] = function() {
                if (active) {
                    blend(this, null)
                    const stroke = name.startsWith('stroke')
                    draw(this, name.endsWith('Text') ? textArea(this, arguments[0], arguments[1], arguments[2], stroke) :
                        pathArea(this, arguments[0], stroke))
                }
                drawn(this)
                return original.apply(this, arguments)
            }
        }
        proto.save = (save => function() {
            if (active) {
                if (!clipStacks.has(this)) clipStacks.set(this, [])
                clipStacks.get(this).push(clips.get(this))
            }
            return save.apply(this, arguments)
        })(proto.save)
        proto.restore = (restore => function() {
            const stack = clipStacks.get(this)
            if (stack && stack.length) {
                const rects = stack.pop()
                if (rects) clips.set(this, rects)
                else clips.delete(this)
            }
            return restore.apply(this, arguments)
        })(proto.restore)
        proto.beginPath = (beginPath => function() {
            if (active) { paths.set(this, []); pathBoxes.delete(this) }
            return beginPath.apply(this, arguments)
        })(proto.beginPath)
        proto.rect = (rect => function(x, y, w, h) {
            if (active) trackPath(this, 'rect', arguments)
            const path = active && paths.get(this)
            if (path) {
                const t = this.getTransform()
                if (t.b !== 0 || t.c !== 0) paths.delete(this)
                else {
                    const xa = t.a * x + t.e, xb = t.a * (x + w) + t.e, ya = t.d * y + t.f, yb = t.d * (y + h) + t.f
                    path.push({x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(ya, yb), y1: Math.max(ya, yb)})
                }
            }
            return rect.apply(this, arguments)
        })(proto.rect)
        for (const name of ['moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse', 'roundRect']) {
            const original = proto[name]
            if (!original) continue
            proto[name] = function() {
                if (active) { paths.delete(this); trackPath(this, name, arguments) }
                return original.apply(this, arguments)
            }
        }
        proto.clip = (clip => function(...args) {
            const path = active && paths.get(this)
            if (path && path.length && !(args[0] instanceof Path2D)) {
                const old = clips.get(this)
                const rects = old ? old.flatMap(o => path.map(r => ({x0: Math.max(o.x0, r.x0), x1: Math.min(o.x1, r.x1),
                    y0: Math.max(o.y0, r.y0), y1: Math.min(o.y1, r.y1)}))).filter(r => r.x0 < r.x1 && r.y0 < r.y1) : path.slice()
                clips.set(this, rects)
            }
            return clip.apply(this, args)
        })(proto.clip)
        proto.clearRect = (clearRect => function(x, y, w, h) {
            if (active) {
                drawn(this)
                draw(this, boxArea(this, x, y, w, h))
            }
            return clearRect.apply(this, arguments)
        })(proto.clearRect)
        proto.putImageData = (putImageData => function(image, x, y) {
            if (active) {
                drawn(this)
                draw(this, deviceArea(this, x, x + image.width, y, y + image.height))
            }
            return putImageData.apply(this, arguments)
        })(proto.putImageData)
    }
    // The board's render path: the surface cache or the direct draw, and the overlay layer.
    const wrapGrid = () => {
        const proto = typeof Grid !== 'undefined' && Grid.prototype
        if (!proto || proto.drawMapSurface.visualsPerf) return
        const surface = proto.drawMapSurface, layer = proto.drawOverlayLayer
        proto.drawMapSurface = function(...args) {
            const cached = surface.apply(this, args)
            if (active) work.renderPath = cached === 'lit' ? 'lit-tiles' : cached ? 'surface-cache' : 'direct'
            return cached
        }
        proto.drawMapSurface.visualsPerf = true
        // TASK-1374: a zoom gesture's frame drawn from the zoom raster.
        if (proto.drawZoomRaster) {
            const zoomRaster = proto.drawZoomRaster
            proto.drawZoomRaster = labelled(function(...args) {
                const drawn = zoomRaster.apply(this, args)
                if (active && drawn) work.renderPath = 'zoom-raster'
                return drawn
            }, 'surface')
        }
        // TASK-1375: a level-of-detail frame that repeats the one on the canvas draws nothing.
        if (proto.endLodFrame) {
            const endLod = proto.endLodFrame
            proto.endLodFrame = function(...args) {
                // TASK-1376: a still frame above the threshold held the same way.
                const still = this.stillHolds
                const held = endLod.apply(this, args)
                if (active && held) work.renderPath = this.stillHolds !== still ? 'still-held' : 'lod-held'
                return held
            }
        }
        // TASK-1376: a held frame draws the board's snapshot (surface, buildings, units, texts) in one drawImage.
        if (proto.drawHeldFrame) proto.drawHeldFrame = labelled(proto.drawHeldFrame, 'surface')
        proto.drawOverlayLayer = function(...args) {
            const layered = layer.apply(this, args)
            if (active && layered) work.overlayLayer = true
            return layered
        }
        // Drawing layers (drawn work by layer).
        proto.drawMapSurface = labelled(proto.drawMapSurface, 'surface')
        proto.drawOverlayLayer = labelled(proto.drawOverlayLayer, 'units')
        for (const name of ['drawStillUnits', 'drawEntityOverlays', 'drawOverlaySnapshot']) if (proto[name]) proto[name] = labelled(proto[name], 'units')
        for (const name of ['drawCellText', 'drawChanceOfWinningText', 'drawLoadingCells']) if (proto[name]) proto[name] = labelled(proto[name], 'text')
        if (proto.drawLitEdges) proto.drawLitEdges = labelled(proto.drawLitEdges, 'light')
        proto.drawOther = labelled(proto.drawOther, args => args[1] || 'entities')
        atmosphericBackground.draw = labelled(atmosphericBackground.draw, 'sky')
        atmosphericLighting.draw = labelled(atmosphericLighting.draw, 'light')
        MapDepth.prototype.drawAtmosphericShadow = labelled(MapDepth.prototype.drawAtmosphericShadow, 'shadow')
        for (const target of [typeof moveTween !== 'undefined' && moveTween, typeof onlineObservation !== 'undefined' && onlineObservation,
            typeof remoteEffects !== 'undefined' && remoteEffects])
            if (target && target.draw) target.draw = labelled(target.draw, 'units')
        for (const target of [typeof border !== 'undefined' && border, typeof attackBorder !== 'undefined' && attackBorder])
            if (target && target.draw) target.draw = labelled(target.draw, 'borders')
        proto.drawMapSurface.visualsPerf = true
    }
    const originalLoad = loadSprites
    loadSprites = function(...args) { if (active) counters.spriteLoads++; return originalLoad.apply(this, args) }
    for (const type of ['visibilitychange', 'focus', 'blur']) window.addEventListener(type, () => {
        if (!active) return
        report.visibility.push({type, timestamp: performance.now(), hidden: document.hidden, focused: document.hasFocus()})
        if (document.hidden || type === 'blur') report.invalidReasons.push(type)
    })
    // Camera input: wheel and keyboard zoom, keyboard pan, mouse edge scroll and drags, touch pinch and drag.
    // A mousemove is recorded only when its buttons or the edge-scroll direction it sets change.
    let pointerState = null
    const edgeOf = event => {
        try { const d = gameEvent.screen.getEdgeDirection?.(getEventPos(event)); return d ? d.x + ',' + d.y : '0,0' }
        catch (_) { return '0,0' }
    }
    for (const type of ['wheel', 'keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchmove', 'touchend']) document.addEventListener(type, event => {
        if (!active || event.target?.closest?.('#visuals-perf-controls')) return
        const now = performance.now()
        let entry = {type, timestamp: now, eventTimestamp: event.timeStamp, trusted: event.isTrusted}
        if (type === 'wheel') Object.assign(entry, {deltaY: event.deltaY, ctrlKey: event.ctrlKey})
        else if (type.startsWith('key')) Object.assign(entry, {key: event.key, code: event.code, repeat: event.repeat})
        else if (type.startsWith('mouse')) {
            const state = event.buttons + '|' + edgeOf(event)
            if (type === 'mousemove' && state === pointerState) entry = null
            else Object.assign(entry, {x: event.clientX, y: event.clientY, buttons: event.buttons, edge: edgeOf(event)})
            pointerState = state
        }
        else entry.points = [...event.touches].map(t => ({x:t.clientX,y:t.clientY}))
        const cameraInput = type === 'wheel' && !event.ctrlKey || type === 'keydown' || type === 'touchmove' ||
            type.startsWith('mouse') && (event.buttons !== 0 || edgeOf(event) !== '0,0')
        if (cameraInput) { lastInput = now; lastInputType = type === 'keydown' ? 'keyboard' : type === 'wheel' ? 'wheel' : type.startsWith('touch') ? 'touch' : 'mouse' }
        if (entry) report.inputs.push(entry)
    }, {capture:true, passive:true})
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const restore = () => {
        if (!saved) return
        gameEvent.screen.zoomBy({x:WIDTH/2,y:HEIGHT/2}, saved.camera.scale/canvas.scale)
        gameEvent.screen.moveTo({x:saved.camera.offset.x+width/2,y:saved.camera.offset.y+height/2})
        otherSettings.atmosphericVisuals = saved.flag
        loadSprites()
        saved = null
    }
    function start(metadata = {}) {
        if (active) throw Error('Capture already active')
        wrapGrid()
        work = freshWork()
        report = {schemaVersion:2, environment:'user-browser', performanceStatus:'user-device-performance-unverified',
            sourceCommits:{client:query.get('clientCommit'),server:query.get('serverCommit'),provenance:'user-supplied URL; verify against source hashes'}, ...metadata, userAgent:navigator.userAgent, viewport:[innerWidth,innerHeight], dpr:devicePixelRatio,
            renderer:'Canvas2D', refreshInterval:{method:'median of consecutive visible RAF timestamps; not hardware refresh rate'},
            board:liveBoard(), flag:otherSettings.atmosphericVisuals, initialCamera:camera(),
            samples:[], inputs:[], visibility:[], longGaps:[], invalidReasons:[]}
        if (document.hidden || !document.hasFocus()) report.invalidReasons.push('initial visibility/focus')
        lastInput=null;lastInputType=null;pointerState=null
        const target=report
        sourceIdentity.then(sources=>{target.sourceHashes=sources})
        active = true
        return report
    }
    function stop() {
        active = false
        if (!report) return null
        const gaps = report.samples.filter(s=>s.visible && s.gapMs>0).map(s=>s.gapMs).sort((a,b)=>a-b)
        report.refreshInterval.observedMedianMs = gaps[Math.floor(gaps.length/2)] ?? null
        report.valid = report.samples.length>1 && report.invalidReasons.length===0
        return report
    }
    function compare(a,b) {
        const sameCamera=(x,y)=>x && y && Math.abs(x.scale-y.scale)<1e-9 && Math.abs(x.offset.x-y.offset.x)<1e-7 && Math.abs(x.offset.y-y.offset.y)<1e-7
        const left=a.workload?.trajectory,right=b.workload?.trajectory
        return a.valid && b.valid && a.board===b.board && JSON.stringify(a.viewport)===JSON.stringify(b.viewport) && a.dpr===b.dpr &&
            sameCamera(a.initialCamera,b.initialCamera) && a.workload.input===b.workload.input &&
            Array.isArray(left) && left.length>1 && left.length===right?.length && left.every((p,i)=>sameCamera(p,right[i]) && Math.abs(p.elapsedMs-right[i].elapsedMs)<1000)
    }
    async function paired({testOwned=false, input=mobilePhone?'pinch':'wheel', metadata={}} = {}) {
        if (!testOwned || gameSettings.isOnline || menu.visible) throw Error('Replay requires a local test-owned game')
        if (input!==(mobilePhone?'pinch':'wheel')) throw Error('Choose the input supported by this browser')
        if (active || saved) throw Error('Capture already active')
        saved = {camera:camera(),flag:otherSettings.atmosphericVisuals}
        cancelled = false
        const runs=[]
        api.progress={runs}
        try {
            for (const flag of [false,true,true,false,false,true]) {
                if (cancelled) break
                gameEvent.screen.zoomBy({x:WIDTH/2,y:HEIGHT/2}, saved.camera.scale/canvas.scale)
                gameEvent.screen.moveTo({x:saved.camera.offset.x+width/2,y:saved.camera.offset.y+height/2})
                otherSettings.atmosphericVisuals=flag; loadSprites()
                segment='warm-up';start(metadata)
                await sleep(10000)
                segment='idle-before';await sleep(5000)
                const trajectory=[]
                segment='zooming'
                const rect=mainCanvas.getBoundingClientRect(), x=rect.x+rect.width/2,y=rect.y+rect.height/2
                const touch=(type,distance)=>mainCanvas.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,
                    touches:type==='touchend'?[]:[-1,1].map((sign,i)=>new Touch({identifier:i,target:mainCanvas,clientX:x+sign*distance,clientY:y}))}))
                if(input==='pinch') touch('touchstart',160)
                const started=performance.now()
                for(let i=0;i<120 && !cancelled;i++) {
                    // Identical ordered inputs; wall-clock scheduling never bypasses the game's handlers.
                    if(input==='wheel') mainCanvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:x,clientY:y,deltaY:i<60?12:-12}))
                    else {
                        // Four bounded pinch gestures each way keep both fingers inside a portrait viewport.
                        if(i && i%15===0){touch('touchend',0);touch('touchstart',i<60?160:40)}
                        touch('touchmove',i<60?160-(i%15+1)*8:40+(i%15+1)*8)
                    }
                    trajectory.push({index:i,elapsedMs:performance.now()-started,...camera()})
                    await sleep(Math.max(0,started+(i+1)*20000/120-performance.now()))
                }
                if(input==='pinch') touch('touchend',160)
                segment='settled-after';await sleep(5000)
                const run=stop();if(boardIdentity()!==run.board){run.valid=false;run.invalidReasons.push('board-changed')}run.workload={input,warmupMs:10000,measuredMs:30000,trajectory};runs.push(run)
            }
        } finally { stop();restore() }
        const pairs=[0,2,4].map(i=>runs[i+1] ? compare(runs[i],runs[i+1]) : false)
        api.lastExport={schemaVersion:1,environment:metadata.environment||'user-browser',runs,pairs,valid:pairs.every(Boolean),cancelled}
        return api.lastExport
    }
    const api=window.visualsPerf={start,stop,paired,compare,setSegment:value=>{segment=value},cancel:()=>{cancelled=true;stop()},export:()=>api.lastExport||stop()}
    window.addEventListener('load',()=>{
        const panel=create('section');panel.id='visuals-perf-controls'
        panel.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;background:#182333;color:white;padding:8px;font:12px sans-serif;max-width:calc(100vw - 32px)'
        const status=create('div');status.textContent='Visual capture — local diagnostics; device FPS unverified';panel.append(status)
        const owned=create('input');owned.type='checkbox';const label=create('label');label.append(owned,' Local test-owned game');panel.append(label)
        const select=create('select');for(const value of ['wheel','pinch']){const o=create('option');o.value=o.textContent=value;select.append(o)}select.value=mobilePhone?'pinch':'wheel';panel.append(select)
        const button=(text,fn)=>{const b=create('button');b.textContent=text;b.style.cssText='min-height:32px;padding:5px;margin:2px';b.onclick=async()=>{try{await fn()}catch(e){status.textContent=e.message}};panel.append(b)}
        button('Start',()=>{api.lastExport=null;start();status.textContent='Recording live RAF'})
        button('Stop',()=>{cancelled=true;stop();status.textContent='Stopped; paired replay restores after current window'})
        button('3 paired captures',async()=>{status.textContent='Capturing 3 pairs (4 minutes)';await paired({testOwned:owned.checked,input:select.value});status.textContent='Capture complete; export report'})
        button('Export',()=>{const blob=new Blob([JSON.stringify(api.export(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=create('a');a.href=url;a.download='visuals-performance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
        for(const type of ['click','mousedown','mousemove','wheel','touchstart','touchmove','touchend']) panel.addEventListener(type,event=>event.stopPropagation())
        document.body.append(panel)
    })
})()
