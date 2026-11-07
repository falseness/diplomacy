// TASK-1564 (SECTORS 8/11): the sector Worker. One file, two sides:
//  - in a Worker (new Worker('render/sectorWorker.js')): the TASK-1563 module (render/sectorDraw.js, importScripts) draws
//    each sector snapshot posted to it on OffscreenCanvas targets and posts the pictures back as ImageBitmaps (transferred);
//  - on the page (its script tag, after sectorDraw.js): SectorWorker, the main thread's queue. A sector build (Grid's lit
//    tile steps, unit sectors) records its snapshot on the main thread as before (SectorRecorder: the drawing code runs
//    there), then, instead of drawing the runs on its canvases, submits the snapshot (only its targets: the runs) and gets
//    the pictures back in a later task (onDone, ImageBitmaps by target k), which the board stores in its caches.
// SPRITES: the images a snapshot draws (by SectorRecorder's key, which holds a canvas's content version: sectorVersion and
// its draws since, sectorCanvasVersion) are made into ImageBitmaps when first recorded (prepare: createImageBitmap copies the
// canvas's pixels at the call, so a canvas redrawn later is the version recorded), sent once with the first build that draws
// them and kept by the worker under their key; versions superseded and the least recently used beyond
// SECTOR_WORKER_SPRITE_BYTES are dropped (in the worker and here) when no build in flight draws them.
// FALLBACK: without Worker, OffscreenCanvas or createImageBitmap, with the flag off (Grid.sectorWorker, the page's
// ?sectorWorker=0), after a worker error, or for a snapshot the worker cannot draw (a pixel read, an opaque value, a sprite
// that cannot be made a bitmap), the build draws its runs on the main thread as TASK-1563 did (budgeted as before); each such
// build counts in counters.fallback (workerFallback). counters: builtWorker / builtMain (sector pictures made in the worker /
// on the main thread), posted, dropped (pictures arriving for a sector no longer wanted: stale versions), failed, depth (builds
// in flight: workerQueueDepth).
const SECTOR_WORKER_SPRITE_BYTES = 384 * 1024 * 1024
// A worker build failing this many times turns the worker off (the fallback from then on).
const SECTOR_WORKER_MAX_FAILURES = 3
// Builds in flight (sent, picture not back) beyond which the board starts no new sector build (busy): the worker makes a
// picture at a time, so builds recorded past it wait, go stale as the camera moves on, and their recording was main-thread
// work for nothing. A build finished frees a place (onDrain: the board's builds go on).
const SECTOR_WORKER_QUEUE = 3

if (typeof importScripts === 'function' && typeof document === 'undefined' && typeof window === 'undefined') {
    // ---- worker side ----
    importScripts('sectorDraw.js')
    const sprites = new Map()
    let fontsReady = Promise.resolve()
    const build = m => {
        for (const [key, bitmap] of m.add)
            sprites.set(key, bitmap)
        const out = [], t0 = performance.now()
        let ops = 0
        for (const target of m.targets) {
            const canvas = new OffscreenCanvas(target.w, target.h), ctx = canvas.getContext('2d')
            SectorDraw.drawSegs(ctx, target.segs, sprites)
            for (const seg of target.segs)
                ops += seg.o.length
            out.push([target.k, canvas.transferToImageBitmap()])
        }
        postMessage({t: 'built', id: m.id, out, ms: performance.now() - t0, ops}, out.map(o => o[1]))
    }
    onmessage = e => {
        const m = e.data
        if (m.t === 'init') {
            // The page's web fonts (the board's texts measure on the page; the worker draws them with the same faces).
            if (typeof FontFace === 'function' && self.fonts)
                fontsReady = Promise.race([Promise.all((m.fonts || []).map(f =>
                    new FontFace(f.family, `url(${f.url})`, {weight: String(f.weight)}).load().then(face => self.fonts.add(face), () => null))),
                    new Promise(r => setTimeout(r, 4000))])
            return
        }
        if (m.t === 'drop') {
            for (const key of m.keys) {
                sprites.get(key)?.close?.()
                sprites.delete(key)
            }
            return
        }
        if (m.t === 'build')
            fontsReady.then(() => {
                try {
                    build(m)
                } catch (error) {
                    postMessage({t: 'failed', id: m.id, error: String(error?.stack || error)})
                }
            })
    }
}

