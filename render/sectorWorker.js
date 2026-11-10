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
// TASK-1565 rework: the queue measured in the worker's time: busy when the builds in flight would take it this many ms (by
// kind, the mean of its builds so far; SECTOR_WORKER_QUEUE_MS / SECTOR_WORKER_QUEUE each before any came back: the
// SECTOR_WORKER_QUEUE builds as before), and at SECTOR_WORKER_QUEUE_MAX builds whatever their time. With its canvases kept
// a lit tile is ~11 ms and a unit sector ~1 ms in the worker (artifacts/TASK-1565/preview), so a fixed 3 builds left it idle.
const SECTOR_WORKER_QUEUE_MS = 48
const SECTOR_WORKER_QUEUE_MAX = 12
// TASK-1570: THE QUEUE IN PRIORITY ORDER. Every build is posted at once with its rank (submit's priority: a function, lower
// first; null: cancel), and the worker, each time it is free, draws the queued build of the lowest rank (the oldest of equal
// ranks), so it never waits for the main thread. Each frame the board asks the ranks again (pump, through Grid's lit
// queue): the changed ones are sent ('rank'), and a build whose priority is null is cancelled ('rank' cancel: the worker drops
// it if it has not started it and answers 'cancelled'; the page then gives it up, onFail('cancelled'), counted in
// counters.cancelled). The board's lit tiles on the canvas go first, then the ring by when the camera reaches them; ring tiles
// the camera left behind are cancelled before they are drawn; unit sectors (no priority) rank 0.
// SECTOR_WORKER_SHOWN_MS / SECTOR_WORKER_SHOWN_MAX: busy(true), for a square on the canvas whose tile is missing (or that the
// camera reaches soon), lets the queue grow to this many ms of builds (and builds): the worker was idle ~80 % of the mobile
// capture's pan frames while the canvas's tiles waited, refilled once a frame at SECTOR_WORKER_QUEUE_MS
// (artifacts/TASK-1570/change.md).
const SECTOR_WORKER_SHOWN_MS = 160
const SECTOR_WORKER_SHOWN_MAX = 24
// TASK-1565: a worker whose median drawing time over its last SECTOR_WORKER_RATE_SAMPLES builds is over this many ms an op is
// slow (SectorWorker.noteRate: the main-thread path from then on). Offline a lit tile is ~0.05 ms an op in a Worker; on a
// software canvas next to a busy page 0.12-0.7 (the median of the first builds, artifacts/TASK-1564/change.md, TASK-1565 dev).
const SECTOR_WORKER_SLOW_MS_PER_OP = 0.08
const SECTOR_WORKER_RATE_SAMPLES = 8
// TASK-1565: the worker's kept target canvases (reused, worker side) at most this many bytes.
const SECTOR_WORKER_POOL_BYTES = 64 * 1024 * 1024

