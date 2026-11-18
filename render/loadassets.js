let assets = {
    size: 1.6 * basis.r,
    logo: new Image(),
    checkMark: new Image(),
    leftButton: new Image(),
    rightButton: new Image(),
    clock: new Image,
    i: new Image(),
    undo: new Image(),
    gold: new Image(),
    town: new Image(),
    farm: new Image(),
    noob: new Image(),
    archer: new Image(),
    archerLeft: new Image(),
    KOHb: new Image(),
    KOHbLeft: new Image(),
    normchel: new Image(),
    catapult: new Image(),
    catapultLeft: new Image(),
    barrack: new Image(),
    wall: new Image(),
    bastion: new Image(),
    tower: new Image(),
    mountain: new Image(),
    lake: new Image(),
    sea: new Image(),
    goldmine: new Image(),
    bush: new Image(),
    hill: new Image()
}
// Demon artwork is shared by both ordinary sprite themes.
const demonSpriteImages = ['imp', 'clawling', 'hound', 'houndLeft', 'brute', 'bulwark',
    'spitter', 'emberArcher', 'hexcaster', 'ravager', 'ravagerLeft', 'demonLord', 'bombard', 'bombardLeft', 'mortar', 'mortarLeft',
    'demonQueen',
    'demonPortalMelee', 'demonPortalRanged', 'demonPortalSiege',
    'demonPortalHeavy', 'demonPortalCavalry', 'demonPortalChaos', 'demonPortalMage']
for (const name of demonSpriteImages) assets[name] = new Image()
// Undead artwork for ordinary units owned by the demon slot, shared by both themes.
const undeadSpriteImages = ['undead/noob', 'undead/archer', 'undead/KOHb', 'undead/KOHbLeft',
    'undead/normchel', 'undead/catapult', 'undead/catapultLeft']
for (const name of undeadSpriteImages) assets[name] = new Image()
// Panel stat icons (row key -> entry: STAT_ICONS, render/staticons.js). The menu does not wait for them.
const statIconImages = Object.freeze({
    statHp: 'assets/icons/stat-hp.svg',
    statHealSpeed: 'assets/icons/stat-heal-speed.svg',
    statDmg: 'assets/icons/stat-dmg.svg',
    statBuildingDmg: 'assets/icons/stat-building-dmg.svg',
    statMoves: 'assets/icons/stat-moves.svg',
    statRange: 'assets/icons/stat-range.svg',
    statRangeIncrease: 'assets/icons/stat-range-increase.svg',
    statTarget: 'assets/icons/stat-target.svg',
    statSalary: 'assets/icons/stat-salary.svg',
    statCost: 'assets/icons/stat-cost.svg',
    statIncome: 'assets/icons/stat-income.svg',
    statGold: 'assets/icons/stat-gold.svg',
    statTurns: 'assets/icons/stat-turns.svg',
    statTrain: 'assets/icons/stat-train.svg',
    statCategory: 'assets/icons/stat-category.svg',
    statHighground: 'assets/icons/stat-highground.svg',
    statNoShoot: 'assets/icons/stat-no-shoot.svg',
    statNoStand: 'assets/icons/stat-no-stand.svg',
})
for (const name in statIconImages) assets[name] = new Image()
const atmosphericNatureImages = ['bush', 'hill', 'mountain', 'lake', 'sea']
// Semantic keys shared by board drawing and production previews. No draw-time filename inference.
const atmosphericBuildingImages = Object.freeze({
    town: 'assets/atmosphere/buildings/town.svg',
    farm: 'assets/atmosphere/buildings/farm.svg',
    barrack: 'assets/atmosphere/buildings/barrack.svg',
    wall: 'assets/atmosphere/buildings/wall.svg',
    bastion: 'assets/atmosphere/buildings/bastion.svg',
    tower: 'assets/atmosphere/buildings/tower.svg',
    goldmine: 'assets/atmosphere/buildings/goldmine.svg',
    demonPortalMelee: 'assets/atmosphere/buildings/demonPortalMelee.svg',
    demonPortalRanged: 'assets/atmosphere/buildings/demonPortalRanged.svg',
    demonPortalSiege: 'assets/atmosphere/buildings/demonPortalSiege.svg',
    demonPortalHeavy: 'assets/atmosphere/buildings/demonPortalHeavy.svg',
    demonPortalCavalry: 'assets/atmosphere/buildings/demonPortalCavalry.svg',
    demonPortalChaos: 'assets/atmosphere/buildings/demonPortalChaos.svg',
    demonPortalMage: 'assets/atmosphere/buildings/demonPortalMage.svg',
})
let imagesCountLoaded = 0
let spriteImages = ['town', 'farm', 'noob', 'archer', 'archerLeft',
        'KOHb', 'KOHbLeft', 'normchel', 
        'catapult', 'catapultLeft', 'barrack', 'wall', 'bastion', 'tower',
        'mountain', 'lake', 'sea', 'goldmine', 'bush', 'hill'].concat(demonSpriteImages, undeadSpriteImages)
let images = spriteImages.slice()
// Images whose last request failed: they still count as loaded (so games can start) and are cached as a blank placeholder.
let failedImages = new Set()
for (let i = 0; i < images.length; ++i) {
    assets[images[i]].onload = function() {
        failedImages.delete(images[i])
        spriteLoadDone(images[i])
        // TASK-1669: until the game sprites are first settled, the cache is painted in idle pieces (queueSpriteCache).
        if (spriteCacheDeferred()) {
            queueSpriteCache(images[i])
            return
        }
        spriteCached(images[i], cacheImage(images[i]))
    }
    assets[images[i]].onerror = function() {
        // A missing optional variant must not become a blank sprite.
        if (assets[images[i]].src.includes('/atmosphere/nature/') ||
                assets[images[i]].src.includes('/atmosphere/buildings/')) {
            assets[images[i]].src = 'assets/sprites/' + images[i] + '.svg'
            return
        }
        console.error('failed to load asset ' + images[i] + ': ' + assets[images[i]].src)
        spriteLoadDone(images[i])
        failedImages.add(images[i])
        ++imagesCountLoaded
        cachedImages[images[i]] = cacheImage(images[i])
        settleGameSprites()
    }
}

