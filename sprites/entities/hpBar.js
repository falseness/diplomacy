class Bar {
    constructor(pos, hpCount, healthColor = '#00e600', dmgColor = '#b3b3b3', 
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