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
        // guaranteed healCount < hpCount 
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
// Health is decomposed independently into remaining and missing ten/one HP.
// Movement continues to use Bar above, with its original geometry and colors.
class HealthBar {
    constructor(pos, maxHP) {
        this.maxHP = maxHP
        this.healthColor = '#2bb52b'
        this.dmgColor = '#b3b3b3'
        this._pos = pos
        this.repaintRects(maxHP)
    }
    get pos() { return this._pos }
    set pos(pos) {
        this._pos = pos
        this.layout()
    }
    repaintRects(hp) {
        // Overkill affects gameplay HP, but cannot add missing-health boxes.
        const healthy = Math.max(0, Math.min(this.maxHP, Math.floor(hp)))
        const missing = this.maxHP - healthy
        this.rects = []
        for (const [count, value, filled] of [
            [Math.floor(healthy / 10), 10, true], [healthy % 10, 1, true],
            [missing % 10, 1, false], [Math.floor(missing / 10), 10, false]
        ]) {
            for (let i = 0; i < count; i++) {
                const rect = new Rect(0, 0, 0, 0)
                rect.hpValue = value
                rect.healthy = filled
                this.rects.push(rect)
            }
        }
        this.layout()
    }
    layout() {
        this.width = this.height = basis.r * 0.15
        const gap = basis.r * 0.05
        const total = this.rects.reduce((sum, rect) =>
            sum + this.width * (rect.hpValue === 10 ? 2 : 1), 0) +
            gap * Math.max(0, this.rects.length - 1)
        let x = this.pos.x - total / 2
        const centerY = this.pos.y - basis.r * 0.9 + this.height / 2
        for (const rect of this.rects) {
            rect.width = this.width * (rect.hpValue === 10 ? 2 : 1)
            rect.height = this.height * (rect.hpValue === 10 ? 2 : 1)
            rect.strokeWidth = basis.r * 0.03
            rect.color = rect.healthy ? this.healthColor : this.dmgColor
            rect.pos = {x, y: centerY - rect.height / 2}
            x += rect.width + gap
        }
    }
    draw(ctx) {
        this.layout()
        for (const rect of this.rects) rect.draw(ctx)
    }
}