// TASK-1649: the sprite outline is drawn by the game, not baked into the asset files: a crisp #1E0F06 line of
// OUTLINE_WIDTH_FRAC of the drawn sprite size (1.5 px at 128, 2.6 px at 219, 21.4 px at 911) under the art of every
// polished unit body and demon portal, painted once per cache paint (board cache, so the team-colour variants inherit
// it; the unit panel portrait at its own size). Buildings, nature, spritesOld/ and undead/ get none.
const OUTLINE_WIDTH_FRAC = 6 / 512
const OUTLINE_COLOUR = Object.freeze({r: 0x1E, g: 0x0F, b: 0x06})
const OUTLINED = Object.freeze(['noob', 'archer', 'archerLeft', 'KOHb', 'KOHbLeft', 'normchel', 'catapult', 'catapultLeft',
    'imp', 'clawling', 'hound', 'houndLeft', 'brute', 'bulwark', 'spitter', 'emberArcher', 'hexcaster', 'ravager',
    'ravagerLeft', 'demonLord', 'bombard', 'bombardLeft', 'mortar', 'mortarLeft', 'demonQueen',
    'demonPortalMelee', 'demonPortalRanged', 'demonPortalSiege', 'demonPortalHeavy', 'demonPortalCavalry',
    'demonPortalChaos', 'demonPortalMage'])
