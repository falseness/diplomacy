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
let grassHexImages = Array.from({length: 6}, (_, i) => 'grass-hex/grass-hex-' + (i + 1))
for (let i = 0; i < grassHexImages.length; ++i)
    assets[grassHexImages[i]] = new Image()
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
let images = spriteImages.concat(grassHexImages)
// Images whose last request failed: they still count as loaded (so the menu starts) and are cached as a blank placeholder.
let failedImages = new Set()
for (let i = 0; i < images.length; ++i) {
    assets[images[i]].onload = function() {
        failedImages.delete(images[i])
        ++imagesCountLoaded
        cachedImages[images[i]] = cacheImage(images[i])
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
    let width = grassHexImages.includes(image) ? basis.hexHalfRectWithStrokeOffset.width * 2 : assets.size
    let height = grassHexImages.includes(image) ? basis.hexHalfRectWithStrokeOffset.height * 2 : assets.size

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
// Repaints the existing cached canvases in place, so hexagon.grassHexImage and the grid
// surface cache image refs stay valid, then makes the next frame rebuild the surface cache.
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

function loadAssets() {
    assets.logo.src = "assets/logo.svg"
    assets.checkMark.src = "assets/checkMark.svg"

    assets.leftButton.src = "assets/leftButton.svg"
    assets.rightButton.src = "assets/rightButton.svg"

    assets.clock.src = "assets/clock.svg"
    assets.i.src = "assets/i.svg"
    assets.undo.src = "assets/undo.svg"
    
    assets.gold.src = "assets/gold.svg"

    loadSprites()
    for (let i = 0; i < grassHexImages.length; ++i) {
        assets[grassHexImages[i]].src = "assets/" + grassHexImages[i] + ".svg"
    }
}
function loadSprites() {
    let spritesFolder = otherSettings.usePolishedSprites ? "sprites" : "spritesOld"
    for (let i = 0; i < spriteImages.length; ++i) {
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
function waitForImagesLoad() {
    if (imagesCountLoaded == images.length) {
        cacheAllImages()
        if (typeof mainCanvas.addEventListener == 'function') {
            mainCanvas.addEventListener('contextlost', () => requestAnimationFrame(restoreImageCaches))
            mainCanvas.addEventListener('contextrestored', restoreImageCaches)
        }
        menu.start()
        return 
    }
    //console.log(imagesCountLoaded)
    requestAnimationFrame(waitForImagesLoad)
}
