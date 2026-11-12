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
// Main menu emblem pictures (town cells cut from in-game screenshots). The menu does not wait for them.
const menuImages = ['menu/towncell-red', 'menu/towncell-green']
for (const name of menuImages) assets[name] = new Image()
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
        ++imagesCountLoaded
        cachedImages[images[i]] = cacheImage(images[i])
        settleGameSprites()
        if ((atmosphericNatureImages.includes(images[i]) || atmosphericBuildingImages[images[i]]) && typeof grid != 'undefined' && grid)
            grid.surfaceCacheState = undefined
    }
    assets[images[i]].onerror = function() {
        // A missing optional variant must not become a blank sprite.
        if (assets[images[i]].src.includes('/atmosphere/nature/') ||
                assets[images[i]].src.includes('/atmosphere/buildings/')) {
            assets[images[i]].src = 'assets/sprites/' + images[i] + '.svg'
            return
        }
        console.error('failed to load asset ' + images[i] + ': ' + assets[images[i]].src)
        failedImages.add(images[i])
        ++imagesCountLoaded
        cachedImages[images[i]] = cacheImage(images[i])
        settleGameSprites()
    }
}

function cacheImage(image) {
    let tmpCanvas = document.createElement('canvas')
    paintCachedImage(tmpCanvas, image)
    // The browser may drop an offscreen canvas backing store (backgrounded mobile tab).
    if (typeof tmpCanvas.addEventListener == 'function') {
        tmpCanvas.addEventListener('contextlost', () => requestAnimationFrame(restoreImageCaches))
        tmpCanvas.addEventListener('contextrestored', restoreImageCaches)
    }

    return tmpCanvas
}
function paintCachedImage(tmpCanvas, image) {
    let width = assets.size
    let height = assets.size

    tmpCanvas.width = width
    tmpCanvas.height = height

    let tmpCtx = tmpCanvas.getContext('2d')

    let pos = {
        x: width / 2,
        y: height / 2
    }
    if (!failedImages.has(image))
        drawImage(tmpCtx, image, pos, width, height)
    tmpCanvas.contentVersion = (tmpCanvas.contentVersion || 0) + 1 // TASK-1554 (InterfaceRecorder)
}
// Repaints the existing cached canvases in place, so the grid surface cache image refs
// stay valid, then makes the next frame rebuild the surface cache.
function restoreImageCaches() {
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
            restoreImageCaches()
    })
}
if (typeof window.addEventListener == 'function')
    window.addEventListener('pageshow', restoreImageCaches)
