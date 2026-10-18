// Movement tween (PRD sec. 8, 9.2), UI only: the unit's coord changes at once (rules and
// state are unaffected); only its drawn position slides along the path, msPerCell per cell.
// A new tween for the same unit, or cancel, interrupts the running one. Started by
// applyCellDiff from a paths hint and by the replay viewer; off when otherSettings.animateMoves
// is false (the sprite jumps).
const moveTween = {
    msPerCell: 120,
    tweens: new Map(),
    // Clock in ms; tests may replace it.
    now() {
        return typeof performance != 'undefined' ? performance.now() : Date.now()
    },
    // path: cells from the start to the unit's current (target) cell.
    start(unit, path) {
        this.cancel(unit)
        if (!otherSettings.animateMoves || !unit || unit.isEmpty() ||
                !Array.isArray(path) || path.length < 2)
            return false
        const last = path[path.length - 1]
        if (last.x !== unit.coord.x || last.y !== unit.coord.y)
            return false
        this.tweens.set(unit, {
            path: path.map(cell => ({x: cell.x, y: cell.y})),
            startTime: this.now()
        })
        return true
    },
    cancel(unit) {
        return this.tweens.delete(unit)
    },
    clear() {
        this.tweens.clear()
    },
    // {pos, from, to, progress} of a running tween, else null (a finished, moved or killed
    // unit's tween is dropped).
    state(unit, now = this.now()) {
        const tween = this.tweens.get(unit)
        if (!tween)
            return null
        const path = tween.path
        const target = path[path.length - 1]
        const elapsed = Math.max(0, now - tween.startTime)
        const total = (path.length - 1) * this.msPerCell
        if (elapsed >= total || unit.killed || grid.getUnit(unit.coord) !== unit ||
                target.x !== unit.coord.x || target.y !== unit.coord.y) {
            this.tweens.delete(unit)
            return null
        }
        const segment = Math.floor(elapsed / this.msPerCell)
        const t = elapsed / this.msPerCell - segment
        const from = unit.calcPos.call({coord: path[segment]})
        const to = unit.calcPos.call({coord: path[segment + 1]})
        return {
            pos: {x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t},
            from: path[segment],
            to: path[segment + 1],
            progress: elapsed / total
        }
    },
    isActive(unit) {
        return this.tweens.has(unit) && this.state(unit) !== null
    },
    // Where the unit is drawn now.
    drawPos(unit) {
        const state = this.state(unit)
        return state ? state.pos : unit.pos
    },
    isVisible(state) {
        return !isFogOfWar || Boolean(grid.fogOfWar[state.from.x][state.from.y]) ||
            Boolean(grid.fogOfWar[state.to.x][state.to.y])
    },
    // Tweening units are left out of the grid's entity passes and drawn here, on top.
    draw(ctx) {
        if (!this.tweens.size)
            return
        const now = this.now()
        for (const unit of [...this.tweens.keys()]) {
            const state = this.state(unit, now)
            if (!state || !this.isVisible(state))
                continue
            drawCachedImage(ctx, cachedImages[grid.getEntityBodyImageName(unit)], state.pos)
            ctx.save()
            ctx.translate(state.pos.x - unit.pos.x, state.pos.y - unit.pos.y)
            unit.drawBars(ctx)
            ctx.restore()
        }
    }
}
