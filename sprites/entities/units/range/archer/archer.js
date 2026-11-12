class Archer extends RangeUnit {
    static maxHP = 1
    static healSpeed = 1
    static dmg = 2
    static speed = 2
    static salary = 2
    static range = 2
    constructor(x, y) {
        super(x, y, 'archer')
        this.mirrorX = false
        this.interaction = new InteractionWithArcher(this.speed, this.range)
    }
    // TASK-1597: a player archer has archerLeft art (mirrorX after a left move). Demon variants (Spitter, EmberArcher,
    // Hexcaster, DemonQueen) and the demon-owned undead archer keep their single image.
    get hasMirroredImage() {
        return this.constructor === Archer && this.player?.role !== 'DEMONS'
    }
    nextTurn() {
        super.nextTurn()
        this.interaction.updateRange(this)
    }
    // The attack range on this cell: base, or 'base + increase' on a hill, tower or town (InteractionWithArcher.updateRange).
    get info() {
        const unit = super.info
        const increase = grid.getBuilding(this.coord)?.rangeIncrease || 0
        if (increase > 0)
            unit.info.range = (this.range + increase) + ' (' + this.range + ' + ' + increase + ')'
        return unit
    }
    get onHill() {
        return grid.getBuilding(this.coord).rangeIncrease
    }
    get rangeIncrease() {
        return grid.getBuilding(this.coord).rangeIncrease
    }
}