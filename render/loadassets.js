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
    bush: new Image()
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
let imagesCountLoaded = 0
let spriteImages = ['town', 'farm', 'noob', 'archer',
        'KOHb', 'KOHbLeft', 'normchel', 
        'catapult', 'catapultLeft', 'barrack', 'wall', 'bastion', 'tower',
        'mountain', 'lake', 'sea', 'goldmine', 'bush'].concat(demonSpriteImages, undeadSpriteImages)
let images = spriteImages.concat(grassHexImages)
// Images whose last request failed: they still count as loaded (so the menu starts) and are cached as a blank placeholder.
let failedImages = new Set()
for (let i = 0; i < images.length; ++i) {
    assets[images[i]].onload = function() {
        failedImages.delete(images[i])
        ++imagesCountLoaded
        cachedImages[images[i]] = cacheImage(images[i])
    }
    assets[images[i]].onerror = function() {
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
