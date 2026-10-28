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
let spriteImages = ['town', 'farm', 'noob', 'archer',
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
}
// Repaints the existing cached canvases in place, so the grid surface cache image refs
// stay valid, then makes the next frame rebuild the surface cache.
function restoreImageCaches() {
    atmosphericBackground.invalidate()
    for (const name in cachedImages) {
        const image = assets[name]
        if (cachedImages[name] && image && image.complete && image.naturalWidth > 0)
            paintCachedImage(cachedImages[name], name)
    }
    if (typeof grid != 'undefined' && grid)
        grid.surfaceCacheState = undefined
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
        assets[spriteImages[i]].src = "assets/" + folder + "/" + spriteImages[i] + ".svg"
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
