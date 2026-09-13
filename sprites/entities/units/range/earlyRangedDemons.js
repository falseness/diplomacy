// Configured demon ownership, stats and rendering with the existing archer rules.
class EarlyRangedDemon extends EarlyMeleeDemon {
    static get range() { return DEMON_TYPES[this.type].range }
    static get description() {
        const result = super.description
        result.info.range = this.range
        return result
    }
    constructor(x, y, name) {
        super(x, y, name)
        this.interaction = new InteractionWithArcher(this.speed, this.range)
    }
    get range() { return this.constructor.range }
    get onHill() { return grid.getBuilding(this.coord).rangeIncrease }
    get rangeIncrease() { return grid.getBuilding(this.coord).rangeIncrease }
}
class Spitter extends EarlyRangedDemon {
    static type = 'spitter'
    constructor(x, y) { super(x, y, 'spitter') }
}
class EmberArcher extends EarlyRangedDemon {
    static type = 'emberArcher'
    constructor(x, y) { super(x, y, 'emberArcher') }
}
