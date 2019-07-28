class Unit extends Entity {
    constructor(x, y, name, hp, healSpeed, dmg, speed, salary) {
        super(x, y, name, hp, healSpeed)
        this.dmg = dmg
        this.salary = salary
        //this.moves = speed
        grid.setUnit(this, this.coord)
        this.player.units.push(this)

        this.interaction = new InterationWithUnit(speed)
    }
    get moves() {
        return this.interaction.moves
    }
    set moves(moves) {
        this.interaction.moves = moves
    }
    get speed() {
        return this.interaction.speed
    }
    toJSON() {
        let res = super.toJSON()
        res.moves = this.moves
        return res
    }
    get isMovesOver() {
        return this.interaction.isMovesOver
    }
    get info() {
        let unit = super.info
        unit.info.dmg = this.dmg

        if (this.isMyTurn)
            unit.info.moves = this.moves + ' / ' + this.speed

        unit.info.salary = this.salary
        return unit
    }
    select() {
        this.interaction.select(this)
    }
    removeSelect() {
        this.interaction.removeSelect()
    }
    needInstructions() { 
        if (!this.isMyTurn)
            return false

        return this.interaction.needInstructions()
    }
    sendInstructions(cell) {
        if (!this.isMyTurn)
            return true
        return this.interaction.sendInstructions(cell, this)
    }
    kill() {
        grid.setUnit(new Empty(), this.coord)

        this.killed = true
    }
    get isUnit() {
        return true
    }
    get isOnSuburbHexagon() {
        return grid.getHexagon(this.coord).isSuburb
    }
    get isHealing() {
        if (!this.isOnSuburbHexagon)
            return false
        return super.isHealing
    }
    get hpIncrease() {
        if (!this.isOnSuburbHexagon)
            return 0
        return super.hpIncrease
    }
    nextTurn() {
        this.interaction.nextTurn()
        
        this.hp += this.hpIncrease
        
        this.wasHitted = false
    }
}