function spriteOutlined(name) {
    return otherSettings.usePolishedSprites && OUTLINED.includes(name)
}
// 1D squared distance transform (Felzenszwalb and Huttenlocher) of f[0..n) into d, with scratch v and z.
function outlineDistance1d(f, n, d, v, z) {
    let k = 0
    v[0] = 0
    z[0] = -Infinity
    z[1] = Infinity
    for (let q = 1; q < n; ++q) {
        if (f[q] === Infinity)
            continue
        if (f[v[k]] === Infinity) {
            v[k] = q
            continue
        }
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        while (s <= z[k]) {
            --k
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        }
        ++k
        v[k] = q
        z[k] = s
        z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < n; ++q) {
        while (z[k + 1] < q)
            ++k
        d[q] = f[v[k]] === Infinity ? Infinity : (q - v[k]) * (q - v[k]) + f[v[k]]
    }
}
// Paints the outline under the art already on canvas (size: the drawn sprite size): each pixel gets the outline colour
// with the coverage of a band of the given width around the silhouette (alpha >= 128), from its exact Euclidean
// distance to the silhouette (about 1 px of anti-aliasing, no blur), and the art is composited over it (source-over).
// Opaque art pixels are unchanged.
function paintSpriteOutline(canvas, size) {
    finishSteps(paintSpriteOutlineSteps(canvas, size))
}
// TASK-1669: a generator's pieces run through (the work as it was before it was split).
function finishSteps(steps) {
    for (;;) {
        const step = steps.next()
        if (step.done)
            return step.value
    }
}
// TASK-1669: pixels of the outline's distance passes a piece (paintSpriteOutlineSteps yields after about as many).
const OUTLINE_STEP_PIXELS = 16384
// paintSpriteOutline's work in pieces (a yield after the pixels are read, after each OUTLINE_STEP_PIXELS of either
// distance pass): the same operations in the same order, so the same pixels. viaWorker (the queued sprite caches,
// runSpriteCache): the band is computed by the outline worker (outlineWorkerPost: the same code), the generator yielding
// SPRITE_CACHE_WAIT until it is back; without a worker (or after a worker error) it is computed here in pieces.
function* paintSpriteOutlineSteps(canvas, size, viaWorker = false) {
    const width = canvas.width, height = canvas.height, ctx = canvas.getContext('2d')
    const w = OUTLINE_WIDTH_FRAC * size
    if (!ctx || !width || !height || !(w > 0))
        return
    const data = ctx.getImageData(0, 0, width, height), px = data.data
    const n = width * height, alphaOf = () => {
        const alpha = new Uint8Array(n)
        for (let i = 0; i < n; ++i)
            alpha[i] = px[i * 4 + 3]
        return alpha
    }
    let found = null
    if (viaWorker) {
        const reply = {}
        // The alpha posted is transferred to the worker (a failed worker's band is computed from a new copy below).
        if (outlineWorkerPost(alphaOf(), width, height, w, reply)) {
            yield SPRITE_CACHE_WAIT
            while (!reply.band && !reply.failed)
                yield SPRITE_CACHE_WAIT
            found = reply.band || null
        }
    }
    if (!found) {
        yield
        found = yield* outlineBandSteps(alphaOf(), width, height, w)
    }
    // The band: the pixels the outline shows under (not opaque, coverage > 0), with their art before the outline,
    // kept on the canvas (spriteOutline) so the team-colour variants recolour the art alone (compositeSpriteOutline).
    const band = {index: found.index, coverage: found.coverage, art: new Uint8ClampedArray(found.index.length * 4)}
    for (let k = 0; k < band.index.length; ++k)
        band.art.set(px.subarray(band.index[k] * 4, band.index[k] * 4 + 4), k * 4)
    compositeSpriteOutline(px, band)
    canvas.spriteOutline = band
    ctx.putImageData(data, 0, 0)
}
// The outline band of a sprite of the given alpha (width x height) and outline width w: the pixels not opaque whose
// coverage is above 0 (index) and that coverage, from each pixel's exact Euclidean distance to the silhouette (alpha >=
// 128). In pieces (a yield after each OUTLINE_STEP_PIXELS of either distance pass). Self-contained but for
// outlineDistance1d and OUTLINE_STEP_PIXELS: the outline worker runs this same source (outlineWorkerSource).
function* outlineBandSteps(alpha, width, height, w) {
    const n = width * height, grid = new Float64Array(n)
    for (let i = 0; i < n; ++i)
        grid[i] = alpha[i] >= 128 ? 0 : Infinity
    const len = Math.max(width, height)
    const f = new Float64Array(len), d = new Float64Array(len), v = new Int32Array(len), z = new Float64Array(len + 1)
    const columns = Math.max(1, Math.floor(OUTLINE_STEP_PIXELS / height)), rows = Math.max(1, Math.floor(OUTLINE_STEP_PIXELS / width))
    for (let x = 0; x < width; ++x) {
        for (let y = 0; y < height; ++y) f[y] = grid[y * width + x]
        outlineDistance1d(f, height, d, v, z)
        for (let y = 0; y < height; ++y) grid[y * width + x] = d[y]
        if ((x + 1) % columns === 0)
            yield
    }
    for (let y = 0; y < height; ++y) {
        const row = y * width
        for (let x = 0; x < width; ++x) f[x] = grid[row + x]
        outlineDistance1d(f, width, d, v, z)
        for (let x = 0; x < width; ++x) grid[row + x] = d[x]
        if ((y + 1) % rows === 0)
            yield
    }
    let count = 0
    for (let i = 0; i < n; ++i)
        if (alpha[i] !== 255 && w + 1 - Math.sqrt(grid[i]) > 0)
            ++count
    const index = new Int32Array(count), coverage = new Float32Array(count)
    for (let i = 0, k = 0; i < n; ++i) {
        if (alpha[i] === 255)
            continue
        // Pixel centre to silhouette edge is the distance to the nearest silhouette pixel centre less half a pixel.
        const c = Math.min(1, w + 1 - Math.sqrt(grid[i]))
        if (!(c > 0))
            continue
        index[k] = i
        coverage[k] = c
        ++k
    }
    return {index, coverage}
}
// TASK-1669: the outline worker: a Worker running outlineBandSteps (its source, with outlineDistance1d's, as a Blob), so
// the queued sprite caches' distance passes (most of a cache's 50-130 ms) leave the main thread. 'off' until first
// asked, then 'on', or 'failed' (no Worker/Blob, a start or worker error: the bands are computed on the main thread).
const outlineWorker = {state: 'off', worker: null, next: 0, pending: new Map()}
function outlineWorkerMain(e) {
    const {id, alpha, width, height, w} = e.data
    const band = finishSteps(outlineBandSteps(alpha, width, height, w))
    postMessage({id, index: band.index, coverage: band.coverage}, [band.index.buffer, band.coverage.buffer])
}
function outlineWorkerSource() {
    return [outlineDistance1d, finishSteps, outlineBandSteps].map(f => f.toString()).join('\n') +
        `\nconst OUTLINE_STEP_PIXELS = ${OUTLINE_STEP_PIXELS}\nonmessage = ${outlineWorkerMain.toString()}\n`
}
function outlineWorkerFail() {
    outlineWorker.state = 'failed'
    try {
        outlineWorker.worker?.terminate()
    } catch (e) {}
    outlineWorker.worker = null
    for (const reply of outlineWorker.pending.values())
        reply.failed = true
    outlineWorker.pending.clear()
    spriteCacheWake()
}
// Posts a band to compute; reply.band is set when it is back (reply.failed on a worker error). False: no worker.
function outlineWorkerPost(alpha, width, height, w, reply) {
    if (outlineWorker.state === 'off') {
        try {
            if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL === 'undefined' ||
                    typeof URL.createObjectURL !== 'function')
                throw new Error('no worker')
            const url = URL.createObjectURL(new Blob([outlineWorkerSource()], {type: 'application/javascript'}))
            const worker = new Worker(url)
            worker.onmessage = e => {
                const reply = outlineWorker.pending.get(e.data.id)
                outlineWorker.pending.delete(e.data.id)
                if (reply)
                    reply.band = {index: e.data.index, coverage: e.data.coverage}
                spriteCacheWake()
            }
            worker.onerror = () => outlineWorkerFail()
            outlineWorker.worker = worker
            outlineWorker.state = 'on'
        } catch (e) {
            outlineWorker.state = 'failed'
        }
    }
    if (outlineWorker.state !== 'on')
        return false
    const id = ++outlineWorker.next
    outlineWorker.pending.set(id, reply)
    outlineWorker.worker.postMessage({id, alpha, width, height, w}, [alpha.buffer])
    return true
}
// Puts each band pixel of px (straight-alpha RGBA) over the outline colour at the band's coverage (source-over).
function compositeSpriteOutline(px, band) {
    const {r, g, b} = OUTLINE_COLOUR
    for (let k = 0; k < band.index.length; ++k) {
        const j = band.index[k] * 4, sa = px[j + 3] / 255, oa = band.coverage[k] * (1 - sa), ra = sa + oa
        px[j] = Math.round((px[j] * sa + r * oa) / ra)
        px[j + 1] = Math.round((px[j + 1] * sa + g * oa) / ra)
        px[j + 2] = Math.round((px[j + 2] * sa + b * oa) / ra)
        px[j + 3] = Math.round(ra * 255)
    }
}
function cacheImage(image) {
    return finishSteps(cacheImageSteps(image))
}
// cacheImage's work in pieces (paintCachedImageSteps), returning the cache canvas.
function* cacheImageSteps(image, viaWorker = false) {
    let tmpCanvas = document.createElement('canvas')
    yield* paintCachedImageSteps(tmpCanvas, image, viaWorker)
    if (!tabCanary)
        paintTabCanary()
    // The browser may drop an offscreen canvas backing store (backgrounded mobile tab).
    if (typeof tmpCanvas.addEventListener == 'function') {
        tmpCanvas.addEventListener('contextlost', imageCacheContextLost)
        tmpCanvas.addEventListener('contextrestored', restoreImageCaches)
    }

    return tmpCanvas
}
function paintCachedImage(tmpCanvas, image) {
    finishSteps(paintCachedImageSteps(tmpCanvas, image))
}
// paintCachedImage's work in pieces: the raster, then the outline's (paintSpriteOutlineSteps).
function* paintCachedImageSteps(tmpCanvas, image, viaWorker = false) {
    let width = assets.size
    let height = assets.size

    tmpCanvas.width = width
    tmpCanvas.height = height

    let tmpCtx = tmpCanvas.getContext('2d')

    let pos = {
        x: width / 2,
        y: height / 2
    }
    tmpCanvas.spriteOutline = null
    if (!failedImages.has(image)) {
        drawImage(tmpCtx, image, pos, width, height) // TASK-1666: direct raster again (TASK-1606's 4x chain reverted)
        if (spriteOutlined(image)) {
            yield
            yield* paintSpriteOutlineSteps(tmpCanvas, width, viaWorker)
        }
    }
    // TASK-1669: what the cache was painted from (settleGameSprites repaints only a cache whose key changed since).
    tmpCanvas.spriteKey = spriteCacheKey(image)
    tmpCanvas.contentVersion = (tmpCanvas.contentVersion || 0) + 1 // TASK-1554 (InterfaceRecorder)
}
// Repaints the existing cached canvases in place, so the grid surface cache image refs
// stay valid, then makes the next frame rebuild the surface cache.
function restoreImageCaches() {
    imageCacheLossSeen = false
    atmosphericBackground.invalidate()
    // TASK-1554: the interface's cache is drawn again (InterfaceLayer).
    if (typeof interfaceLayer != 'undefined' && interfaceLayer)
        interfaceLayer.cached = null
    for (const name in cachedImages) {
        const image = assets[name]
        if (cachedImages[name] && image && image.complete && image.naturalWidth > 0)
            paintCachedImage(cachedImages[name], name)
    }
    rebuildTeamColourImages()
    if (typeof grid != 'undefined' && grid) {
        grid.surfaceCacheState = undefined
        // TASK-1562: the unit sectors were drawn from the lost sprites (kept across zooms now).
        grid.clearUnitSectors?.('images')
    }
    restoreCameraTransform()
    paintTabCanary()
}
// A lost context's canvas: its caches are repainted on the next frame (as before), and a tab return before that frame
// repaints them too (imageCacheLossSeen).
let imageCacheLossSeen = false
function imageCacheContextLost() {
    imageCacheLossSeen = true
    requestAnimationFrame(restoreImageCaches)
}
// TASK-1665: the tab-return canary. A phone may wipe a backgrounded tab's canvases (TASK-569), but most tab switches
// lose nothing, and rebuilding every sprite cache and the board on each return showed the grey ground for seconds. The
// canary is a canvas made like the sprite caches (same size, painted opaque with the first of them and again by every
// cacheAllImages and restore), so a wipe that empties them empties it too; on return it is read back through a 1x1
// probe (drawImage, so the canary itself is never read with getImageData and keeps the sprite caches' backing).
// Intact: nothing was lost, nothing is rebuilt. Wiped (or no canary yet): restoreImageCaches as before.
// contextlost/contextrestored keep their own restore.
const TAB_CANARY_COLOUR = Object.freeze([255, 0, 255])
let tabCanary = null, tabCanaryProbe = null
function paintTabCanary() {
    if (typeof document.createElement != 'function')
        return
    if (!tabCanary)
        tabCanary = document.createElement('canvas')
    tabCanary.width = tabCanary.height = assets.size || 128
    const ctx = tabCanary.getContext && tabCanary.getContext('2d')
    if (!ctx)
        return
    ctx.fillStyle = `rgb(${TAB_CANARY_COLOUR.join(',')})`
    ctx.fillRect(0, 0, tabCanary.width, tabCanary.height)
}
function tabCanaryIntact() {
    if (!tabCanary || !tabCanary.width || !tabCanary.height)
        return false
    try {
        if (!tabCanaryProbe) {
            tabCanaryProbe = document.createElement('canvas')
            tabCanaryProbe.width = tabCanaryProbe.height = 1
        }
        const ctx = tabCanaryProbe.getContext('2d', {willReadFrequently: true})
        ctx.clearRect(0, 0, 1, 1)
        const c = Math.floor(tabCanary.width / 2)
        ctx.drawImage(tabCanary, c, c, 1, 1, 0, 0, 1, 1)
        const px = ctx.getImageData(0, 0, 1, 1).data
        return px[3] === 255 && TAB_CANARY_COLOUR.every((v, i) => Math.abs(px[i] - v) <= 2)
    } catch (e) {
        return false
    }
}
function restoreImageCachesIfWiped() {
    if (imageCacheLossSeen || !tabCanaryIntact())
        restoreImageCaches()
}
// A restored main context comes back with the identity transform, and events/screen.js only ever
// applies the camera incrementally (translate/scale), so set it again from canvas.scale and offset.
function restoreCameraTransform() {
    if (typeof mainCtx == 'undefined' || typeof canvas == 'undefined' || !canvas)
        return
    mainCtx.setTransform(canvas.scale, 0, 0, canvas.scale,
        -canvas.offset.x * canvas.scale, -canvas.offset.y * canvas.scale)
}
if (typeof document.addEventListener == 'function') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState == 'visible')
            restoreImageCachesIfWiped()
    })
}
if (typeof window.addEventListener == 'function')
    window.addEventListener('pageshow', () => restoreImageCachesIfWiped())
