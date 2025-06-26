class Unit extends Entity {
    static visionRange = 3
    constructor(x, y, name) {
        super(x, y, name)
        //this.moves = speed
        grid.setUnit(this, this.coord)
        this.player.units.push(this)

        this.interaction = new InterationWithUnit(this.speed)
        this.hpBarMarginY = -basis.r * 0.125
        this.movesBarMarginY = basis.r * 0.1

        const movesBarW = basis.r * 0.4
        const movesBarH = basis.r * 0.225

        this.hpBar.healthColor = '#00e600'
        const movesColor = '#ffa500'
        this.movesBar = new Bar(
            {x: this.pos.x + assets.size / 2, 
            y: this.pos.y + assets.size / 2 + this.movesBarMarginY }, 
            this.speed, movesColor, undefined, 
            movesBarW, movesBarH)

        this.trimBars()
    }
    static get description() {
        let res = super.description

        res.info.dmg = this.dmg
        res.info.speed = this.speed
        res.info.salary = this.salary
        
        return res
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
    skipMoves() {
        this.interaction.skipMoves(this)
        this.updateMovesBar()
    }
    get dmg() {
        return this.constructor.dmg
    }
    get speed() {
        return this.constructor.speed
    }
    get visionRange() {
        return this.constructor.visionRange
    }
    get salary() {
        return this.constructor.salary
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

        unit.canSkipMoves = this.isMyTurn && this.moves != 0

        if (this.isMyTurn) {
            unit.info.moves = this.moves + ' / ' + this.speed    
        }
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
    get isFullMoves() {
        return this.moves == this.speed
    }
    changeFogOfWarByVision(value = 1) {
        let increasedVision = grid.getBuilding(this.coord).rangeIncrease
        grid.visionWay.changeFogOfWarByVision(this.coord, grid.fogOfWar, 
            this.visionRange, value, Boolean(increasedVision))
    }
    drawBars(ctx) {
        super.drawBars(ctx)

        if (this.isMyTurn && (otherSettings.alwaysDisplayMovesBar || !this.isFullMoves))
            this.movesBar.draw(ctx)
    }
    createCommandsFromDestinations(coords) {
        let result = []

        for (let i = 0; i < coords.length; ++i) {
            result.push({
                type: 'unit',
                whoDoCommandCoord: {x: this.coord.x, y: this.coord.y},
                destinationCoord: {x: coords[i].x, y: coords[i].y}
            })
        }
        return result
    }
    getAvailableCommands() {
        assert(this.isMyTurn)
        let coords = this.interaction.getAvailableCommandDestinations(this)

        return this.createCommandsFromDestinations(coords)
    }
    draw(ctx) {
        this.drawBars(ctx)

        super.draw(ctx)
    }
}