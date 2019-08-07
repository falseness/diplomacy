class Archer extends RangeUnit {
    constructor(x, y) {
        const hp = 2
        const healSpeed = 1
        const dmg = 1
        const speed = 2
        const salary = 2
        const range = 2
        super(x, y, 'archer', hp, healSpeed, dmg, range, speed, salary)
        this.interaction = new InteractionWithArcher(speed, range)
    }
    get onHill() {
        return grid.getBuilding(this.coord).rangeIncrease
    }
    get rangeIncrease() {
        return grid.getBuilding(this.coord).rangeIncrease
    }
}