class RangeUnit extends Unit {
    constructor(x, y, name, hp, healSpeed, dmg, range, speed, salary) {
        super(x, y, name, hp, healSpeed, dmg, speed, salary)

        this.interaction = new InteractionWithRangeUnit(speed, range)
    }
}