function cacheAllImages() {
    for (let i = 0; i < images.length; ++i) {
        cachedImages[images[i]] = cacheImage(images[i])
    }
    paintTabCanary()
}
// TASK-1669: what a sprite cache is painted from: the image's source, whether it failed, its outline and the size.
function spriteCacheKey(name) {
    return `${assets[name]?.src}|${failedImages.has(name)}|${spriteOutlined(name)}|${assets.size}`
}
// cacheAllImages for the caches not painted from what they would be now (missing, or the image, its failure, the
// outline or the size changed since): the sprites settle without painting every cache a second time (each was painted
// when its image loaded, the same pixels).
function cacheStaleImages() {
    for (let i = 0; i < images.length; ++i)
        if (!cachedImages[images[i]] || cachedImages[images[i]].spriteKey !== spriteCacheKey(images[i]))
            cachedImages[images[i]] = cacheImage(images[i])
    paintTabCanary()
}
// A sprite's cache is ready (painted at its load, or by its queued pieces): it counts as loaded, and the board's
// surface cache is drawn again for the atmospheric nature and buildings.
function spriteCached(name, canvas) {
    ++imagesCountLoaded
    cachedImages[name] = canvas
    settleGameSprites()
    if ((atmosphericNatureImages.includes(name) || atmosphericBuildingImages[name]) && typeof grid != 'undefined' && grid)
        grid.surfaceCacheState = undefined
}
// TASK-1669: the game sprites load behind the menu (waitForImagesLoad); painting each cache (its raster and outline,
// 50-130 ms) in its load event held a menu frame per sprite. Until they first settle, a loaded sprite's cache is
// painted in pieces (cacheImageSteps, the outline's distance passes in the outline worker) in idle callbacks instead:
// SPRITE_CACHE_STEP_MS of pieces a callback (one at least; all there are while a game entry waits for them,
// whenGameSpritesReady). A sprite counts as loaded (imagesCountLoaded) when its cache is ready, so the sprites settle
// as before, once every cache is painted.
const SPRITE_CACHE_STEP_MS = 12
// What a cache's pieces yield while the outline worker computes its band (the job waits, spriteCacheWake resumes it).
const SPRITE_CACHE_WAIT = 'spriteCacheWait'
const spriteCacheJobs = []
let spriteCacheScheduled = false
function spriteCacheDeferred() {
    return !gameSpritesLoaded && typeof requestIdleCallback == 'function' && typeof document.createElement == 'function'
}
function queueSpriteCache(name) {
    spriteCacheJobs.push({name, steps: null, waiting: false})
    scheduleSpriteCache()
}
function spriteCacheWake() {
    for (const job of spriteCacheJobs)
        job.waiting = false
    scheduleSpriteCache()
}
function scheduleSpriteCache() {
    if (spriteCacheScheduled || !spriteCacheJobs.some(job => !job.waiting))
        return
    spriteCacheScheduled = true
    requestIdleCallback(runSpriteCache, {timeout: 50})
}
function runSpriteCache(deadline) {
    spriteCacheScheduled = false
    const start = performance.now()
    const budget = deadline.didTimeout ? SPRITE_CACHE_STEP_MS : Math.min(SPRITE_CACHE_STEP_MS, Math.max(4, deadline.timeRemaining()))
    for (;;) {
        const job = spriteCacheJobs.find(job => !job.waiting)
        if (!job)
            return
        job.steps ??= cacheImageSteps(job.name, true)
        const step = job.steps.next()
        if (step.done) {
            spriteCacheJobs.splice(spriteCacheJobs.indexOf(job), 1)
            // A size changed meanwhile: painted again at the size now.
            spriteCached(job.name, step.value.spriteKey === spriteCacheKey(job.name) ? step.value : cacheImage(job.name))
        } else if (step.value === SPRITE_CACHE_WAIT)
            job.waiting = true
        if (!gameSpritesWaiting && performance.now() - start >= budget)
            break
    }
    scheduleSpriteCache()
}
let cachedImages = {}

