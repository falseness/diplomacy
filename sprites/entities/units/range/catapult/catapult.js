class Catapult extends RangeUnit {
    constructor(x, y) {
        const hp = 3
        const healSpeed = 1
        const dmg = 1
        const speed = 1
        const salary = 6
        const range = 5
        super(x, y, 'catapult', hp, healSpeed, dmg, range, speed, salary)
        this.buildingDMG = 3
        this.mirrorX = false

        this.interaction = new InteractionWithCatapult(speed, range)
    }
    get info() {
        let unit = super.info
        unit.info.dmg += '\nbuilding dmg: ' + this.buildingDMG
        return unit
    }
    draw(ctx) {
        this.hpBar.draw(ctx)
        drawCachedImage(ctx, cachedImages[this.mirrorX ? 'catapultLeft' : this.name], this.pos)
    }
}