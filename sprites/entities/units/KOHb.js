class KOHb extends Unit {
    constructor(x, y, town) {
        const hp = 3
        const healSpeed = 2
        const dmg = 1
        const speed = 3
        const salary = 6
        super(x, y, 'KOHb', hp, healSpeed, dmg, speed, salary, town)
        this.mirrorX = false
    }
    move(coord, arr) {
        let oldX = this.coord.x
        super.move(coord, arr)
        let newX = this.coord.x

        this.mirrorX = newX < oldX
    }
    draw(ctx) {
        drawImage(ctx, this.mirrorX ? 'KOHbLeft' : this.name, this.getPos())
    }
}