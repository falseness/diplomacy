// Portals are combat objectives, never products or economic buildings.
class DemonPortal extends Building {
    static get maxHP() { return COOP_WAVE_CONFIG.portalHealth }
    static healSpeed = 0
    // Generated maps give every portal a category (ai/wave-config.js); portals
    // from older saves and authored fixtures have none.
    constructor(x, y, category) {
        const slot = gameSettings.coop && gameSettings.coop.demonSlot
        if (!Number.isInteger(slot) || !players[slot] || players[slot].role !== 'DEMONS')
            throw new Error('portal requires demon ownership')
        if (category !== undefined && !COOP_PORTAL_CATEGORIES.includes(category))
            throw new RangeError('invalid portal category')
        if (isCoordNotOnMap({x, y}, grid.arr.length, grid.arr[0].length) ||
                !grid.getBuilding({x, y}).isEmpty())
            throw new Error('portal requires empty building cell')
        const occupant = grid.getUnit({x, y})
        if (!occupant.isEmpty() && !players[slot].units.includes(occupant))
            throw new Error('portal requires empty or demon-occupied unit cell')
        // Setup and deserialization share ownership bookkeeping, without adding
        // a player action to the undo stack. The building cell is still empty.
        grid.getHexagon({x, y}).repaint(slot, false)
        super(x, y, 'demonPortal')
        Object.defineProperty(this, 'ownerSlot', {value: slot})
        if (category !== undefined) Object.defineProperty(this, 'category', {value: category})
        external.push(this)
    }
    get playerColor() { return this.ownerSlot }
    get isDemonPortal() { return true }
    get isExternal() { return true }
    get canBeDestroyed() { return false }
    // Each category has its own artwork (assets/sprites/demonPortal<Category>.svg);
    // the entity name stays 'demonPortal' for saves and ledgers.
    get imageName() {
        if (this.category === undefined) return 'demonPortal'
        return 'demonPortal' + this.category[0].toUpperCase() + this.category.slice(1)
    }
    get info() {
        const result = super.info
        result.displayName = 'demon portal'
        result.image = this.imageName
        return result
    }
    isObstacle(playerColor) { return false }
    toJSON() {
        const result = {...super.toJSON(), ownerSlot: this.ownerSlot}
        if (this.category !== undefined) result.category = this.category
        if (Object.prototype.hasOwnProperty.call(this, 'id')) result.id = this.id
        return result
    }
    hit(damage) {
        if (this.killed) return true
        if (!Number.isFinite(damage) || damage < 0) throw new RangeError('invalid portal damage')
        const destroyed = super.hit(damage)
        if (!destroyed && gameEvent.selected === this)
            entityInterface.change(this.info, this.player.fullColor)
        return destroyed
    }
    kill() {
        if (this.killed) return
        this.hp = 0
        this.killed = true
        if (grid.getBuilding(this.coord) === this) grid.setBuilding(new Empty(), this.coord)
        for (let i = external.length - 1; i >= 0; i--)
            if (external[i] === this) external.splice(i, 1)
        if (gameEvent.selected === this) gameEvent.removeSelection()
        this.updateHPBar()
    }
    draw(ctx) {
        if (this.killed) return
        drawCachedImage(ctx, cachedImages[this.imageName], this.pos)
    }
    drawBars(ctx) {
        if (!this.killed) this.hpBar.draw(ctx)
    }
}
