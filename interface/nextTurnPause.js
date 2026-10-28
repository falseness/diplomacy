class NextTurnPauseInterface {
    #visible = false
    constructor() {
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, 0, undefined, 
            undefined, 0.4)

        const imgClockSize = 0.05 * WIDTH
        const intervalY = 0.15 * HEIGHT
        const firstY = 0.4 * HEIGHT

        this.playerText = new Text(WIDTH / 2, 0.15 * HEIGHT, 
            0.1 * WIDTH, 'Player 0')

        // TASK-1367: the gold row is the statGold coin and the panels' formula 'G + I = T' (TASK-1354), centred at
        // the old row's place and font size, on a parchment plaque so its dark ink/green/red/gold read on any overlay.
        this.goldSize = 0.075 * WIDTH
        this.goldY = firstY
        // The plaque stops short of the clock row (on wide short screens, e.g. 844x390, the rows are close).
        this.goldPlaqueHeight = Math.min(1.5 * this.goldSize, 2 * (intervalY - imgClockSize / 2) - 0.01 * HEIGHT)
        this.goldFormula = null

        this.timeInfo = new ImageWithLabel(
            new JustImage('clock', {x: NaN, y: NaN}, imgClockSize, imgClockSize),
            new Text(NaN, NaN, imgClockSize, 'time'),
            {x: WIDTH / 2, y: firstY + intervalY})
        
        this.roundText = new Text(WIDTH / 2, firstY + 2 * intervalY, imgClockSize, 'error')
        
    }
    get visible() {
        return this.#visible
    }
    backToMenu() {
        // no need to update timer or info
        this.#visible = false
    }
    set visible(boolean) {
        this.#visible = boolean
        if (boolean) {
            this.background.color = players[whooseTurn].hexColor
            this.timeInfo.textString = timer.timerText
            this.goldFormula = parseGoldFormula(goldFormulaText(players[whooseTurn].gold, players[whooseTurn].income))
            this.playerText.text = 'Player ' + whooseTurn
            this.roundText.text = 'Round ' + gameRound
        }
        else {
            timer.updateLastPause()
            nextTurnButton.deactivate()
        }
    }
    hideButDontUpdateTimer() {
        this.#visible = false
    }
    click() {
        if (this.visible) {
            this.visible = false
            return true
        }
        return false
    }
    drawGold(ctx) {
        if (!this.goldFormula)
            return
        const f = this.goldSize, y = this.goldY, gap = 0.2 * f, pad = 0.35 * f, h = this.goldPlaqueHeight
        const width = f + gap + goldFormulaWidth(ctx, this.goldFormula, f)
        const x = WIDTH / 2 - width / 2
        ctx.save()
        roundedRectPath(ctx, x - pad, y - h / 2, width + 2 * pad, h, 0.3 * h)
        ctx.globalAlpha = 0.92
        ctx.fillStyle = '#f4e6c4'
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = TRAIN_PANEL_GOLD
        ctx.lineWidth = Math.max(1, 0.04 * f)
        ctx.stroke()
        const coin = assets.statGold
        if (coin && coin.complete && coin.naturalWidth > 0)
            ctx.drawImage(coin, x, y - f / 2, f, f)
        ctx.restore()
        drawGoldFormula(ctx, this.goldFormula, x + f + gap, y, f, Infinity)
    }
    draw(ctx) {
        if (!this.visible)
            return

        this.background.draw(ctx)
        this.timeInfo.draw(ctx)
        
        if (!isFogOfWar)
            this.drawGold(ctx)
        
        this.roundText.draw(ctx)
        this.playerText.draw(ctx)
    }
}