// TASK-1593: player-colour cloth variants of the polished player units. The polished art paints its cloth in fixed
// colours (noob, archer red; normchel, KOHb blue); a variant moves those cloth pixels to the player's hue, keeping
// their luminance, relative saturation and alpha, and leaves every other pixel (gold, iron, skin, leather, outline)
// as it is. Built from the cached base canvas (no extra SVG raster), never for spritesOld, undead/ or demon images.
const TEAM_COLOUR_IMAGES = Object.freeze(['noob', 'archer', 'archerLeft', 'normchel', 'KOHb', 'KOHbLeft'])
// name -> Map(rgb integer -> variant canvas). Keys are integers, so a lookup allocates nothing.
const teamColourVariants = new Map(TEAM_COLOUR_IMAGES.map(name => [name, new Map()]))
let teamColourBuilds = 0
// The cached image to draw for a unit body of the given owner colour ({r, g, b}): the variant for the polished
// player units, else cachedImages[name]. Per-frame path: integer key, Map lookups, no allocation once built.
function teamColourImage(name, rgb) {
    const base = cachedImages[name]
    const variants = teamColourVariants.get(name)
    if (!variants || !base || !rgb || !otherSettings.usePolishedSprites || failedImages.has(name))
        return base
    const key = (rgb.r << 16) | (rgb.g << 8) | rgb.b
    let variant = variants.get(key)
    if (variant === undefined) {
        variant = document.createElement('canvas')
        variant.rgbKey = key
        if (typeof variant.addEventListener == 'function') {
            variant.addEventListener('contextlost', imageCacheContextLost)
            variant.addEventListener('contextrestored', restoreImageCaches)
        }
        variants.set(key, variant)
    }
    // A new base canvas (sprites reloaded, theme switch), a repainted one (context loss: contentVersion) or a
    // changed assets.size rebuilds the variant in place, so references to it stay valid.
    if (variant.base !== base || variant.baseVersion !== base.contentVersion || variant.width !== base.width)
        paintTeamColourImage(variant, base, key, name)
    return variant
}
// TASK-1632: whether teamColourImage(name, rgb) would build its variant now (the menu builds the variants ahead).
function teamColourVariantMissing(name, rgb) {
    const base = cachedImages[name], variants = teamColourVariants.get(name)
    if (!variants || !base || !rgb || !otherSettings.usePolishedSprites || failedImages.has(name))
        return false
    const variant = variants.get((rgb.r << 16) | (rgb.g << 8) | rgb.b)
    return !variant || variant.base !== base || variant.baseVersion !== base.contentVersion || variant.width !== base.width
}
// TASK-1594: the player-colour variant at a given pixel size, rasterized from the SVG (the unit panel's portrait is
// drawn larger than the board's cached sprites): null when the board's image would be drawn as it is (not a polished
// player unit, polished sprites off, no colour, image not loaded). One kept per slot: the name by default (the panel
// shows one unit); the menu passes its own slot per picture (TASK-1595: tutorial cards, the hot seat faceoff's red and
// blue swordsmen), so pictures drawn in the same frame do not repaint each other.
const teamColourPortraits = new Map()
function teamColourPortrait(name, rgb, size, slot = name) {
    return finishSteps(teamColourPortraitSteps(name, rgb, size, slot))
}
// TASK-1669: teamColourPortrait's work in pieces (the raster, the outline's pieces, the recolour), so the menu builds its
// pictures' portraits ahead (menuWarmSteps), viaWorker: the outline's band in the outline worker (paintSpriteOutlineSteps).
function* teamColourPortraitSteps(name, rgb, size, slot = name, viaWorker = false) {
    const image = assets[name]
    if (!teamColourVariants.has(name) || !rgb || !otherSettings.usePolishedSprites || failedImages.has(name) ||
            !image || !image.complete || !image.naturalWidth)
        return null
    size = Math.max(1, Math.round(size))
    const key = (rgb.r << 16) | (rgb.g << 8) | rgb.b, src = image.src
    const kept = teamColourPortraits.get(slot)
    if (kept && kept.key === key && kept.size === size && kept.src === src && kept.name === name)
        return kept.canvas
    const base = document.createElement('canvas')
    base.width = base.height = size
    base.getContext('2d').drawImage(image, 0, 0, size, size)
    if (spriteOutlined(name)) {
        yield
        yield* paintSpriteOutlineSteps(base, size, viaWorker)
        yield
    }
    // Kept again: another portrait of the slot may have been kept meanwhile (its canvas is repainted in place).
    const now = teamColourPortraits.get(slot)
    const canvas = now ? now.canvas : document.createElement('canvas')
    paintTeamColourImage(canvas, base, key, name)
    teamColourPortraits.set(slot, {name, key, size, src, canvas})
    return canvas
}
// Repaints every built variant from its (repainted) base; restoreImageCaches calls it after a context loss.
function rebuildTeamColourImages() {
    for (const [name, variants] of teamColourVariants) {
        const base = cachedImages[name]
        if (!base || failedImages.has(name))
            continue
        for (const [key, variant] of variants)
            paintTeamColourImage(variant, base, key, name)
    }
}
// Cloth classes of the polished art (artifacts/concepts/units_concept_style/concept_art/ranged_demons/vsvg.py
// unit_recolored): red cloth hue < 0.045 or > 0.93 with saturation > 0.45 (and max channel > 0.12), blue cloth
// 0.55 < hue < 0.75 with saturation > 0.35. Hue in [0, 1), HSV saturation.
function teamColourIsCloth(h, s, mx) {
    return ((h < 0.045 || h > 0.93) && s > 0.45 && mx > 0.12) || (h > 0.55 && h < 0.75 && s > 0.35)
}
// TASK-1644: the GPT archer's bow is painted in the same reds as its hood and cloak, and the cloth's lit patches are
// orange, so its cloth is classified by region: a red or orange pixel (hue < hmax or > 0.93, saturation > 0.45, max
// channel > 0.12) is cloth only inside a cloth region, with that region's hue limit (0.075 hood and cloak, 0.1 the
// pale lit patch on the hood's crown, 0.03 the face opening: hood shadows only, not skin or hair). Polygons in
// sprite fractions of the archer (artwork facing right); archerLeft is its exact mirror. No blue rule.
const TEAM_COLOUR_REGIONS = Object.freeze({
    archer: Object.freeze({
        regions: [
            {hmax: 0.075, poly: [[0.39, 0.12], [0.45, 0.05], [0.55, 0.04], [0.63, 0.08], [0.68, 0.18], [0.68, 0.26],
                [0.71, 0.30], [0.75, 0.38], [0.77, 0.45], [0.77, 0.50], [0.70, 0.50], [0.68, 0.47], [0.62, 0.43],
                [0.55, 0.40], [0.47, 0.40], [0.40, 0.42], [0.35, 0.40], [0.32, 0.36], [0.33, 0.32], [0.37, 0.27],
                [0.38, 0.18]]},
            {hmax: 0.075, poly: [[0.62, 0.43], [0.68, 0.45], [0.77, 0.47], [0.77, 0.62], [0.70, 0.68], [0.64, 0.66],
                [0.63, 0.55]]},
            {hmax: 0.1, poly: [[0.42, 0.10], [0.45, 0.055], [0.52, 0.045], [0.52, 0.10], [0.46, 0.12]]},
        ],
        // Overrides the regions above where it applies.
        face: {hmax: 0.03, poly: [[0.42, 0.22], [0.45, 0.17], [0.53, 0.155], [0.61, 0.17], [0.645, 0.22],
            [0.63, 0.28], [0.56, 0.31], [0.48, 0.31], [0.43, 0.28]]},
    }),
})
const TEAM_COLOUR_REGION_OF = Object.freeze({archer: {art: 'archer', mirror: false}, archerLeft: {art: 'archer', mirror: true}})
function teamColourInPolygon(poly, x, y) {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[j]
        if ((y1 > y) != (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1)
            inside = !inside
    }
    return inside
}
// Per pixel hue limit of a region-classified image (0 = never cloth), or null for the colour-only rule.
// TASK-1655: kept per name and size (a pure function of them: every owner colour's variant of a sprite reads the same
// limits), and each row's polygon edge crossings found once (teamColourRowCrossings: the same expression and comparison as
// teamColourInPolygon, so the same pixels inside), not every polygon edge tested for every pixel (~110 ms an archer
// variant on this host, inside the start's first held frames).
const teamColourLimitsKept = new Map()
function teamColourRegionLimits(name, width, height) {
    const of = name && TEAM_COLOUR_REGION_OF[name]
    if (!of)
        return null
    const memo = name + '|' + width + 'x' + height
    const kept = teamColourLimitsKept.get(memo)
    if (kept)
        return kept
    const art = TEAM_COLOUR_REGIONS[of.art]
    const limits = new Float32Array(width * height)
    for (let y = 0; y < height; ++y) {
        const fy = (y + 0.5) / height
        const face = teamColourRowCrossings(art.face.poly, fy)
        const regions = art.regions.map(region => teamColourRowCrossings(region.poly, fy))
        if (!face.length && regions.every(c => !c.length))
            continue
        for (let x = 0; x < width; ++x) {
            const fx = of.mirror ? 1 - (x + 0.5) / width : (x + 0.5) / width
            let hmax = 0
            if (teamColourCrossed(face, fx))
                hmax = art.face.hmax
            else for (let k = 0; k < regions.length; ++k)
                if (teamColourCrossed(regions[k], fx))
                    hmax = Math.max(hmax, art.regions[k].hmax)
            limits[y * width + x] = hmax
        }
    }
    teamColourLimitsKept.set(memo, limits)
    return limits
}
// TASK-1655: the x of each edge of poly the row at y crosses (teamColourInPolygon's test and value, in its edge order).
function teamColourRowCrossings(poly, y) {
    const out = []
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[j]
        if ((y1 > y) != (y2 > y))
            out.push((x2 - x1) * (y - y1) / (y2 - y1) + x1)
    }
    return out
}
// TASK-1655: teamColourInPolygon(poly, x, y) from the row's crossings: inside when x is left of an odd number of them.
function teamColourCrossed(crossings, x) {
    let inside = false
    for (let k = 0; k < crossings.length; ++k)
        if (x < crossings[k])
            inside = !inside
    return inside
}
function teamColourIsRegionCloth(h, s, mx, hmax) {
    return hmax > 0 && (h < hmax || h > 0.93) && s > 0.45 && mx > 0.12
}
function teamColourHsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    let h = 0
    if (d > 0)
        h = (mx == r ? ((g - b) / d + 6) % 6 : mx == g ? (b - r) / d + 2 : (r - g) / d + 4) / 6
    return [h, mx > 0 ? d / mx : 0, mx]
}
function paintTeamColourImage(variant, base, key, name) {
    const width = base.width, height = base.height
    variant.width = width
    variant.height = height
    variant.base = base
    variant.baseVersion = base.contentVersion
    ++teamColourBuilds
    if (!width || !height)
        return
    const data = base.getContext('2d').getImageData(0, 0, width, height)
    const px = data.data
    // TASK-1649: an outlined base: recolour the art under the outline band, then put the outline back under it.
    const band = base.spriteOutline
    if (band)
        for (let k = 0; k < band.index.length; ++k)
            px.set(band.art.subarray(k * 4, k * 4 + 4), band.index[k] * 4)
    const pr = ((key >> 16) & 255) / 255, pg = ((key >> 8) & 255) / 255, pb = (key & 255) / 255
    const [ph, ps] = teamColourHsv(pr, pg, pb)
    // The player's colour at full value: the cloth hue target (r, g, b sum to its own luminance below).
    const [hr, hg, hb] = teamColourFromHsv(ph, 1, 1)
    // Mean cloth saturation of the base: a cloth pixel keeps its saturation relative to it.
    const limits = teamColourRegionLimits(name, width, height)
    const isCloth = (i, h, s, mx) => limits ? teamColourIsRegionCloth(h, s, mx, limits[i >> 2]) : teamColourIsCloth(h, s, mx)
    let clothSat = 0, cloth = 0
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] == 0) continue
        const [h, s, mx] = teamColourHsv(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255)
        if (isCloth(i, h, s, mx)) { clothSat += s; ++cloth }
    }
    const satScale = cloth ? ps / (clothSat / cloth) : 0
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] == 0) continue
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
        const [h, s, mx] = teamColourHsv(r, g, b)
        if (!isCloth(i, h, s, mx)) continue
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        const sat = Math.min(1, s * satScale)
        // Grey of the pixel's luminance mixed toward the hue colour by sat, scaled to keep the luminance; when a
        // channel would pass 1 the mix is pulled back toward the grey (same hue and luminance, less saturation).
        let cr = 1 - sat + sat * hr, cg = 1 - sat + sat * hg, cb = 1 - sat + sat * hb
        const cl = 0.299 * cr + 0.587 * cg + 0.114 * cb
        cr *= lum / cl; cg *= lum / cl; cb *= lum / cl
        const over = Math.max(cr, cg, cb)
        if (over > 1) {
            const t = (1 - lum) / (over - lum)
            cr = lum + (cr - lum) * t; cg = lum + (cg - lum) * t; cb = lum + (cb - lum) * t
        }
        px[i] = Math.round(cr * 255)
        px[i + 1] = Math.round(cg * 255)
        px[i + 2] = Math.round(cb * 255)
    }
    if (band)
        compositeSpriteOutline(px, band)
    variant.getContext('2d').putImageData(data, 0, 0)
    variant.contentVersion = (variant.contentVersion || 0) + 1
}
function teamColourFromHsv(h, s, v) {
    const k = n => (n + h * 6) % 6
    const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1))
    return [f(5), f(3), f(1)]
}