// ---- page side ----
// The content version of canvas sprites: every drawing call on a 2D context, and every size set, counts on its canvas
// (sectorDraws), so a sprite's key changes with its pixels (SectorRecorder.key). Installed when the worker starts (not in
// headless contexts or with the fallback).
let sectorDrawCountsOn = false
function sectorCountDraws() {
    if (sectorDrawCountsOn || typeof CanvasRenderingContext2D === 'undefined' || typeof HTMLCanvasElement === 'undefined')
        return
    sectorDrawCountsOn = true
    const proto = CanvasRenderingContext2D.prototype
    for (const name of ['fill', 'stroke', 'drawImage', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText',
        'putImageData', 'drawFocusIfNeeded', 'reset']) {
        const call = proto[name]
        if (typeof call !== 'function')
            continue
        proto[name] = function() {
            const canvas = this.canvas
            if (canvas)
                canvas.sectorDraws = (canvas.sectorDraws || 0) + 1
            return call.apply(this, arguments)
        }
    }
    for (const name of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name)
        if (!d?.set)
            continue
        Object.defineProperty(HTMLCanvasElement.prototype, name, {...d, set(value) {
            this.sectorDraws = (this.sectorDraws || 0) + 1
            d.set.call(this, value)
        }})
    }
}
// A sprite's content version for its key: its own sectorVersion (the light map's, a lit quarter's) and the draws on it.
function sectorCanvasVersion(value) {
    if (typeof value.sectorVersion !== 'function' && value.sectorDraws === undefined)
        return null
    return (typeof value.sectorVersion === 'function' ? value.sectorVersion() : '') + '.' + (value.sectorDraws || 0) + '.' +
        value.width + 'x' + value.height
}

