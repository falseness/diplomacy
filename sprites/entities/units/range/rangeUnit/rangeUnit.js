class RangeUnit extends Unit {
    constructor(x, y, name) {
        super(x, y, name)

        this.interaction = new InteractionWithRangeUnit(this.speed, this.range)
    }
    static get description() {
        let res = super.description

        res.info.range = this.range
        
        return res
    }
    get range() {
        return this.constructor.range
    }
}