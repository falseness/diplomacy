let assets = {
    size: 1.6 * basis.r,
    logo: new Image(),
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
    barrack: new Image()
}

function loadAssets() {
    assets.logo.src = "assets/logo.svg"
    assets.undo.src = "assets/undo.svg"
    
    assets.gold.src = "assets/gold.svg"
    assets.town.src = "assets/townhall.svg"
    assets.farm.src = "assets/farm.svg"
    assets.noob.src = "assets/noob.svg"
    assets.archer.src = "assets/archer.svg"
    
    assets.KOHb.src = "assets/KOHb.svg"
    assets.KOHbLeft.src = "assets/KOHbLeft.svg"
    
    assets.normchel.src = "assets/normchel.svg"
    
    assets.catapult.src = "assets/catapult.svg"
    assets.catapultLeft.src = "assets/catapultLeft.svg"
    
    assets.barrack.src = "assets/barrack.svg"
}