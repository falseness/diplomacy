class KOHb extends Unit {
    static maxHP = 3
    static healSpeed = 2
    static dmg = 2
    static speed = 4
    static salary = 2
    constructor(x, y) {
        super(x, y, 'KOHb')
        this.mirrorX = false
        this.interaction = new MirroringInteraction(this.speed)
    }
    static get description() {
        let res = super.description
        res.name = this.name
        return res
    }
    draw(ctx) {
        this.drawBars(ctx)
        drawCachedImage(ctx, cachedImages[this.mirrorX ? 'KOHbLeft' : this.name], this.pos)
    }
}