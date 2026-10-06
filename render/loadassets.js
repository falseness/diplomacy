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
    'demonPortalHeavy', 'demonPortalSupport', 'demonPortalChaos', 'demonPortalMage']
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

    return tmpCanvas
}
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
        menu.start()
        return 
    }
    //console.log(imagesCountLoaded)
    requestAnimationFrame(waitForImagesLoad)
}