const SectorWorker = {
    worker: null,
    state: 'off', // off: not started; on; failed (fallback from then on)
    failures: 0,
    serial: 0,
    chain: null,
    inflight: new Map(), // id -> {onDone, onFail, keys}
    sprites: new Map(), // key -> {promise, bitmap, sent, refs, last, bytes, base, bad}
    latest: new Map(), // base key -> latest version key
    spriteBytes: 0,
    use: 0,
    counters: {builtWorker: 0, builtMain: 0, builtMainMoving: 0, fallback: 0, posted: 0, dropped: 0, failed: 0, depth: 0, depthMax: 0, spriteBytes: 0,
        spritesSent: 0, spritesDropped: 0, workerMs: 0},
    // Whether the builds go to the worker now (started on the first call).
    on() {
        if (this.state === 'on')
            return true
        if (this.state === 'failed' || !this.wanted())
            return false
        return this.start()
    },
    wanted() {
        if (typeof Grid !== 'undefined' && Grid.sectorWorker === false)
            return false
        if (typeof location !== 'undefined' && typeof URLSearchParams !== 'undefined' &&
                new URLSearchParams(location.search).get('sectorWorker') === '0')
            return false
        return typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function' &&
            typeof document !== 'undefined'
    },
    start() {
        let worker
        try {
            worker = new Worker(this.scriptUrl())
        } catch (error) {
            this.fail('start: ' + error)
            return false
        }
        this.worker = worker
        this.state = 'on'
        this.chain = Promise.resolve()
        sectorCountDraws()
        worker.onmessage = e => this.receive(e.data)
        worker.onerror = e => {
            e.preventDefault?.()
            this.fail('worker: ' + (e.message || 'error'))
        }
        const fonts = typeof MENU_FONT_FILES !== 'undefined' ? MENU_FONT_FILES.map(f => ({family: f.family, weight: f.weight,
            url: new URL(`assets/fonts/${f.file}`, location.href).href})) : []
        worker.postMessage({t: 'init', fonts})
        return true
    },
    scriptUrl() {
        const own = typeof document !== 'undefined' && [...document.scripts].find(s => /render\/sectorWorker\.js(\?|$)/.test(s.src))
        return own ? own.src : 'render/sectorWorker.js'
    },
    // The worker given up: the builds in flight fail (their sectors are built again, on the main thread).
    fail(reason) {
        this.state = 'failed'
        this.reason = reason
        try {
            this.worker?.terminate()
        } catch (e) {}
        this.worker = null
        const inflight = [...this.inflight.values()]
        this.inflight.clear()
        this.counters.depth = 0
        for (const job of inflight) {
            ++this.counters.failed
            job.onFail?.(reason)
        }
        this.sprites.clear()
        this.latest.clear()
        this.spriteBytes = 0
    },
    // A sprite of a recording (SectorRecorder.key): its bitmap made now, from the pixels it has now.
    prepare(key, image, base) {
        const s = this.sprites.get(key)
        if (s) {
            s.last = ++this.use
            return
        }
        const entry = {promise: null, bitmap: null, sent: false, refs: 0, last: ++this.use, bytes: (image.width * image.height * 4) || 0,
            base, bad: false}
        try {
            entry.promise = createImageBitmap(image)
            entry.promise.then(bitmap => {
                if (this.sprites.get(key) === entry)
                    entry.bitmap = bitmap
                else
                    bitmap.close?.()
            }, () => {
                entry.bad = true
            })
        } catch (error) {
            entry.bad = true
            entry.promise = Promise.reject(error)
            entry.promise.catch(() => {})
        }
        this.sprites.set(key, entry)
        this.spriteBytes += entry.bytes
        const old = base && this.latest.get(base)
        if (base)
            this.latest.set(base, key)
        if (old && old !== key)
            this.release(old)
    },
    // Whether the builds in flight fill the queue (SECTOR_WORKER_QUEUE): the board starts no new sector build then.
    busy() {
        return this.state === 'on' && this.inflight.size >= SECTOR_WORKER_QUEUE
    },
    // Whether a sprite key cannot go to the worker.
    bad(key) {
        return !!this.sprites.get(key)?.bad
    },
    // A sprite let go of when no build in flight draws it (in the worker too when it was sent).
    release(key, drops) {
        const s = this.sprites.get(key)
        if (!s || s.refs)
            return false
        this.sprites.delete(key)
        this.spriteBytes -= s.bytes
        ++this.counters.spritesDropped
        if (s.sent)
            (drops || (this.pendingDrops ||= [])).push(key)
        else
            s.bitmap?.close?.()
        return true
    },
    // Snapshot (its targets: {k, w, h, segs}) drawn in the worker; sprites: its key -> image map (SectorRecorder's sink).
    // onDone(out: [[k, ImageBitmap], ...]) or onFail(reason) later, in a task of its own. Returns the job's id.
    submit(snapshot, sprites, onDone, onFail) {
        const id = ++this.serial, keys = [...sprites.keys()]
        for (const key of keys) {
            const s = this.sprites.get(key)
            if (s) {
                ++s.refs
                s.last = ++this.use
            }
        }
        const job = {id, onDone, onFail, keys, kind: snapshot.kind}
        this.inflight.set(id, job)
        this.counters.depth = this.inflight.size
        this.counters.depthMax = Math.max(this.counters.depthMax, this.counters.depth)
        const targets = snapshot.targets.map(t => ({k: t.k, w: t.w, h: t.h, segs: t.segs}))
        this.chain = this.chain.then(() => this.post(job, targets)).catch(error => this.jobFailed(id, 'post: ' + error))
        ++this.counters.posted
        return id
    },
    async post(job, targets) {
        const add = []
        for (const key of job.keys) {
            const s = this.sprites.get(key)
            if (!s)
                throw new Error('sprite ' + key + ' not prepared')
            if (s.sent)
                continue
            const bitmap = s.bitmap || await s.promise
            if (this.state !== 'on' || !this.inflight.has(job.id))
                return
            s.bitmap = null
            s.sent = true
            add.push([key, bitmap])
            ++this.counters.spritesSent
        }
        if (this.state !== 'on' || !this.inflight.has(job.id))
            return
        const drops = this.pendingDrops
        this.pendingDrops = null
        if (drops?.length)
            this.worker.postMessage({t: 'drop', keys: drops})
        this.worker.postMessage({t: 'build', id: job.id, targets, add}, add.map(a => a[1]))
    },
    jobFailed(id, reason) {
        const job = this.inflight.get(id)
        if (!job)
            return
        this.finish(job)
        ++this.counters.failed
        // (A sprite that cannot be made a bitmap is the build's own failure, not the worker's.)
        if (!job.keys.some(key => this.bad(key)) && ++this.failures >= SECTOR_WORKER_MAX_FAILURES)
            this.fail(reason)
        job.onFail?.(reason)
        if (typeof console !== 'undefined')
            console.warn('sector worker build failed: ' + reason)
    },
    finish(job) {
        this.inflight.delete(job.id)
        this.counters.depth = this.inflight.size
        for (const key of job.keys) {
            const s = this.sprites.get(key)
            if (s && s.refs)
                --s.refs
        }
        this.collect()
    },
    // Superseded and least recently used sprites over the budget let go of.
    collect() {
        const drops = []
        for (const [key, s] of this.sprites)
            if (!s.refs && s.base && this.latest.get(s.base) !== key)
                this.release(key, drops)
        if (this.spriteBytes > SECTOR_WORKER_SPRITE_BYTES) {
            const order = [...this.sprites].filter(([, s]) => !s.refs).sort((a, b) => a[1].last - b[1].last)
            for (const [key] of order) {
                if (this.spriteBytes <= SECTOR_WORKER_SPRITE_BYTES * 0.75)
                    break
                const base = this.sprites.get(key)?.base
                if (this.release(key, drops) && base && this.latest.get(base) === key)
                    this.latest.delete(base)
            }
        }
        if (drops.length)
            (this.pendingDrops ||= []).push(...drops)
        this.counters.spriteBytes = this.spriteBytes
    },
    receive(m) {
        if (m.t === 'failed') {
            this.jobFailed(m.id, m.error)
            return
        }
        if (m.t !== 'built')
            return
        const job = this.inflight.get(m.id)
        if (!job) {
            for (const [, bitmap] of m.out)
                bitmap.close?.()
            return
        }
        this.finish(job)
        this.counters.workerMs += m.ms || 0
        const by = this.counters.byKind ||= {}, k = by[job.kind] ||= {n: 0, ms: 0, ops: 0, max: 0}
        ++k.n
        k.ms += m.ms || 0
        k.ops += m.ops || 0
        k.max = Math.max(k.max, m.ms || 0)
        const run = () => {
            job.onDone(m.out)
            this.onDrain?.()
        }
        typeof gridTask === 'function' ? gridTask(run)() : run()
    },
    // A sector picture made: in the worker (stored, or dropped as no longer wanted) or on the main thread (fallback: the
    // worker not used for it).
    // moving: the camera not at rest then (builtMainMoving).
    built(where, fallback = false, moving = false) {
        if (where === 'worker')
            ++this.counters.builtWorker
        else {
            ++this.counters.builtMain
            if (fallback)
                ++this.counters.fallback
            if (moving)
                ++this.counters.builtMainMoving
        }
    },
    dropped(out) {
        ++this.counters.dropped
        for (const [, bitmap] of out || [])
            bitmap?.close?.()
    }
}
