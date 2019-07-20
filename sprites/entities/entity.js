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
    isKilled() {
        return this.killed
    }
    isHealing() {
        return this.hp != this.maxHP && !this.wasHitted
    }
    getHPIncrease() {
        if (this.wasHitted)
            return 0
        return Math.min(this.maxHP - this.hp, this.healSpeed)
    }
    getInfo() {
        let hp = this.hp
        if (this.isHealing())
            hp += ' (+' + this.getHPIncrease() + ')'
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
        drawImage(ctx, this.name, this.pos)
    }
    nextTurn() {
        console.log("ERROR entity next turn")
    }
}