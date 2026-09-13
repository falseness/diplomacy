// Demons move with the standard path finder, but attack only adjacent cells.
class DemonMeleeInteraction extends InterationWithUnit {
    outsideMeleeReach(cell, unit) {
        return (this.cellHasEnemyUnit(cell, unit) || this.cellHasEnemyBuilding(cell, unit)) &&
            !unit.neighbours.some(coord => coordsEqually(coord, cell.coord))
    }
    getAvailableMoveCommandDestinations(unit) {
        return super.getAvailableMoveCommandDestinations(unit)
            .filter(coord => !this.outsideMeleeReach(grid.getCell(coord), unit))
    }
    getAvailableCommandDestinations(unit) {
        return this.getAvailableMoveCommandDestinations(unit)
    }
    canHitSomethingOnCell(cell, unit) {
        this.getAvailableCommandDestinations(unit)
        return !this.outsideMeleeReach(cell, unit) && super.canHitSomethingOnCell(cell, unit)
    }
    sendInstructions(cell, unit) {
        // Recompute legality so direct commands cannot use a stale selection.
        const legal = this.getAvailableCommandDestinations(unit)
            .some(coord => coordsEqually(coord, cell.coord))
        if (!legal) return true
        return super.sendInstructions(cell, unit)
    }
}

class EarlyMeleeDemon extends Unit {
    static get maxHP() { return DEMON_TYPES[this.type].health }
    static get dmg() { return DEMON_TYPES[this.type].damage }
    static get speed() { return DEMON_TYPES[this.type].movement }
    static healSpeed = 0
    static salary = 0
    constructor(x, y, name) {
        const slot = gameSettings.coop && gameSettings.coop.demonSlot
        if (!Number.isInteger(slot) || !players[slot] || players[slot].role !== 'DEMONS')
            throw new Error('demon unit requires demon ownership')
        super(x, y, name)
        Object.defineProperty(this, 'ownerSlot', {value: slot})
        this.interaction = new DemonMeleeInteraction(this.speed)
    }
    // Unit registers ownership during super(), before ownerSlot is assigned.
    get playerColor() { return this.ownerSlot === undefined ? gameSettings.coop.demonSlot : this.ownerSlot }
    draw(ctx) {
        ctx.save()
        ctx.fillStyle = this.player.fullColor
        ctx.beginPath()
        ctx.arc(this.pos.x + assets.size / 2, this.pos.y + assets.size / 2,
            assets.size * 0.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(DEMON_TYPES[this.name].name[0], this.pos.x + assets.size / 2,
            this.pos.y + assets.size / 2)
        ctx.restore()
        this.drawBars(ctx)
    }
}
class Imp extends EarlyMeleeDemon {
    static type = 'imp'
    constructor(x, y) { super(x, y, 'imp') }
}
class Clawling extends EarlyMeleeDemon {
    static type = 'clawling'
    constructor(x, y) { super(x, y, 'clawling') }
}
class Hound extends EarlyMeleeDemon {
    static type = 'hound'
    constructor(x, y) { super(x, y, 'hound') }
}
