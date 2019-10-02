class Catapult extends RangeUnit {
    static maxHP = 3
    static healSpeed = 1
    static dmg = 1
    static speed = 1
    static salary = 3
    static range = 5
    static buildingDMG = 3
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