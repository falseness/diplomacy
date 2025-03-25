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

        const imgGoldSize = 0.075 * WIDTH
        this.goldInfo = new ImageWithLabel(
            new JustImage('gold', {x: NaN, y: NaN}, imgGoldSize, imgGoldSize),
            new Text(NaN, NaN, imgGoldSize, 'gold'),
            {x: WIDTH / 2, y: firstY})

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
            this.goldInfo.textString = String(players[whooseTurn].gold)
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
    draw(ctx) {
        if (!this.visible)
            return

        this.background.draw(ctx)
        this.timeInfo.draw(ctx)
        
        if (!isFogOfWar)
            this.goldInfo.draw(ctx)
        
        this.roundText.draw(ctx)
        this.playerText.draw(ctx)
    }
}