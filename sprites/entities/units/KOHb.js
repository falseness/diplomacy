class KOHb extends Unit {
    constructor(x, y, town) {
        super(x, y, 'KOHb', 5, 3, 4, 8, town)
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