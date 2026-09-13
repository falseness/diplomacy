// Portals are combat objectives, never products or economic buildings.
class DemonPortal extends Building {
    static get maxHP() { return COOP_WAVE_CONFIG.portalHealth }
    static healSpeed = 0
    constructor(x, y) {
        const slot = gameSettings.coop && gameSettings.coop.demonSlot
        if (!Number.isInteger(slot) || !players[slot] || players[slot].role !== 'DEMONS')
            throw new Error('portal requires demon ownership')
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
        external.push(this)
    }
    get playerColor() { return this.ownerSlot }
    get isDemonPortal() { return true }
    get isExternal() { return true }
    get canBeDestroyed() { return false }
    get info() {
        const result = super.info
        result.displayName = 'Demon Portal'
        return result
    }
    isObstacle(playerColor) { return false }
    toJSON() {
        const result = {...super.toJSON(), ownerSlot: this.ownerSlot}
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
        DemonPortal.drawSymbol(ctx, this.pos.x + assets.size / 2,
            this.pos.y + assets.size / 2, assets.size, this.player.fullColor.hex)
    }
    drawBars(ctx) {
        if (!this.killed) this.hpBar.draw(ctx)
    }
    static drawSymbol(ctx, x, y, size, color) {
        ctx.save()
        ctx.fillStyle = '#210d31'
        ctx.strokeStyle = color
        ctx.lineWidth = size * 0.06
        ctx.beginPath()
        ctx.ellipse(x, y, size * 0.25, size * 0.38, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    }
}
