function getClass(name) {
    const classes = {
        imp: Imp,
        clawling: Clawling,
        hound: Hound,
        brute: Brute,
        bulwark: Bulwark,
        spitter: Spitter,
        emberArcher: EmberArcher,
        hexcaster: Hexcaster,
        ravager: Ravager,
        demonLord: DemonLord,
        bombard: Bombard,
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
