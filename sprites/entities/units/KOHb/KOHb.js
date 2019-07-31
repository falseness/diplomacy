class KOHb extends Unit {
    constructor(x, y) {
        const hp = 3
        const healSpeed = 1
        const dmg = 1
        const speed = 3
        const salary = 4
        super(x, y, 'KOHb', hp, healSpeed, dmg, speed, salary)
        this.mirrorX = false
        this.interaction = new MirroringInteraction(speed)
    }
    draw(ctx) {
        this.hpBar.draw(ctx)
        drawCachedImage(ctx, cachedImages[this.mirrorX ? 'KOHbLeft' : this.name], this.pos)
    }
}