if (typeof importScripts === 'function' && typeof document === 'undefined' && typeof window === 'undefined') {
    // ---- worker side ----
    importScripts('sectorDraw.js')
    const sprites = new Map()
    let fontsReady = Promise.resolve()
    // TASK-1565: the target canvases are kept and reused (pool by size), and the pictures copied out with
    // createImageBitmap(canvas). On a software canvas (no GPU) the first draw on a new OffscreenCanvas - and on one whose
    // backing transferToImageBitmap took away - waits on the page's main-thread canvas work (~400 ms while the page draws,
    // artifacts/TASK-1565/probe/reuse-disable-gpu.json); a kept canvas draws at once. Each use starts from the default
    // state: save() before the runs, restore() back to it after (as many as the runs' unbalanced saves), a new path, cleared.
    const pool = new Map() // 'w x h' -> free canvases
    let pooledBytes = 0
    const take = (w, h) => {
        const free = pool.get(w + 'x' + h)
        if (free?.length) {
            pooledBytes -= w * h * 4
            return free.pop()
        }
        const canvas = new OffscreenCanvas(w, h)
        canvas.getContext('2d')
        return canvas
    }
    const give = canvas => {
        const bytes = canvas.width * canvas.height * 4
        if (pooledBytes + bytes > SECTOR_WORKER_POOL_BYTES)
            return
        const key = canvas.width + 'x' + canvas.height
        if (!pool.has(key))
            pool.set(key, [])
        pool.get(key).push(canvas)
        pooledBytes += bytes
    }
    const build = async m => {
        for (const [key, bitmap] of m.add)
            sprites.set(key, bitmap)
        const t0 = performance.now(), used = [], pending = []
        let ops = 0
        try {
            for (const target of m.targets) {
                const canvas = take(target.w, target.h), ctx = canvas.getContext('2d')
                used.push(canvas)
                ctx.clearRect(0, 0, target.w, target.h)
                ctx.beginPath()
                ctx.save()
                let saves = 0
                SectorDraw.drawSegs(ctx, target.segs, sprites)
                // (a whole lit tile's op draws over its quarters: counted once a quarter, as the quarters' recordings were, for
                // the slow test's ms an op, SECTOR_WORKER_SLOW_MS_PER_OP)
                const weight = target.crops ? target.crops.length : 1
                for (const seg of target.segs) {
                    ops += seg.o.length * weight
                    for (const op of seg.o)
                        saves += op[0] === 'save' ? 1 : op[0] === 'restore' ? -1 : 0
                }
                for (let k = Math.max(0, saves); k >= 0; --k)
                    ctx.restore()
                // TASK-1565 pass 6: a whole lit tile (Grid.litTileWhole) cut into its quarters ([k, x, y, w, h] each).
                if (target.crops)
                    for (const [k, x, y, w, h] of target.crops)
                        pending.push(createImageBitmap(canvas, x, y, w, h).then(bitmap => [k, bitmap]))
                else
                    pending.push(createImageBitmap(canvas).then(bitmap => [target.k, bitmap]))
            }
            const out = await Promise.all(pending)
            postMessage({t: 'built', id: m.id, out, ms: performance.now() - t0, ops, jumped: m.jumped || 0}, out.map(o => o[1]))
        } finally {
            for (const canvas of used)
                give(canvas)
        }
    }
    // TASK-1570: the builds waiting (queue), drawn one at a time, the lowest rank first (the oldest of equal ranks); jumped:
    // the queued builds of older ids a build was drawn before (counters.reordered on the page).
    const queue = []
    let running = false
    const runQueue = async () => {
        if (running)
            return
        running = true
        try {
            while (queue.length) {
                await fontsReady
                let best = 0
                for (let i = 1; i < queue.length; ++i)
                    if (queue[i].rank < queue[best].rank || queue[i].rank === queue[best].rank && queue[i].id < queue[best].id)
                        best = i
                const m = queue.splice(best, 1)[0]
                m.jumped = queue.reduce((n, o) => n + (o.id < m.id ? 1 : 0), 0)
                try {
                    await build(m)
                } catch (error) {
                    postMessage({t: 'failed', id: m.id, error: String(error?.stack || error)})
                }
            }
        } finally {
            running = false
        }
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
        // TASK-1570: new ranks for queued builds, and builds cancelled: dropped if not started (their sprites kept: the page
        // counts them sent), answered 'cancelled'.
        if (m.t === 'rank') {
            for (const [id, rank] of m.ranks || []) {
                const q = queue.find(b => b.id === id)
                if (q)
                    q.rank = rank
            }
            for (const id of m.cancel || []) {
                const k = queue.findIndex(b => b.id === id)
                if (k < 0)
                    continue
                const [b] = queue.splice(k, 1)
                for (const [key, bitmap] of b.add)
                    sprites.set(key, bitmap)
                postMessage({t: 'cancelled', id})
            }
            return
        }
        if (m.t === 'build') {
            // one build at a time (the pooled canvases are the build's until its pictures are copied out)
            if (!(typeof m.rank === 'number'))
                m.rank = 0
            queue.push(m)
            runQueue()
        }
    }
}