function cacheAllImages() {
    for (let i = 0; i < images.length; ++i) {
        cachedImages[images[i]] = cacheImage(images[i])
    }
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
            variant.addEventListener('contextlost', () => requestAnimationFrame(restoreImageCaches))
            variant.addEventListener('contextrestored', restoreImageCaches)
        }
        variants.set(key, variant)
    }
    // A new base canvas (sprites reloaded, theme switch), a repainted one (context loss: contentVersion) or a
    // changed assets.size rebuilds the variant in place, so references to it stay valid.
    if (variant.base !== base || variant.baseVersion !== base.contentVersion || variant.width !== base.width)
        paintTeamColourImage(variant, base, key)
    return variant
}
// TASK-1594: the player-colour variant at a given pixel size, rasterized from the SVG (the unit panel's portrait is
// drawn larger than the board's cached sprites): null when the board's image would be drawn as it is (not a polished
// player unit, polished sprites off, no colour, image not loaded). One kept per slot: the name by default (the panel
// shows one unit); the menu passes its own slot per picture (TASK-1595: tutorial cards, the hot seat faceoff's red and
// blue swordsmen), so pictures drawn in the same frame do not repaint each other.
const teamColourPortraits = new Map()
function teamColourPortrait(name, rgb, size, slot = name) {
    const image = assets[name]
    if (!teamColourVariants.has(name) || !rgb || !otherSettings.usePolishedSprites || failedImages.has(name) ||
            !image || !image.complete || !image.naturalWidth)
        return null
    size = Math.max(1, Math.round(size))
    const key = (rgb.r << 16) | (rgb.g << 8) | rgb.b
    const kept = teamColourPortraits.get(slot)
    if (kept && kept.key === key && kept.size === size && kept.src === image.src && kept.name === name)
        return kept.canvas
    const base = document.createElement('canvas')
    base.width = base.height = size
    base.getContext('2d').drawImage(image, 0, 0, size, size)
    const canvas = kept ? kept.canvas : document.createElement('canvas')
    paintTeamColourImage(canvas, base, key)
    teamColourPortraits.set(slot, {name, key, size, src: image.src, canvas})
    return canvas
}
// Repaints every built variant from its (repainted) base; restoreImageCaches calls it after a context loss.
function rebuildTeamColourImages() {
    for (const [name, variants] of teamColourVariants) {
        const base = cachedImages[name]
        if (!base || failedImages.has(name))
            continue
        for (const [key, variant] of variants)
            paintTeamColourImage(variant, base, key)
    }
}
// Cloth classes of the polished art (artifacts/concepts/units_concept_style/concept_art/ranged_demons/vsvg.py
// unit_recolored): red cloth hue < 0.045 or > 0.93 with saturation > 0.45 (and max channel > 0.12), blue cloth
// 0.55 < hue < 0.75 with saturation > 0.35. Hue in [0, 1), HSV saturation.
function teamColourIsCloth(h, s, mx) {
    return ((h < 0.045 || h > 0.93) && s > 0.45 && mx > 0.12) || (h > 0.55 && h < 0.75 && s > 0.35)
}
function teamColourHsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    let h = 0
    if (d > 0)
        h = (mx == r ? ((g - b) / d + 6) % 6 : mx == g ? (b - r) / d + 2 : (r - g) / d + 4) / 6
    return [h, mx > 0 ? d / mx : 0, mx]
}
function paintTeamColourImage(variant, base, key) {
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
    const pr = ((key >> 16) & 255) / 255, pg = ((key >> 8) & 255) / 255, pb = (key & 255) / 255
    const [ph, ps] = teamColourHsv(pr, pg, pb)
    // The player's colour at full value: the cloth hue target (r, g, b sum to its own luminance below).
    const [hr, hg, hb] = teamColourFromHsv(ph, 1, 1)
    // Mean cloth saturation of the base: a cloth pixel keeps its saturation relative to it.
    let clothSat = 0, cloth = 0
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] == 0) continue
        const [h, s, mx] = teamColourHsv(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255)
        if (teamColourIsCloth(h, s, mx)) { clothSat += s; ++cloth }
    }
    const satScale = cloth ? ps / (clothSat / cloth) : 0
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] == 0) continue
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
        const [h, s, mx] = teamColourHsv(r, g, b)
        if (!teamColourIsCloth(h, s, mx)) continue
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
    assets.logo.src = "assets/logo.svg"
    assets.checkMark.src = "assets/checkMark.svg"

    assets.leftButton.src = "assets/leftButton.svg"
    assets.rightButton.src = "assets/rightButton.svg"

    assets.clock.src = "assets/clock.svg"
    assets.i.src = "assets/i.svg"
    assets.undo.src = "assets/undo.svg"
    
    assets.gold.src = "assets/gold.svg"
    for (const name of menuImages) assets[name].src = "assets/" + name + ".png"
    for (const name in statIconImages) assets[name].src = statIconImages[name]

    // The game sprites the menu draws now, the others once the menu has started (waitForImagesLoad).
    loadSprites(spriteImages.filter(name => MENU_CRITICAL_IMAGES.includes(name)))
}
function loadSprites(names = spriteImages) {
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
// hot seat / tutorial banner emblems (MENU_EMBLEMS: 'normchel', 'noob'). The menu starts once these and the fonts are
// ready; the other game sprites load behind it, and every entry into a game waits for them (whenGameSpritesReady).
const MENU_CRITICAL_IMAGES = ['logo', 'checkMark', 'leftButton', 'rightButton', 'normchel', 'noob']
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
        mainCanvas.addEventListener('contextlost', () => requestAnimationFrame(restoreImageCaches))
        mainCanvas.addEventListener('contextrestored', restoreImageCaches)
    }
    // The first menu frame waits for the menu fonts (they load in parallel with the images). The other game sprites
    // are requested then, so they do not hold up the menu's own downloads.
    const startMenu = () => {
        menu.start()
        loadSprites(spriteImages.filter(name => !MENU_CRITICAL_IMAGES.includes(name)))
    }
    if (menuFontsReady) menuFontsReady.then(startMenu)
    else startMenu()
}
// Called by every sprite load or failure: once every sprite has loaded or failed (a reloaded one counts again, so the
// count alone is not enough) it caches them all (once) and resolves gameSpritesReady.
function settleGameSprites() {
    if (gameSpritesLoaded || imagesCountLoaded < images.length ||
            !images.every(name => failedImages.has(name) || (assets[name].complete && assets[name].naturalWidth > 0)))
        return
    cacheAllImages()
    gameSpritesLoaded = true
    resolveGameSprites()
}
