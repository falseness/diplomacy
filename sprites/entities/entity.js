class Entity extends Sprite {
    constructor(x, y, name, hp) {
        super(x, y)
        this.hp = hp

        this.name = name
    }
    getInfo() {
        return {
            name: this.name,
            info: {
                hp: this.hp
            }
        }
    }
    select() {
        return true
    }
    removeSelect() {
        return true
    }
    draw(ctx) {
        drawImage(ctx, this.name, this.getPos())
    }
}