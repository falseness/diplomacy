function getClass(name) {
    const classes = {
        imp: Imp,
        clawling: Clawling,
        hound: Hound,
        suburb: Suburb,
        noob: Noob, 
        archer: Archer, 
        normchel: Normchel,
        catapult: Catapult, 
        KOHb: KOHb,
        farm: Farm, 
        barrack: Barrack, 
        wall: Wall, 
        bastion: Bastion,
        tower: Tower
    }
    return classes[name]
}
