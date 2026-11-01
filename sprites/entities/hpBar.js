class Bar {
    #pos
    constructor(pos, hpCount, healthColor = '#2bb52b', dmgColor = '#b3b3b3', 
        w = basis.r * 0.15, h = basis.r * 0.15) {
        this.rects = new Array(hpCount)
        this.width = w//#00ff00
        this.height = h
        this.healthColor = healthColor
        this.dmgColor = dmgColor
        
        const strokeWidth = basis.r * 0.03  
        for (let i = 0; i < this.rects.length; ++i) {
            this.rects[i] = new Rect(
                NaN, NaN,
                this.width, this.height, undefined, strokeWidth, 
                this.healthColor, 'black'
            )
        }
        this.pos = pos
    }
    get pos() {
        return this.#pos
    }
    set pos(pos) {

        const intervalX = basis.r * 0.05
        const marginY = -basis.r * 0.9
        let hpBarWidth = this.width * this.rects.length + 
            intervalX * (this.rects.length - 1)

        for (let i = 0; i < this.rects.length; ++i) {
            this.rects[i].pos = 
                {x: pos.x - hpBarWidth / 2 + i * this.width + i * intervalX,
                y: pos.y + marginY}
        }
    }
    repaintRects(healthCount) {
        if (healthCount < 0)
            return
        // A save from before a speed cut can hold more moves than the bar has boxes.
        healthCount = Math.min(healthCount, this.rects.length)
        for (let i = 0; i < healthCount; ++i) {
            this.rects[i].color = this.healthColor
        }
        for (let i = healthCount; i < this.rects.length; ++i) {
            this.rects[i].color = this.dmgColor
        }
    }
    draw(ctx) {
        for (let i = 0; i < this.rects.length; ++i) {
            this.rects[i].draw(ctx)
        }
    }
}
// Health is decomposed independently into remaining and missing big (HealthBar.BIG HP, drawn at 2x size) and
// one-HP boxes. Movement continues to use Bar above, with its original geometry and colors.
// TASK-1491: the hp the entity heals at its owner's next turn start (Entity.hpIncrease, the 'pending' argument) is
// drawn as pending one-HP boxes between the healthy and the missing ones; the missing hp left after it is decomposed
// as before, so a big missing box the pending hp reaches is split into one-HP boxes.
// TASK-1509: a pending box is dark (pendingColor) with a white heart (pendingMarkColor) inside its rim (concept Y36);
// the bar draws the heart itself, so every place that draws a HealthBar shows it.
class HealthBar {
    static BIG = 5
    // Count of repaintRects calls (TASK-1491 sync evidence: Entity.syncHPBar repaints only on a change).
    static repaints = 0
    constructor(pos, maxHP) {
        this.maxHP = maxHP
        this.healthColor = '#2bb52b'
        this.dmgColor = '#b3b3b3'
        this.pendingColor = '#1a1a1a'
        this.pendingMarkColor = '#ffffff'
        this._pos = pos
        this.repaintRects(maxHP)
    }
    get pos() { return this._pos }
    set pos(pos) {
        this._pos = pos
        this.layout()
    }
    repaintRects(hp, pending = 0) {
        ++HealthBar.repaints
        // Overkill affects gameplay HP, but cannot add missing-health boxes.
        const healthy = Math.max(0, Math.min(this.maxHP, Math.floor(hp)))
        const missing = this.maxHP - healthy
        // The pending heal fills at most the missing hp (NaN, negative: none).
        const heal = Math.max(0, Math.min(missing, Math.floor(pending) || 0))
        const rest = missing - heal
        this.paintedHP = hp
        this.paintedPending = pending
        this.rects = []
        for (const [count, value, filled, pink] of [
            [Math.floor(healthy / HealthBar.BIG), HealthBar.BIG, true, false], [healthy % HealthBar.BIG, 1, true, false],
            [heal, 1, false, true],
            [rest % HealthBar.BIG, 1, false, false], [Math.floor(rest / HealthBar.BIG), HealthBar.BIG, false, false]
        ]) {
            for (let i = 0; i < count; i++) {
                const rect = new Rect(0, 0, 0, 0)
                rect.hpValue = value
                rect.healthy = filled
                rect.pending = pink
                this.rects.push(rect)
            }
        }
        this.layout()
    }
    // The box colour of a rect of this bar.
    colorOf(rect) {
        return rect.healthy ? this.healthColor : rect.pending ? this.pendingColor : this.dmgColor
    }
    layout() {
        this.width = this.height = basis.r * 0.15
        const gap = basis.r * 0.05
        const total = this.rects.reduce((sum, rect) =>
            sum + this.width * (rect.hpValue === HealthBar.BIG ? 2 : 1), 0) +
            gap * Math.max(0, this.rects.length - 1)
        let x = this.pos.x - total / 2
        const centerY = this.pos.y - basis.r * 0.9 + this.height / 2
        for (const rect of this.rects) {
            rect.width = this.width * (rect.hpValue === HealthBar.BIG ? 2 : 1)
            rect.height = this.height * (rect.hpValue === HealthBar.BIG ? 2 : 1)
            rect.strokeWidth = basis.r * 0.03
            rect.color = this.colorOf(rect)
            rect.pos = {x, y: centerY - rect.height / 2}
            x += rect.width + gap
        }
    }
    // The layout is redone only when what it reads changed (the rects themselves only change
    // in repaintRects and layout), not on every draw of every bar every frame.
    draw(ctx) {
        const pos = this.pos, key = this.laidOut
        if (!key || key.rects !== this.rects || key.x !== pos.x || key.y !== pos.y || key.r !== basis.r ||
                key.healthColor !== this.healthColor || key.dmgColor !== this.dmgColor ||
                key.pendingColor !== this.pendingColor) {
            this.layout()
            this.laidOut = {rects: this.rects, x: pos.x, y: pos.y, r: basis.r,
                healthColor: this.healthColor, dmgColor: this.dmgColor, pendingColor: this.pendingColor}
        }
        for (const rect of this.rects) {
            rect.draw(ctx)
            if (rect.pending) this.drawPendingMark(ctx, rect)
        }
    }
    // The heart of a pending box (concept Y36: 0.86 of the inner width), clipped to the box inside its rim.
    drawPendingMark(ctx, rect) {
        const sw = rect.strokeWidth, x = rect.x + sw / 2, y = rect.y + sw / 2, w = rect.width - sw, h = rect.height - sw
        if (!(w > 0 && h > 0)) return
        const cx = x + w / 2, cy = y + h / 2, s = w * 0.86, top = cy - s * 0.3
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, w, h)
        ctx.clip()
        ctx.beginPath()
        ctx.moveTo(cx, cy + s * 0.45)
        ctx.bezierCurveTo(cx - s * 0.6, cy + s * 0.02, cx - s * 0.55, top - s * 0.32, cx, top + s * 0.02)
        ctx.bezierCurveTo(cx + s * 0.55, top - s * 0.32, cx + s * 0.6, cy + s * 0.02, cx, cy + s * 0.45)
        ctx.fillStyle = this.pendingMarkColor
        ctx.fill()
        ctx.restore()
    }
}
