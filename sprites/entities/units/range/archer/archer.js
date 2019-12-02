class Archer extends RangeUnit {
    static maxHP = 1
    static healSpeed = 1
    static dmg = 2
    static speed = 2
    static salary = 2
    static range = 2
    constructor(x, y) {
        super(x, y, 'archer')
        this.interaction = new InteractionWithArcher(this.speed, this.range)
    }
    get onHill() {
        return grid.getBuilding(this.coord).rangeIncrease
    }
    get rangeIncrease() {
        return grid.getBuilding(this.coord).rangeIncrease
    }
}