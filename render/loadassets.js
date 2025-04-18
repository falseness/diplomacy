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
let imagesCountLoaded = 0
let images = ['town', 'farm', 'noob', 'archer',
        'KOHb', 'KOHbLeft', 'normchel', 
        'catapult', 'catapultLeft', 'barrack', 'wall', 'bastion', 'tower',
        'mountain', 'lake', 'sea', 'goldmine', 'bush']
for (let i = 0; i < images.length; ++i) {
    assets[images[i]].onload = function() {
        ++imagesCountLoaded
    }
}

function cacheImage(image) {
    let tmpCanvas = document.createElement('canvas')
    
    tmpCanvas.width = assets.size
    tmpCanvas.height = assets.size

    let tmpCtx = tmpCanvas.getContext('2d')

    let pos = {
        x: assets.size / 2,
        y: assets.size / 2
    }
    drawImage(tmpCtx, image, pos)

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
    
    for (let i = 0; i < images.length; ++i) {
        assets[images[i]].src = "assets/" + images[i] + ".svg"
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