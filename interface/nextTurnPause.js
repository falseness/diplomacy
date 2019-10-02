class NextTurnPauseInterface {
    #visible = false
    constructor() {
        this.background = new Rect(0, 0, WIDTH, HEIGHT, undefined, 0, undefined, 
            undefined, 0.4)

        const imgClockSize = 0.05 * WIDTH
        this.timeInfo = new ImageWithLabel(
            new JustImage('clock', {x: NaN, y: NaN}, imgClockSize, imgClockSize),
            new Text(NaN, NaN, imgClockSize, 'time'),
            {x: WIDTH / 2, y: HEIGHT / 2})

        const imgGoldSize = 0.075 * WIDTH
        this.goldInfo = new ImageWithLabel(
            new JustImage('gold', {x: NaN, y: NaN}, imgGoldSize, imgGoldSize),
            new Text(NaN, NaN, imgGoldSize, 'gold'),
            {x: WIDTH / 2, y: HEIGHT / 2 - imgClockSize / 2 - imgGoldSize})
        
        this.playerText = new Text(WIDTH / 2, HEIGHT / 2 - imgClockSize / 2 - imgGoldSize * 2.5, 
            0.1 * WIDTH, 'Player 0')
        
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
            this.timeInfo.textString = String(timer.seconds)
            this.goldInfo.textString = String(players[whooseTurn].gold)
            this.playerText.text = 'Player ' + whooseTurn
        }
        else {
            timer.updateLastPause()
        }
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
        this.goldInfo.draw(ctx)
        this.playerText.draw(ctx)
    }
}