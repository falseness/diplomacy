function getClass(name) {
    const classes = {
        suburb: Suburb,
        noob: Noob, 
        archer: Archer, 
        normchel: Normchel,
        catapult: Catapult, 
        KOHb: KOHb,
        farm: Farm, 
        barrack: Barrack, 
        wall: Wall, 
        tower: Tower
    }
    return classes[name]
}