class Entity extends Sprite {
    constructor(x, y, name, hp, healSpeed) {
        super(x, y)
        this.hp = hp
        this.maxHP = hp
        
        this.killed = this.hp <= 0
        
        this.healSpeed = healSpeed
        this.wasHitted = false
        
        this.name = name
    }
    toJSON() {
        let res = {
            name: this.name,
            coord: {
                x: this.coord.x,
                y: this.coord.y
            },
            hp: this.hp,
            wasHitted: this.wasHitted
        }
        return res
    }
    get playerColor() {
        return grid.getHexagon(this.coord).playerColor
    }
    get player() {
        return players[this.playerColor]
    }
    get isPassable() {
        return false
    }
    get isHealing() {
        return this.hp != this.maxHP && !this.wasHitted
    }
    get hpIncrease() {
        if (this.wasHitted)
            return 0
        return Math.min(this.maxHP - this.hp, this.healSpeed)
    }
    get info() {
        let hp = this.hp
        if (this.isHealing)
            hp += ' (+' + this.hpIncrease + ')'
        hp += ' / ' + this.maxHP
        return {
            name: this.name,
            info: {
                hp: hp
            }
        }
    }
    hit(dmg) {
        this.hp -= dmg
        this.wasHitted = true
        if (this.hp <= 0)
            this.kill()

        return this.killed
    }
    get isMyTurn() {
        return this.playerColor == whooseTurn
    }
    select() {
        return true
    }
    removeSelect() {
        return true
    }
    isBuildingProduction() {
        return false
    }
    get isBuilding() {
        return false
    }
    get isUnit() {
        return false
    }
    draw(ctx) {
        drawImage(ctx, this.name, this.pos)
    }
    nextTurn() {
        console.log("ERROR entity next turn")
    }
}