// Menu fonts (assets/fonts, OFL.txt): the menu draws its texts in these families (menu/menu.js), the game keeps
// Times New Roman. Each family lists Times New Roman after it, so a font that fails to load falls back to it.
const MENU_FONT_FAMILY = "'Alegreya Sans', 'Times New Roman'"
const MENU_TITLE_FONT_FAMILY = "'Alegreya Sans SC', 'Times New Roman'"
const MENU_FONT_FILES = [
    {family: 'Alegreya Sans', weight: 400, file: 'AlegreyaSans-400.woff2'},
    {family: 'Alegreya Sans', weight: 500, file: 'AlegreyaSans-500.woff2'},
    {family: 'Alegreya Sans SC', weight: 700, file: 'AlegreyaSansSC-700.woff2'},
    {family: 'Alegreya Sans SC', weight: 800, file: 'AlegreyaSansSC-800.woff2'},
]
// The load result per font file; null until loadMenuFonts settles.
let menuFontResults = null
let menuFontsReady = null
// Starts loading every menu font; the promise settles when all have loaded or failed, or after timeoutMs.
// Without FontFace (headless contexts) there is nothing to load and the promise is null.
function loadMenuFonts(timeoutMs = 4000) {
    if (typeof FontFace !== 'function' || typeof document === 'undefined' || !document.fonts)
        return null
    const loads = MENU_FONT_FILES.map(({family, weight, file}) =>
        new FontFace(family, `url(assets/fonts/${file})`, {weight: String(weight)}).load().then(face => {
            document.fonts.add(face)
            return {family, weight, file, status: 'loaded'}
        }, error => ({family, weight, file, status: 'failed', error: String(error?.message ?? error)})))
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
    return Promise.race([Promise.all(loads), timeout]).then(results => {
        menuFontResults = results ?? MENU_FONT_FILES.map(({family, weight, file}) => ({family, weight, file, status: 'timeout'}))
        return menuFontResults
    })
}
function loadAssets() {
    menuFontsReady = loadMenuFonts()
    // TASK-1669: the menu's Play online emblem tiles, built in idle time while the menu's fonts and images load.
    if (typeof menuEmblemPrebuild == 'function')
        menuEmblemPrebuild()
    assets.logo.src = "assets/logo.svg"
    assets.checkMark.src = "assets/checkMark.svg"

    assets.leftButton.src = "assets/leftButton.svg"
    assets.rightButton.src = "assets/rightButton.svg"

    assets.clock.src = "assets/clock.svg"
    assets.i.src = "assets/i.svg"
    assets.undo.src = "assets/undo.svg"
    
    assets.gold.src = "assets/gold.svg"
    for (const name in statIconImages) assets[name].src = statIconImages[name]

    // The game sprites the menu draws now, the others once the menu has started (waitForImagesLoad).
    loadSprites(spriteImages.filter(name => MENU_CRITICAL_IMAGES.includes(name)))
}
// staggered (TASK-1669: the game sprites behind the menu): requested SPRITE_LOAD_CONCURRENCY at a time, the next an idle
// callback after one has loaded (spriteLoadDone), so the browser's parse of each SVG document (50-100 ms for the large
// unit sprites) falls between menu frames instead of all of them in one 1 s task when they all arrive at once.
function loadSprites(names = spriteImages, staggered = false) {
    if (staggered && typeof requestIdleCallback == 'function') {
        spriteLoadQueue.push(...spriteImages.filter(name => names.includes(name) && !spriteLoadQueue.includes(name)))
        pumpSpriteLoads()
        return
    }
    // Requested now: none of them waits in the queue any more.
    spriteLoadQueue = spriteLoadQueue.filter(name => !names.includes(name))
    setSpriteSources(names)
}
const SPRITE_LOAD_CONCURRENCY = 3
let spriteLoadQueue = []
const spriteLoadsInFlight = new Set()
let spriteLoadPumpScheduled = false
function pumpSpriteLoads() {
    spriteLoadPumpScheduled = false
    while (spriteLoadsInFlight.size < SPRITE_LOAD_CONCURRENCY && spriteLoadQueue.length) {
        const name = spriteLoadQueue.shift()
        spriteLoadsInFlight.add(name)
        setSpriteSources([name])
    }
}
// A sprite's request settled (loaded, or failed for good): the next is requested an idle callback later.
function spriteLoadDone(name) {
    if (!spriteLoadsInFlight.delete(name) || spriteLoadPumpScheduled || !spriteLoadQueue.length)
        return
    spriteLoadPumpScheduled = true
    requestIdleCallback(pumpSpriteLoads, {timeout: 100})
}
function setSpriteSources(names) {
    let spritesFolder = otherSettings.usePolishedSprites ? "sprites" : "spritesOld"
    for (let i = 0; i < spriteImages.length; ++i) {
        if (!names.includes(spriteImages[i]))
            continue
        if (undeadSpriteImages.includes(spriteImages[i])) {
            assets[spriteImages[i]].src = "assets/" + spriteImages[i] + ".svg"
            continue
        }
        if (otherSettings.usePolishedSprites && otherSettings.atmosphericVisuals !== false &&
            atmosphericNatureImages.includes(spriteImages[i])) {
            assets[spriteImages[i]].src = "assets/atmosphere/nature/" + spriteImages[i] + ".svg"
            continue
        }
        if (otherSettings.usePolishedSprites && otherSettings.atmosphericVisuals !== false &&
            atmosphericBuildingImages[spriteImages[i]]) {
            assets[spriteImages[i]].src = atmosphericBuildingImages[spriteImages[i]]
            continue
        }
        const folder = demonSpriteImages.includes(spriteImages[i]) ? "sprites" : spritesFolder
        // The old theme has no mirrored archer art: archerLeft is the plain archer there.
        const file = folder == "spritesOld" && spriteImages[i] == 'archerLeft' ? 'archer' : spriteImages[i]
        assets[spriteImages[i]].src = "assets/" + folder + "/" + file + ".svg"
    }
}
// What the menu itself draws (menu/, the menu interfaces): the logo, check marks, slider arrows and the
// hot seat / tutorial / Play online banner emblems (MENU_EMBLEMS: 'normchel', 'noob', 'town'). The menu starts once
// these and the fonts are ready; the other game sprites load behind it, and every entry into a game waits for them
// (whenGameSpritesReady).
// TASK-1669: and the Play online emblem's town (MENU_EMBLEMS.towns), so the menu's first frame draws that banner whole
// (it was drawn without its emblem, then rasterized again once the town loaded).
const MENU_CRITICAL_IMAGES = ['logo', 'checkMark', 'leftButton', 'rightButton', 'normchel', 'noob', 'town']
function menuImagesSettled() {
    return MENU_CRITICAL_IMAGES.every(name => assets[name].complete || failedImages.has(name))
}
// True once every game sprite has loaded or failed and cacheAllImages ran; gameSpritesReady resolves then.
let gameSpritesLoaded = false
let resolveGameSprites
const gameSpritesReady = new Promise(resolve => resolveGameSprites = resolve)
// The game entry waiting for the sprites ({control}: the pressed menu control the menu marks 'Loading…'), or null.
let gameSpritesWaiting = null
// Runs run() once the game sprites are loaded and cached: at once when they already are, else when gameSpritesReady
// resolves, with the pressed control (Button.pressed) shown as loading meanwhile. A later entry replaces a waiting one.
function whenGameSpritesReady(run, control = Button.pressed) {
    if (gameSpritesLoaded)
        return run()
    const waiting = gameSpritesWaiting = {control, since: performance.now()}
    // TASK-1669: the sprites still queued (loadSprites staggered) are requested at once.
    if (spriteLoadQueue.length)
        loadSprites(spriteLoadQueue.slice())
    return gameSpritesReady.then(() => {
        if (gameSpritesWaiting !== waiting)
            return
        gameSpritesWaiting = null
        return run()
    })
}
function waitForImagesLoad() {
    if (!menuImagesSettled()) {
        requestAnimationFrame(waitForImagesLoad)
        return
    }
    if (typeof mainCanvas.addEventListener == 'function') {
        mainCanvas.addEventListener('contextlost', imageCacheContextLost)
        mainCanvas.addEventListener('contextrestored', restoreImageCaches)
    }
    // The first menu frame waits for the menu fonts (they load in parallel with the images). The other game sprites
    // are requested then, so they do not hold up the menu's own downloads. TASK-1669: and for the menu's pictures and
    // rasters, built ahead in idle pieces (menuWarm), so the first frame only draws them.
    const startMenu = () => {
        menu.start()
        loadSprites(spriteImages.filter(name => !MENU_CRITICAL_IMAGES.includes(name)), true)
    }
    const warmThenStart = () => typeof menuWarm == 'function' ? menuWarm(startMenu) : startMenu()
    if (menuFontsReady) menuFontsReady.then(warmThenStart)
    else warmThenStart()
}
// Called by every sprite load or failure: once every sprite has loaded or failed (a reloaded one counts again, so the
// count alone is not enough) it caches them all (once) and resolves gameSpritesReady.
function settleGameSprites() {
    if (gameSpritesLoaded || imagesCountLoaded < images.length ||
            !images.every(name => failedImages.has(name) || (assets[name].complete && assets[name].naturalWidth > 0)))
        return
    cacheStaleImages()
    gameSpritesLoaded = true
    resolveGameSprites()
}
