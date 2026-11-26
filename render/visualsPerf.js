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
        pathBlends: {draws: 0, canvasMegapixels: 0}, uploads: [], uploadMegapixels: 0, renderPath: null, standIn: null, overlayLayer: false, sceneLayer: false, litLayer: false,
        drawnMegapixels: 0, drawCalls: 0, drawnMainMegapixels: 0, drawnByLayer: {}, unboundedDraws: 0,
        canvasSites: {}, bitmapSites: {}, offscreenByTarget: {}, tilesMissingOnScreen: 0, tilesBuiltInFrame: 0, tilesFromStandIn: 0, tilesUnbuilt: 0,
        // TASK-1557 (see sectorCounters below)
        layerFullRebuild: {}, layerRebuildCauses: {}, liveBoardCalls: {text: 0, units: 0, ground: 0, lighting: 0, other: 0}, standInPx: 0, standInPxBy: {},
        // TASK-1568 (see groundFill below)
        groundFillPx: 0})
    let work = freshWork()
    const originalLoop = gameLoop, originalDraw = drawAll
    gameLoop = function(timestamp) {
        if (!active) return originalLoop(timestamp)
        const start = performance.now()
        const observedSegment = saved ? segment : lastInput === null ? 'idle-before' : start-lastInput<250 ? 'zooming' : 'settled-after'
        frame = {timestamp, start, segment:observedSegment, input: lastInput !== null && start-lastInput<250 ? lastInputType : null, visible: !document.hidden, focused: document.hasFocus(), camera: camera(), renderMs: 0, ...counters,
            surfaceCacheRevision:grid.surfaceCacheRevision, surfaceCacheStages:grid.surfaceCacheStages, surfaceCacheThreshold:grid.getSurfaceCacheGeometry().scale, rasterizations: atmosphericBackground.rasterizations, cacheBytes: atmosphericBackground.bytes()}
        taskSources.enter('update')
        try { return originalLoop(timestamp) }
        finally {
            taskSources.exit()
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
            // TASK-1624: the turn playback's window and step of the frame (playbackTrace).
            frame.playback = playbackTrace.frame(frame)
            const round = v => Math.round(v * 1e4) / 1e4
            frame.work = {...work, blendedMegapixels: round(work.blendedMegapixels), blendedMainMegapixels: round(work.blendedMainMegapixels),
                blendedByOp: Object.fromEntries(Object.entries(work.blendedByOp).map(([k, v]) => [k, round(v)])),
                pathBlends: {draws: work.pathBlends.draws, canvasMegapixels: round(work.pathBlends.canvasMegapixels)}, uploadMegapixels: round(work.uploadMegapixels),
                drawnMegapixels: round(work.drawnMegapixels), drawnMainMegapixels: round(work.drawnMainMegapixels),
                drawnByLayer: Object.fromEntries(Object.entries(work.drawnByLayer).map(([k, [mp, calls]]) => [k, [round(mp), calls]])),
                offscreenByTarget: Object.fromEntries(Object.entries(work.offscreenByTarget).map(([k, [mp, calls]]) => [k, [round(mp), calls]]))}
            // TASK-1549: heavy = over 500 draw calls or over 1 MP drawn on offscreen layers (the tasks since the previous
            // frame included); canvases created since the previous frame.
            const offscreen = Object.entries(frame.work.drawnByLayer).reduce((sum, [k, [mp]]) => k.startsWith('offscreen/') ? sum + mp : sum, 0)
            frame.work.offscreenMegapixels = round(offscreen)
            frame.work.canvasesCreated = Object.values(work.canvasSites).reduce((a, b) => a + b, 0)
            frame.heavy = work.drawCalls > 500 || offscreen > 1
            frame.tilesMissingOnScreen = work.tilesMissingOnScreen
            // TASK-1557: the board layers rebuilt whole since the previous frame (layerFullRebuild: 'layer:reason' counts,
            // reason outside / zoom / state / other; layerRebuildCauses: the layer's own cause), the offscreen drawing on the
            // main thread (every offscreen draw these wrappers see runs on it) and the stand-in pixels rounded.
            sectorCounters.frameEnd()
            frame.work.mainOffscreenMP = frame.work.offscreenMegapixels
            // TASK-1564: the sector pictures made since the previous frame in the Worker (sectorsBuiltWorker) and on the main
            // thread (sectorsBuiltMain; workerFallback: of those, made here though the worker could have made them, or with it
            // off), the pictures dropped as stale, the builds in flight now (workerQueueDepth) and at most since.
            frame.work.sectorWorker = sectorWorkerDelta()
            // TASK-1565: the sector caches' bytes now (the lit tiles' and the unit sectors' SectorCache together:
            // SECTOR_CACHE_BYTES at most) and the builds ahead of the camera since the previous frame (Grid.sectorAhead).
            const board = typeof grid !== 'undefined' ? grid : null
            frame.work.sectorBytes = board ? (board.sectors?.bytes || 0) + (board.unitSectors?.bytes || 0) + (board.unitSectorAlt?.cache.bytes || 0) : null
            frame.work.sectorAhead = sectorAheadDelta(board)
            frame.work.standInPx = Math.round(work.standInPx)
            // TASK-1568: on-screen board pixels (device, the main canvas) drawn as the board's plain ground fill for a square
            // without its tile (visualsPerf.groundFill: TASK-1571 Grid.drawGroundFill).
            frame.work.groundFillPx = Math.round(work.groundFillPx)
            frame.work.standInPxBy = Object.fromEntries(Object.entries(work.standInPx ? work.standInPxBy : {}).map(([k, v]) => [k, Math.round(v)]))
            frame.work.layerFullRebuildCount = Object.values(work.layerFullRebuild).reduce((a, b) => a + b, 0)
            // TASK-1562: the board squares of the frame drawn at the camera's level (exact) and not (stretched from another
            // level), Grid.levelCoverage; a frame not drawn on the levels (mode 'standard') draws every square at the
            // camera's level; a held frame (no board drawn) shows the last frame's.
            frame.work.exactCoverage = levelCoverage()
            // TASK-1574 (ZOOMFADE 1/5): swapPops, fades, settleMs, zoomExactCoverage and the frame's squares (squareFrame), from
            // swapRaw when the capture stops (swapFinish).
            frame.work.swapRaw = swapRaw()
            // TASK-1614: the main thread's JS time since the previous frame by source (exclusive ms, taskSources below).
            frame.work.taskMs = taskSources.frameEnd()
            // TASK-1631: level-load phases since the previous frame and the builds still pending (phaseTimers, loadPendingOf).
            frame.work.phaseMs = phaseTimers.frameEnd()
            frame.loadPending = loadPendingOf()
            work = freshWork()
            if (frame.gapMs > 50) report.longGaps.push({timestamp, gapMs: frame.gapMs})
            report.samples.push(frame)
            if (document.hidden) report.invalidReasons.push('hidden-tab')
            frame = null
        }
    }
    let sectorAheadLast = null
    const sectorAheadDelta = board => {
        const c = board?.aheadWork
        if (!c)
            return null
        const last = sectorAheadLast || {}, out = {}
        for (const k of Object.keys(c))
            if (typeof c[k] === 'number' && k !== 'ring' && k !== 'reach')
                out[k] = c[k] - (last[k] || 0)
            // TASK-1568: litDeferBy {surfaceQueued, overlayQueued, overlaySnapshot} (Grid.litTaskDefers' conditions)
            else if (c[k] && typeof c[k] === 'object')
                out[k] = Object.fromEntries(Object.entries(c[k]).map(([n, v]) => [n, v - (last[k]?.[n] || 0)]))
        out.ring = c.ring
        // TASK-1570: the lit ring's reach the last lit frame asked for (not a delta)
        out.reach = c.reach
        sectorAheadLast = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v && typeof v === 'object' ? {...v} : v]))
        return out
    }
    let sectorWorkerLast = null
    const sectorWorkerDelta = () => {
        if (typeof SectorWorker === 'undefined')
            return null
        const c = SectorWorker.counters, last = sectorWorkerLast || {}
        const out = {state: SectorWorker.state}
        // TASK-1570: cancelled (builds the worker dropped before drawing them: the camera left their square), reordered (queued
        // builds of older ids a build was drawn before, in the worker).
        for (const k of ['builtWorker', 'builtMain', 'builtMainMoving', 'fallback', 'posted', 'dropped', 'failed', 'spritesSent', 'spritesDropped',
                'cancelled', 'reordered'])
            out[k] = (c[k] || 0) - (last[k] || 0)
        out.workerMs = Math.round((c.workerMs - (last.workerMs || 0)) * 10) / 10
        out.depth = c.depth
        out.depthMax = c.depthMax
        out.spriteMB = Math.round(c.spriteBytes / 1e5) / 10
        c.depthMax = c.depth
        sectorWorkerLast = {...c}
        return out
    }
    // TASK-1574 (ZOOMFADE 1/5): the squares (u, v at the camera's level: the unit sectors' grid) of each frame drawn on the main
    // canvas (squareFrame: mode zoom / settle / rest from Grid.squareStates, 'board' for any other frame, whose squares are all
    // drawn at the camera's level; level; r: the on-screen square range [u0, u1, v0, v1]; ne: the squares not drawn exact
    // (stretched or held); fd: the squares drawn fading in). A held frame (no board drawn: the same picture) is {held: 1}.
    // SWAP POP (work.swapPops): a square of the previous drawn frame's ne, at the same level, on screen in this frame and in
    // neither its ne nor its fd: replaced by its exact picture at full opacity from one frame to the next. work.fades: the
    // squares fading in drawn in the frame. work.settleMs: on the first drawn frame after a zoom gesture with no square
    // stretched, held or fading, the ms since the end of the gesture's last zoom frame (else null). work.zoomExactCoverage:
    // a zoom gesture frame's share of squares drawn exact (Grid.levelCoverage), else null.
    // TASK-1574 attempt 2 (probe effect): a sampled frame keeps only references to what the draw made anyway (swapRaw: the draw
    // serial, Grid.squareStates, Grid.frameView, the board's and the surface cache's bounds); the counters above are worked out
    // from them when the capture stops (swapFinish), off the frames: no strings, sets or board geometry inside the measured run.
    const swapRaw = () => {
        const g = typeof grid !== 'undefined' ? grid : null
        return g ? [g.drawSerial, g.squareStates, g.frameView, typeof mapDepth !== 'undefined' ? mapDepth.bounds : undefined, g.surfaceCacheBounds] : null
    }
    const squareKey = ({u, v}) => u + ',' + v
    const squareFrameOf = (g, [serial, st, fv, bounds, cacheBounds]) => {
        if (st && st.serial === serial) {
            const r = [Infinity, -Infinity, Infinity, -Infinity]
            for (const {u, v} of st.squares) {
                r[0] = Math.min(r[0], u); r[1] = Math.max(r[1], u); r[2] = Math.min(r[2], v); r[3] = Math.max(r[3], v)
            }
            return {mode: st.mode, level: st.level, r, ne: st.stretch.concat(st.held).map(squareKey), fd: (st.fading || []).map(squareKey)}
        }
        if (fv && fv.serial === serial) {
            const range = g.litTileRange(fv.cw, fv.ch, fv.ox, fv.oy, 0), b = g.unitBoardSquaresIn(fv.level, bounds, cacheBounds)
            return {mode: 'board', level: fv.level, r: [Math.max(range.u0, b.u0), Math.min(range.u1, b.u1), Math.max(range.v0, b.v0), Math.min(range.v1, b.v1)], ne: [], fd: []}
        }
        return null
    }
    const swapPopsOf = (prev, cur) => {
        if (!prev || !cur || prev.level !== cur.level || !prev.ne.length)
            return 0
        const ne = new Set(cur.ne), fd = new Set(cur.fd), r = cur.r
        let n = 0
        for (const k of prev.ne) {
            if (ne.has(k) || fd.has(k))
                continue
            const [u, v] = k.split(',').map(Number)
            if (u >= r[0] && u <= r[1] && v >= r[2] && v <= r[3])
                ++n
        }
        return n
    }
    // The samples' swap counters in order (each sample once: a later stop finds none left to do).
    const swapFinish = samples => {
        const g = typeof grid !== 'undefined' ? grid : null
        let prev = null, serial = null, zoomLastEnd = null
        for (const frame of samples) {
            const raw = frame.work.swapRaw
            if (raw === undefined)
                continue
            delete frame.work.swapRaw
            let cur = null
            if (raw && g) {
                cur = raw[0] === serial ? undefined : squareFrameOf(g, raw)
                serial = raw[0]
            }
            let swapPops = 0, settleMs = null
            if (cur !== undefined) {
                swapPops = swapPopsOf(prev, cur)
                prev = cur
                if (cur?.mode === 'zoom')
                    zoomLastEnd = frame.end
                else if (cur && zoomLastEnd !== null && !cur.ne.length && !cur.fd.length) {
                    settleMs = Math.round((frame.end - zoomLastEnd) * 10) / 10
                    zoomLastEnd = null
                }
            }
            const cov = frame.work.exactCoverage
            const zoomExactCoverage = cov && cov.mode === 'zoom' && !cov.held ? (cov.total ? Math.round(cov.exact / cov.total * 1e4) / 1e4 : 1) : null
            Object.assign(frame.work, {swapPops, fades: cur ? cur.fd.length : 0, settleMs, zoomExactCoverage, squareFrame: cur === undefined ? {held: 1} : cur})
        }
    }
    let coverageSerial = null, coverageLast = null
    const levelCoverage = () => {
        const g = typeof grid !== 'undefined' ? grid : null
        if (!g) return null
        if (g.drawSerial === coverageSerial && coverageLast) return {...coverageLast, held: true}
        coverageSerial = g.drawSerial
        const c = g.levelCoverage
        coverageLast = c && c.serial === g.drawSerial ? {mode: c.mode, kind: c.kind, total: c.total, exact: c.exact, stretched: c.stretched, live: c.live, bare: c.bare, standIn: c.standIn, old: c.old} : {mode: 'standard'}
        return coverageLast
    }
    // TASK-1614 (diagnostic, only while a capture is active): the main thread's JS time by source, and the long tasks
    // (PerformanceObserver 'longtask', over 50 ms) named by it. Wrappers below charge the time inside them to their source,
    // exclusively (a nested source's time is its own, not its caller's): sprite (sprite raster and cache), lit-tiles (the
    // lit view's tiles and a new board's held start), sprite-image (an <img> drawn: an SVG sprite decoded / rasterized),
    // light-map, owned-tiles, surface-cache (its build / split / patch steps),
    // sector-worker (the Worker's messages received) and sector-main (sectors built on the main thread), sky, tutorial-ui,
    // game-start (GameManager.start: the board made), frame (drawAll outside the others) and update (the game loop outside
    // drawAll). Each long task gets by: {source: ms inside it} and other (its time no wrapper saw: style, layout, paint and
    // the canvas raster flushed at the frame's end, GC, unwrapped code). work.taskMs: the same per frame (since the frame
    // before). report.longTasks: [{t, ms, by, other}].
    const taskSources = (() => {
        const stack = [], segments = [], perFrame = {}
        let mark = 0, observer = null, target = null, wrapped = false
        const charge = now => {
            const top = stack[stack.length - 1]
            if (top !== undefined && now > mark) {
                perFrame[top] = (perFrame[top] || 0) + now - mark
                const last = segments[segments.length - 1]
                if (last && last.s === top && mark - last.b < 2) last.b = now
                else segments.push({s: top, a: mark, b: now})
            }
            mark = now
        }
        const enter = source => { if (!active) return; charge(performance.now()); stack.push(source) }
        const exit = () => { if (!stack.length) return; charge(performance.now()); stack.pop() }
        const wrap = (obj, name, source) => {
            const fn = obj && obj[name]
            if (typeof fn !== 'function' || fn.taskSource || /^(async\s+)?(function\s*)?\*/.test(Function.prototype.toString.call(fn).trim()) ||
                    fn.constructor?.name === 'GeneratorFunction')
                return
            const w = function(...args) {
                if (!active) return fn.apply(this, args)
                enter(source)
                try { return fn.apply(this, args) }
                finally { exit() }
            }
            w.taskSource = source
            obj[name] = w
        }
        const wrapAll = () => {
            if (wrapped) return
            wrapped = true
            const G = typeof Grid !== 'undefined' ? Grid.prototype : null
            const L = typeof atmosphericLighting !== 'undefined' ? atmosphericLighting : null
            if (typeof SpriteCache !== 'undefined') for (const n of ['build', 'restockAtRest', 'beginFrame', 'makeRoom']) wrap(SpriteCache, n, 'sprite')
            // (a global function declaration called by name sees the window property)
            for (const n of ['loadSprites', 'whenGameSpritesReady']) wrap(window, n, 'sprite')
            if (L) {
                for (const n of ['spillSprite', 'liftSprite', 'tileVariant']) wrap(L, n, 'sprite')
                for (const n of ['ownedTile', 'prewarmOwnedTiles', 'tileFill']) wrap(L, n, 'owned-tiles')
                for (const n of ['stepLightMap', 'lightMap', 'build', 'updateMapRegion', 'prewarmGlows', 'finishLightMap', 'unstashMap']) wrap(L, n, 'light-map')
            }
            if (G) {
                for (const n of ['litTile', 'holdStartFrame', 'holdLoadFrame', 'stepLitView', 'queueLitTiles', 'setLitView', 'litLayerStep', 'drawLitLayerRaster', 'renderLitCellSprites']) wrap(G, n, 'lit-tiles')
                for (const n of ['surfaceCacheBuildStep', 'surfaceSplitStep', 'surfacePatchStep', 'standInPreviewStep', 'patchSurfaceCache', 'startSurfaceCacheBuild']) wrap(G, n, 'surface-cache')
                for (const n of ['buildUnitSector']) wrap(G, n, 'sector-main')
            }
            if (typeof SectorWorker !== 'undefined') wrap(SectorWorker, 'receive', 'sector-worker')
            if (typeof atmosphericBackground !== 'undefined') for (const n of ['rasterSteps', 'decorateSteps', 'syncKey']) wrap(atmosphericBackground, n, 'sky')
            if (typeof TutorialManager !== 'undefined') for (const n of ['start', 'switchTo', 'drawLoading', 'checkResult']) wrap(TutorialManager, n, 'tutorial-ui')
            for (const target of [typeof tutorialResultInterface !== 'undefined' && tutorialResultInterface, typeof tutorialPauseInterface !== 'undefined' && tutorialPauseInterface])
                if (target) for (const n of ['draw', 'show', 'click', 'layOut', 'place']) wrap(target, n, 'tutorial-ui')
            if (typeof GameManager !== 'undefined') wrap(GameManager, 'start', 'game-start')
            // An <img> drawn on a canvas (the sprites' SVG images: decoded and rasterized at the size drawn, on a first draw at
            // that size) is sprite-image time, whatever function drew it.
            for (const proto of [CanvasRenderingContext2D.prototype, typeof OffscreenCanvasRenderingContext2D !== 'undefined' && OffscreenCanvasRenderingContext2D.prototype]) {
                if (!proto) continue
                const drawImage = proto.drawImage
                proto.drawImage = function(image) {
                    if (!active || !(image instanceof HTMLImageElement)) return drawImage.apply(this, arguments)
                    enter('sprite-image')
                    try { return drawImage.apply(this, arguments) }
                    finally { exit() }
                }
            }
        }
        const name = entry => {
            const a = entry.startTime, b = a + entry.duration, by = {}
            let seen = 0
            for (let i = segments.length - 1; i >= 0; --i) {
                const x = segments[i]
                if (x.b <= a - 60000) break
                const o = Math.min(b, x.b) - Math.max(a, x.a)
                if (o > 0) { by[x.s] = (by[x.s] || 0) + o; seen += o }
            }
            const round = v => Math.round(v * 10) / 10
            return {t: round(a), ms: round(entry.duration), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, round(v)])), other: round(Math.max(0, entry.duration - seen))}
        }
        return {
            enter, exit,
            frameEnd() {
                const out = {}
                for (const k in perFrame) { out[k] = Math.round(perFrame[k] * 10) / 10; delete perFrame[k] }
                // segments older than a minute are past any long task still to be delivered
                const old = performance.now() - 60000
                let drop = 0
                while (drop < segments.length && segments[drop].b < old) ++drop
                if (drop) segments.splice(0, drop)
                return out
            },
            start(report) {
                wrapAll()
                target = report
                report.longTasks = []
                stack.length = 0
                segments.length = 0
                for (const k in perFrame) delete perFrame[k]
                if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
                    observer = new PerformanceObserver(list => { if (target) for (const entry of list.getEntries()) target.longTasks.push(name(entry)) })
                    observer.observe({type: 'longtask'})
                    report.longTaskObserver = true
                }
                else report.longTaskObserver = false
            },
            stop() {
                if (observer) {
                    if (target) for (const entry of observer.takeRecords()) target.longTasks.push(name(entry))
                    observer.disconnect()
                    observer = null
                }
                target = null
                stack.length = 0
            }
        }
    })()
    // TASK-1631 (LEVEL LOAD 1/5): main-thread ms per level-load phase, exclusive (a nested phase's time is its own), on a stack
    // of its own (taskSources' sources unchanged). Phases: rules (the game set up: GameManager.start / load, a save's
    // unpacking, TutorialManager.start, co-op map generation; Grid's constructor and the phases below excluded), grid-build
    // (Grid's constructor), tile-variants (the atmospheric neutral / fog / owned tile variants: atmosphericLighting.tileVariant, stoneVariant,
    // fogVariant, tileDetail, ownedTile, prewarmOwnedTiles), underlay (MapDepth: geometry, underlay cache, atmospheric sides,
    // rim, shadow, underlay worker), lit-tiles (the lit view's tiles and the start hold: taskSources' lit-tiles methods), sectors
    // (unit sectors and lit tile sectors built / stored / received from the Worker), sprites (SpriteCache, sprite
    // images, spill / lift sprites, an <img> drawn), surface-cache, light-map and sky (named apart: not phases of the
    // ticket's list; the tool counts them under other with their own figures). Time no wrapper sees (the frame's other
    // drawing, update, browser raster / GC / layout) is other: the tool takes it from the main thread's busy time.
    // work.phaseMs: ms per phase since the previous frame; visualsPerf.phases(): the segments [phase, start, end] (merged
    // when adjacent) since the capture started, for cutting at a load's click and sharp frame.
    const phaseTimers = (() => {
        const stack = [], segments = [], perFrame = {}
        let mark = 0, wrapped = false
        const charge = now => {
            const top = stack[stack.length - 1]
            if (top !== undefined && now > mark) {
                perFrame[top] = (perFrame[top] || 0) + now - mark
                const last = segments[segments.length - 1]
                if (last && last[0] === top && mark - last[2] < 1) last[2] = now
                else segments.push([top, mark, now])
            }
            mark = now
        }
        const enter = phase => { charge(performance.now()); stack.push(phase) }
        const exit = () => { if (!stack.length) return; charge(performance.now()); stack.pop() }
        const wrap = (obj, name, phase) => {
            const fn = obj && obj[name]
            if (typeof fn !== 'function' || fn.loadPhase || fn.constructor?.name === 'GeneratorFunction')
                return false
            const w = function(...args) {
                if (!active) return fn.apply(this, args)
                enter(phase)
                try { return fn.apply(this, args) }
                finally { exit() }
            }
            w.loadPhase = phase
            if (fn.taskSource) w.taskSource = fn.taskSource
            obj[name] = w
            return true
        }
        const wrapAll = () => {
            if (wrapped) return
            wrapped = true
            const G = typeof Grid !== 'undefined' ? Grid.prototype : null
            const L = typeof atmosphericLighting !== 'undefined' ? atmosphericLighting : null
            if (typeof GameManager !== 'undefined') for (const n of ['start', 'load', 'setUpBoard']) wrap(GameManager, n, 'rules')
            if (typeof TutorialManager !== 'undefined') wrap(TutorialManager, 'start', 'rules')
            if (typeof saveManager !== 'undefined') wrap(saveManager, 'load', 'rules')
            for (const n of ['loadFromObject', 'generateCoopGame', 'startTurn']) wrap(window, n, 'rules')
            if (typeof Grid !== 'undefined' && !Grid.loadPhase) {
                // (a class binding: the global name Grid is replaced by a Proxy whose construct is timed; prototype, statics
                // and instanceof are the class's own)
                const target = Grid
                const proxy = new Proxy(target, {construct(t, args, newTarget) {
                    if (!active) return Reflect.construct(t, args, newTarget === proxy ? t : newTarget)
                    enter('grid-build')
                    try { return Reflect.construct(t, args, newTarget === proxy ? t : newTarget) }
                    finally { exit() }
                }})
                Grid = proxy
                target.loadPhase = 'grid-build'
            }
            if (L) {
                for (const n of ['tileVariant', 'stoneVariant', 'fogVariant', 'tileDetail', 'ownedTile', 'prewarmOwnedTiles']) wrap(L, n, 'tile-variants')
                for (const n of ['spillSprite', 'liftSprite']) wrap(L, n, 'sprites')
                for (const n of ['stepLightMap', 'lightMap', 'build', 'updateMapRegion', 'prewarmGlows', 'finishLightMap', 'unstashMap']) wrap(L, n, 'light-map')
            }
            if (typeof MapDepth !== 'undefined') {
                for (const n of ['rebuild', 'buildFaces', 'ensureGeometry', 'renderUnderlay', 'createUnderlayCache', 'drawCacheRegion', 'drawUnderlay',
                        'renderAtmosphericSides', 'createAtmosphericShadow', 'drawAtmosphericShadow', 'renderRim', 'drawRim'])
                    wrap(MapDepth.prototype, n, 'underlay')
                for (const n of ['underlayWorkerDone']) wrap(MapDepth, n, 'underlay')
            }
            if (G) {
                for (const n of ['litTile', 'holdStartFrame', 'holdLoadFrame', 'stepLitView', 'queueLitTiles', 'setLitView', 'litLayerStep', 'drawLitLayerRaster', 'renderLitCellSprites'])
                    wrap(G, n, 'lit-tiles')
                for (const n of ['surfaceCacheBuildStep', 'surfaceSplitStep', 'surfacePatchStep', 'standInPreviewStep', 'patchSurfaceCache', 'startSurfaceCacheBuild'])
                    wrap(G, n, 'surface-cache')
                for (const n of ['unitSectorTask', 'buildUnitSector', 'composeUnitSector', 'unitSectorGround', 'storeUnitSector', 'unitSectorArrived',
                        'queueUnitSectors', 'sectorSubmit', 'storeSector', 'closeSectorTile', 'sectorSnapshot'])
                    wrap(G, n, 'sectors')
            }
            if (typeof SectorWorker !== 'undefined') wrap(SectorWorker, 'receive', 'sectors')
            if (typeof SpriteCache !== 'undefined') for (const n of ['build', 'restockAtRest', 'beginFrame', 'makeRoom']) wrap(SpriteCache, n, 'sprites')
            for (const n of ['loadSprites']) wrap(window, n, 'sprites')
            if (typeof atmosphericBackground !== 'undefined') for (const n of ['rasterSteps', 'decorateSteps', 'syncKey']) wrap(atmosphericBackground, n, 'sky')
            for (const proto of [CanvasRenderingContext2D.prototype, typeof OffscreenCanvasRenderingContext2D !== 'undefined' && OffscreenCanvasRenderingContext2D.prototype]) {
                if (!proto) continue
                const drawImage = proto.drawImage
                proto.drawImage = function(image) {
                    if (!active || !(image instanceof HTMLImageElement)) return drawImage.apply(this, arguments)
                    enter('sprites')
                    try { return drawImage.apply(this, arguments) }
                    finally { exit() }
                }
            }
        }
        return {
            enter, exit,
            frameEnd() {
                const out = {}
                for (const k in perFrame) { out[k] = Math.round(perFrame[k] * 10) / 10; delete perFrame[k] }
                return out
            },
            start() { wrapAll(); stack.length = 0; segments.length = 0; for (const k in perFrame) delete perFrame[k] },
            stop() { stack.length = 0 },
            segments: () => segments.map(([p, a, b]) => [p, Math.round(a * 10) / 10, Math.round(b * 10) / 10])
        }
    })()
    // TASK-1631: the board's builds still under way at a frame's end (frame.loadPending): surface (the surface cache queued,
    // building, split, patched, layered or dirty), lit (lit tiles queued, the lit view unbuilt / patched / its layer job),
    // litRest (the lit view's rest snapshot not done).
    const loadPendingOf = () => {
        const g = typeof grid !== 'undefined' ? grid : null
        if (!g) return null
        const out = []
        if (g.surfaceCacheQueued || g.surfaceCacheBuild || g.surfaceSplitJob || g.surfacePatchJob || g.surfaceLayerJob || g.surfaceCacheDirty) out.push('surface')
        if (g.surfaceCache && !g.surfaceCacheLit) out.push('surfaceUnlit')
        const v = g.litView
        if (g.litTilesQueued || v && (v.unbuilt || v.patch || v.layerJob)) out.push('lit')
        if (v && v.rest && typeof LIT_REST_BANDS !== 'undefined' && v.rest.done !== LIT_REST_BANDS) out.push('litRest')
        return out
    }
    drawAll = function(...args) {
        if (!frame) return originalDraw.apply(this, args)
        frame.camera = camera() // Camera after the existing update, actually used by this draw.
        const start = performance.now()
        if (typeof turnPlaybackView !== 'undefined') turnPlaybackView.heldFrame = false
        if (typeof grid !== 'undefined' && grid) grid.cacheHeldFrame = false
        taskSources.enter('frame')
        holdNote = null
        boardDrawn = false
        try { return originalDraw.apply(this, args) }
        finally {
            taskSources.exit()
            frame.renderMs += performance.now() - start
            // TASK-1519: a turn playback's held start frame (turnPlaybackView.holdFrame: nothing drawn).
            if (typeof turnPlaybackView !== 'undefined' && turnPlaybackView.heldFrame && work.renderPath === null) work.renderPath = 'playback-held'
            // TASK-1520: a frame held while the surface cache is built (Grid.holdCacheFrame: nothing drawn).
            else if (typeof grid !== 'undefined' && grid && grid.cacheHeldFrame && work.renderPath === null) work.renderPath = 'cache-held'
            // TASK-1614: every frame names the path that drew it. A frame drawAll returned from before drawing the board (a hold
            // not labelled above) or whose board took no labelled path is named by what it did (renderPathOf).
            if (work.renderPath === null) work.renderPath = renderPathOf()
        }
    }
    // TASK-1614: the name of a frame's path when no drawing wrapper named it: the hold drawAll returned at (holdNote: start-held,
    // zoom-held); a board drawn (grid.draw ran in this drawAll) without a wrapper naming it: the surface it drew by its own
    // record (Grid.frameSurface; work.pathFallback marks such frames); no board drawn ('no-board': no grid, or drawMain not
    // reached).
    let holdNote = null, boardDrawn = false
    const SURFACE_PATHS = {lit: 'lit-tiles', standin: 'stand-in', fill: 'ground-fill', true: 'surface-cache', false: 'direct'}
    const renderPathOf = () => {
        let path = holdNote
        if (!path && boardDrawn) {
            path = SURFACE_PATHS[String(grid.frameSurface)] || 'board:' + String(grid.frameSurface)
            work.pathFallback = true
        }
        holdNote = null
        boardDrawn = false
        return path || 'no-board'
    }
    // TASK-1549 (diagnostic, only while a capture is active): canvases created and ImageBitmaps made per frame by creation
    // site ('fn file:line < caller', the first two client frames of the stack; work.canvasSites / work.bitmapSites), and
    // tiles the frame's lit view needed but did not have (work.tilesMissingOnScreen). diagnostics.calls counts every pass
    // through this code: 0 without an active capture.
    const diagnostics = {calls: 0}
    const pageBase = location.href.slice(0, location.href.lastIndexOf('/') + 1)
    const creationSite = () => {
        const limit = Error.stackTraceLimit
        Error.stackTraceLimit = 40
        const stack = new Error().stack || ''
        Error.stackTraceLimit = limit
        const frames = []
        for (const line of stack.split('\n').slice(1)) {
            const m = line.match(/^\s*at (?:(.*?) \()?(.*?):(\d+):\d+\)?$/)
            if (!m || !m[2].startsWith(pageBase) || m[2].endsWith('render/visualsPerf.js')) continue
            frames.push({fn: m[1] || '<anonymous>', file: m[2].slice(pageBase.length), line: m[3]})
            if (frames.length === 2) break
        }
        if (!frames.length) return 'unknown'
        return `${frames[0].fn} ${frames[0].file}:${frames[0].line}` + (frames[1] ? ` < ${frames[1].fn}` : '')
    }
    // Each canvas created while capturing keeps its creation site, so drawn work on offscreen canvases is also counted by the
    // canvas drawn to (work.offscreenByTarget: [MP, calls] per creation site; 'before-capture' for older canvases).
    const canvasSiteOf = new WeakMap()
    const countSite = sites => {
        diagnostics.calls++
        const site = creationSite()
        sites[site] = (sites[site] || 0) + 1
        return site
    }
    const create = document.createElement.bind(document)
    document.createElement = function(name, ...args) {
        if (active && name.toLowerCase() === 'canvas') {
            counters.canvasAllocations++
            const element = create(name, ...args)
            canvasSiteOf.set(element, countSite(work.canvasSites))
            return element
        }
        return create(name, ...args)
    }
    if (typeof createImageBitmap === 'function') {
        const bitmap = createImageBitmap
        createImageBitmap = function(...args) {
            if (active) countSite(work.bitmapSites)
            return bitmap.apply(this, args)
        }
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
    // TASK-1557: liveBoardCalls = the board's own drawing calls (all canvases, the tasks since the previous frame included) by
    // group of their layer label: text (cell texts), units (units, their bars, entities), ground (surface, buildings, sky,
    // shadow, borders), lighting (light), other (unlabelled calls: 'between-frames' tasks such as tile builds). Not counted:
    // the frame's own and the interface's calls, and the drawImage copies of a kept board picture made in the compositing
    // functions (compositing > 0: the surface cache, stand-in, lit tiles, lit / scene / overlay layers, zoom raster, held
    // frame).
    const BOARD_GROUPS = {text: 'text', units: 'units', entities: 'units', buildings: 'ground', surface: 'ground', sky: 'ground',
        shadow: 'ground', borders: 'ground', light: 'lighting', 'between-frames': 'other'}
    let compositing = 0
    // TASK-1557: standInPx = on-screen board pixels (device, the main canvas) drawn from a picture not at the frame's exact
    // scale: the stand-in (drawStandIn / drawStandInRect: the surface cache or the preview for missing lit tiles),
    // the zoom underlay, the zoom raster stretched to the camera, and the surface cache drawn magnified (its drawImage's
    // scale over 1). standInPxBy: those by source, plus 'surface-minified' (the surface cache drawn smaller than its raster:
    // reported, not in standInPx). standInSource: the outermost such function's classifier, set while it runs.
    let standInSource = null, standInKind = null
    const addStandIn = (kind, area, total = true) => {
        work.standInPxBy[kind] = (work.standInPxBy[kind] || 0) + area * 1e6
        if (total) work.standInPx += area * 1e6
    }
    const STAND_IN_KINDS = {
        drawStandIn: () => (g, source, args, area) => addStandIn('standin', area),
        drawStandInRect: () => (g, source, args, area) => addStandIn('standin', area),
        drawZoomUnderlay: () => (g, source, args, area) => addStandIn('zoom-underlay', area),
        drawZoomRaster: board => (g, source, args, area) => { if (source === board.zoomRaster?.canvas) addStandIn('zoom-raster', area) },
        // TASK-1562: the sectors of other levels stretched to the camera (and the underlay under them).
        drawStretchedSectors: () => (g, source, args, area) => addStandIn('stretched', area),
        // TASK-1565: a unit sector whose ground is a stand-in (the surface cache magnified or its preview: Grid.drawStandInSector),
        // the stand-in under exact units.
        drawStandInSector: () => (g, source, args, area) => addStandIn('sector-standin', area),
        drawSurfaceCacheRect: () => (g, source, args, area) => {
            if (args.length !== 8 || !args[2]) return
            const f = Math.hypot(g.getTransform().a, g.getTransform().b) * args[6] / args[2]
            if (f > 1.001) addStandIn('surface-magnified', area)
            else if (f < 0.999) addStandIn('surface-minified', area, false)
        }}
    const draw = (g, area, image = false) => {
        if (area === null) { work.unboundedDraws++; area = g.canvas.width * g.canvas.height / 1e6 }
        const group = BOARD_GROUPS[layer]
        if (group && !(image && compositing)) work.liveBoardCalls[group]++
        work.drawCalls++
        work.drawnMegapixels += area
        const main = g.canvas === mainCanvas
        if (main) work.drawnMainMegapixels += area
        const onscreen = main || g.canvas === interfaceCanvasElement()
        const key = onscreen ? layer : 'offscreen/' + layer
        const entry = work.drawnByLayer[key] ||= [0, 0]
        entry[0] += area; entry[1]++
        if (!onscreen) {
            const target = work.offscreenByTarget[canvasSiteOf.get(g.canvas) || 'before-capture'] ||= [0, 0]
            target[0] += area; target[1]++
        }
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
    // TASK-1557: and with the compositing state and stand-in classifier they were recorded under (a recorded frame's calls,
    // such as a level-of-detail frame's, are made after the compositing functions returned): 'layer|compositing|kind'.
    if (typeof canvasCallLabels !== 'undefined')
        canvasCallLabels = {current: () => compositing || standInKind ? layer + '|' + (compositing ? 1 : 0) + '|' + (standInKind || '') : layer,
            within: (label, fn) => {
                const outer = layer, outerCompositing = compositing, outerSource = standInSource, outerKind = standInKind
                const parts = String(label).split('|')
                layer = parts[0]
                if (parts.length === 3) {
                    compositing = +parts[1]
                    standInKind = parts[2] || null
                    standInSource = standInKind && typeof grid !== 'undefined' ? STAND_IN_KINDS[standInKind](grid) : null
                }
                try { return fn() }
                finally { layer = outer; compositing = outerCompositing; standInSource = outerSource; standInKind = outerKind }
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
                draw(this, area, true)
                if (standInSource && this.canvas === mainCanvas) standInSource(this, source, args, area)
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
    // TASK-1614: why a recorded still frame (Grid.stillFrameCandidate) was not held (Grid.makeLodFrame): not steady (the
    // surface it drew, a job changing a buffer in place, the light not baked into the cache, fades, a path or loading image
    // drawn), no frame before it to repeat, or its key or calls differ from that frame's (the first difference: key index,
    // call count, or the first differing call's name and argument index / property).
    const stillMissOf = (g, recorder, last) => {
        // TASK-1618: a frame of a pan's hold with the camera at rest (Grid.restingInHold: recorded for its base, never held).
        if (typeof gameEvent !== 'undefined' && gameEvent.screen?.surfaceMoving) return 'hold'
        if (g.frameSurface === true) {
            if (g.fadesPending?.()) return 'fades'
            // (TASK-1616: not while the jobs are paused on a tutorial's result screen, Grid.resultPaused: they keep no hold off)
            const paused = !!g.resultPaused?.()
            // (TASK-1618: the split and layer job only when they keep a still frame from being held, Grid.surfaceJobHolds)
            const holds = g.surfaceJobHolds ? g.surfaceJobHolds() : false
            for (const name of ['surfaceCacheBuild', 'surfacePatchJob', 'surfaceLayerJob', 'surfaceSplitJob'])
                if (g[name] && !paused && !(holds && (name === 'surfaceLayerJob' || name === 'surfaceSplitJob'))) return 'job:' + name
            if (g.litView?.layerJob) return 'job:litLayer'
            if (otherSettings.atmosphericVisuals && !g.surfaceCacheLit && !Grid.stillUnlitFrames) return 'cache-unlit'
            if (recorder && !g.recordingSteady(recorder)) return 'unsteady-args'
        }
        else if (!g.stillFrameSteady(recorder)) return 'unsteady:' + String(g.frameSurface)
        if (!last) return 'no-previous'
        if (last.serial !== g.drawSerial - 1) return 'not-consecutive'
        const a = recorder.key, b = last.key
        if (a.length !== b.length) return 'key-length'
        for (let k = 0; k < a.length; ++k) if (a[k] !== b[k]) return 'key:' + k
        if (recorder.calls.length !== last.calls.length) return 'calls:' + recorder.calls.length + '/' + last.calls.length
        for (let k = 0; k < recorder.calls.length; ++k) {
            const x = recorder.calls[k], y = last.calls[k]
            if (x.set !== y.set || x.name !== y.name) return 'call:' + (x.set !== undefined ? 'set ' : '') + x.name + '/' + y.name
            if (x.set !== undefined) { if (x.value !== y.value) return 'call:' + x.name + '='; continue }
            if (x.args.length !== y.args.length) return 'call:' + x.name + ' args'
            for (let i = 0; i < x.args.length; ++i) if (x.args[i] !== y.args[i])
                return 'call:' + x.name + '#' + i + (x.args[i] && typeof x.args[i] === 'object' ? ' ' + (x.args[i].constructor?.name || 'object') : '')
        }
        return 'other'
    }
    // The board's render path: the surface cache or the direct draw, and the overlay layer.
    const wrapGrid = () => {
        const proto = typeof Grid !== 'undefined' && Grid.prototype
        if (!proto || proto.drawMapSurface.visualsPerf) return
        const surface = proto.drawMapSurface, layer = proto.drawOverlayLayer
        proto.drawMapSurface = function(...args) {
            const cached = surface.apply(this, args)
            // TASK-1571: 'ground-fill', a lit frame whose view is not made yet (Grid.drawGroundFill over the board).
            if (active) work.renderPath = cached === 'lit' ? 'lit-tiles' : cached === 'standin' ? 'stand-in' : cached === 'fill' ? 'ground-fill' :
                cached ? 'surface-cache' : 'direct'
            return cached
        }
        proto.drawMapSurface.visualsPerf = true
        // TASK-1544: the stand-in's source ('cache', 'preview'; 'zoom': the preview under a zoom raster's frame); lit tiles
        // drawn with it for their missing squares keep the 'lit-tiles' path.
        if (proto.drawStandInRect) {
            const standInRect = proto.drawStandInRect
            proto.drawStandInRect = function(...args) {
                if (active) work.standIn = args[5]
                return standInRect.apply(this, args)
            }
            const standIn = proto.drawStandIn
            proto.drawStandIn = function(...args) {
                const source = standIn.apply(this, args)
                if (active && source) work.standIn = source
                return source
            }
        }
        // TASK-1549: lit tiles the frame needed but did not have: built in the frame (litTile), drawn from the stand-in
        // (drawLitView's missing set), or the whole view's missing tiles when it is not drawn for them (litTilesUnbuilt).
        if (proto.drawLitView && proto.litTile && proto.litTilesUnbuilt) {
            const drawLitView = proto.drawLitView, litTile = proto.litTile, unbuilt = proto.litTilesUnbuilt
            let inView = false
            const missingTotal = () => { work.tilesMissingOnScreen = work.tilesBuiltInFrame + work.tilesFromStandIn + work.tilesUnbuilt }
            proto.drawLitView = function(...args) {
                if (!active || !frame) return drawLitView.apply(this, args)
                diagnostics.calls++
                const before = this.litFrame
                inView = true
                try { return drawLitView.apply(this, args) }
                finally {
                    inView = false
                    const after = this.litFrame
                    if (after && after !== before && after.missing) work.tilesFromStandIn += after.missing.size
                    missingTotal()
                }
            }
            proto.litTile = function(view, u, v) {
                if (active && inView && view && view.tiles && !view.tiles.has(u + ',' + v)) { diagnostics.calls++; work.tilesBuiltInFrame++ }
                return litTile.apply(this, arguments)
            }
            proto.litTilesUnbuilt = function(ctx, view, t) {
                const result = unbuilt.apply(this, arguments)
                if (active && frame && result) {
                    diagnostics.calls++
                    const range = this.litTileRange(ctx.canvas.width, ctx.canvas.height, Math.round(t.e - view.e), Math.round(t.f - view.f), 0)
                    let missing = 0
                    for (let v = range.v0; v <= range.v1; ++v)
                        for (let u = range.u0; u <= range.u1; ++u)
                            if (!view.tiles.has(u + ',' + v) && !view.stale?.has(u + ',' + v)) ++missing
                    work.tilesUnbuilt = missing
                    missingTotal()
                }
                return result
            }
        }
        // TASK-1374: a zoom gesture's frame drawn from the zoom raster.
        if (proto.drawZoomRaster) {
            const zoomRaster = proto.drawZoomRaster
            proto.drawZoomRaster = labelled(function(...args) {
                const drawn = zoomRaster.apply(this, args)
                if (active && drawn) work.renderPath = 'zoom-raster'
                return drawn
            }, 'surface')
        }
        // TASK-1474: a moving frame far out drawn from the scene layer (the surface cache, its shadow and overlays).
        if (proto.drawSceneLayer) {
            const sceneLayer = proto.drawSceneLayer
            proto.drawSceneLayer = labelled(function(...args) {
                const drawn = sceneLayer.apply(this, args)
                if (active && drawn) {
                    work.renderPath = 'surface-cache'
                    work.sceneLayer = true
                }
                return drawn
            }, 'surface')
        }
        // TASK-1515: a pan frame on the lit tiles whose units and cell texts came from the lit layer.
        if (proto.drawLitLayer) {
            const litLayer = proto.drawLitLayer
            proto.drawLitLayer = labelled(function(...args) {
                const drawn = litLayer.apply(this, args)
                if (active && drawn) work.litLayer = true
                return drawn
            }, 'units')
        }
        // TASK-1560: a pan frame drawing the board from the unit sectors (the surface cache's path: drawCacheSectors; the lit
        // path: drawLitView with litFrame.units): work.unitSectors {drawn: sectors composited, live: live squares, built:
        // sectors built by the tasks since the previous frame}.
        const unitWork = () => work.unitSectors ||= {drawn: 0, live: 0, built: 0}
        if (proto.drawCacheSectors) {
            const cacheSectors = proto.drawCacheSectors
            proto.drawCacheSectors = labelled(function(...args) {
                const drawn = cacheSectors.apply(this, args)
                if (active && drawn) work.renderPath = 'surface-cache'
                return drawn
            }, 'surface')
        }
        // TASK-1562: a zoom gesture's frame drawn from the levels kept (drawZoomSectors); a lit frame after a zoom whose view is
        // not made yet (drawLevelStandIn).
        if (proto.drawZoomSectors) {
            const zoomSectors = proto.drawZoomSectors
            proto.drawZoomSectors = labelled(function(...args) {
                const drawn = zoomSectors.apply(this, args)
                if (active && drawn) work.renderPath = 'zoom-sectors'
                return drawn
            }, 'surface')
        }
        if (proto.drawLevelStandIn) {
            const levelStandIn = proto.drawLevelStandIn
            proto.drawLevelStandIn = labelled(function(...args) {
                const drawn = levelStandIn.apply(this, args)
                if (active && drawn) work.renderPath = 'stand-in'
                return drawn
            }, 'surface')
        }
        if (proto.drawUnitSectorAt) {
            const at = proto.drawUnitSectorAt
            proto.drawUnitSectorAt = function(...args) {
                if (active) unitWork().drawn++
                return at.apply(this, args)
            }
        }
        if (proto.drawLiveSectorUnits) {
            const liveUnits = proto.drawLiveSectorUnits
            proto.drawLiveSectorUnits = labelled(function(ctx, frame) {
                if (active) unitWork().live += frame.live.length
                return liveUnits.apply(this, arguments)
            }, 'units')
        }
        // TASK-1561: the overlay sectors' copies (units and texts over a live ground) in their own layer.
        if (proto.drawUnitOverlays) proto.drawUnitOverlays = labelled(proto.drawUnitOverlays, 'sectors')
        // TASK-1561: the cell texts a unit sector build or a live square draws (sectorCellTexts' copies) are texts.
        if (proto.drawSectorTexts) proto.drawSectorTexts = labelled(proto.drawSectorTexts, 'text')
        if (proto.buildUnitSector) {
            const build = proto.buildUnitSector
            proto.buildUnitSector = function(...args) {
                const built = build.apply(this, args)
                if (active && built) unitWork().built++
                return built
            }
        }
        // TASK-1375: a level-of-detail frame that repeats the one on the canvas draws nothing.
        if (proto.endLodFrame) {
            const endLod = proto.endLodFrame
            proto.endLodFrame = function(...args) {
                // TASK-1376: a still frame above the threshold held the same way.
                const still = this.stillHolds, recorded = this.stillRecording, last = this.lodFrame, based = this.stillBaseHolds
                const held = endLod.apply(this, args)
                if (active && held) work.renderPath = this.stillHolds !== still ? 'still-held' : 'lod-held'
                // TASK-1614: why a recorded still frame was made again instead of held (stillMissOf).
                else if (active && recorded && this === grid) {
                    work.stillMiss = stillMissOf(this, args[1], last)
                    // TASK-1618: made on the board's held base (Grid.drawBaseFrame: its copy drawn back, then the calls
                    // after it), not from the surface cache.
                    if (this.stillBaseHolds !== based) work.renderPath = 'still-base'
                }
                return held
            }
        }
        // TASK-1614: a frame not recorded as a still frame (beginLodFrame null) though the camera is at rest: why
        // (stillFrameCandidate's refusal).
        if (proto.beginLodFrame) {
            const beginLod = proto.beginLodFrame
            proto.beginLodFrame = function(ctx, ...rest) {
                const recorder = beginLod.call(this, ctx, ...rest)
                if (active && !recorder && this === grid) {
                    const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
                    work.stillMiss = 'not-recorded:' + (!Grid.stillFrames ? 'off' : debug ? 'debug' : !screen ? 'no-screen' : screen.surfaceMoving ? 'moving' :
                        screen.zoomGesture ? 'zoom' : zoomRasterTweens() ? 'tweens' : this.fadesPending?.() ? 'fades' : typeof mainCanvas === 'undefined' || ctx.canvas !== mainCanvas ? 'canvas' : 'other')
                }
                return recorder
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
        // TASK-1557: the compositing functions (their drawImage copies of kept pictures are not live board calls) and the
        // stand-in classifiers.
        for (const name of ['drawSurfaceCache', 'drawSurfaceCacheRect', 'drawStandIn', 'drawStandInRect', 'drawZoomUnderlay', 'drawZoomRaster', 'drawStretchedSectors',
            'drawSceneLayer', 'drawLitLayer', 'drawLitTileAt', 'drawUnitSectorAt', 'drawStandInSector', 'drawHeldFrame', 'drawOverlaySnapshot', 'drawOverlayLayer']) {
            const original = proto[name]
            if (!original) continue
            proto[name] = function(...args) {
                if (!active) return original.apply(this, args)
                const outer = standInSource, outerKind = standInKind
                if (!outer && STAND_IN_KINDS[name]) { standInSource = STAND_IN_KINDS[name](this); standInKind = name }
                ++compositing
                try { return original.apply(this, args) }
                finally { --compositing; standInSource = outer; standInKind = outerKind }
            }
        }
        // (Board drawing made inside them is live again: the patched cells drawn over the surface cache.)
        if (proto.drawPatchCells) {
            const patchCells = proto.drawPatchCells
            proto.drawPatchCells = function(...args) {
                const outer = compositing, source = standInSource, kind = standInKind
                compositing = 0; standInSource = null; standInKind = null
                try { return patchCells.apply(this, args) }
                finally { compositing = outer; standInSource = source; standInKind = kind }
            }
        }
        sectorCounters.wrap(proto)
        // TASK-1614: the holds drawAll returns at before drawing (holdStartFrame: a new board's first frame kept while its lit
        // tiles are built; holdZoomFrame: a zoom gesture's raster made in steps), and whether grid.draw ran (renderPathOf).
        // TASK-1633: holdLoadFrame (a frame after the start hold that would draw the board partial, kept while its builds run).
        for (const [name, label] of [['holdStartFrame', 'start-held'], ['holdZoomFrame', 'zoom-held'], ['holdLoadFrame', 'load-held']]) {
            const hold = proto[name]
            if (!hold) continue
            proto[name] = function(...args) {
                const held = hold.apply(this, args)
                if (active && held) holdNote = label
                return held
            }
        }
        const gridDraw = proto.draw
        proto.draw = function(...args) {
            if (active && this === grid) boardDrawn = true
            return gridDraw.apply(this, args)
        }
        proto.drawMapSurface.visualsPerf = true
    }
    // TASK-1557: full rebuilds of the board's kept layers, counted in the frame they are found in (the tasks since the previous
    // frame included) as work.layerFullRebuild['layer:reason'] (reason: outside = the view left a layer kept at the same
    // scale and state; zoom = a new scale; state = the board, the layer's key or the canvas state changed; other = first,
    // after a rest, or not known) and work.layerRebuildCauses['layer:cause'] (the layer's own cause). Layers:
    // lit-layer (TASK-1515's units/text layer: queueLitLayer's cause; 'none' takes the reason its last drop had),
    // lit-tiles (a new lit view: every tile built again; a new scale = zoom, the same scale = state when replaced or dropped
    // for the board's cell state, else other; cause = the scale or the dropping caller), scene-layer and overlay-layer (a new
    // raster: scale, key / revision, else outside), zoom-raster (a new one: zoom), surface-cache (finishSurfaceCacheBuild:
    // state when replacing a cache, else other).
    const sectorCounters = (() => {
        let seen = null, litCause = null, litDropReason = 'other', viewDrop = null, litQueuedIn = null
        const add = (name, reason, cause, from = null) => {
            work.layerFullRebuild[name + ':' + reason] = (work.layerFullRebuild[name + ':' + reason] || 0) + 1
            work.layerRebuildCauses[name + ':' + cause] = (work.layerRebuildCauses[name + ':' + cause] || 0) + 1
            // TASK-1625: also in the turn playback window it happens in (call time, not the next sample's), with the window its
            // work was queued or started in when that is known (from: the lit layer's queue, the surface cache build's start).
            playbackTrace.full(name + ':' + cause, from)
        }
        const litReason = cause => cause === 'outside' ? 'outside' : cause === 'scale' ? 'zoom' :
            cause === 'canvas' || cause.startsWith('state') || cause === 'key' || cause === 'cells' ? 'state' :
            cause === 'none' ? litDropReason : 'other'
        const STATE_CALLERS = /CellLayer|Patch|Split|refresh|followCell/i
        const zoomingNow = () => { const screen = gameEvent?.screen; return !!(screen && (screen.zoomGesture || screen.surfaceZooming)) }
        const mainScale = () => typeof mainCtx !== 'undefined' ? mainCtx.getTransform().a : null
        const sameKey = (a, b) => !!a && !!b && a.length === b.length && a.every((v, k) => v === b[k])
        const snapshot = g => ({board: g, litBuilds: g.litLayerBuilds, litView: g.litView, litViewA: g.litView?.a ?? null,
            sectorClears: g.sectorWork ? g.sectorWork.clears : 0,
            scene: g.sceneLayer, scenePrev: g.sceneLayer || null, overlay: g.overlayLayer, overlayPrev: g.overlayLayer || null, zoomRaster: g.zoomRaster})
        return {
            wrap(proto) {
                const queue = proto.queueLitLayer, drop = proto.dropLitLayer, dropView = proto.dropLitView, finish = proto.finishSurfaceCacheBuild
                if (queue) proto.queueLitLayer = function(ctx, t, state, ahead, cause = 'ahead') {
                    if (active && this === grid && !this.litLayerQueued) { litCause = cause; litQueuedIn = playbackTrace.windowKey() }
                    return queue.apply(this, arguments)
                }
                if (drop) proto.dropLitLayer = function(...args) {
                    if (active && this === grid && this.litLayer) litDropReason = zoomingNow() || this.litLayer.a !== mainScale() ? 'zoom' : 'other'
                    return drop.apply(this, args)
                }
                if (dropView) proto.dropLitView = function(...args) {
                    if (active && this === grid && this.litView) {
                        diagnostics.calls++
                        viewDrop = {a: this.litView.a, caller: creationSite().split(' ')[0]}
                    }
                    return dropView.apply(this, args)
                }
                if (finish) proto.finishSurfaceCacheBuild = function(...args) {
                    const had = this === grid && !!this.surfaceCacheBounds && this.surfaceCacheRevision > 0
                    const result = finish.apply(this, args)
                    // TASK-1625: the playback window the finished build was started in (startSurfaceCacheBuild).
                    const from = active && this === grid ? playbackTrace.surfaceBuilt(args[0]) : null
                    if (active && this === grid) add('surface-cache', had ? 'state' : 'other', had ? 'replaced' : 'first', from)
                    return result
                }
            },
            frameEnd() {
                const g = typeof grid !== 'undefined' ? grid : null
                if (!g) return
                if (!seen || seen.board !== g) { seen = snapshot(g); return }
                for (let n = seen.litBuilds; n < g.litLayerBuilds; ++n) add('lit-layer', litReason(litCause || 'none'), litCause || 'none', litQueuedIn)
                seen.litBuilds = g.litLayerBuilds
                // TASK-1559: the lit sectors dropped whole because they no longer draw the board (Grid.clearSectors), as
                // ground-sectors: zoom in a zoom gesture, else by its cause (state: the board, light map, cell layer, lamp or
                // portal, outline; other: no basis, observed). 'released' (releaseLitCanvases: the surface cache draws the
                // board, the lit path is not in use) frees them without a rebuild: work.sectorReleases (the lit view made
                // when the lit path is back finds no sectors and counts as lit-tiles then).
                const clears = g.sectorWork ? g.sectorWork.clears : 0
                if (clears > seen.sectorClears) {
                    const reasons = g.sectorClears.slice(-(clears - seen.sectorClears))
                    for (const cause of reasons) {
                        if (cause === 'released') { work.sectorReleases = (work.sectorReleases || 0) + 1; continue }
                        add('ground-sectors', /light map|board|cell layer|lamp|outline/.test(cause) ? (zoomingNow() ? 'zoom' : 'state') : 'other', cause.replace(/ /g, '-'))
                    }
                }
                seen.sectorClears = clears
                const view = g.litView
                if (view && view !== seen.litView) {
                    const prevA = viewDrop ? viewDrop.a : seen.litViewA
                    // TASK-1559: a view that took kept sectors on its canvas (Grid.adoptSectors) is not every tile built again.
                    if (view.sectorAdopt && view.sectorsOnCanvas > 0) work.litSectorAdoptions = (work.litSectorAdoptions || 0) + 1
                    else if (prevA === null) add('lit-tiles', 'other', 'first')
                    // TASK-1562: a view for a new scale made after a zoom on the levels (Grid.zoomLevels): its tiles are built a
                    // step at a time while the frames draw the squares from the sectors kept (stretched or of the camera's
                    // level), nothing is built whole: work.levelViews.
                    else if (prevA !== view.a && view.levelBuild) work.levelViews = (work.levelViews || 0) + 1
                    else if (prevA !== view.a) add('lit-tiles', 'zoom', 'scale')
                    else if (!viewDrop) add('lit-tiles', 'state', 'replaced')
                    else add('lit-tiles', STATE_CALLERS.test(viewDrop.caller) ? 'state' : 'other', viewDrop.caller)
                    viewDrop = null
                }
                if (view) { seen.litViewA = view.a; viewDrop = null }
                else if (viewDrop) seen.litViewA = viewDrop.a
                seen.litView = view
                for (const [name, field, prevField, key] of [['scene-layer', 'sceneLayer', 'scenePrev', 'key'], ['overlay-layer', 'overlayLayer', 'overlayPrev', 'revision']]) {
                    const layer = g[field], prev = seen[prevField]
                    if (layer && layer !== seen[field.replace('Layer', '')]) {
                        if (!prev) add(name, 'other', 'first')
                        else if (prev.a !== layer.a || prev.d !== layer.d) add(name, 'zoom', 'scale')
                        else if (key === 'key' ? !sameKey(prev.key, layer.key) : prev.revision !== layer.revision) add(name, 'state', key)
                        else add(name, 'outside', 'outside')
                    }
                    seen[field.replace('Layer', '')] = layer
                    if (layer) seen[prevField] = layer
                }
                if (g.zoomRaster && g.zoomRaster !== seen.zoomRaster) add('zoom-raster', 'zoom', 'gesture')
                seen.zoomRaster = g.zoomRaster
            },
            reset() { seen = null; litCause = null; litDropReason = 'other'; viewDrop = null; litQueuedIn = null }
        }
    })()
    // TASK-1624 (ENEMY TURN 1/6): what an AI turn's playback (turnPlaybackView) changes and rebuilds, step by step
    // (report.playbackTrace; each sample's playback: {w, r, s, ph}, its window). A window is the time from one playback
    // event to the next: 'pre' (the capture's start), 'begin' (turnPlaybackView.begin), 'r<R>:load' (an AI turn's snapshot
    // loaded: a new Grid), 'r<R>:s<S>' (step S: its glide from pace(), then its apply and wait), 'end' (the computed board
    // back). Per window: board (the Grid instance's number), the cells it changed (content: owner or unit; hp; buildings;
    // lamps: a light kind shown, hidden or replaced; fog: the viewer's fog flipped; TASK-1626 marks: the rest the units pass
    // draws, a moves bar, a hit or heal mark, production turns, a portal preview), the tiles they touch at the camera's
    // level (each changed cell's hex box, its sprites' height above it, an owner change's territory glow, a lamp change's
    // light reach LAMP_REACH; grown as Grid.staleSectorsIn grows), the lit tiles and unit sectors stored (rebuilt) in it, each
    // with its cause, the surface cache's builds and patches, the lit patches and the sector clears. A tile's cause:
    // board-reload (its square was built on another Grid before: the board swap lost it), step / fog (on the same board,
    // a step's changed cells / a fog flip since its last build reach it), clear:<reason> (Grid.clearSectors / clearUnitSectors
    // since its last build), glide-new (its first build, the camera moving in the window or the one before: a square new in
    // view), glide-again (built on this board before, no change reaches it, the camera moving: evicted or dropped), new (its
    // first build, the camera still), TASK-1626 path (a unit sector's first build over the other ground: its square built over
    // a lit tile before and now over the surface cache or the other way, the frames' path changed) or other. TASK-1626: a
    // unit sector's history is its kind's (over a lit tile or over the cache). Also per window: the levels built at, the refusals of the surface cache's and the
    // lit view's patches (with patchSurfaceCache's early returns: early-<why>).
    const playbackTrace = (() => {
        const LAMP_REACH = 4, boards = new WeakMap()
        let lightRebuildsAt = null, boardSeq = 0, trace = null, win = null, wrapped = false, seq = 0, built = new Map(), marks = [], before = null
        // TASK-1625: the window each surface cache build was started in (by the build object).
        const buildStarts = new WeakMap()
        const boardId = g => { if (!g) return null; if (!boards.has(g)) boards.set(g, ++boardSeq); return boards.get(g) }
        const tileSize = () => typeof LIT_TILE !== 'undefined' ? LIT_TILE : 256
        const level = () => grid?.litView?.sectorLevel || grid?.litView?.a || (typeof mainCtx !== 'undefined' ? mainCtx.getTransform().a : canvas.scale)
        const sig = e => !e || (e.isEmpty && e.isEmpty()) ? '' : e.name + '|' + JSON.stringify(e.playerColor ?? null)
        // TASK-1626: the rest of what a cell's units pass draws (Grid.unitCellValues): the unit's moves bar, hit and heal marks,
        // the building's hit mark, ruin, heal, production turns and portal preview.
        const marksOf = cell => {
            const u = cell.unit, b = cell.building
            const unit = u && !(u.isEmpty && u.isEmpty()) ? [u.moves, u.wasHitted, u.hpIncrease, typeof shouldShowMovesBar === 'function' ? shouldShowMovesBar(u) : ''] : []
            const building = b && !(b.isEmpty && b.isEmpty()) ? [b.wasHitted, b.killed, b.hpIncrease, b.isBuildingProduction?.() ? b.turns : '',
                b.isPreparingManufacture ? (b.unitProduction?.name || '') + '/' + (b.unitProduction?.turns ?? '') : '',
                b.isDemonPortal ? (b.nextProduction?.type || '') + '/' + (b.nextProduction?.roundsRemaining ?? '') : ''] : []
            return JSON.stringify([unit, building])
        }
        const lampOf = b => { try { return b && !(b.isEmpty && b.isEmpty()) && atmosphericLighting.emitsLight(b) ? (b.isDemonPortal ? 'demonPortal' : b.name) : '' } catch (_) { return '' } }
        // The board's cells now: per cell index (i x height + j) owner, unit, hp, building, lamp, the viewer's fog.
        const snap = () => {
            const g = grid, out = {board: g, w: g.arr.length, h: g.arr[0].length, owner: [], unit: [], hp: [], building: [], lamp: [], fog: [], marks: []}
            for (let i = 0; i < out.w; ++i)
                for (let j = 0; j < out.h; ++j) {
                    const cell = g.arr[i][j]
                    out.owner.push(cell.hexagon.unknown ? '?' : JSON.stringify(cell.hexagon.playerColor ?? null))
                    out.unit.push(sig(cell.unit))
                    out.hp.push((cell.unit && !cell.unit.isEmpty?.() ? cell.unit.hp : '') + '|' + (cell.building && !cell.building.isEmpty?.() ? cell.building.hp : ''))
                    out.building.push(sig(cell.building))
                    // TASK-1626: a lamp is shown where collect finds it (in view, known, not killed): fog hides or shows it.
                    const fogged = typeof isFogOfWar !== 'undefined' && isFogOfWar && g.fogOfWar && !g.fogOfWar[i]?.[j]
                    out.lamp.push(fogged || cell.hexagon.unknown || cell.building?.killed ? '' : lampOf(cell.building))
                    out.fog.push(typeof isFogOfWar !== 'undefined' && isFogOfWar && g.fogOfWar ? (g.fogOfWar[i]?.[j] ? 1 : 0) : 1)
                    out.marks.push(marksOf(cell))
                }
            return out
        }
        // World boxes the changed cells reach; their tiles at the camera's level.
        const changeRects = (cells) => {
            const r = basis.r, hex = 1.1 * r, T = atmosphericLighting.TERRITORY, glow = Math.max(T.reach, T.cool?.reach || 0) * r
            const rects = []
            for (const [i, j, kinds] of cells) {
                const c = grid.arr[i][j].hexagon.calcPos()
                let reach = hex
                if (kinds.includes('o')) reach = Math.max(reach, glow)
                if (kinds.includes('l')) reach = Math.max(reach, LAMP_REACH * r)
                // (a unit's or building's sprite stands up to a hex radius above its cell)
                rects.push({x0: c.x - reach, y0: c.y - reach - (kinds.includes('l') ? 0 : r), x1: c.x + reach, y1: c.y + reach, fog: kinds === 'f'})
            }
            return rects
        }
        // TASK-1626: a lamp shown, hidden or replaced also turns the shadows of the casters within the shadow lamps' reach
        // (atmosphericLighting.SHADOW.reachRadii) whose strongest lamp or its strength changed: their shadows as cast with the
        // lamps before and after (shadowBounds).
        const lampShadowRects = (was, now, cells) => {
            const lamps = cells.filter(([, , kinds]) => kinds.includes('l'))
            if (!lamps.length || !was || was.w !== now.w || was.h !== now.h || typeof atmosphericLighting === 'undefined') return []
            const L = atmosphericLighting, r = basis.r, reach = (L.SHADOW.reachRadii + 1) * r, out = []
            const sources = s => {
                const list = []
                for (let k = 0; k < s.lamp.length; ++k) if (s.lamp[k]) {
                    const i = Math.floor(k / s.h), j = k % s.h
                    list.push({x: i, y: j, pos: grid.arr[i][j].hexagon.calcPos(), name: s.lamp[k]})
                }
                return list
            }
            const then = sources(was), after = sources(now), centres = lamps.map(([i, j]) => grid.arr[i][j].hexagon.calcPos())
            for (let i = 0; i < now.w; ++i) for (let j = 0; j < now.h; ++j) {
                const cell = grid.arr[i][j], c = cell.hexagon.calcPos(), b = cell.building
                if (!centres.some(q => Math.hypot(q.x - c.x, q.y - c.y) <= reach)) continue
                if (!b || !b.notEmpty?.() || !L.castsShadow(grid, i, j, b, true)) continue
                // (the same strongest lamp at the same strength: the same shadow)
                const was = L.strongestLamp(c, then, L.SHADOW.reachRadii), is = L.strongestLamp(c, after, L.SHADOW.reachRadii)
                if (was.strength === is.strength && (was.best === is.best || was.best && is.best && was.best.x === is.best.x && was.best.y === is.best.y)) continue
                for (const image of new Set([cachedImages[grid.getEntityBodyImageName(b)], cachedImages[b.bodyImageName]])) {
                    if (!image || !image.width) continue
                    for (const q of [L.shadowBounds(b, image, c, then), L.shadowBounds(b, image, c, after)])
                        out.push({x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1, fog: false})
                }
            }
            return out
        }
        const tilesOf = (rects, a) => {
            const L = tileSize(), grow = (3 + 4 * (typeof LIT_EDGE_BLOCK !== 'undefined' ? LIT_EDGE_BLOCK : 8)) / a, set = new Set()
            for (const q of rects)
                for (let u = Math.floor((q.x0 - grow) * a / L); u <= Math.floor((q.x1 + grow) * a / L); ++u)
                    for (let v = Math.floor((q.y0 - grow) * a / L); v <= Math.floor((q.y1 + grow) * a / L); ++v)
                        set.add(u + ',' + v)
            return set
        }
        const diff = (was, now) => {
            const cells = [], count = {content: 0, hp: 0, buildings: 0, lamps: 0, fog: 0, marks: 0}
            if (!was || was.w !== now.w || was.h !== now.h) return {cells, count, sizeChanged: !!was}
            for (let k = 0; k < now.owner.length; ++k) {
                let kinds = ''
                if (was.owner[k] !== now.owner[k]) kinds += 'o'
                if (was.unit[k] !== now.unit[k]) kinds += 'u'
                if (was.hp[k] !== now.hp[k]) kinds += 'h'
                if (was.building[k] !== now.building[k]) kinds += 'b'
                if (was.lamp[k] !== now.lamp[k]) kinds += 'l'
                if (was.fog[k] !== now.fog[k]) kinds += 'f'
                if (was.marks && was.marks[k] !== now.marks[k]) kinds += 'm'
                if (!kinds) continue
                if (/[ou]/.test(kinds)) ++count.content
                if (kinds.includes('h')) ++count.hp
                if (kinds.includes('b')) ++count.buildings
                if (kinds.includes('l')) ++count.lamps
                if (kinds.includes('f')) ++count.fog
                if (kinds.includes('m')) ++count.marks
                cells.push([Math.floor(k / now.h), k % now.h, kinds])
            }
            return {cells, count}
        }
        const open = (key, extra = {}) => {
            if (!trace) return
            win = {w: trace.windows.length, key, board: boardId(typeof grid !== 'undefined' ? grid : null), t0: Math.round(performance.now()), ...extra,
                cells: null, touched: null, rebuilt: {lit: 0, unit: 0}, rebuiltTouched: {lit: 0, unit: 0},
                causes: {lit: {}, unit: {}}, levels: {}, surface: {full: 0, patch: 0, litPatch: 0}, refusals: {}, clears: [], glideFrames: 0, motionFrames: 0, frames: 0,
                keys: {lit: new Set(), unit: new Set()}}
            trace.windows.push(win)
        }
        // The changes since before (the window's start) on the same board: the window's cells and touched tiles.
        const record = (was) => {
            if (!trace || !win || !grid) return
            const now = snap(), d = diff(was, now)
            const a = level(), rects = changeRects(d.cells).concat(lampShadowRects(was, now, d.cells))
            win.board = boardId(now.board)
            win.cells = d.count
            if (d.sizeChanged) win.cells.sizeChanged = true
            win.changed = d.cells.length <= 400 ? d.cells : d.cells.length
            const touched = tilesOf(rects.filter(q => !q.fog), a), fogTiles = tilesOf(rects.filter(q => q.fog), a)
            for (const k of fogTiles) touched.add(k)
            win.touched = {a: Math.round(a * 1e4) / 1e4, tiles: touched.size, fogOnly: [...fogTiles].filter(k => !tilesOf(rects.filter(q => !q.fog), a).has(k)).length}
            win.touchedKeys = touched
            win.touchedRects = rects
            const id = ++seq
            for (const q of rects) marks.push({seq: id, board: now.board, rect: q, kind: q.fog ? 'fog' : 'step'})
            if (marks.length > 20000) marks.splice(0, marks.length - 20000)
            before = now
        }
        const inRect = (q, x0, y0, x1, y1) => q.x0 < x1 && q.x1 > x0 && q.y0 < y1 && q.y1 > y0
        // TASK-1626: ground: a unit sector's kind ('lit': over a lit tile, 'cache': over the surface cache), two pictures of a
        // square with their own histories: a square's first build over the other ground (its other kind built before) is
        // 'path' (the frames' path changed between the lit tiles and the cache), not new.
        const tileBuilt = (kind, a, u, v, board, ground = '') => {
            if (!trace || !win) return
            const L = tileSize(), x0 = u * L / a, y0 = v * L / a, x1 = (u + 1) * L / a, y1 = (v + 1) * L / a
            const sq = Math.round(a * 1e4) + ':' + u + ':' + v, id = kind + ground + ':' + sq, b = boardId(board)
            let prev = built.get(id)
            const other = !prev && ground ? built.get(kind + (ground === 'lit' ? 'cache' : 'lit') + ':' + sq) || built.get(kind + ':' + sq) : null
            // (a glide's squares may arrive in the window after it: the window before counts too)
            const last = trace.windows[win.w - 1], moving = !!(win.motionFrames || win.glideFrames || last && (last.motionFrames || last.glideFrames))
            let cause
            if (!prev && other) cause = other.board !== b ? 'board-reload' : 'path'
            else if (!prev) cause = moving ? 'glide-new' : 'new'
            else if (prev.board !== b) cause = 'board-reload'
            else {
                const hit = marks.filter(m => m.seq > prev.seq && m.board === board && inRect(m.rect, x0, y0, x1, y1))
                const clear = trace.clears.filter(c => c.seq > prev.seq && c.board === b && (kind === 'lit' ? c.what === 'sectors' : c.what === 'unitSectors')).at(-1)
                cause = hit.some(m => m.kind === 'step') ? 'step' : hit.length ? 'fog' : clear ? 'clear:' + clear.reason :
                    moving ? 'glide-again' : 'other'
            }
            built.set(id, {board: b, seq})
            const key = Math.round(a * 1e4) + ':' + u + ',' + v, lv = kind + ':' + Math.round(a * 1e4) / 1e4
            win.causes[kind][cause] = (win.causes[kind][cause] || 0) + 1
            win.levels[lv] = (win.levels[lv] || 0) + 1
            if (!win.keys[kind].has(key)) {
                win.keys[kind].add(key)
                ++win.rebuilt[kind]
                // (the square meets the window's changed cells' boxes, grown as tilesOf grows them at its level)
                const grow = (3 + 4 * (typeof LIT_EDGE_BLOCK !== 'undefined' ? LIT_EDGE_BLOCK : 8)) / a
                if (win.touchedRects?.some(q => inRect(q, x0 - grow, y0 - grow, x1 + grow, y1 + grow))) ++win.rebuiltTouched[kind]
            }
        }
        const wrap = () => {
            if (wrapped || typeof Grid === 'undefined' || typeof turnPlaybackView === 'undefined') return
            wrapped = true
            const G = Grid.prototype, V = turnPlaybackView
            const around = (object, name, fn) => {
                const original = object[name]
                if (typeof original !== 'function') return
                object[name] = function(...args) { return fn.call(this, original, args) }
            }
            around(G, 'storeSector', function(original, args) {
                const [view, u, v, tile] = args
                if (active && this === grid && view && tile) tileBuilt('lit', view.sectorLevel || view.a, u, v, this)
                return original.apply(this, args)
            })
            around(G, 'storeUnitSector', function(original, args) {
                if (active && this === grid && args[3]) tileBuilt('unit', args[0], args[1], args[2], this, args[5] === 'lit' || args[5] === 'cache' ? args[5] : '')
                return original.apply(this, args)
            })
            for (const [name, field] of [['finishSurfaceCacheBuild', 'full'], ['finishSurfacePatch', 'patch'], ['finishLitPatch', 'litPatch']])
                around(G, name, function(original, args) {
                    if (active && this === grid && win) ++win.surface[field]
                    return original.apply(this, args)
                })
            // Why a surface cache / lit view patch was refused (Grid.surfacePatchRefusals / litPatchRefusals' new counts).
            for (const [name, field, tag] of [['patchSurfaceCache', 'surfacePatchRefusals', 'surface'], ['startLitPatch', 'litPatchRefusals', 'lit']])
                around(G, name, function(original, args) {
                    const was = active && win && this === grid ? {...(this[field] || {})} : null
                    // (patchSurfaceCache's own early returns, before its refusals: no patching, no lit cache, a build under way)
                    const early = was && tag === 'surface' ? (!Grid.surfacePatching ? 'off' : !otherSettings.atmosphericVisuals ? 'visuals' :
                        !this.surfaceCache ? 'none' : this.surfaceCacheBuild ? 'building' : !this.surfaceCacheLit ? 'unlit' : this.isObserving() ? 'observing' : null) : null
                    const result = original.apply(this, args)
                    let refused = false
                    if (was) for (const [k, n] of Object.entries(this[field] || {}))
                        if (n > (was[k] || 0)) { refused = true; win.refusals[tag + ':' + k] = (win.refusals[tag + ':' + k] || 0) + n - (was[k] || 0) }
                    if (was && !result && !refused && early) win.refusals[tag + ':early-' + early] = (win.refusals[tag + ':early-' + early] || 0) + 1
                    return result
                })
            // The surface cache dropped (a cell layer split whose cells changed under it, a cell layer follow that failed) and
            // the builds started with or without a cache to patch (surface-build:after-cache / no-cache).
            for (const [name, why] of [['surfaceSplitHolds', 'split-states'], ['followCellLayer', 'cell-layer-follow']])
                around(G, name, function(original, args) {
                    const had = !!this.surfaceCache
                    const result = original.apply(this, args)
                    if (active && win && this === grid && had && !this.surfaceCache) win.refusals['surface-drop:' + why] = (win.refusals['surface-drop:' + why] || 0) + 1
                    return result
                })
            // TASK-1626: a split finished at once (the board changed under it) instead of the cache dropped.
            around(G, 'settleSplit', function(original, args) {
                const result = original.apply(this, args)
                if (active && win && this === grid && result) win.refusals['surface-split:settled'] = (win.refusals['surface-split:settled'] || 0) + 1
                return result
            })
            around(G, 'surfaceCacheBuildHolds', function(original, args) {
                const result = original.apply(this, args)
                if (active && win && this === grid && !result) win.refusals['surface-build:restart'] = (win.refusals['surface-build:restart'] || 0) + 1
                return result
            })
            around(G, 'startSurfaceCacheBuild', function(original, args) {
                const result = original.apply(this, args)
                if (active && win && this === grid && result) {
                    const k = 'surface-build:' + (args[0] ? 'after-cache' : 'no-cache')
                    win.refusals[k] = (win.refusals[k] || 0) + 1
                    if (typeof result === 'object') buildStarts.set(result, win.key)
                }
                return result
            })
            for (const [name, what] of [['clearSectors', 'sectors'], ['clearUnitSectors', 'unitSectors']])
                around(G, name, function(original, args) {
                    const had = what === 'sectors' ? this.sectors?.entries.size : this.unitSectors?.entries.size
                    if (active && trace && this === grid && had) {
                        const reason = String(args[0])
                        trace.clears.push({seq: ++seq, board: boardId(this), what, reason, w: win?.w})
                        win?.clears.push(what + ':' + reason)
                    }
                    return original.apply(this, args)
                })
            around(V, 'begin', function(original, args) {
                const was = active && grid ? snap() : null
                const began = original.apply(this, args)
                if (active && began) { open('begin', {steps: this.active?.steps}); before = was }
                return began
            })
            around(V, 'load', function(original, args) {
                const p = args[0], was = active && grid ? snap() : null
                if (active) open('r' + p.recordingIndex + ':load', {r: p.recordingIndex, player: p.recordings[p.recordingIndex]?.player})
                const result = original.apply(this, args)
                if (active) record(was)
                return result
            })
            // A step's window opens when it is chosen (pace: before its glide); rush applies steps without one.
            around(V, 'pace', function(original, args) {
                const p = args[0]
                if (active) open('r' + p.recordingIndex + ':s' + p.stepIndex, {r: p.recordingIndex, s: p.stepIndex,
                    t: p.recordings[p.recordingIndex]?.actions[p.stepIndex]?.action.t})
                return original.apply(this, args)
            })
            around(V, 'apply', function(original, args) {
                const p = args[0], key = 'r' + p.recordingIndex + ':s' + p.stepIndex
                if (active && win?.key !== key) open(key, {r: p.recordingIndex, s: p.stepIndex, t: p.recordings[p.recordingIndex]?.actions[p.stepIndex]?.action.t, rushed: true})
                const was = active && grid ? (before?.board === grid ? before : snap()) : null
                const result = original.apply(this, args)
                if (active && win) { win.seen = !!p.seen; record(was) }
                return result
            })
            around(V, 'end', function(original, args) {
                const p = args[0], mine = this.active === p, was = active && mine && grid ? snap() : null
                if (active && mine) open('end', {result: args[1]})
                const result = original.apply(this, args)
                if (active && mine) record(was)
                return result
            })
        }
        return {
            // TASK-1625: per window, the board layers rebuilt whole in it ('layer:cause', at call time: win.full) and the surface
            // cache builds finished in it by the window they were started in (win.surfaceStarted; 'before': not seen starting).
            // win.fullFrom['layer:cause@window']: those whose work was queued or started in another known window ('before':
            // a surface cache build not seen starting, before the capture).
            full(key, from) {
                if (!trace || !win) return
                ;(win.full ||= {})[key] = (win.full[key] || 0) + 1
                if (from) (win.fullFrom ||= {})[key + '@' + from] = (win.fullFrom[key + '@' + from] || 0) + 1
            },
            surfaceBuilt(build) {
                if (!trace || !win) return null
                const from = build && typeof build === 'object' && buildStarts.get(build) || 'before'
                ;(win.surfaceStarted ||= {})[from] = (win.surfaceStarted[from] || 0) + 1
                return from
            },
            windowKey() {
                return trace && win ? win.key : null
            },
            start(report) {
                wrap()
                built = new Map(); marks = []; seq = 0; before = null
                // The squares the board holds already (its lit view's tiles, its lit and unit sectors): built before the capture.
                const g = typeof grid !== 'undefined' ? grid : null, b = boardId(g)
                const seed = (kind, a, u, v) => built.set(kind + ':' + Math.round(a * 1e4) + ':' + u + ':' + v, {board: b, seq: 0})
                if (g?.litView) for (const key of g.litView.tiles.keys()) { const [u, v] = key.split(',').map(Number); seed('lit', g.litView.sectorLevel || g.litView.a, u, v) }
                for (const [kind, cache] of [['lit', g?.sectors], ['unit', g?.unitSectors]])
                    if (cache?.entries) for (const entry of cache.entries.values()) if (entry.level)
                        seed(kind === 'unit' && (entry.kind === 'lit' || entry.kind === 'cache') ? kind + entry.kind : kind, entry.level, entry.u, entry.v)
                trace = report.playbackTrace = {schema: 1, lampReachRadii: LAMP_REACH, tile: tileSize(), windows: [], clears: []}
                open('pre')
            },
            // Each sample: its window and the playback's phase; the window's frames, glide and camera-move frames.
            frame(frame) {
                if (!trace || !win) return null
                const p = typeof turnPlaybackView !== 'undefined' ? turnPlaybackView.active : null
                ++win.frames
                // (the light map's whole rebuilds, atmosphericLighting.rebuilds, since the window's last frame)
                const rebuilds = typeof atmosphericLighting !== 'undefined' ? atmosphericLighting.rebuilds : 0
                if (win.lightRebuilds0 === undefined) win.lightRebuilds0 = lightRebuildsAt ?? rebuilds
                win.lightMapRebuilds = rebuilds - win.lightRebuilds0
                lightRebuildsAt = rebuilds
                const glide = !!(p && p.screen && p.screen.glide) || p?.phase === 'glide'
                if (glide) ++win.glideFrames
                if (frame.motion !== 'still') ++win.motionFrames
                return {w: win.w, r: p ? p.recordingIndex : null, s: p ? p.stepIndex : null, ph: p ? p.phase : null, glide}
            },
            stop() {
                if (!trace) return
                for (const w of trace.windows) { delete w.keys; delete w.touchedKeys; delete w.touchedRects; delete w.lightRebuilds0 }
                lightRebuildsAt = null
                for (const c of trace.clears) delete c.board
                trace = win = null; before = null; marks = []; built = new Map()
            }
        }
    })()
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
        else {
            // TASK-1538: ids (event.touches identifiers, same order as points) and changed (changedTouches identifiers)
            // let a capture tell a finger the browser never ended (a ghost touch) from a new one; diagnostic only.
            entry.points = [...event.touches].map(t => ({x:t.clientX,y:t.clientY}))
            entry.ids = [...event.touches].map(t => t.identifier)
            entry.changed = [...(event.changedTouches || [])].map(t => t.identifier)
        }
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
        sectorCounters.reset()
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
        // TASK-1574: Grid.frameView for the swap counters while sampling.
        if (typeof Grid !== 'undefined') Grid.noteFrameViews = true
        taskSources.start(report)
        phaseTimers.start()
        playbackTrace.start(report)
        active = true
        return report
    }
    function stop() {
        active = false
        taskSources.stop()
        phaseTimers.stop()
        if (typeof Grid !== 'undefined') Grid.noteFrameViews = false
        if (!report) return null
        swapFinish(report.samples)
        playbackTrace.stop()
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
    // TASK-1568: devicePx board pixels of the main canvas drawn as the plain ground fill for squares without a tile.
    const groundFill=devicePx=>{if(active&&devicePx>0)work.groundFillPx+=devicePx}
    const api=window.visualsPerf={phases:phaseTimers.segments,start,stop,groundFill,paired,compare,diagnostics,setSegment:value=>{segment=value},cancel:()=>{cancelled=true;stop()},export:()=>api.lastExport||stop()}
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
