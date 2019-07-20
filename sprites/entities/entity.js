class Entity extends Sprite {
    constructor(x, y, name, hp) {
        super(x, y)
        this.hp = hp
        this.killed = this.hp < -0

        this.name = name
    }
    isKilled() {
        return this.killed
    }
    getInfo() {
        return {
            name: this.name,
            info: {
                hp: this.hp
            }
        }
    }
    hit(dmg) {
        this.hp -= dmg
        if (this.hp <= 0)
            this.kill()
    }
    isMyTurn() {
        return this.getPlayer() == whooseTurn
    }
    select() {
        return true
    }
    removeSelect() {
        return true
    }
    isBuilding() {
        return false
    }
    isUnit() {
        return false
    }
    draw(ctx) {
        drawImage(ctx, this.name, this.getPos())
    }
}