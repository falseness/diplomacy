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
        super(x, y, 'demonPortal')
        Object.defineProperty(this, 'ownerSlot', {value: slot})
        external.push(this)
    }
    get playerColor() { return this.ownerSlot }
    get isDemonPortal() { return true }
    get isExternal() { return true }
    get canBeDestroyed() { return false }
    isObstacle(playerColor) { return playerColor === this.playerColor }
    toJSON() {
        const result = {...super.toJSON(), ownerSlot: this.ownerSlot}
        if (Object.prototype.hasOwnProperty.call(this, 'id')) result.id = this.id
        return result
    }
    hit(damage) {
        if (this.killed) return true
        if (!Number.isFinite(damage) || damage < 0) throw new RangeError('invalid portal damage')
        return super.hit(damage)
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
        const x = this.pos.x + assets.size / 2, y = this.pos.y + assets.size / 2
        ctx.save()
        ctx.fillStyle = '#210d31'
        ctx.strokeStyle = this.player.fullColor
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.ellipse(x, y, assets.size * 0.25, assets.size * 0.38, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    }
}