// ---- page side ----
// The content version of canvas sprites: every drawing call on a 2D context, and every size set, counts on its canvas
// (sectorDraws), so a sprite's key changes with its pixels (SectorRecorder.key). Installed when the worker starts (not in
// headless contexts or with the fallback).
// TASK-1565: the page's drawing calls since the wrapper was installed (sectorCountDraws).
let sectorDrawTotal = 0
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
            // TASK-1565: every drawing call of the page counted (Grid.frameCalls: the build-ahead budget's real calls).
            ++sectorDrawTotal
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
        spritesSent: 0, spritesDropped: 0, workerMs: 0, slow: 0, cancelled: 0, reordered: 0},
    // TASK-1565: the worker's recent drawing times (ms an op, the last SECTOR_WORKER_RATE_SAMPLES builds).
    rates: [],
    // Whether the builds go to the worker now (started on the first call).
    on() {
        if (this.state === 'on')
            return true
        if (this.state === 'failed' || this.state === 'slow' || !this.wanted())
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
    // Whether the builds in flight fill the queue (SECTOR_WORKER_QUEUE): the board starts no new sector
    // build then. TASK-1570: shown, a build for a square on the canvas: up to SECTOR_WORKER_SHOWN_MS / SECTOR_WORKER_SHOWN_MAX.
    busy(shown = false) {
        if (this.state !== 'on')
            return false
        if (this.inflight.size >= (shown ? SECTOR_WORKER_SHOWN_MAX : SECTOR_WORKER_QUEUE_MAX))
            return true
        let ms = 0
        for (const job of this.inflight.values())
            ms += this.kindMs(job.kind)
        return ms >= (shown ? SECTOR_WORKER_SHOWN_MS : SECTOR_WORKER_QUEUE_MS) - 1e-9
    },
    // TASK-1570: the ranks of the builds in flight asked again (their priority functions): the changed ones sent to the worker,
    // and those whose priority is null cancelled (the worker answers 'cancelled' for those it has not started). Through the
    // post chain, so a build's own message is in the worker first.
    pump() {
        if (!this.worker || this.state !== 'on' && this.state !== 'slow')
            return
        const ranks = [], cancel = []
        for (const job of this.inflight.values()) {
            if (!job.priority || job.cancelling)
                continue
            const p = job.priority()
            if (p === null || p === undefined) {
                job.cancelling = true
                cancel.push(job.id)
            }
            else if (p !== job.rank) {
                job.rank = p
                ranks.push([job.id, p])
            }
        }
        if (!ranks.length && !cancel.length)
            return
        this.chain = this.chain.then(() => this.worker?.postMessage({t: 'rank', ranks, cancel}))
    },
    // TASK-1570: a build the worker dropped before drawing it (pump's cancel): given up, not a failure of the worker.
    cancelled(id) {
        const job = this.inflight.get(id)
        if (!job)
            return
        this.finish(job)
        ++this.counters.cancelled
        const run = () => {
            job.onFail?.('cancelled')
            this.onDrain?.()
        }
        typeof gridTask === 'function' ? gridTask(run)() : run()
    },
    // TASK-1565 rework: a build's expected time in the worker (ms): the mean of its kind's builds so far.
    kindMs(kind) {
        const k = this.counters.byKind?.[kind]
        return k?.n ? k.ms / k.n : SECTOR_WORKER_QUEUE_MS / SECTOR_WORKER_QUEUE
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
    // TASK-1570: priority (optional): a function, lower first, null to cancel (pump); without one rank 0. The build is posted
    // with its rank now (a null one: last, Infinity; cancelled by the next pump if still null).
    submit(snapshot, sprites, onDone, onFail, priority = null) {
        const id = ++this.serial, keys = [...sprites.keys()]
        for (const key of keys) {
            const s = this.sprites.get(key)
            if (s) {
                ++s.refs
                s.last = ++this.use
            }
        }
        const p = priority ? priority() : 0
        const job = {id, onDone, onFail, keys, kind: snapshot.kind, priority, rank: p ?? Infinity}
        this.inflight.set(id, job)
        this.counters.depth = this.inflight.size
        this.counters.depthMax = Math.max(this.counters.depthMax, this.counters.depth)
        const targets = snapshot.targets.map(t => t.crops ? {k: t.k, w: t.w, h: t.h, segs: t.segs, crops: t.crops} :
            {k: t.k, w: t.w, h: t.h, segs: t.segs})
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
            if (!this.worker || !this.inflight.has(job.id))
                return
            s.bitmap = null
            s.sent = true
            add.push([key, bitmap])
            ++this.counters.spritesSent
        }
        if (!this.worker || !this.inflight.has(job.id))
            return
        const drops = this.pendingDrops
        this.pendingDrops = null
        if (drops?.length)
            this.worker.postMessage({t: 'drop', keys: drops})
        this.worker.postMessage({t: 'build', id: job.id, rank: job.rank, targets, add}, add.map(a => a[1]))
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
        if (m.t === 'cancelled') {
            this.cancelled(m.id)
            return
        }
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
        this.counters.reordered += m.jumped || 0
        this.counters.workerMs += m.ms || 0
        const by = this.counters.byKind ||= {}, k = by[job.kind] ||= {n: 0, ms: 0, ops: 0, max: 0}
        ++k.n
        k.ms += m.ms || 0
        k.ops += m.ops || 0
        k.max = Math.max(k.max, m.ms || 0)
        this.noteRate(m.ms, m.ops)
        const run = () => {
            job.onDone(m.out)
            this.onDrain?.()
        }
        typeof gridTask === 'function' ? gridTask(run)() : run()
    },
    // TASK-1565: SOFTWARE CANVAS DETECTION. Where the worker draws far slower than it can (the median of its last
    // SECTOR_WORKER_RATE_SAMPLES builds over SECTOR_WORKER_SLOW_MS_PER_OP ms an op: on a software canvas, --disable-gpu, a
    // worker's drawImage waits on the page's main-thread canvas work, ~0.7 ms an op against ~0.05 offline,
    // artifacts/TASK-1564/change.md), the builds go to the budgeted main-thread path from then on (state 'slow'; the builds in
    // flight still come back). Grid.sectorWorkerSlow false: never.
    noteRate(ms, ops) {
        if (!(ops > 0) || !(ms >= 0))
            return
        const r = this.rates
        r.push(ms / ops)
        if (r.length > SECTOR_WORKER_RATE_SAMPLES)
            r.shift()
        if (this.state !== 'on' || r.length < SECTOR_WORKER_RATE_SAMPLES || typeof Grid !== 'undefined' && Grid.sectorWorkerSlow === false)
            return
        const sorted = [...r].sort((a, b) => a - b), median = sorted[sorted.length >> 1]
        if (median <= SECTOR_WORKER_SLOW_MS_PER_OP)
            return
        this.state = 'slow'
        this.reason = 'slow: ' + median.toFixed(3) + ' ms an op'
        ++this.counters.slow
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
