// Moves bars belong to units whose owner moves in parallel with the local viewer:
// online the local seat or a seat still pending this round, offline whooseTurn.
// Demons, AI, neutral and unknown owners never qualify, even with alwaysDisplayMovesBar.
function shouldShowMovesBar(unit) {
    if (!unit?.isUnit) return false
    const owner = players[unit.playerColor]
    if (!owner || owner.constructor !== Player) return false
    if (!otherSettings.alwaysDisplayMovesBar && unit.isFullMoves) return false
    if (unit.playerColor === whooseTurn) return true
    if (!gameSettings.isOnline) return false
    const pending = gameSettings.coop
        ? (typeof onlineCommit === 'undefined' ? null : onlineCommit?.pendingSeats)
        : (typeof onlineParallelPending === 'undefined' || onlineParallelPending?.gameRound !== gameRound
            ? null : onlineParallelPending.pendingSeats)
    return Array.isArray(pending) && pending.includes(unit.playerColor)
}

class Unit extends Entity {
    static visionRange = 3
    constructor(x, y, name) {
        super(x, y, new.target.type || name)
        // Town Duel keeps field units on neutral opening cells. Capture their owner
        // before registration; every other map continues to derive it from territory.
        if (gameSettings.tutorial?.id === 'tutorial-14')
            this.tutorialOwner = Unit.restoringTutorialOwner ?? super.playerColor
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
        refreshCoopVision()
    }
    static withTutorialOwner(owner, construct) {
        const previous = Unit.restoringTutorialOwner
        try {
            Unit.restoringTutorialOwner = gameSettings.tutorial?.id === 'tutorial-14' &&
                Number.isInteger(owner) && players[owner] ? owner : undefined
            return construct()
        } finally {
            Unit.restoringTutorialOwner = previous
        }
    }
    get playerColor() {
        return this.tutorialOwner ?? super.playerColor
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
        if (this.tutorialOwner !== undefined) res.tutorialOwner = this.tutorialOwner
        // Older saves have no IDs; retain their wire format while preserving
        // identities supplied by a scenario or multiplayer controller.
        if (this.id !== undefined) res.id = this.id
        return res
    }
    get isMovesOver() {
        return this.interaction.isMovesOver
    }
    get info() {
        let unit = super.info
        if (this.constructor.type)
            unit.displayName = DEMON_TYPES[this.constructor.type].name
        unit.info.dmg = this.dmg
        // Preserve the independent speed row for foreign units.
        if (!this.isMyTurn)
            unit.info.speed = this.speed

        unit.canSkipMoves = this.isMyTurn && this.moves != 0

        if (this.showsMovesRow)
            unit.info.moves = this.moves + ' / ' + this.speed
        if (this.player.showsUnitSalary)
            unit.info.salary = this.salary
        return unit
    }
    // The panel's moves row: the viewer's own units (offline the current turn's
    // player, online the local seat) and, in co-op, a human ally's. Enemies,
    // demons, AI and neutral units show none.
    get showsMovesRow() {
        if (this.isMyTurn) return true
        const owner = this.player
        return Boolean(gameSettings.coop && owner && owner.constructor === Player &&
            owner.isAlliedWith(players[whooseTurn]))
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
    cellHasTeammate(cell) {
        // Passable nature only reports the hex colour; it is not a teammate building.
        // An unknown cell (hidden-information board) has no owner, so its entities (public terrain) are
        // nobody's teammates: their player is players[null].
        return !cell.hexagon.unknown && [cell.unit, cell.building].some(entity => entity.notEmpty() &&
            !(entity.isNature && entity.isPassable) &&
            entity.playerColor !== this.playerColor && this.player.isAlliedWith(entity.player))
    }
    canHitSomethingOnCell(cell) {
        return !this.cellHasTeammate(cell) && this.interaction.canHitSomethingOnCell(cell, this)
    }
    sendInstructions(cell) {
        if (!this.isMyTurn)
            return true
        // A rejected teammate target ends the selection like any finished command.
        if (this.cellHasTeammate(cell)) {
            this.removeSelect()
            return true
        }
        
        let noNeedInstructionsEnough = this.interaction.sendInstructions(cell, this)
        this.updateMovesBar()
        return noNeedInstructionsEnough
    }
    kill() {
        grid.setUnit(new Empty(), this.coord)

        this.killed = true
        refreshCoopVision()
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

        if (shouldShowMovesBar(this))
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
    getAvailableMoveCommands() {
        assert(this.isMyTurn)
        let coords = this.interaction.getAvailableMoveCommandDestinations(this)

        return this.createCommandsFromDestinations(
            coords.filter(coord => !this.cellHasTeammate(grid.getCell(coord))))
    }
    getAvailableCommands() {
        assert(this.isMyTurn)
        let coords = this.interaction.getAvailableCommandDestinations(this)

        return this.createCommandsFromDestinations(
            coords.filter(coord => !this.cellHasTeammate(grid.getCell(coord))))
    }
    draw(ctx) {
        this.drawBars(ctx)

        super.draw(ctx)
    }
}
