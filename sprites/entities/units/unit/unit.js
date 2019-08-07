class Unit extends Entity {
    constructor(x, y, name, hp, healSpeed, dmg, speed, salary) {
        super(x, y, name, hp, healSpeed)
        this.dmg = dmg
        this.salary = salary
        //this.moves = speed
        grid.setUnit(this, this.coord)
        this.player.units.push(this)

        this.interaction = new InterationWithUnit(speed)
        this.hpBarMarginY = -basis.r * 0.1
        this.movesBarMarginY = basis.r * 0.1
        this.hpBar = new Bar(
            {x: this.pos.x + assets.size / 2, 
            y: this.pos.y + assets.size / 2 + this.hpBarMarginY}, 
            this.maxHP)
        const movesColor = '#ffa500'
        this.movesBar = new Bar(
            {x: this.pos.x + assets.size / 2, 
            y: this.pos.y + assets.size / 2 + this.movesBarMarginY }, 
            this.speed, movesColor)
    }
    trimBars() {
        this.hpBar.pos = 
            {x: this.pos.x + assets.size / 2, 
            y: this.pos.y + assets.size / 2 + this.hpBarMarginY}
        this.movesBar.pos = 
            {x: this.pos.x + assets.size / 2, 
            y: this.pos.y + assets.size / 2 + this.movesBarMarginY}
    }
    get moves() {
        return this.interaction.moves
    }
    set moves(moves) {
        this.interaction.moves = moves
        this.updateMovesBar()
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
        
        let noNeedInstructionsEnough = this.interaction.sendInstructions(cell, this)
        this.updateMovesBar()
        return noNeedInstructionsEnough
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
    updateHPBar() {
        this.hpBar.repaintRects(this.hp)
    }
    updateMovesBar() {
        this.movesBar.repaintRects(this.moves)
    }
    nextTurn() {
        this.interaction.nextTurn()
        
        this.hp += this.hpIncrease
        this.updateHPBar()
        this.updateMovesBar()
        
        this.wasHitted = false
    }
    hit(dmg) {
        super.hit(dmg)
        this.updateHPBar()
    }
    draw(ctx) {
        this.hpBar.draw(ctx)

        if (this.isMyTurn)
            this.movesBar.draw(ctx)

        super.draw(ctx)
    }
}