class Catapult extends RangeUnit {
    static maxHP = 1
    static healSpeed = 1
    static dmg = 0
    static speed = 2
    static salary = 2
    static range = 5
    static buildingDMG = 4
    constructor(x, y) {
        super(x, y, 'catapult')
        this.mirrorX = false

        this.interaction = new InteractionWithCatapult(this.speed, this.range)
    }
    static get description() {
        let res = super.description

        res.info.dmg += '\nbuilding dmg: ' + this.buildingDMG

        res.info.range = '2 - ' + this.range
        
        return res
    }
    get buildingDMG() {
        return this.constructor.buildingDMG
    }
    get info() {
        let unit = super.info
        unit.info.dmg += '\nbuilding dmg: ' + this.buildingDMG
        return unit
    }
    draw(ctx) {
        this.drawBars(ctx)
        drawCachedImage(ctx, cachedImages[this.mirrorX ? 'catapultLeft' : this.name], this.pos)
    }
}
// Siege demons share the catapult art and building damage/undo mechanics.
class Bombard extends Catapult {
    static range = 2
    static minimumRange = 2
    constructor(x, y) {
        super(x, y)
        this.interaction = new InteractionWithBombard(this.speed, this.range)
    }
    static get description() {
        const res = super.description
        res.info.target = 'enemy buildings only'
        return res
    }
    get info() {
        const res = super.info
        res.info.range = '2 - 2'
        res.info.target = 'enemy buildings only'
        return res
    }
    draw(ctx) {
        this.drawBars(ctx)
        drawCachedImage(ctx, cachedImages[this.mirrorX ? 'catapultLeft' : 'catapult'], this.pos)
    }
}
registerDemonVariant(Bombard, 'bombard', 'catapult')
